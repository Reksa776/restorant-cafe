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
 * the PROVEN legacy cutoff (the F.5 snapshot migration's applied time):
 *
 *   legacyExpected    — completed BEFORE the F.5 snapshot feature existed
 *                       (no snapshot could have been written; expected).
 *   anomaly           — completed AT/AFTER the cutoff yet no snapshot exists
 *                       (the snapshot engine was live; this is a real defect).
 *   unknownCompletion — completion time is unavailable, so it cannot be
 *                       classified. It is NEVER silently folded into legacy.
 */
export type IntegrityLegacyBucket =
  | "legacyExpected"
  | "anomaly"
  | "unknownCompletion";

export interface IntegrityBucketCount {
  items: number;
  orders: number;
}

/**
 * Evidence for the legacy cutoff. `resolved=false` ⇒ no classification.
 *
 * IMPORTANT (F2): the cutoff is the MIGRATION APPLY time — the only proven
 * boundary. The time the snapshot-writing CODE was actually deployed is NOT
 * provable from available evidence, so `codeDeployUnproven` is always true.
 * A completion shortly AFTER the cutoff is therefore classified as an anomaly
 * on the assumption that the engine was live then, and may be a false positive
 * if the code was deployed later. Severity is intentionally NOT lowered.
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

/** C2 — COMPLETED orders whose items carry no snapshot, split by cutoff. */
export interface CompletedItemsWithoutSnapshotCheck {
  code: "COMPLETED_ORDER_ITEM_WITHOUT_SNAPSHOT";
  status: IntegrityCheckStatus;
  items: number;
  orders: number;
  buckets: Record<IntegrityLegacyBucket, IntegrityBucketCount>;
  cutoff: IntegrityCutoffEvidence;
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
