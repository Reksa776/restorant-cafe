import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";
import { num } from "@/lib/money";
import { revenueScopeWhere } from "@/services/report/report.service";
import {
  IntegrityQuerySchema,
  INTEGRITY_SAMPLE_LIMIT_DEFAULT,
  type CompletedItemsWithoutSnapshotCheck,
  type IntegrityCutoffEvidence,
  type IntegrityReport,
  type ReconciliationCheck,
  type RevenueOrdersWithoutItemsCheck,
} from "./integrity.types";
import {
  LEGACY_CUTOFF_MIGRATION,
  buildCutoffEvidence,
  completedWithoutSnapshotStatus,
  deriveOverallStatus,
  deriveReconciliation,
  partitionViolations,
  reconciliationStatus,
  revenueWithoutItemsStatus,
  selectSampleOrderIds,
} from "./integrity.rules";

// ============================================================
// ACCOUNTING INTEGRITY MONITORING — READ-ONLY SERVICE
//
// Detects, per tenant (and optional branch), three integrity conditions:
//
//   C1  revenue-bearing orders with NO OrderItem at all;
//   C2  COMPLETED orders whose items carry NO OrderItemCostSnapshot,
//       split into expected-legacy vs anomaly against a PROVEN cutoff;
//   C3  Order → OrderItem → OrderItemCostSnapshot relation reconciliation.
//
// Hard rules:
//  * READ-ONLY. This module performs no INSERT/UPDATE/DELETE and never
//    repairs data. It is a monitor, not a fixer.
//  * The revenue set ALWAYS comes from the canonical `revenueScopeWhere`
//    predicate (report.service) — never re-implemented here.
//  * `restaurantId` always comes from the authenticated session; branch
//    isolation is enforced through the caller-supplied `branchFilters`.
//  * Every raw SQL query carries a tenant predicate. OrderItem has no
//    restaurantId, so it is ALWAYS scoped through a JOIN to `order`.
//  * The legacy cutoff is PROVEN from the migration that introduced the
//    snapshot engine (`20260911143644_f5_order_item_cost_snapshot`), read at
//    runtime from `_prisma_migrations`. If it cannot be resolved, items are
//    classified as `unknownCompletion` — NEVER guessed into legacy/anomaly.
// ============================================================

/**
 * The migration that created `orderitemcostsnapshot` and shipped the frozen
 * COGS engine (F.5). Orders COMPLETED before it existed carry no snapshot by
 * design; this is the ONLY proven boundary between legacy and anomaly.
 *
 * Evidence (repo + DB, read-only):
 *   - `prisma/migrations/20260911143644_f5_order_item_cost_snapshot/migration.sql`
 *   - AUDIT-F5-HISTORICAL-COGS-PROFITABILITY.md (11 September 2026)
 *   - `_prisma_migrations.finished_at` for this migration
 */
const n = (v: unknown): number => Number(v ?? 0);
const count = (v: unknown): number => {
  const x = n(v);
  return Number.isFinite(x) ? x : 0;
};

// ============================================================
// Cutoff resolution (proven from migration metadata)
// ============================================================

interface MigrationRow {
  finished_at: Date | null;
  started_at: Date | null;
}

async function resolveLegacyCutoff(): Promise<{
  cutoff: Date | null;
  evidence: IntegrityCutoffEvidence;
}> {
  // F2 — the cutoff is the MIGRATION APPLY time only; the code-deploy time is
  // not provable, so `codeDeployUnproven` is always true (never assumed away).
  const unresolved = buildCutoffEvidence({
    migration: LEGACY_CUTOFF_MIGRATION,
    appliedAt: null,
    resolved: false,
  });
  try {
    const rows = await prisma.$queryRaw<MigrationRow[]>`
      SELECT finished_at, started_at
      FROM _prisma_migrations
      WHERE migration_name = ${LEGACY_CUTOFF_MIGRATION}
      LIMIT 1
    `;
    const row = rows[0];
    const applied = row?.finished_at ?? row?.started_at ?? null;
    if (!applied) return { cutoff: null, evidence: unresolved };
    const cutoff = applied instanceof Date ? applied : new Date(applied);
    if (Number.isNaN(cutoff.getTime())) return { cutoff: null, evidence: unresolved };
    return {
      cutoff,
      evidence: buildCutoffEvidence({
        migration: LEGACY_CUTOFF_MIGRATION,
        appliedAt: cutoff,
        resolved: true,
      }),
    };
  } catch {
    // The migration ledger is unavailable → do NOT guess a cutoff.
    return { cutoff: null, evidence: unresolved };
  }
}

// ============================================================
// C1 — revenue orders without items (canonical revenue predicate)
// ============================================================

async function checkRevenueOrdersWithoutItems(
  restaurantId: string,
  branchFilters: string[] | null,
  sampleLimit: number
): Promise<RevenueOrdersWithoutItemsCheck> {
  // Reuse THE canonical revenue predicate; no second revenue definition.
  const where: Prisma.OrderWhereInput = {
    ...revenueScopeWhere(restaurantId, branchFilters),
    items: { none: {} },
  };

  const [agg, sample] = await Promise.all([
    prisma.order.aggregate({
      where,
      _count: { _all: true },
      _sum: { grandTotal: true },
    }),
    prisma.order.findMany({
      where,
      select: { id: true },
      orderBy: { createdAt: "desc" },
      take: sampleLimit,
    }),
  ]);

  const orders = count(agg._count?._all);
  return {
    code: "REVENUE_ORDER_WITHOUT_ITEMS",
    status: revenueWithoutItemsStatus(orders),
    orders,
    headerValue: num(agg._sum?.grandTotal),
    sampleOrderIds: sample.map((r) => r.id),
  };
}

// ============================================================
// C2 — COMPLETED items without snapshot, split by proven cutoff
// ============================================================

interface C2RawCounts {
  totalItems: bigint | number | string | null;
  totalOrders: bigint | number | string | null;
  legacyItems: bigint | number | string | null;
  legacyOrders: bigint | number | string | null;
  anomalyItems: bigint | number | string | null;
  anomalyOrders: bigint | number | string | null;
  unknownItems: bigint | number | string | null;
  unknownOrders: bigint | number | string | null;
}

interface OrderIdRow {
  orderId: string;
}

async function checkCompletedItemsWithoutSnapshot(
  restaurantId: string,
  branchFilters: string[] | null,
  sampleLimit: number
): Promise<CompletedItemsWithoutSnapshotCheck> {
  const { cutoff, evidence } = await resolveLegacyCutoff();

  const branchSql = branchFilters?.length
    ? Prisma.sql`AND o.\`branchId\` IN (${Prisma.join(branchFilters)})`
    : Prisma.empty;

  // Completed order items (scoped through `order`) that have no snapshot.
  const baseFrom = Prisma.sql`
    FROM orderitem oi
    JOIN \`order\` o ON o.id = oi.orderId
    LEFT JOIN orderitemcostsnapshot s ON s.orderItemId = oi.id
    LEFT JOIN (
      SELECT orderId, MIN(createdAt) AS done
      FROM orderstatushistory
      WHERE status = 'COMPLETED'
      GROUP BY orderId
    ) h ON h.orderId = o.id
    WHERE o.status = 'COMPLETED'
      AND s.id IS NULL
      AND o.restaurantId = ${restaurantId}
      ${branchSql}
  `;

  let counts: C2RawCounts;
  if (cutoff) {
    const rows = await prisma.$queryRaw<C2RawCounts[]>(Prisma.sql`
      SELECT
        COUNT(*) AS totalItems,
        COUNT(DISTINCT o.id) AS totalOrders,
        SUM(CASE WHEN h.done IS NOT NULL AND h.done < ${cutoff} THEN 1 ELSE 0 END) AS legacyItems,
        COUNT(DISTINCT CASE WHEN h.done IS NOT NULL AND h.done < ${cutoff} THEN o.id END) AS legacyOrders,
        SUM(CASE WHEN h.done IS NOT NULL AND h.done >= ${cutoff} THEN 1 ELSE 0 END) AS anomalyItems,
        COUNT(DISTINCT CASE WHEN h.done IS NOT NULL AND h.done >= ${cutoff} THEN o.id END) AS anomalyOrders,
        SUM(CASE WHEN h.done IS NULL THEN 1 ELSE 0 END) AS unknownItems,
        COUNT(DISTINCT CASE WHEN h.done IS NULL THEN o.id END) AS unknownOrders
      ${baseFrom}
    `);
    counts = rows[0] ?? ({} as C2RawCounts);
  } else {
    // No proven cutoff → cannot classify. Everything is `unknownCompletion`.
    const rows = await prisma.$queryRaw<C2RawCounts[]>(Prisma.sql`
      SELECT
        COUNT(*) AS totalItems,
        COUNT(DISTINCT o.id) AS totalOrders,
        0 AS legacyItems,
        0 AS legacyOrders,
        0 AS anomalyItems,
        0 AS anomalyOrders,
        COUNT(*) AS unknownItems,
        COUNT(DISTINCT o.id) AS unknownOrders
      ${baseFrom}
    `);
    counts = rows[0] ?? ({} as C2RawCounts);
  }

  const legacyItems = count(counts.legacyItems);
  const legacyOrders = count(counts.legacyOrders);
  const anomalyItems = count(counts.anomalyItems);
  const anomalyOrders = count(counts.anomalyOrders);
  const unknownItems = count(counts.unknownItems);
  const unknownOrders = count(counts.unknownOrders);
  const items = count(counts.totalItems);
  const orders = count(counts.totalOrders);

  // Samples: anomalies first (the actionable ones), then unknowns.
  const sampleOrderIds: string[] = [];
  if (cutoff && anomalyItems > 0) {
    const rows = await prisma.$queryRaw<OrderIdRow[]>(Prisma.sql`
      SELECT o.id AS orderId
      ${baseFrom}
        AND h.done IS NOT NULL AND h.done >= ${cutoff}
      GROUP BY o.id
      ORDER BY MIN(h.done) ASC
      LIMIT ${sampleLimit}
    `);
    for (const r of rows) sampleOrderIds.push(r.orderId);
  }
  if (unknownItems > 0 && sampleOrderIds.length < sampleLimit) {
    const rows = await prisma.$queryRaw<OrderIdRow[]>(Prisma.sql`
      SELECT o.id AS orderId
      ${baseFrom}
        AND h.done IS NULL
      GROUP BY o.id
      LIMIT ${sampleLimit - sampleOrderIds.length}
    `);
    for (const r of rows) sampleOrderIds.push(r.orderId);
  }

  return {
    code: "COMPLETED_ORDER_ITEM_WITHOUT_SNAPSHOT",
    status: completedWithoutSnapshotStatus({
      anomalyItems,
      unknownItems,
      cutoffResolved: evidence.resolved,
    }),
    items,
    orders,
    buckets: {
      legacyExpected: { items: legacyItems, orders: legacyOrders },
      anomaly: { items: anomalyItems, orders: anomalyOrders },
      unknownCompletion: { items: unknownItems, orders: unknownOrders },
    },
    cutoff: evidence,
    sampleOrderIds,
  };
}

// ============================================================
// C3 — Order → OrderItem → OrderItemCostSnapshot reconciliation
// ============================================================

interface C3Counts {
  orders: bigint | number | string | null;
  orderItems: bigint | number | string | null;
  snapshots: bigint | number | string | null;
}

interface StatusRow {
  status: string;
  c: bigint | number | string | null;
}

interface ViolationRow {
  code: string;
  c: bigint | number | string | null;
}

async function checkReconciliation(
  restaurantId: string,
  branchFilters: string[] | null,
  sampleLimit: number
): Promise<ReconciliationCheck> {
  const branches = branchFilters ?? [];
  const branchFilterActive = branches.length > 0;
  const orderBranchSql = branchFilterActive
    ? Prisma.sql`AND o.\`branchId\` IN (${Prisma.join(branches)})`
    : Prisma.empty;

  const [countRows, statusRows, branchRows, tenantRows] = await Promise.all([
    // Counts — the declared scope (Order restaurant + branch).
    prisma.$queryRaw<C3Counts[]>(Prisma.sql`
      SELECT
        (SELECT COUNT(*) FROM \`order\` o
          WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}) AS orders,
        (SELECT COUNT(*) FROM orderitem oi
          JOIN \`order\` o ON o.id = oi.orderId
          WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}) AS orderItems,
        (SELECT COUNT(*) FROM orderitemcostsnapshot s
          JOIN \`order\` o ON o.id = s.orderId
          WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}) AS snapshots
    `),
    // Snapshot status distribution — same declared scope as the counts.
    prisma.$queryRaw<StatusRow[]>(Prisma.sql`
      SELECT s.status AS status, COUNT(*) AS c
      FROM orderitemcostsnapshot s
      JOIN \`order\` o ON o.id = s.orderId
      WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}
      GROUP BY s.status
    `),
    // F1 — BRANCH_SCOPED invariants: SAME Order/branch scope as counts, so
    // they can never disagree with the declared branch scope. Both have a
    // reliable Order relation by construction.
    prisma.$queryRaw<ViolationRow[]>(Prisma.sql`
      SELECT 'SNAPSHOT_ORDER_MISMATCH' AS code, COUNT(*) AS c
        FROM orderitemcostsnapshot s
        JOIN \`order\` o ON o.id = s.orderId
        JOIN orderitem oi ON oi.id = s.orderItemId
        WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}
          AND oi.orderId <> s.orderId
      UNION ALL
      SELECT 'SNAPSHOT_TENANT_MISMATCH' AS code, COUNT(*) AS c
        FROM orderitemcostsnapshot s
        JOIN \`order\` o ON o.id = s.orderId
        WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}
          AND o.restaurantId <> s.restaurantId
    `),
    // F1 — TENANT_WIDE invariants: no reliable Order/branch attribution, so
    // they are evaluated over the WHOLE tenant and never silently merged into
    // the branch-scoped verdict.
    prisma.$queryRaw<ViolationRow[]>(Prisma.sql`
      SELECT 'ORPHAN_SNAPSHOT_ITEM' AS code, COUNT(*) AS c
        FROM orderitemcostsnapshot s
        LEFT JOIN orderitem oi ON oi.id = s.orderItemId
        WHERE s.restaurantId = ${restaurantId} AND oi.id IS NULL
      UNION ALL
      SELECT 'SNAPSHOT_ORDER_MISSING' AS code, COUNT(*) AS c
        FROM orderitemcostsnapshot s
        LEFT JOIN \`order\` o ON o.id = s.orderId
        WHERE s.restaurantId = ${restaurantId} AND o.id IS NULL
      UNION ALL
      SELECT 'DUPLICATE_SNAPSHOT_PER_ITEM' AS code, COUNT(*) AS c
        FROM (
          SELECT s.orderItemId
          FROM orderitemcostsnapshot s
          WHERE s.restaurantId = ${restaurantId}
          GROUP BY s.orderItemId
          HAVING COUNT(*) > 1
        ) d
    `),
  ]);

  const c3 = countRows[0] ?? ({} as C3Counts);
  const orderItems = count(c3.orderItems);
  const snapshots = count(c3.snapshots);

  const snapshotByStatus: Record<string, number> = {};
  for (const r of statusRows) snapshotByStatus[r.status] = count(r.c);

  const rawViolations = [...branchRows, ...tenantRows].map((r) => ({
    code: r.code,
    count: count(r.c),
  }));
  // A snapshot can never exceed the order items it references; if it does the
  // relation is broken. Derived from the counts, so it shares their scope.
  const overshoot = Math.max(0, snapshots - orderItems);
  if (overshoot > 0) {
    rawViolations.push({ code: "SNAPSHOTS_EXCEED_ORDER_ITEMS", count: overshoot });
  }

  const { branchScoped, tenantWide } = partitionViolations(rawViolations);
  const branchScopedTotal = branchScoped.reduce((s, v) => s + v.count, 0);
  const tenantWideTotal = tenantWide.reduce((s, v) => s + v.count, 0);
  const violationTotal = branchScopedTotal + tenantWideTotal;
  // F4 — genuine scope-aligned verdicts (no tautological count equality).
  const { branchReconciled, tenantReconciled, reconciled } = deriveReconciliation(
    branchScopedTotal,
    tenantWideTotal
  );

  // F1 — samples follow the DECLARED scope. Tenant-wide samples are only
  // collected when the caller's scope IS the whole tenant; a branch-scoped
  // caller can therefore never receive another branch's order ids.
  const sampleOrderIds: string[] = [];
  if (violationTotal > 0) {
    const branchSampleRows = await prisma.$queryRaw<OrderIdRow[]>(Prisma.sql`
      SELECT DISTINCT v.orderId FROM (
        SELECT o.id AS orderId FROM orderitemcostsnapshot s
          JOIN \`order\` o ON o.id = s.orderId
          JOIN orderitem oi ON oi.id = s.orderItemId
          WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}
            AND oi.orderId <> s.orderId
        UNION
        SELECT o.id AS orderId FROM orderitemcostsnapshot s
          JOIN \`order\` o ON o.id = s.orderId
          WHERE o.restaurantId = ${restaurantId} ${orderBranchSql}
            AND o.restaurantId <> s.restaurantId
      ) v
      LIMIT ${sampleLimit}
    `);

    let tenantSampleRows: OrderIdRow[] = [];
    if (!branchFilterActive) {
      // Only orders that ARE in the caller's tenant are ever emitted.
      tenantSampleRows = await prisma.$queryRaw<OrderIdRow[]>(Prisma.sql`
        SELECT DISTINCT o.id AS orderId
        FROM orderitemcostsnapshot s
        LEFT JOIN orderitem oi ON oi.id = s.orderItemId
        JOIN \`order\` o ON o.id = s.orderId
        WHERE s.restaurantId = ${restaurantId}
          AND o.restaurantId = ${restaurantId}
          AND oi.id IS NULL
        UNION
        SELECT DISTINCT o.id AS orderId
        FROM orderitemcostsnapshot s
        JOIN orderitem oi ON oi.id = s.orderItemId
        JOIN \`order\` o ON o.id = oi.orderId
        WHERE s.restaurantId = ${restaurantId}
          AND o.restaurantId = ${restaurantId}
        GROUP BY s.orderItemId, o.id
        HAVING COUNT(*) > 1
        LIMIT ${sampleLimit}
      `);
    }

    sampleOrderIds.push(
      ...selectSampleOrderIds({
        branchScopedOrderIds: branchSampleRows.map((r) => r.orderId),
        tenantWideOrderIds: tenantSampleRows.map((r) => r.orderId),
        branchFilterActive,
        limit: sampleLimit,
      })
    );
  }

  return {
    code: "ORDER_ITEM_SNAPSHOT_RECONCILIATION",
    status: reconciliationStatus(violationTotal),
    reconciled,
    branchReconciled,
    tenantReconciled,
    counts: {
      orders: count(c3.orders),
      orderItems,
      snapshots,
    },
    snapshotByStatus,
    violations: [...branchScoped, ...tenantWide],
    sampleOrderIds,
    scopeNote:
      "BRANCH_SCOPED invariants (SNAPSHOT_ORDER_MISMATCH, SNAPSHOT_TENANT_MISMATCH, " +
      "SNAPSHOTS_EXCEED_ORDER_ITEMS) use the same Order/branch scope as counts. " +
      "TENANT_WIDE invariants (ORPHAN_SNAPSHOT_ITEM, SNAPSHOT_ORDER_MISSING, " +
      "DUPLICATE_SNAPSHOT_PER_ITEM) have no reliable branch attribution, are always " +
      "evaluated tenant-wide, and are never merged into the branch verdict. " +
      "reconciled = branchReconciled && tenantReconciled. Orders whose branchId is NULL " +
      "are excluded when a branch filter is active (consistent with the existing " +
      "branchId IN (...) contract) and remain visible only in tenant-wide scope.",
  };
}

// ============================================================
// Public entry point
// ============================================================

/**
 * Run the three read-only integrity checks for the caller's tenant.
 *
 * @param restaurantId  ALWAYS from the authenticated session.
 * @param rawQuery      Raw query params (validated here).
 * @param authorizedBranchFilters  The caller's authorized branch scope
 *                    (`authorizedBranches(ctx)`), or undefined for all.
 */
export async function getIntegrityReport(
  restaurantId: string,
  rawQuery: unknown,
  authorizedBranchFilters?: string[] | null
): Promise<IntegrityReport> {
  const parsed = IntegrityQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const q = parsed.data;

  // Effective branch scope: an explicitly validated branchId narrows to that
  // branch; otherwise the caller's authorized branch list applies. A non-scoped
  // caller with no explicit branch sees all branches (null = no filter).
  const branchFilters: string[] | null = q.branchId
    ? [q.branchId]
    : authorizedBranchFilters && authorizedBranchFilters.length > 0
      ? authorizedBranchFilters
      : null;

  const sampleLimit = q.sampleLimit ?? INTEGRITY_SAMPLE_LIMIT_DEFAULT;

  const [revenueOrdersWithoutItems, completedItemsWithoutSnapshot, reconciliation] =
    await Promise.all([
      checkRevenueOrdersWithoutItems(restaurantId, branchFilters, sampleLimit),
      checkCompletedItemsWithoutSnapshot(restaurantId, branchFilters, sampleLimit),
      checkReconciliation(restaurantId, branchFilters, sampleLimit),
    ]);

  return {
    generatedAt: new Date().toISOString(),
    scope: {
      restaurantId,
      branchIds: branchFilters,
      sampleLimit,
    },
    overallStatus: deriveOverallStatus([
      revenueOrdersWithoutItems.status,
      completedItemsWithoutSnapshot.status,
      reconciliation.status,
    ]),
    checks: {
      revenueOrdersWithoutItems,
      completedItemsWithoutSnapshot,
      reconciliation,
    },
  };
}
