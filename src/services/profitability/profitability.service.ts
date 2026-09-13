import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";
import {
  resolveReportRange,
  computeRefundRevenue,
  type ReportPeriod,
} from "@/services/report/report.service";
import type {
  ProfitabilityReport,
  ProfitabilityProductRow,
  ProfitabilityBranchRow,
  ProfitabilityFilters,
  ProfitabilityCoverage,
  ProfitabilityCogsState,
  ProfitabilityRefundState,
} from "./profitability.types";

// ============================================================
// F.5 — PROFITABILITY SERVICE (server-side aggregation)
//
// Revenue semantics match the existing sales report exactly:
//   sold = status != CANCELLED AND paymentStatus = PAID.
//
// COGS comes from OrderItemCostSnapshot (frozen historical cost at
// the READY → COMPLETED transition). Rows without a snapshot
// (pre-F.5 legacy / not-yet-completed orders) contribute nothing
// to COGS — they are disclosed in `coverage` and `unpaidCompleted`.
//
// Math is Prisma.Decimal internally; rounded at the final monetary
// boundary (ROUND_HALF_UP, 2 dp) before returning plain numbers
// to the client. Float division is avoided; null is returned when
// the divisor is zero (percentage metrics).
// ============================================================

const ROUND = Prisma.Decimal.ROUND_HALF_UP;

function num(v: unknown): number {
  return Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;
}

/** H3 — half-cent tolerance for Decimal comparisons. */
const MONEY_EPSILON = 0.005;

function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * H2.1 — derive the coverage state from the DISJOINT buckets.
 * Status (not money) is the ONLY thing that decides coverage, so a valid
 * SNAPSHOTTED COGS of 0 still counts as COVERED (never treated as missing).
 */
function deriveCogsState(counts: {
  totalItems: number;
  costed: number;
  uncosted: number;
  legacy: number;
  pending: number;
}): ProfitabilityCogsState {
  const { totalItems, costed, uncosted, legacy, pending } = counts;
  if (totalItems === 0 || costed === totalItems) return "COVERED";
  if (costed > 0) return "PARTIAL";
  if (pending > 0) return "PENDING_COGS";
  if (uncosted > 0) return "UNCOVERED";
  return "LEGACY";
}

type ReportFilters = ProfitabilityFilters;

export class ProfitabilityService {
  async getProfitabilityReport(
    restaurantId: string,
    period: ReportPeriod,
    opts?: {
      startDate?: string;
      endDate?: string;
      branchFilters?: string[] | null;
      filters?: ReportFilters;
      pagination?: { page?: number; limit?: number };
    }
  ): Promise<ProfitabilityReport> {
    const range = resolveReportRange(period, opts?.startDate, opts?.endDate);
    const branchFilters = opts?.branchFilters;
    const { filters } = opts || {};
    const page = Math.max(1, opts?.pagination?.page ?? 1);
    const limit = Math.min(200, Math.max(1, opts?.pagination?.limit ?? 50));

    // H3.4 — revenue-relevant orders are PAID, OR collected-then-refunded. A
    // fully refunded COMPLETED order becomes UNPAID but MUST stay in scope so
    // its incurred COGS is retained (never zeroed just because revenue is).
    //
    // H4.5-B1 — this is the SAME revenue set WITHOUT the order-creation date
    // bound, used to find the underlying order of a refund attributed to its
    // APPROVAL date (which may fall in a later period than the order). Original
    // sales/COGS still use the date-bounded `soldWhere`.
    const soldScopeWhere: Prisma.OrderWhereInput = {
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      status: { not: "CANCELLED" },
      OR: [
        { paymentStatus: "PAID" },
        { payments: { some: { status: "REFUNDED" } } },
      ],
      ...(filters?.orderType ? { orderType: filters.orderType as never } : {}),
      ...(filters?.paymentMethod
        ? {
            payments: {
              some: {
                method: filters.paymentMethod,
                status: "PAID",
              },
            },
          }
        : {}),
    };

    const soldWhere: Prisma.OrderWhereInput = {
      ...soldScopeWhere,
      createdAt: { gte: range.start, lte: range.end },
    };

    const itemWhere = Prisma.sql`
      WHERE o.\`restaurantId\` = ${restaurantId}
        AND o.\`createdAt\` >= ${range.start}
        AND o.\`createdAt\` <= ${range.end}
        AND o.\`status\` <> 'CANCELLED'
        AND (
          o.\`paymentStatus\` = 'PAID'
          OR EXISTS (SELECT 1 FROM \`payment\` pm WHERE pm.\`orderId\` = o.\`id\` AND pm.\`status\` = 'REFUNDED')
        )
        ${branchFilters?.length ? Prisma.sql`AND o.\`branchId\` IN (${Prisma.join([...branchFilters])})` : Prisma.empty}
        ${filters?.orderType ? Prisma.sql`AND o.\`orderType\` = ${filters.orderType}` : Prisma.empty}
        ${filters?.paymentMethod ? Prisma.sql`AND o.\`id\` IN (SELECT \`orderId\` FROM \`payment\` WHERE \`method\` = ${filters.paymentMethod} AND \`status\` = 'PAID')` : Prisma.empty}
    `;

    const itemFilterSql = Prisma.sql`
      ${filters?.productId ? Prisma.sql`AND oi.\`productId\` = ${filters.productId}` : Prisma.empty}
      ${filters?.categoryId ? Prisma.sql`AND oi.\`productId\` IN (SELECT \`id\` FROM \`product\` WHERE \`restaurantId\` = ${restaurantId} AND \`categoryId\` = ${filters.categoryId})` : Prisma.empty}
    `;

    const [
      orderAgg,
      refundAgg,
      productRows,
      branchSalesRows,
      branchCogsRows,
      branchRefundRows,
      coverageRow,
      unpaidRow,
      allProductsMeta,
      allCategoriesMeta,
      refundRevenue,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: soldWhere,
        _sum: {
          subtotal: true,
          grandTotal: true,
          discount: true,
          tax: true,
          serviceCharge: true,
        },
      }),

      prisma.refund.aggregate({
        where: {
          restaurantId,
          ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
          status: "APPROVED",
          approvedAt: { gte: range.start, lte: range.end },
          // H4.5-B1 — approval-date attribution: the order may predate the period.
          order: soldScopeWhere,
        },
        _sum: { amount: true },
      }),

      // Product-level metrics + COGS + coverage counts. Scope + filters applied
      // server-side; COGS is only summed for SNAPSHOTTED rows (others are NULL → 0).
      prisma.$queryRaw<
        Array<{
          productId: string;
          productName: string;
          categoryId: string | null;
          categoryName: string | null;
          qty: bigint | number | string;
          gross: bigint | number | string;
          discount: bigint | number | string;
          orderCount: bigint | number | string;
          cogs: bigint | number | string;
          withSnapshot: bigint | number | string;
          costed: bigint | number | string;
          legacy: bigint | number | string;
          pending: bigint | number | string;
          totalItems: bigint | number | string;
        }>
      >`
        SELECT oi.\`productId\`,
               p.\`name\` AS productName,
               p.\`categoryId\` AS categoryId,
               c.\`name\` AS categoryName,
               COALESCE(SUM(oi.\`quantity\`), 0) AS qty,
               COALESCE(SUM(oi.\`totalPrice\`), 0) AS gross,
               COALESCE(SUM(
                 CASE WHEN o.\`subtotal\` > 0
                   THEN oi.\`totalPrice\` * o.\`discount\` / o.\`subtotal\`
                   ELSE 0 END
               ), 0) AS discount,
               COUNT(DISTINCT oi.\`orderId\`) AS orderCount,
               COALESCE(SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN s.\`hppTotal\` ELSE 0 END), 0) AS cogs,
               SUM(CASE WHEN s.\`id\` IS NOT NULL THEN 1 ELSE 0 END) AS withSnapshot,
               SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS costed,
               SUM(CASE WHEN o.\`status\` = 'COMPLETED' AND s.\`id\` IS NULL THEN 1 ELSE 0 END) AS legacy,
               SUM(CASE WHEN o.\`status\` <> 'COMPLETED' AND s.\`id\` IS NULL THEN 1 ELSE 0 END) AS pending,
               COUNT(*) AS totalItems
        FROM \`orderitem\` oi
        JOIN \`order\` o ON o.\`id\` = oi.\`orderId\`
        JOIN \`product\` p ON p.\`id\` = oi.\`productId\`
        LEFT JOIN \`category\` c ON c.\`id\` = p.\`categoryId\`
        LEFT JOIN \`orderitemcostsnapshot\` s ON s.\`orderItemId\` = oi.\`id\`
        ${itemWhere}
        ${itemFilterSql}
        GROUP BY oi.\`productId\`, p.\`name\`, p.\`categoryId\`, c.\`name\`
        ORDER BY COALESCE(SUM(oi.\`totalPrice\`), 0) DESC
      `,

      // Branch-level order metrics (for multi-branch profitability).
      prisma.$queryRaw<
        Array<{
          branchId: string;
          totalSales: bigint | number | string;
          totalTax: bigint | number | string;
          totalServiceCharge: bigint | number | string;
          orders: bigint | number | string;
        }>
      >`
        SELECT o.\`branchId\`,
               COALESCE(SUM(o.\`grandTotal\`), 0) AS totalSales,
               COALESCE(SUM(o.\`tax\`), 0) AS totalTax,
               COALESCE(SUM(o.\`serviceCharge\`), 0) AS totalServiceCharge,
               COUNT(DISTINCT o.\`id\`) AS orders
        FROM \`order\` o
        ${itemWhere}
        GROUP BY o.\`branchId\`
      `,

      // Branch-level COGS.
      prisma.$queryRaw<
        Array<{
          branchId: string | null;
          cogs: bigint | number | string;
          costed: bigint | number | string;
          uncosted: bigint | number | string;
          legacy: bigint | number | string;
          pending: bigint | number | string;
          totalItems: bigint | number | string;
        }>
      >`
        SELECT o.\`branchId\`,
               COALESCE(SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN s.\`hppTotal\` ELSE 0 END), 0) AS cogs,
               SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS costed,
               SUM(CASE WHEN s.\`id\` IS NOT NULL AND s.\`status\` <> 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS uncosted,
               SUM(CASE WHEN o.\`status\` = 'COMPLETED' AND s.\`id\` IS NULL THEN 1 ELSE 0 END) AS legacy,
               SUM(CASE WHEN o.\`status\` <> 'COMPLETED' AND s.\`id\` IS NULL THEN 1 ELSE 0 END) AS pending,
               COUNT(*) AS totalItems
        FROM \`orderitem\` oi
        JOIN \`order\` o ON o.\`id\` = oi.\`orderId\`
        LEFT JOIN \`orderitemcostsnapshot\` s ON s.\`orderItemId\` = oi.\`id\`
        ${itemWhere}
        GROUP BY o.\`branchId\`
      `,

      // Refund totals per branch (APPROVED within period).
      prisma.$queryRaw<
        Array<{
          branchId: string | null;
          refund: bigint | number | string;
        }>
      >`
        SELECT r.\`branchId\`,
               COALESCE(SUM(r.\`amount\`), 0) AS refund
        FROM \`refund\` r
        JOIN \`order\` o ON o.\`id\` = r.\`orderId\`
        WHERE r.\`restaurantId\` = ${restaurantId}
          AND r.\`status\` = 'APPROVED'
          AND r.\`approvedAt\` >= ${range.start}
          AND r.\`approvedAt\` <= ${range.end}
          AND o.\`status\` <> 'CANCELLED'
          AND (
            o.\`paymentStatus\` = 'PAID'
            OR EXISTS (SELECT 1 FROM \`payment\` pm WHERE pm.\`orderId\` = o.\`id\` AND pm.\`status\` = 'REFUNDED')
          )
          ${branchFilters?.length ? Prisma.sql`AND r.\`branchId\` IN (${Prisma.join([...branchFilters])})` : Prisma.empty}
        GROUP BY r.\`branchId\`
      `,

      // Coverage counts (all sold items in scope).
      prisma.$queryRaw<
        Array<{
          totalOrderItems: bigint | number | string;
          costedOrderItems: bigint | number | string;
          uncostedOrderItems: bigint | number | string;
          legacyOrderItems: bigint | number | string;
          pendingOrderItems: bigint | number | string;
        }>
      >`
        SELECT COUNT(*) AS totalOrderItems,
               SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS costedOrderItems,
               SUM(CASE WHEN s.\`id\` IS NOT NULL AND s.\`status\` <> 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS uncostedOrderItems,
               SUM(CASE WHEN o.\`status\` = 'COMPLETED' AND s.\`id\` IS NULL THEN 1 ELSE 0 END) AS legacyOrderItems,
               SUM(CASE WHEN o.\`status\` <> 'COMPLETED' AND s.\`id\` IS NULL THEN 1 ELSE 0 END) AS pendingOrderItems
        FROM \`orderitem\` oi
        JOIN \`order\` o ON o.\`id\` = oi.\`orderId\`
        LEFT JOIN \`orderitemcostsnapshot\` s ON s.\`orderItemId\` = oi.\`id\`
        ${itemWhere}
      `,

      // Unpaid completed COGS (COMPLETED but paymentStatus != PAID) for disclosure.
      prisma.$queryRaw<
        Array<{
          orders: bigint | number | string;
          orderItems: bigint | number | string;
          cogs: bigint | number | string;
        }>
      >`
        SELECT COUNT(DISTINCT o.\`id\`) AS orders,
               COUNT(oi.\`id\`) AS orderItems,
               COALESCE(SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN s.\`hppTotal\` ELSE 0 END), 0) AS cogs
        FROM \`order\` o
        JOIN \`orderitem\` oi ON oi.\`orderId\` = o.\`id\`
        LEFT JOIN \`orderitemcostsnapshot\` s ON s.\`orderItemId\` = oi.\`id\`
        WHERE o.\`restaurantId\` = ${restaurantId}
          AND o.\`status\` = 'COMPLETED'
          AND o.\`paymentStatus\` <> 'PAID'
          AND o.\`createdAt\` >= ${range.start}
          AND o.\`createdAt\` <= ${range.end}
          ${branchFilters?.length ? Prisma.sql`AND o.\`branchId\` IN (${Prisma.join([...branchFilters])})` : Prisma.empty}
      `,

      // Products + categories for filter dropdowns (active in scope, non-cancelled orders only).
      prisma.product.findMany({
        where: { restaurantId, isActive: true },
        select: {
          id: true,
          name: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
        take: 500,
      }),

      prisma.category.findMany({
        where: { restaurantId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      // H3 PATCH — refund-aware net revenue on the PRODUCT-revenue basis, so a
      // fully refunded order yields netSales = 0 instead of −(tax+service).
      computeRefundRevenue({
        restaurantId,
        start: range.start,
        end: range.end,
        branchFilters,
        extraOrderFilter: Prisma.sql`
          ${filters?.orderType ? Prisma.sql`AND o.\`orderType\` = ${filters.orderType}` : Prisma.empty}
          ${filters?.paymentMethod ? Prisma.sql`AND o.\`id\` IN (SELECT \`orderId\` FROM \`payment\` WHERE \`method\` = ${filters.paymentMethod} AND \`status\` = 'PAID')` : Prisma.empty}
        `,
      }),
    ]);

    // H3.4 — refund-aware COGS reversal, computed from the frozen snapshots
    // (exact per RefundItem) with a pro-rata fallback for legacy refunds.
    const refundAware = await this.computeRefundAware(
      soldScopeWhere,
      restaurantId,
      range,
      branchFilters
    );

    const totalSales = num(orderAgg._sum.grandTotal);
    const grossSales = num(orderAgg._sum.subtotal);
    const totalDiscount = num(orderAgg._sum.discount);
    const totalTax = num(orderAgg._sum.tax);
    const totalServiceCharge = num(orderAgg._sum.serviceCharge);
    const totalRefund = num(refundAgg._sum.amount);
    // H3 PATCH — product revenue (grandTotal − tax − serviceCharge) less the
    // product-revenue share of approved refunds. Identical to the previous
    // formula when tax/service are 0, and exactly 0 for a full refund.
    const netSales = refundRevenue.total.netSales;
    const coverageRowData = coverageRow[0];
    const unpaidRowData = unpaidRow[0];

    // Product rows (in-memory sort + paginate — bounded by active product count).
    const allProductRows: ProfitabilityProductRow[] = productRows.map(
      (r, idx) => {
        const qty = num(r.qty);
        const gross = num(r.gross);
        const discount = num(r.discount);
        const cogs = num(r.cogs);
        const withSnapshot = Number(r.withSnapshot);
        const costed = Number(r.costed);
        const totalItems = Number(r.totalItems);
        const legacy = Number(r.legacy);
        const pending = Number(r.pending);
        const uncosted = withSnapshot - costed;
        const productNet = gross - discount;
        // H2.2 — coverage is decided by STATUS only, never by cogs === 0.
        // Gross profit exists ONLY when every item is SNAPSHOTTED, so a
        // missing/unknown COGS is never reported as a full-margin profit.
        // A valid SNAPSHOTTED COGS of 0 keeps profit = netSales (0 is real).
        const coverageComplete = totalItems > 0 && costed === totalItems;
        const cogsState = deriveCogsState({
          totalItems,
          costed,
          uncosted,
          legacy,
          pending,
        });
        // H3.4 — profit uses RETAINED COGS (historical minus refund reversal),
        // so a partial refund never leaves the refunded cost stranded.
        const productCogsReversal = refundAware.productReversal.get(r.productId) ?? 0;
        const retainedCogs = num(cogs - productCogsReversal);
        const profit = coverageComplete ? num(productNet - retainedCogs) : null;
        const margin =
          profit !== null && productNet > 0
            ? Math.round((profit / productNet) * 10000) / 100
            : null;
        const foodCost =
          coverageComplete && productNet > 0
            ? Math.round((retainedCogs / productNet) * 10000) / 100
            : null;

        return {
          rank: 0, // set after sort
          productId: r.productId,
          name: r.productName,
          categoryId: r.categoryId,
          categoryName: r.categoryName,
          qtySold: qty,
          grossSales: gross,
          discount,
          netSales: productNet,
          cogs,
          grossProfit: profit,
          grossMarginPct: margin,
          foodCostPct: foodCost,
          orderCount: Number(r.orderCount),
          costedItems: costed,
          uncostedItems: uncosted,
          legacyItems: legacy,
          pendingItems: pending,
          coverageComplete,
          cogsState,
          cogsReversal: num(productCogsReversal),
          retainedCogs,
        };
      }
    );

    allProductRows.sort((a, b) => b.netSales - a.netSales || b.qtySold - a.qtySold);
    allProductRows.forEach((row, idx) => {
      row.rank = idx + 1;
    });

    const totalProducts = allProductRows.length;
    const pageStart = (page - 1) * limit;
    const paginatedProducts = allProductRows.slice(pageStart, pageStart + limit);

    const productSummary = {
      totalNetSales: num(
        allProductRows.reduce((sum, r) => sum + r.netSales, 0)
      ),
      totalCogs: num(allProductRows.reduce((sum, r) => sum + r.cogs, 0)),
    };

    // H2.1 — disjoint coverage buckets (each item lands in exactly one).
    const cov: ProfitabilityCoverage = {
      totalOrderItems: Number(coverageRowData?.totalOrderItems ?? 0),
      costedOrderItems: Number(coverageRowData?.costedOrderItems ?? 0),
      uncostedOrderItems: Number(coverageRowData?.uncostedOrderItems ?? 0),
      legacyOrderItems: Number(coverageRowData?.legacyOrderItems ?? 0),
      pendingOrderItems: Number(coverageRowData?.pendingOrderItems ?? 0),
    };
    const coverageComplete =
      cov.uncostedOrderItems + cov.legacyOrderItems + cov.pendingOrderItems === 0;
    const summaryCogsState = deriveCogsState({
      totalItems: cov.totalOrderItems,
      costed: cov.costedOrderItems,
      uncosted: cov.uncostedOrderItems,
      legacy: cov.legacyOrderItems,
      pending: cov.pendingOrderItems,
    });

    // H2.2 — summary COGS is the covered (SNAPSHOTTED) COGS only; it never
    // fabricates COGS for pending/uncovered/legacy items. When coverage is
    // incomplete the gross profit is NULL (UNKNOWN), not revenue − 0.
    // H3.4 — gross profit uses RETAINED COGS (historical − refund reversal).
    // A fully refunded order keeps ALL its incurred COGS, so netSales = 0 with
    // retainedCogs > 0 yields an intentionally negative gross profit.
    const cogs = productSummary.totalCogs;
    const cogsReversal = refundAware.totalReversal;
    const retainedCogs = num(cogs - cogsReversal);
    const summaryGrossProfit = coverageComplete
      ? num(netSales - retainedCogs)
      : null;
    const summaryGrossMarginPct =
      summaryGrossProfit !== null && netSales > 0
        ? Math.round((summaryGrossProfit / netSales) * 10000) / 100
        : null;
    const summaryFoodCostPct =
      coverageComplete && netSales > 0
        ? Math.round((retainedCogs / netSales) * 10000) / 100
        : null;

    // Branch rows (merge order-level sales + cogs + refund per branch).
    const branchSalesMap = new Map(
      branchSalesRows.map((r) => [r.branchId, r])
    );
    const branchCogsMap = new Map(
      branchCogsRows.map((r) => [r.branchId, r])
    );
    const branchRefundMap = new Map(
      branchRefundRows.map((r) => [r.branchId, r])
    );

    const allBranchIds = new Set<string>();
    for (const r of branchSalesRows) allBranchIds.add(r.branchId);
    for (const r of branchCogsRows) if (r.branchId) allBranchIds.add(r.branchId);
    for (const r of branchRefundRows) if (r.branchId) allBranchIds.add(r.branchId);

    const branchRows: ProfitabilityBranchRow[] = [];
    for (const bId of allBranchIds) {
      if (branchFilters?.length && !branchFilters.includes(bId)) continue;
      const sales = branchSalesMap.get(bId);
      const cogsData = branchCogsMap.get(bId);
      const refundData = branchRefundMap.get(bId);

      const bTotalSales = num(sales?.totalSales);
      const bTax = num(sales?.totalTax);
      const bServiceCharge = num(sales?.totalServiceCharge);
      const bRefund = num(refundData?.refund);
      // H3 PATCH — same refund-aware product-revenue basis per branch.
      const bNetSales =
        refundRevenue.byBranch.get(bId)?.netSales ??
        num(bTotalSales - bTax - bServiceCharge - bRefund);
      const bCogs = num(cogsData?.cogs);
      // H2.2 — branch gross profit is NULL unless the branch's COGS coverage
      // is complete (same rule as the product/summary level).
      const bTotal = Number(cogsData?.totalItems ?? 0);
      const bCosted = Number(cogsData?.costed ?? 0);
      const bCoverageComplete = bTotal > 0 && bCosted === bTotal;
      const bCogsState = deriveCogsState({
        totalItems: bTotal,
        costed: bCosted,
        uncosted: Number(cogsData?.uncosted ?? 0),
        legacy: Number(cogsData?.legacy ?? 0),
        pending: Number(cogsData?.pending ?? 0),
      });
      // H3.4 — retained COGS for the branch (partial refunds release cost).
      const bCogsReversal = refundAware.branchReversal.get(bId) ?? 0;
      const bRetainedCogs = num(bCogs - bCogsReversal);
      const bProfit = bCoverageComplete
        ? num(bNetSales - bRetainedCogs)
        : null;
      const bMargin =
        bProfit !== null && bNetSales > 0
          ? Math.round((bProfit / bNetSales) * 10000) / 100
          : null;
      const bFoodCost =
        bCoverageComplete && bNetSales > 0
          ? Math.round((bRetainedCogs / bNetSales) * 10000) / 100
          : null;
      const bRefundState: ProfitabilityRefundState =
        bRefund <= 0 ? "NONE" : bCogsReversal > 0 ? "PARTIAL" : "FULL";

      branchRows.push({
        branchId: bId,
        branchName: "", // resolved below
        branchCode: "",
        orders: Number(sales?.orders ?? 0),
        totalSales: bTotalSales,
        totalTax: bTax,
        totalServiceCharge: bServiceCharge,
        totalRefund: bRefund,
        netSales: bNetSales,
        cogs: bCogs,
        grossProfit: bProfit,
        grossMarginPct: bMargin,
        foodCostPct: bFoodCost,
        coverageComplete: bCoverageComplete,
        cogsState: bCogsState,
        cogsReversal: num(bCogsReversal),
        retainedCogs: bRetainedCogs,
        refundState: bRefundState,
      });
    }

    // Resolve branch names.
    if (branchRows.length > 0) {
      const branchMeta = await prisma.branch.findMany({
        where: {
          id: { in: branchRows.map((b) => b.branchId) },
          restaurantId,
        },
        select: { id: true, name: true, code: true },
      });
      const metaMap = new Map(branchMeta.map((b) => [b.id, b]));
      for (const row of branchRows) {
        const meta = metaMap.get(row.branchId);
        row.branchName = meta?.name ?? "";
        row.branchCode = meta?.code ?? "";
      }
    }

    return {
      period,
      range: { start: range.start.toISOString(), end: range.end.toISOString() },
      filters: {
        branchId: filters?.branchId ?? null,
        productId: filters?.productId ?? null,
        categoryId: filters?.categoryId ?? null,
        orderType: filters?.orderType ?? null,
        paymentMethod: filters?.paymentMethod ?? null,
      },
      summary: {
        totalSales,
        grossSales,
        totalDiscount,
        totalTax,
        totalServiceCharge,
        totalRefund,
        netSales,
        cogs: productSummary.totalCogs,
        grossProfit: summaryGrossProfit,
        grossMarginPct: summaryGrossMarginPct,
        foodCostPct: summaryFoodCostPct,
        coverage: cov,
        coverageComplete,
        cogsState: summaryCogsState,
        grossRevenue: totalSales,
        refundReversal: totalRefund,
        historicalCogs: num(cogs),
        cogsReversal: num(cogsReversal),
        retainedCogs,
        refundState: refundAware.refundState,
        unpaidCompleted: {
          orders: Number(unpaidRowData?.orders ?? 0),
          orderItems: Number(unpaidRowData?.orderItems ?? 0),
          cogs: num(unpaidRowData?.cogs),
        },
      },
      branches: branchRows,
      products: paginatedProducts,
      productSummary: {
      totalNetSales: productSummary.totalNetSales,
      totalCogs: productSummary.totalCogs,
      totalGrossProfit: null,
    },
      pagination: {
        page,
        limit,
        total: totalProducts,
        totalPages: Math.ceil(totalProducts / limit),
      },
      availableProducts: allProductsMeta.map((p) => ({
        id: p.id,
        name: p.name,
        categoryName: p.category.name,
      })),
      availableCategories: allCategoriesMeta,
    };
  }

  /**
   * H3.4 — refund-aware COGS reversal.
   *
   * Only PARTIAL refunds release COGS. A refund that fully refunds its order
   * keeps the ENTIRE historical COGS (the cost was genuinely incurred), so a
   * fully refunded COMPLETED order stays representable with netSales = 0 and
   * retainedCogs > 0 (an intentionally negative gross profit).
   *
   * Quantity-based refunds use the frozen per-item reversedCogs
   * (snapshot.hppUnit × refunded quantity). Legacy amount-only refunds with no
   * RefundItem rows fall back to a PRO-RATA approximation
   * (refundAmount / grandTotal × covered COGS) — approximate by design.
   */
  private async computeRefundAware(
    refundOrderScope: Prisma.OrderWhereInput,
    restaurantId: string,
    range: { start: Date; end: Date },
    branchFilters?: string[] | null
  ): Promise<{
    totalReversal: number;
    productReversal: Map<string, number>;
    branchReversal: Map<string, number>;
    refundState: ProfitabilityRefundState;
  }> {
    const productReversal = new Map<string, number>();
    const branchReversal = new Map<string, number>();

    const refunds = await prisma.refund.findMany({
      where: {
        restaurantId,
        status: "APPROVED",
        approvedAt: { gte: range.start, lte: range.end },
        ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
        // H4.5-B1 — approval-date attribution: the order may predate the period.
        order: refundOrderScope,
      },
      select: {
        orderId: true,
        amount: true,
        items: {
          select: {
            reversedCogs: true,
            orderItem: { select: { productId: true } },
          },
        },
        order: { select: { branchId: true, grandTotal: true } },
      },
    });
    if (refunds.length === 0) {
      return {
        totalReversal: 0,
        productReversal,
        branchReversal,
        refundState: "NONE",
      };
    }

    const orderIds = [...new Set(refunds.map((r) => r.orderId))];
    const [paymentAgg, snapRows] = await Promise.all([
      prisma.payment.groupBy({
        by: ["orderId"],
        where: {
          orderId: { in: orderIds },
          status: { in: ["PAID", "REFUNDED"] },
        },
        _sum: { amount: true },
      }),
      prisma.orderItemCostSnapshot.findMany({
        where: { orderId: { in: orderIds }, status: "SNAPSHOTTED" },
        select: { orderId: true, productId: true, hppTotal: true },
      }),
    ]);

    const paidByOrder = new Map(
      paymentAgg.map((r) => [r.orderId, Number(r._sum.amount ?? 0)])
    );
    const refundedByOrder = new Map<string, number>();
    for (const r of refunds) {
      refundedByOrder.set(
        r.orderId,
        round2((refundedByOrder.get(r.orderId) ?? 0) + Number(r.amount))
      );
    }
    // Orders fully refunded keep ALL of their incurred COGS (no reversal).
    const fullyRefunded = new Set<string>();
    for (const [orderId, paid] of paidByOrder) {
      if (paid > 0 && (refundedByOrder.get(orderId) ?? 0) >= paid - MONEY_EPSILON) {
        fullyRefunded.add(orderId);
      }
    }

    const cogsByOrder = new Map<string, number>();
    const cogsByOrderProduct = new Map<string, Map<string, number>>();
    for (const s of snapRows) {
      const v = Number(s.hppTotal ?? 0);
      cogsByOrder.set(s.orderId, (cogsByOrder.get(s.orderId) ?? 0) + v);
      if (!cogsByOrderProduct.has(s.orderId)) {
        cogsByOrderProduct.set(s.orderId, new Map());
      }
      const m = cogsByOrderProduct.get(s.orderId)!;
      m.set(s.productId, (m.get(s.productId) ?? 0) + v);
    }

    const orderReversal = new Map<string, number>();
    const addOrderReversal = (orderId: string, v: number) => {
      orderReversal.set(orderId, round2((orderReversal.get(orderId) ?? 0) + v));
    };
    const addProductReversal = (productId: string, v: number) => {
      productReversal.set(
        productId,
        round2((productReversal.get(productId) ?? 0) + v)
      );
    };

    let hasPartial = false;
    let hasFull = false;
    for (const r of refunds) {
      if (fullyRefunded.has(r.orderId)) {
        hasFull = true;
        continue;
      }
      hasPartial = true;
      if (r.items.length > 0) {
        // Exact, quantity-based reversal from the frozen snapshot value.
        for (const it of r.items) {
          const rev = Number(it.reversedCogs ?? 0);
          if (rev <= 0) continue;
          addOrderReversal(r.orderId, rev);
          const pid = it.orderItem?.productId;
          if (pid) addProductReversal(pid, rev);
        }
      } else {
        // Legacy amount-only refund → pro-rata fallback (approximate).
        const covered = cogsByOrder.get(r.orderId) ?? 0;
        const grand = Number(r.order?.grandTotal ?? 0);
        const ratio = grand > 0 ? Math.min(1, Number(r.amount) / grand) : 0;
        const reversal = round2(covered * ratio);
        if (reversal <= 0) continue;
        addOrderReversal(r.orderId, reversal);
        const perProduct = cogsByOrderProduct.get(r.orderId);
        if (perProduct && covered > 0) {
          for (const [pid, c] of perProduct) {
            addProductReversal(pid, round2(reversal * (c / covered)));
          }
        }
      }
    }

    const branchOfOrder = new Map<string, string | null>();
    for (const r of refunds) {
      branchOfOrder.set(r.orderId, r.order?.branchId ?? null);
    }
    for (const [orderId, rev] of orderReversal) {
      const bId = branchOfOrder.get(orderId);
      if (!bId) continue;
      branchReversal.set(bId, round2((branchReversal.get(bId) ?? 0) + rev));
    }

    let totalReversal = 0;
    for (const v of orderReversal.values()) {
      totalReversal = round2(totalReversal + v);
    }

    return {
      totalReversal,
      productReversal,
      branchReversal,
      refundState: hasPartial ? "PARTIAL" : hasFull ? "FULL" : "NONE",
    };
  }
}

export const profitabilityService = new ProfitabilityService();
