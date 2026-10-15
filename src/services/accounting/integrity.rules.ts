import type {
  IntegrityCheckStatus,
  IntegrityCutoffEvidence,
  IntegrityDisclosure,
  IntegrityEvidenceLevel,
  IntegrityLegacyBucket,
  IntegrityOverallStatus,
  IntegritySnapshotMarkerSource,
  IntegrityViolation,
  IntegrityViolationScope,
} from "./integrity.types";

// ============================================================
// ACCOUNTING INTEGRITY MONITORING — pure rules (DB-free)
//
// Mirrors the established split used by `coverage.ts` (Profitabilitas) and
// `pnl.rules.ts` (P&L): every decision that does not need I/O lives here so
// it can be unit-tested deterministically and shared.
// ============================================================

/**
 * The migration that created `orderitemcostsnapshot` (F.5). Orders COMPLETED
 * before it existed carry no snapshot by design; this is the ONLY proven
 * boundary between legacy and anomaly.
 *
 * WHAT IT PROVES: the schema/table existed in THIS database from that instant.
 * WHAT IT DOES NOT PROVE: when the snapshot-writing CODE was deployed, whether
 * it was running at the cutoff, or when the engine was activated. A completion
 * just after the cutoff therefore stays an anomaly (severity never lowered) —
 * it may be a false positive if the deploy lagged the migration.
 *
 * Evidence (repo + DB, read-only):
 *   - `prisma/migrations/20260911143644_f5_order_item_cost_snapshot/migration.sql`
 *   - AUDIT-F5-HISTORICAL-COGS-PROFITABILITY.md (11 September 2026)
 *   - `_prisma_migrations.finished_at` for this migration (read at runtime)
 */
export const LEGACY_CUTOFF_MIGRATION = "20260911143644_f5_order_item_cost_snapshot";

/**
 * Classify a COMPLETED item's completion time against the PROVEN cutoff.
 * Returns `unknownCompletion` when the cutoff is unresolved or the completion
 * time is missing/invalid — it NEVER guesses legacy/anomaly.
 */
export function classifyCompletionBucket(
  completedAt: Date | string | null | undefined,
  cutoff: Date | null
): IntegrityLegacyBucket {
  if (!cutoff) return "unknownCompletion";
  if (completedAt == null) return "unknownCompletion";
  const d = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (Number.isNaN(d.getTime())) return "unknownCompletion";
  return d.getTime() < cutoff.getTime() ? "legacyExpected" : "anomaly";
}

// ============================================================
// M2 — observed snapshot marker (lower bound only)
//
// The marker is an OBSERVATION, never an activation record. It is used for ONE
// purpose: to carve the window between the migration cutoff and the first
// snapshot ever observed for the tenant out of the anomaly bucket. It can never
// move the cutoff, and a missing/failed marker can never activate the carve.
// ============================================================

/**
 * A marker read plus its provenance. `firstObservedSnapshotAt` is a Date only
 * when the source is `SNAPSHOT_MIN_OBSERVED`; `population` is null only when the
 * read FAILED (a verified empty population is the number 0, not null).
 */
export interface IntegrityMarkerObservation {
  source: IntegritySnapshotMarkerSource;
  population: number | null;
  firstObservedSnapshotAt: Date | null;
}

/**
 * Build the marker observation from the RAW read result. Fails safe:
 * any shape that is not a verified non-empty population becomes UNVERIFIED
 * (never `POPULATION_EMPTY`, never an observed value).
 *
 * @param population  snapshot rows in the tenant scope, or null when the read failed
 * @param firstAt     MIN(completedAt) in the tenant scope, or null
 */
export function buildSnapshotMarker(input: {
  population: number | null;
  firstObservedSnapshotAt: Date | null;
}): IntegrityMarkerObservation {
  if (input.population === null) {
    return {
      source: "SNAPSHOT_MARKER_UNVERIFIED",
      population: null,
      firstObservedSnapshotAt: null,
    };
  }
  // A row count is never negative; clamp a nonsense value to "empty".
  const population = Math.max(0, input.population);
  if (population === 0) {
    return {
      source: "SNAPSHOT_POPULATION_EMPTY",
      population,
      firstObservedSnapshotAt: null,
    };
  }
  const marker = input.firstObservedSnapshotAt;
  // A non-empty population MUST yield a marker (completedAt is NOT NULL).
  // Anything else is an unverified read, never an observed value.
  if (!marker || Number.isNaN(marker.getTime())) {
    return {
      source: "SNAPSHOT_MARKER_UNVERIFIED",
      population,
      firstObservedSnapshotAt: null,
    };
  }
  return { source: "SNAPSHOT_MIN_OBSERVED", population, firstObservedSnapshotAt: marker };
}

/** true only when the carve is ALLOWED (marker genuinely observed). */
export function markerAllowsCarve(marker: IntegrityMarkerObservation): boolean {
  return (
    marker.source === "SNAPSHOT_MIN_OBSERVED" &&
    marker.firstObservedSnapshotAt !== null
  );
}

/**
 * The carve window start — the ONLY definition of "the carve is allowed".
 *
 * Returns the observed marker when (and only when) it is STRICTLY NEWER than
 * the proven cutoff; otherwise null (carve disabled → plain cutoff-only).
 *
 * Why the `> cutoff` guard is mandatory: a marker at/before the cutoff cannot
 * describe an activation window after the migration (it is a metadata anomaly,
 * e.g. restored/backdated snapshot rows). Carving with it would put the
 * `[marker, cutoff)` interval inside BOTH the legacy and the anomaly bucket, so
 * buckets would overlap and `legacy + beforeFirstSnapshot + anomaly + unknown`
 * would exceed the item total. It is also exactly what the pure classifier
 * below does for such input (an empty window).
 */
export function carveWindow(
  cutoff: Date | null,
  marker: IntegrityMarkerObservation
): Date | null {
  if (!cutoff) return null;
  if (!markerAllowsCarve(marker)) return null;
  const first = marker.firstObservedSnapshotAt;
  if (!first || Number.isNaN(first.getTime())) return null;
  return first.getTime() > cutoff.getTime() ? first : null;
}

/**
 * M2 classifier: cutoff + (only when observed AND newer than the cutoff) the
 * marker.
 *
 *   no cutoff / no completion time  -> unknownCompletion
 *   done <  cutoff                  -> legacyExpected
 *   cutoff <= done <  window        -> beforeFirstSnapshot   (carve window only)
 *   done >= cutoff (no window)      -> anomaly
 *   done >= window                  -> anomaly
 *
 * The carve is gated on `carveWindow`, so an EMPTY / UNVERIFIED marker AND a
 * marker at/before the cutoff both degrade to the cutoff-only classification —
 * they can never lower severity and never overlap the legacy bucket.
 */
export function classifyCompletionBucketV2(
  completedAt: Date | string | null | undefined,
  cutoff: Date | null,
  marker: IntegrityMarkerObservation
): IntegrityLegacyBucket {
  if (!cutoff) return "unknownCompletion";
  if (completedAt == null) return "unknownCompletion";
  const d = completedAt instanceof Date ? completedAt : new Date(completedAt);
  if (Number.isNaN(d.getTime())) return "unknownCompletion";
  if (d.getTime() < cutoff.getTime()) return "legacyExpected";
  const first = carveWindow(cutoff, marker);
  if (first && d.getTime() < first.getTime()) return "beforeFirstSnapshot";
  return "anomaly";
}

/**
 * Evidence level is OUTPUT-ONLY metadata: it must never reach a severity rule.
 * Derived from `markerAllowsCarve` (not from the source alone) so the evidence
 * level can never overstate the marker: a source that claims OBSERVED but
 * carries no usable value is reported as MIGRATION_ONLY, exactly like a failed
 * read, and therefore keeps the carve disabled.
 */
export function evidenceLevelFor(
  marker: IntegrityMarkerObservation
): IntegrityEvidenceLevel {
  return markerAllowsCarve(marker) ? "SNAPSHOT_OBSERVED" : "MIGRATION_ONLY";
}

/**
 * Disclosure for the two non-observed marker states ONLY. Verified-empty and
 * failed reads are different facts and get different codes. The text states the
 * observation and its limits; it never claims the system is healthy or broken.
 */
export function buildSnapshotDisclosure(
  marker: IntegrityMarkerObservation
): IntegrityDisclosure | null {
  if (marker.source === "SNAPSHOT_POPULATION_EMPTY") {
    return {
      code: "SNAPSHOT_POPULATION_EMPTY",
      text:
        "Tidak ada snapshot teramati di scope tenant ini. Ini fakta populasi data; " +
        "tidak dapat membedakan engine yang belum menulis dari snapshot yang " +
        "hilang atau ter-restore.",
    };
  }
  // Fail safe: anything that is not a genuinely observed marker — a failed read
  // or an inconsistent shape — is disclosed as UNVERIFIED. The only state
  // without disclosure is a verified observation, which needs none.
  if (markerAllowsCarve(marker)) return null;
  return {
    code: "SNAPSHOT_MARKER_UNVERIFIED",
    text:
      "Bukti marker snapshot tidak dapat dibaca. Klasifikasi memakai cutoff-only " +
      "dan status tidak diturunkan. Ini BUKAN bukti bahwa populasi snapshot kosong.",
  };
}

/** Overall severity: CRITICAL ⊃ WARN/UNKNOWN ⊃ OK. */
export function deriveOverallStatus(
  statuses: IntegrityCheckStatus[]
): IntegrityOverallStatus {
  if (statuses.includes("CRITICAL")) return "CRITICAL";
  if (statuses.includes("WARN") || statuses.includes("UNKNOWN")) return "WARN";
  return "OK";
}

/** C1 severity — any revenue order without items is a hard defect. */
export function revenueWithoutItemsStatus(orders: number): IntegrityCheckStatus {
  return orders > 0 ? "CRITICAL" : "OK";
}

/**
 * C2 severity:
 *   anomaly > 0                → CRITICAL
 *     (no snapshot exists at/after the cutoff. Whether the snapshot-writing
 *      code was actually LIVE then is unproven — the migration proves only that
 *      the table existed — so this is kept CRITICAL rather than explained away.)
 *   only unknown/unclassified  → UNKNOWN (cutoff unresolved) or WARN
 *   only expected legacy       → OK
 *   nothing                     → OK
 *
 * EVIDENCE IS NOT AN INPUT: this function takes counts + `cutoffResolved` only.
 */
export function completedWithoutSnapshotStatus(counts: {
  anomalyItems: number;
  unknownItems: number;
  cutoffResolved: boolean;
}): IntegrityCheckStatus {
  if (counts.anomalyItems > 0) return "CRITICAL";
  if (counts.unknownItems > 0) {
    return counts.cutoffResolved ? "WARN" : "UNKNOWN";
  }
  return "OK";
}

/** C3 severity — any relational violation is a hard defect. */
export function reconciliationStatus(violationTotal: number): IntegrityCheckStatus {
  return violationTotal > 0 ? "CRITICAL" : "OK";
}

/**
 * M2 severity — the marker-aware C2 status.
 *
 *   anomaly > 0                 -> CRITICAL  (a real post-cutoff/post-marker gap)
 *   beforeFirstSnapshot > 0     -> UNKNOWN   (unproven activation window; never OK)
 *   only unknownCompletion      -> UNKNOWN when the cutoff is unresolved, else WARN
 *   only expected legacy        -> OK
 *
 * ANTI-DOWNGRADE: this function accepts counts + `cutoffResolved` ONLY. It has
 * no access to `markerSource`, `firstObservedSnapshotAt`, `snapshotPopulation`,
 * `evidenceLevel`, `activationUnproven`, `disclosure`, or `codeDeployUnproven`,
 * so no evidence field can ever change the severity. `beforeFirstSnapshot` is
 * itself non-zero only when the marker was genuinely OBSERVED (see
 * `markerAllowsCarve`), which is what keeps E2–E4/E6 CRITICAL.
 */
export function completedWithoutSnapshotStatusV3(counts: {
  anomalyItems: number;
  beforeFirstSnapshotItems: number;
  unknownItems: number;
  cutoffResolved: boolean;
}): IntegrityCheckStatus {
  if (counts.anomalyItems > 0) return "CRITICAL";
  if (counts.beforeFirstSnapshotItems > 0) return "UNKNOWN";
  if (counts.unknownItems > 0) {
    return counts.cutoffResolved ? "WARN" : "UNKNOWN";
  }
  return "OK";
}

// ============================================================
// F1 — C3 violation scope (branch-scoped vs tenant-wide)
// ============================================================

/**
 * F1 — which C3 invariants can be attributed to a branch.
 *
 * BRANCH_SCOPED ones are computed with the SAME Order/branch scope as the
 * reconciliation `counts`, so they can never disagree with the declared
 * branch scope. TENANT_WIDE ones have no reliable Order/branch attribution and
 * are always evaluated over the whole tenant.
 */
export const VIOLATION_SCOPE: Record<string, IntegrityViolationScope> = {
  SNAPSHOT_ORDER_MISMATCH: "BRANCH_SCOPED",
  SNAPSHOT_TENANT_MISMATCH: "BRANCH_SCOPED",
  SNAPSHOTS_EXCEED_ORDER_ITEMS: "BRANCH_SCOPED",
  ORPHAN_SNAPSHOT_ITEM: "TENANT_WIDE",
  SNAPSHOT_ORDER_MISSING: "TENANT_WIDE",
  DUPLICATE_SNAPSHOT_PER_ITEM: "TENANT_WIDE",
};

export function violationScope(code: string): IntegrityViolationScope {
  // Unknown codes default to TENANT_WIDE: never understate the scope.
  return VIOLATION_SCOPE[code] ?? "TENANT_WIDE";
}

/** Split raw violation counts into branch-scoped and tenant-wide groups. */
export function partitionViolations(
  raw: Array<{ code: string; count: number }>
): { branchScoped: IntegrityViolation[]; tenantWide: IntegrityViolation[] } {
  const branchScoped: IntegrityViolation[] = [];
  const tenantWide: IntegrityViolation[] = [];
  for (const v of raw) {
    const scope = violationScope(v.code);
    const entry: IntegrityViolation = { code: v.code, count: v.count, scope };
    if (scope === "BRANCH_SCOPED") branchScoped.push(entry);
    else tenantWide.push(entry);
  }
  return { branchScoped, tenantWide };
}

/**
 * F4 — reconciliation verdicts. No tautological count equality: each verdict
 * is a genuine boolean over the invariants that actually share that scope.
 */
export function deriveReconciliation(
  branchScopedTotal: number,
  tenantWideTotal: number
): { branchReconciled: boolean; tenantReconciled: boolean; reconciled: boolean } {
  const branchReconciled = branchScopedTotal === 0;
  const tenantReconciled = tenantWideTotal === 0;
  return {
    branchReconciled,
    tenantReconciled,
    reconciled: branchReconciled && tenantReconciled,
  };
}

/**
 * F1 — build the sample order ids for the DECLARED scope only. Tenant-wide
 * samples are included only when the caller's scope IS the whole tenant;
 * otherwise they are omitted so a branch-scoped caller can never receive
 * another branch's order ids.
 */
export function selectSampleOrderIds(input: {
  branchScopedOrderIds: string[];
  tenantWideOrderIds: string[];
  branchFilterActive: boolean;
  limit: number;
}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (ids: string[]) => {
    for (const id of ids) {
      if (out.length >= input.limit) return;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  };
  push(input.branchScopedOrderIds);
  if (!input.branchFilterActive) push(input.tenantWideOrderIds);
  return out;
}

/**
 * F2 — cutoff evidence. `codeDeployUnproven` is always true: the cutoff is the
 * migration apply time, and the code-deploy time is not provable from the
 * available evidence. This is stated explicitly rather than assumed away.
 */
export function buildCutoffEvidence(input: {
  migration: string;
  appliedAt: Date | null;
  resolved: boolean;
}): IntegrityCutoffEvidence {
  return {
    migration: input.migration,
    appliedAt: input.appliedAt ? input.appliedAt.toISOString() : null,
    resolved: input.resolved,
    codeDeployUnproven: true,
  };
}

// ============================================================
// M-2 — naive DATETIME literal → UTC instant
//
// The schema stores naive `DATETIME(3)` values as **UTC wall clock**: measured
// on the isolated target, the F.5 literal `2026-10-14 07:52:58.220` equals the
// replay's own `information_schema.CREATE_TIME` instant while the server session
// time zone is UTC. Reading such a literal therefore requires an EXPLICIT UTC
// designator:
//
//   * Prisma's driver adapter already interprets it as UTC (what this helper
//     reproduces exactly — the value is unchanged);
//   * the raw `mariadb` driver re-interprets it in the PROCESS time zone, which
//     is off by the host offset (7 h on this machine) and must never be used for
//     a cutoff or for any comparison against a Prisma value.
//
// Parsing is deterministic and timezone-independent: the same literal yields the
// same instant on any host, and nothing here reads the process time zone.
// ============================================================

/** `YYYY-MM-DD HH:MM:SS[.fraction]` (also accepts a `T` separator). */
const NAIVE_DATETIME_LITERAL =
  /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?$/;

/**
 * Parse a MariaDB `DATETIME(3)` literal as the UTC instant it denotes.
 *
 * Millisecond precision is preserved (fractional digits are left-padded and
 * truncated to 3). Anything that is not a valid literal returns an **invalid
 * Date** so callers degrade to “no cutoff” instead of guessing.
 */
export function parseNaiveUtcDateTime(literal: string): Date {
  const match = NAIVE_DATETIME_LITERAL.exec(literal.trim());
  if (!match) return new Date(NaN);
  const [, year, month, day, hour, minute, second, fraction] = match;
  const milliseconds = fraction ? Number(`${fraction}000`.slice(0, 3)) : 0;

  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = Number(hour);
  const mi = Number(minute);
  const s = Number(second);
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi, s, milliseconds));

  // Reject rolled-over components (month 13, Feb 30, hour 24, …): a wrong instant
  // is worse than “no cutoff”. A sentinel invalid Date is returned instead.
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== mo - 1 ||
    date.getUTCDate() !== d ||
    date.getUTCHours() !== h ||
    date.getUTCMinutes() !== mi ||
    date.getUTCSeconds() !== s
  ) {
    return new Date(NaN);
  }

  return date;
}

// ============================================================
// M-1 — deterministic legacy-cutoff selection from the migration ledger
//
// `resolveLegacyCutoff()` used to run `… WHERE migration_name = ? LIMIT 1` with
// no ordering and no eligibility filter, so an arbitrary, unordered row could
// supply the “proven” cutoff — including a row that never completed
// (`finished_at IS NULL`) or was rolled back (`rolled_back_at IS NOT NULL`). Real
// ledgers do contain such rows: `F8-FULL-REGRESSION.md` §21 (F8-B) records a
// rolled-back `20260911_add_ingredient_f1` (`finished_at = NULL`) followed by a
// successful re-apply.
//
// The selection rule implemented here is explicit and testable:
//
//   eligible = finished_at IS NOT NULL AND rolled_back_at IS NULL
//   selected = the EARLIEST eligible `finished_at`, ties broken by `id`
//   ambiguous = more than one eligible row → reported, never hidden
//
// `started_at` is NEVER a fallback: the migration may not have completed at all,
// and `started_at` is server-generated (`DEFAULT current_timestamp(3)`) while
// `finished_at` is engine-written, so the two can follow different conventions.
// ============================================================

/**
 * One `_prisma_migrations` row as read for cutoff resolution. Timestamps are
 * read as naive text (`CAST(… AS CHAR)`) so no client ever interprets them
 * implicitly (see `parseNaiveUtcDateTime`).
 */
export interface LegacyCutoffLedgerRow {
  id: string;
  /** `CAST(finished_at AS CHAR)` or null. */
  finishedAtLiteral: string | null;
  /** `CAST(rolled_back_at AS CHAR)` or null. */
  rolledBackAtLiteral: string | null;
}

export interface LegacyCutoffSelection {
  /** Earliest eligible successful apply instant, or null when none is eligible. */
  appliedAt: Date | null;
  /** Eligible rows carrying a parseable `finished_at`. */
  eligibleRows: number;
  /** Rows read for the migration, eligible or not (diagnostics only). */
  rowsRead: number;
}

/**
 * Select the cutoff from the rows of the F.5 migration. Pure: no I/O, no
 * ordering assumptions on the input (the caller may pass rows in any order).
 */
export function selectLegacyCutoff(
  rows: LegacyCutoffLedgerRow[]
): LegacyCutoffSelection {
  const eligible = rows
    .filter(
      (row) => row.finishedAtLiteral != null && row.rolledBackAtLiteral == null
    )
    .map((row) => ({
      id: row.id,
      appliedAt: parseNaiveUtcDateTime(row.finishedAtLiteral as string),
    }))
    .filter((row) => !Number.isNaN(row.appliedAt.getTime()))
    .sort(
      (a, b) =>
        a.appliedAt.getTime() - b.appliedAt.getTime() ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    );

  return {
    appliedAt: eligible[0]?.appliedAt ?? null,
    eligibleRows: eligible.length,
    rowsRead: rows.length,
  };
}

/**
 * M1-R — disclosure for an ambiguous ledger (more than one eligible row).
 *
 * It states the observation and its limit: the cutoff uses the EARLIEST eligible
 * row, because that is the earliest instant at which the snapshot schema is
 * proven to have existed. It never claims the boundary is unambiguous, and it is
 * display-only metadata — severity is computed from counts only.
 */
export function buildCutoffAmbiguityDisclosure(
  eligibleRows: number
): IntegrityDisclosure | null {
  if (eligibleRows <= 1) return null;
  return {
    code: "LEGACY_CUTOFF_AMBIGUOUS",
    text:
      `Ledger migrasi memuat ${eligibleRows} baris migrasi F.5 yang sukses ` +
      "(finished_at terisi dan tidak di-rollback). Cutoff memakai baris paling AWAL — " +
      "instan paling awal yang terbukti — sehingga ambiguitas ini terbuka dan batas " +
      "tersebut TIDAK diperlakukan sebagai satu-satunya bukti yang pasti.",
  };
}
