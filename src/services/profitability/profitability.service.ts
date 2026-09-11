import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";
import { resolveReportRange, type ReportPeriod } from "@/services/report/report.service";
import type {
  ProfitabilityReport,
  ProfitabilityProductRow,
  ProfitabilityBranchRow,
  ProfitabilityFilters,
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

    const soldWhere: Prisma.OrderWhereInput = {
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      createdAt: { gte: range.start, lte: range.end },
      status: { not: "CANCELLED" },
      paymentStatus: "PAID",
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

    const itemWhere = Prisma.sql`
      WHERE o.\`restaurantId\` = ${restaurantId}
        AND o.\`createdAt\` >= ${range.start}
        AND o.\`createdAt\` <= ${range.end}
        AND o.\`status\` <> 'CANCELLED'
        AND o.\`paymentStatus\` = 'PAID'
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
          order: soldWhere,
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
          totalItems: bigint | number | string;
        }>
      >`
        SELECT o.\`branchId\`,
               COALESCE(SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN s.\`hppTotal\` ELSE 0 END), 0) AS cogs,
               SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS costed,
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
          AND o.\`paymentStatus\` = 'PAID'
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
        }>
      >`
        SELECT COUNT(*) AS totalOrderItems,
               SUM(CASE WHEN s.\`status\` = 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS costedOrderItems,
               SUM(CASE WHEN s.\`id\` IS NOT NULL AND s.\`status\` <> 'SNAPSHOTTED' THEN 1 ELSE 0 END) AS uncostedOrderItems,
               SUM(CASE WHEN o.\`status\` = 'COMPLETED' AND s.\`id\` IS NULL THEN 1 ELSE 0 END) AS legacyOrderItems
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
    ]);

    const totalSales = num(orderAgg._sum.grandTotal);
    const grossSales = num(orderAgg._sum.subtotal);
    const totalDiscount = num(orderAgg._sum.discount);
    const totalTax = num(orderAgg._sum.tax);
    const totalServiceCharge = num(orderAgg._sum.serviceCharge);
    const totalRefund = num(refundAgg._sum.amount);
    const netSales = totalSales - totalTax - totalServiceCharge - totalRefund;
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
        const productNet = gross - discount;
        const profit =
          withSnapshot === totalItems || cogs !== 0 ? productNet - cogs : null;
        const margin =
          profit !== null && productNet > 0
            ? Math.round((profit / productNet) * 10000) / 100
            : null;
        const foodCost =
          productNet > 0
            ? Math.round((cogs / productNet) * 10000) / 100
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
          uncostedItems: withSnapshot - costed,
          legacyItems: legacy,
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

    // Summary profit metrics derived directly from aggregated revenue vs COGS
    // (avoids rounding drift from summing per-product profits).
    const cogs = productSummary.totalCogs;
    const summaryGrossProfit = netSales - cogs;
    const summaryGrossMarginPct =
      netSales > 0
        ? Math.round((summaryGrossProfit / netSales) * 10000) / 100
        : null;
    const summaryFoodCostPct =
      netSales > 0
        ? Math.round((cogs / netSales) * 10000) / 100
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
      const bNetSales = bTotalSales - bTax - bServiceCharge - bRefund;
      const bCogs = num(cogsData?.cogs);
      const bProfit = bNetSales - bCogs;
      const bMargin =
        bNetSales > 0
          ? Math.round((bProfit / bNetSales) * 10000) / 100
          : null;
      const bFoodCost =
        bNetSales > 0
          ? Math.round((bCogs / bNetSales) * 10000) / 100
          : null;

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
        coverage: {
          totalOrderItems: Number(coverageRowData?.totalOrderItems ?? 0),
          costedOrderItems: Number(coverageRowData?.costedOrderItems ?? 0),
          uncostedOrderItems: Number(coverageRowData?.uncostedOrderItems ?? 0),
          legacyOrderItems: Number(coverageRowData?.legacyOrderItems ?? 0),
        },
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
}

export const profitabilityService = new ProfitabilityService();
