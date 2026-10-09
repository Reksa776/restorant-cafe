import type {
  IntegrityCheckStatus,
  IntegrityCutoffEvidence,
  IntegrityLegacyBucket,
  IntegrityOverallStatus,
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
 * The migration that created `orderitemcostsnapshot` and shipped the frozen
 * COGS engine (F.5). Orders COMPLETED before it existed carry no snapshot by
 * design; this is the ONLY proven boundary between legacy and anomaly.
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
 *   anomaly > 0                → CRITICAL (snapshot engine was live)
 *   only unknown/unclassified  → UNKNOWN (cutoff unresolved) or WARN
 *   only expected legacy       → OK
 *   nothing                     → OK
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
