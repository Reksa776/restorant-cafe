import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";

// ============================================================
// Sales report aggregation (server-side only — never trusts client
// totals). All queries are restaurant-scoped and only count REAL sales:
// an order counts as sold when status != CANCELLED AND paymentStatus = PAID
// (FAILED / EXPIRED / REFUNDED / UNPAID / PENDING are never revenue).
// ============================================================

export type ReportPeriod = "today" | "yesterday" | "week" | "month" | "custom";

export interface ReportRange {
  start: Date;
  end: Date;
}

/** Resolve a period (+ optional custom dates) into a [start, end] range. */
export function resolveReportRange(
  period: ReportPeriod,
  startDate?: string,
  endDate?: string
): ReportRange {
  const now = new Date();

  if (period === "custom") {
    if (!startDate || !endDate) {
      throw new ValidationError(
        "startDate dan endDate wajib diisi untuk periode custom"
      );
    }
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ValidationError("Format tanggal tidak valid");
    }
    if (start > end) {
      throw new ValidationError("startDate tidak boleh melebihi endDate");
    }
    return { start, end };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (period) {
    case "today":
      break;
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      break;
    }
    case "week": {
      // Monday-based week (ISO).
      const day = start.getDay(); // 0 = Sunday
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff);
      break;
    }
    case "month": {
      start.setDate(1);
      break;
    }
  }

  if (period === "yesterday") {
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return { start, end: now };
}

// The "sold" order predicate shared by every aggregation.
function soldOrderWhere(
  restaurantId: string,
  range: ReportRange,
  branchFilters?: string[] | null
) {
  return {
    restaurantId,
    ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    createdAt: { gte: range.start, lte: range.end },
    status: { not: "CANCELLED" as const },
    paymentStatus: "PAID" as const,
  };
}

export class ReportService {
  /** Full sales report for the period. When `branchFilters` is set, only those branches. */
  async getSalesReport(
    restaurantId: string,
    period: ReportPeriod,
    startDate?: string,
    endDate?: string,
    branchFilters?: string[] | null
  ) {
    const range = resolveReportRange(period, startDate, endDate);
    const soldWhere = soldOrderWhere(restaurantId, range, branchFilters);

    // ------------------------------------------------------------
    // Summary (Prisma aggregate over sold orders)
    // ------------------------------------------------------------
    const [
      orderAgg,
      orderCountAll,
      paidOrderCount,
      itemAgg,
      paymentRows,
      orderTypeRows,
      bestSellerRows,
      categoryProductRows,
      hourlyRows,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: soldWhere,
        _sum: {
          grandTotal: true,
          discount: true,
          tax: true,
          serviceCharge: true,
        },
      }),
      prisma.order.count({
        where: {
          restaurantId,
          ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
          createdAt: { gte: range.start, lte: range.end },
          status: { not: "CANCELLED" },
        },
      }),
      prisma.order.count({ where: soldWhere }),
      prisma.orderItem.aggregate({
        where: { order: { is: soldWhere } },
        _sum: { quantity: true },
      }),
      // Payment breakdown (all statuses — cash/QRIS/VA + non-paid buckets).
      prisma.payment.groupBy({
        by: ["method", "status", "provider"],
        where: {
          restaurantId,
          ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
          createdAt: { gte: range.start, lte: range.end },
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      // Order type breakdown (sold only).
      prisma.order.groupBy({
        by: ["orderType"],
        where: soldWhere,
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
      // Best selling products (sold only).
      prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: { is: soldWhere } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10,
      }),
      // Category revenue — group by product first, join category below.
      prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: { is: soldWhere } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 50,
      }),
      // Busiest hours (MySQL HOUR()) — sold orders only.
      prisma.$queryRaw<
        Array<{ hour: number; orders: bigint | number; revenue: number | string }>
      >`
        SELECT HOUR(\`createdAt\`) AS hour,
               COUNT(*) AS orders,
               COALESCE(SUM(\`grandTotal\`), 0) AS revenue
        FROM \`order\`
        WHERE \`restaurantId\` = ${restaurantId}
          ${branchFilters?.length ? Prisma.sql`AND \`branchId\` IN (${Prisma.join(branchFilters)})` : Prisma.empty}
          AND \`createdAt\` >= ${range.start}
          AND \`createdAt\` <= ${range.end}
          AND \`status\` <> 'CANCELLED'
          AND \`paymentStatus\` = 'PAID'
        GROUP BY HOUR(\`createdAt\`)
        ORDER BY hour ASC
      `,
    ]);

    const totalSales = Number(orderAgg._sum.grandTotal ?? 0);
    const totalDiscount = Number(orderAgg._sum.discount ?? 0);
    const totalTax = Number(orderAgg._sum.tax ?? 0);
    const totalServiceCharge = Number(orderAgg._sum.serviceCharge ?? 0);
    const totalItemsSold = Number(itemAgg._sum.quantity ?? 0);

    // ------------------------------------------------------------
    // Payment breakdown buckets
    // ------------------------------------------------------------
    const buckets = {
      cash: { count: 0, amount: 0 },
      qris: { count: 0, amount: 0 },
      va: { count: 0, amount: 0 },
      other: { count: 0, amount: 0 },
      unpaid: { count: 0, amount: 0 },
      failed: { count: 0, amount: 0 },
      refunded: { count: 0, amount: 0 },
      cancelled: { count: 0, amount: 0 },
    };

    for (const row of paymentRows) {
      const amount = Number(row._sum.amount ?? 0);
      const count = row._count._all;
      const method = row.method;
      const status = row.status;

      // Method bucket (paid only for the revenue buckets).
      if (status === "PAID") {
        if (method === "KASIR") {
          buckets.cash.count += count;
          buckets.cash.amount += amount;
        } else if (method === "QRIS") {
          buckets.qris.count += count;
          buckets.qris.amount += amount;
        } else if (row.provider === "ipaymu" && !method) {
          buckets.va.count += count;
          buckets.va.amount += amount;
        } else {
          buckets.other.count += count;
          buckets.other.amount += amount;
        }
      } else if (status === "UNPAID" || status === "PENDING") {
        buckets.unpaid.count += count;
        buckets.unpaid.amount += amount;
      } else if (status === "FAILED" || status === "EXPIRED") {
        buckets.failed.count += count;
        buckets.failed.amount += amount;
      } else if (status === "REFUNDED") {
        buckets.refunded.count += count;
        buckets.refunded.amount += amount;
      } else if (status === "CANCELLED") {
        buckets.cancelled.count += count;
        buckets.cancelled.amount += amount;
      }
    }

    // ------------------------------------------------------------
    // Order type breakdown
    // ------------------------------------------------------------
    const orderType = {
      DINE_IN: { count: 0, amount: 0 },
      TAKEAWAY: { count: 0, amount: 0 },
      DELIVERY: { count: 0, amount: 0 },
    };
    for (const row of orderTypeRows) {
      const bucket = orderType[row.orderType];
      if (bucket) {
        bucket.count = row._count._all;
        bucket.amount = Number(row._sum.grandTotal ?? 0);
      }
    }

    // ------------------------------------------------------------
    // Best selling products (+ categories)
    // ------------------------------------------------------------
    const bestSellerIds = bestSellerRows.map((r) => r.productId);
    const bestSellers = await prisma.product.findMany({
      where: { id: { in: bestSellerIds }, restaurantId },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        category: { select: { id: true, name: true } },
      },
    });
    const bestSellerMap = new Map(bestSellers.map((p) => [p.id, p]));

    const bestSellingProducts = bestSellerRows
      .map((row) => {
        const product = bestSellerMap.get(row.productId);
        if (!product) return null;
        return {
          productId: product.id,
          name: product.name,
          imageUrl: product.imageUrl,
          categoryName: product.category?.name || null,
          quantitySold: row._sum.quantity ?? 0,
          revenue: Number(row._sum.totalPrice ?? 0),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Category revenue aggregated from the top-50 product rows.
    const productRowsForCategory = await prisma.product.findMany({
      where: {
        id: { in: categoryProductRows.map((r) => r.productId) },
        restaurantId,
      },
      select: {
        id: true,
        category: { select: { id: true, name: true } },
      },
    });
    const productCategoryMap = new Map(
      productRowsForCategory.map((p) => [p.id, p.category])
    );
    const categoryTotals = new Map<
      string,
      { name: string; quantitySold: number; revenue: number }
    >();
    for (const row of categoryProductRows) {
      const cat = productCategoryMap.get(row.productId);
      if (!cat) continue;
      const entry = categoryTotals.get(cat.id) || {
        name: cat.name,
        quantitySold: 0,
        revenue: 0,
      };
      entry.quantitySold += Number(row._sum.quantity ?? 0);
      entry.revenue += Number(row._sum.totalPrice ?? 0);
      categoryTotals.set(cat.id, entry);
    }
    const bestCategories = [...categoryTotals.values()]
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 5);

    // ------------------------------------------------------------
    // Busiest hours
    // ------------------------------------------------------------
    const busiestHours = hourlyRows.map((row) => ({
      hour: Number(row.hour),
      orders: Number(row.orders),
      revenue: Number(row.revenue),
    }));

    const paidCount = paidOrderCount;
    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      summary: {
        totalSales,
        totalOrders: orderCountAll,
        paidOrders: paidCount,
        totalItemsSold,
        averageOrderValue: paidCount > 0 ? totalSales / paidCount : 0,
        totalDiscount,
        totalTax,
        totalServiceCharge,
        // Net = product revenue after discount, before tax/service.
        netSales: totalSales - totalTax - totalServiceCharge,
      },
      paymentBreakdown: buckets,
      orderType,
      bestSellingProducts,
      bestCategories,
      busiestHours,
    };
  }

  /**
   * Order-level rows for the CSV export (non-cancelled orders in range).
   * Bounded to the 5000 most recent orders so the export stays cheap.
   */
  async getSalesOrdersForExport(
    restaurantId: string,
    period: ReportPeriod,
    startDate?: string,
    endDate?: string,
    branchFilters?: string[] | null
  ) {
    const range = resolveReportRange(period, startDate, endDate);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
        createdAt: { gte: range.start, lte: range.end },
        status: { not: "CANCELLED" },
      },
      include: {
        customer: { select: { name: true } },
        payments: {
          select: {
            method: true,
            provider: true,
            status: true,
            paidAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    // Newest-first for the DB read, but export chronologically.
    return orders.reverse();
  }
}

export const reportService = new ReportService();