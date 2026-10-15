import { z } from "zod/v4";

// ============================================================
// ACCOUNTING INTEGRITY MONITORING — query schema + result types.
//
// A READ-ONLY integrity read-model over the EXISTING Order → OrderItem →
// OrderItemCostSnapshot relations. It introduces NO new revenue/COGS engine,
// writes nothing, and never repairs data. Every number comes from the same
// canonical predicates the reports use.
//
// Query params arrive as strings and are coerced/validated here; the tenant
// (`restaurantId`) is NEVER accepted from the client — it always comes from
// the authenticated admin session (see the route + service).
// ============================================================

/** How many sample ids a single check may return (bounded server-side). */
export const INTEGRITY_SAMPLE_LIMIT_DEFAULT = 10;
export const INTEGRITY_SAMPLE_LIMIT_MAX = 50;

export const IntegrityQuerySchema = z.object({
  /** Client hint only — branch isolation is enforced via `branchFilters`. */
  branchId: z.string().trim().min(1).max(64).optional().nullable(),
  sampleLimit: z.coerce
    .number()
    .int()
    .min(1, "sampleLimit minimal 1")
    .max(INTEGRITY_SAMPLE_LIMIT_MAX, `sampleLimit maksimal ${INTEGRITY_SAMPLE_LIMIT_MAX}`)
    .default(INTEGRITY_SAMPLE_LIMIT_DEFAULT),
});

export type IntegrityQuery = z.infer<typeof IntegrityQuerySchema>;

/** Per-check severity. `UNKNOWN` means "cannot be proven" — never guessed. */
export type IntegrityCheckStatus = "OK" | "WARN" | "CRITICAL" | "UNKNOWN";

/** Aggregate severity for the whole report (UNKNOWN folds into WARN). */
export type IntegrityOverallStatus = "OK" | "WARN" | "CRITICAL";

/**
 * Classification of a COMPLETED OrderItem that has NO snapshot, relative to
 * the PROVEN legacy cutoff (the F.5 snapshot migration's applied time) and —
 * only when it was actually OBSERVED — the lower-bound snapshot marker:
 *
 *   legacyExpected     — completed BEFORE the cutoff: the snapshot table did
 *                        not exist yet, so no snapshot could have been written.
 *   beforeFirstSnapshot— completed AT/AFTER the cutoff but BEFORE the first
 *                        snapshot ever observed for this tenant. The cutoff
 *                        proves the SCHEMA existed at that instant; it does NOT
 *                        prove the snapshot-writing code was deployed or ever
 *                        ran. This window is therefore UNKNOWN — never a clean
 *                        OK and never an anomaly. Reachable ONLY when the
 *                        marker was observed (see IntegritySnapshotMarkerSource);
 *                        an empty/unverified marker never carves here.
 *   anomaly            — completed AT/AFTER the cutoff with no snapshot and
 *                        outside the (unproven) activation window. This is the
 *                        real defect case and its severity is never lowered.
 *   unknownCompletion  — completion time is unavailable, so it cannot be
 *                        classified. It is NEVER silently folded into legacy.
 */
export type IntegrityLegacyBucket =
  | "legacyExpected"
  | "beforeFirstSnapshot"
  | "anomaly"
  | "unknownCompletion";

export interface IntegrityBucketCount {
  items: number;
  orders: number;
}

/**
 * How the snapshot marker (`MIN(orderitemcostsnapshot.completedAt)`, tenant-
 * wide) was obtained. This separates a VERIFIED EMPTY population from a FAILED
 * read — they must never be conflated:
 *
 *   SNAPSHOT_MIN_OBSERVED      — the marker query succeeded and the tenant has
 *                                at least one snapshot. `completedAt` is a
 *                                real observed value. It is a LOWER BOUND of
 *                                observed engine activity, NOT activation time.
 *   SNAPSHOT_POPULATION_EMPTY  — the query succeeded and found ZERO snapshots.
 *                                A verified population fact; it cannot
 *                                distinguish "engine never wrote" from
 *                                "snapshots were deleted/restored away".
 *   SNAPSHOT_MARKER_UNVERIFIED — the query FAILED (or returned an impossible
 *                                shape). Nothing is known; this is NOT evidence
 *                                that the population is empty.
 */
export type IntegritySnapshotMarkerSource =
  | "SNAPSHOT_MIN_OBSERVED"
  | "SNAPSHOT_POPULATION_EMPTY"
  | "SNAPSHOT_MARKER_UNVERIFIED";

/** Output-only evidence level for C2. Never an input to any severity rule. */
export type IntegrityEvidenceLevel = "MIGRATION_ONLY" | "SNAPSHOT_OBSERVED";

/** Machine-readable disclosure codes attached to the C2 check. */
export type IntegrityDisclosureCode =
  | "SNAPSHOT_POPULATION_EMPTY"
  | "SNAPSHOT_MARKER_UNVERIFIED"
  /**
   * M1-R: the migration ledger holds MORE THAN ONE eligible F.5 row (successful,
   * not rolled back). The cutoff uses the earliest of them; this code records
   * that the boundary is disclosed rather than treated as a single proven row.
   */
  | "LEGACY_CUTOFF_AMBIGUOUS";

/**
 * Explicit, non-alarming disclosure. It states an observation + its limits and
 * is FORBIDDEN from claiming the system is healthy, unhealthy, or that the
 * engine is inactive.
 */
export interface IntegrityDisclosure {
  code: IntegrityDisclosureCode;
  text: string;
}

/**
 * Evidence for the legacy cutoff. `resolved=false` ⇒ no classification.
 *
 * IMPORTANT (F2): the cutoff is the MIGRATION APPLY time — the only proven
 * boundary. The time the snapshot-writing CODE was actually deployed (or ever
 * ran) is NOT provable from available evidence, so `codeDeployUnproven` is
 * always true. A completion shortly AFTER the cutoff is still classified as an
 * anomaly because the engine-live claim cannot be proven EITHER WAY; that may
 * be a false positive when the code was deployed later. Severity is
 * intentionally NOT lowered.
 */
export interface IntegrityCutoffEvidence {
  /** The migration that introduced the snapshot engine (repo artifact). */
  migration: string;
  /** Its recorded apply time from `_prisma_migrations`, or null if unknown. */
  appliedAt: string | null;
  resolved: boolean;
  /** true = the code-deploy time is unproven (cutoff = migration apply only). */
  codeDeployUnproven: boolean;
}

/** C1 — revenue-bearing orders with no OrderItem at all. */
export interface RevenueOrdersWithoutItemsCheck {
  code: "REVENUE_ORDER_WITHOUT_ITEMS";
  status: IntegrityCheckStatus;
  orders: number;
  headerValue: number;
  sampleOrderIds: string[];
}

/** C2 — COMPLETED orders whose items carry no snapshot, split by cutoff+marker. */
export interface CompletedItemsWithoutSnapshotCheck {
  code: "COMPLETED_ORDER_ITEM_WITHOUT_SNAPSHOT";
  status: IntegrityCheckStatus;
  items: number;
  orders: number;
  /**
   * The four buckets PARTITION `items` (see IntegrityLegacyBucket):
   * `legacyExpected + beforeFirstSnapshot + anomaly + unknownCompletion === items`.
   */
  buckets: Record<IntegrityLegacyBucket, IntegrityBucketCount>;
  cutoff: IntegrityCutoffEvidence;
  /**
   * Independent comparison: the status C2 would have WITHOUT the marker
   * (cutoff-only classification, same cutoff instance). It is always emitted so
   * a severity change caused by the carve is visible instead of silent.
   */
  statusCutoffOnly: IntegrityCheckStatus;
  /** How the marker was obtained — see IntegritySnapshotMarkerSource. */
  markerSource: IntegritySnapshotMarkerSource;
  /**
   * Tenant-wide `MIN(orderitemcostsnapshot.completedAt)`, or null when no marker
   * was observed. A LOWER BOUND of observed engine activity — NOT proof of when
   * the engine was activated/deployed.
   */
  firstObservedSnapshotAt: string | null;
  /** Snapshot rows in the tenant scope; null when the marker read FAILED. */
  snapshotPopulation: number | null;
  /** Output-only metadata. Never an input to any severity rule. */
  evidenceLevel: IntegrityEvidenceLevel;
  /** Always true: the engine activation/deploy time is not proven by any source. */
  activationUnproven: true;
  /** Present only for verified-empty or unverified marker reads. */
  disclosure: IntegrityDisclosure | null;
  /**
   * M1-R: present only when the ledger held more than one ELIGIBLE F.5 row, in
   * which case the earliest was used. Separate from `disclosure` so the marker
   * disclosure can never be displaced by it. Display-only metadata: it is never
   * an input to any severity rule.
   */
  cutoffDisclosure: IntegrityDisclosure | null;
  sampleOrderIds: string[];
}

/**
 * Scope of a C3 invariant (F1):
 *   BRANCH_SCOPED — attributable to the caller's tenant AND branch through the
 *                   snapshot's Order, so it uses the SAME Order/branch scope as
 *                   `counts` (SNAPSHOT_ORDER_MISMATCH, SNAPSHOT_TENANT_MISMATCH,
 *                   SNAPSHOTS_EXCEED_ORDER_ITEMS).
 *   TENANT_WIDE  — no reliable Order/branch attribution exists, so it is always
 *                   evaluated over the whole tenant and must NOT be silently
 *                   presented as a branch-scoped result (ORPHAN_SNAPSHOT_ITEM,
 *                   SNAPSHOT_ORDER_MISSING, DUPLICATE_SNAPSHOT_PER_ITEM).
 */
export type IntegrityViolationScope = "BRANCH_SCOPED" | "TENANT_WIDE";

export interface IntegrityViolation {
  code: string;
  count: number;
  scope: IntegrityViolationScope;
}

/** C3 — Order → OrderItem → OrderItemCostSnapshot relation reconciliation. */
export interface ReconciliationCheck {
  code: "ORDER_ITEM_SNAPSHOT_RECONCILIATION";
  status: IntegrityCheckStatus;
  /** Strongest verdict: true only when EVERY invariant (both scopes) is 0. */
  reconciled: boolean;
  /** true only when every BRANCH_SCOPED invariant (counts scope) is 0. */
  branchReconciled: boolean;
  /** true only when every TENANT_WIDE invariant is 0. */
  tenantReconciled: boolean;
  counts: {
    orders: number;
    orderItems: number;
    snapshots: number;
  };
  snapshotByStatus: Record<string, number>;
  violations: IntegrityViolation[];
  sampleOrderIds: string[];
  /** Human-readable explanation of the branch-vs-tenant scope semantics. */
  scopeNote: string;
}

export interface IntegrityReport {
  generatedAt: string;
  scope: {
    restaurantId: string;
    /** null = all branches the caller may read (authorizedBranches). */
    branchIds: string[] | null;
    sampleLimit: number;
  };
  overallStatus: IntegrityOverallStatus;
  checks: {
    revenueOrdersWithoutItems: RevenueOrdersWithoutItemsCheck;
    completedItemsWithoutSnapshot: CompletedItemsWithoutSnapshotCheck;
    reconciliation: ReconciliationCheck;
  };
}
