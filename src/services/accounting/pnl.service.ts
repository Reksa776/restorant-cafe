import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";
import { round2, num } from "@/lib/money";
import { resolveReportRange } from "@/services/report/report.service";
import { profitabilityService } from "@/services/profitability/profitability.service";
import { PnlQuerySchema, type PnlReport } from "./pnl.types";
// D1 — pure rules (DB-free). Re-exported below for existing consumers.
import { computeNetProfit } from "./pnl.rules";

export { computeNetProfit } from "./pnl.rules";

// ============================================================
// PROFIT & LOSS — READ-MODEL (ACCOUNTING PHASE D)
//
// A READ-ONLY composition. It introduces NO new revenue/refund/COGS/expense
// engine and writes nothing. Every number is sourced from the EXISTING
// canonical engines:
//
//   * Revenue / Net Sales  → the canonical report engine, via Profitabilitas
//     (`profitabilityService.getProfitabilityReport` → `computeRefundRevenue`).
//   * COGS / coverage / refund reversal / Gross Profit → Profitabilitas
//     (`OrderItemCostSnapshot`, refund-aware reversal).
//   * Operating Expenses   → the `Expense` table (ACCOUNTING PHASE B),
//     tenant + branch scoped, bounded to the SAME period as the report.
//
//   Gross Profit = netSales − retainedCogs  (null when COGS is incomplete)
//   Net Profit   = Gross Profit − Operating Expenses  (null when GP is null)
//
// Hard rules: Purchase is NEVER an operating expense (it becomes COGS when
// sold); missing COGS is never treated as 0; the period range and all
// tenant/branch scoping reuse the existing helpers unchanged.
// ============================================================

/** Local-day bounds, matching the Expense `spentAt` calendar-day semantics. */
function startOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function endOfLocalDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

export async function getPnlReport(
  restaurantId: string,
  rawQuery: unknown,
  branchFilters?: string[] | null
): Promise<PnlReport> {
  const parsed = PnlQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const q = parsed.data;

  const range = resolveReportRange(q.period, q.startDate ?? undefined, q.endDate ?? undefined);

  // 1) Revenue / Net Sales / COGS / Gross Profit — delegated to the existing
  //    Profitabilitas engine (single source of truth for COGS + gross profit).
  //    Same filters + scope the Profitabilitas page uses, so the two cannot
  //    diverge. `limit: 1` only trims the product table; the summary is
  //    computed over ALL product rows.
  const profitability = await profitabilityService.getProfitabilityReport(
    restaurantId,
    q.period,
    {
      startDate: q.startDate ?? undefined,
      endDate: q.endDate ?? undefined,
      branchFilters,
      filters: {
        branchId: q.branchId ?? null,
        productId: null,
        categoryId: null,
        orderType: q.orderType ?? null,
        paymentMethod: q.paymentMethod ?? null,
      },
      pagination: { page: 1, limit: 1 },
    }
  );
  const s = profitability.summary;

  // 2) Operating Expenses — a scoped, read-only aggregate over `Expense`.
  //    Period bounds are aligned to the report range using the SAME local-day
  //    semantics the expense module uses (spentAt is a calendar day). This does
  //    NOT change any existing date basis.
  const expenseWhere = {
    restaurantId,
    ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    spentAt: { gte: startOfLocalDay(range.start), lte: endOfLocalDay(range.end) },
  };

  const [expenseAgg, expenseGrouped, expenseCount] = await Promise.all([
    prisma.expense.aggregate({ where: expenseWhere, _sum: { amount: true } }),
    prisma.expense.groupBy({
      by: ["categoryId"],
      where: expenseWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.expense.count({ where: expenseWhere }),
  ]);

  const categoryIds = expenseGrouped.map((g) => g.categoryId);
  const categories = categoryIds.length
    ? await prisma.expenseCategory.findMany({
        where: { id: { in: categoryIds }, restaurantId },
        select: { id: true, name: true },
      })
    : [];
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const byCategory = expenseGrouped
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: categoryName.get(g.categoryId) ?? "—",
      total: round2(num(g._sum.amount)),
      count: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);

  const operatingExpenses = round2(num(expenseAgg._sum.amount));

  // 3) Net Profit — null whenever Gross Profit is unknown.
  const grossProfit = s.grossProfit;
  const netProfit = computeNetProfit(
    grossProfit === null ? null : num(grossProfit),
    operatingExpenses
  );

  return {
    period: q.period,
    range: { start: range.start.toISOString(), end: range.end.toISOString() },
    filters: {
      branchId: q.branchId ?? null,
      orderType: q.orderType ?? null,
      paymentMethod: q.paymentMethod ?? null,
    },
    summary: {
      grossSales: num(s.totalSales),
      totalDiscount: num(s.totalDiscount),
      totalTax: num(s.totalTax),
      totalServiceCharge: num(s.totalServiceCharge),
      totalRefund: num(s.refundReversal),
      netSales: num(s.netSales),
      cogs: num(s.retainedCogs),
      historicalCogs: num(s.historicalCogs),
      cogsReversal: num(s.cogsReversal),
      grossProfit: grossProfit === null ? null : num(grossProfit),
      operatingExpenses,
      netProfit,
    },
    opex: {
      total: operatingExpenses,
      count: expenseCount,
      byCategory,
    },
    coverage: s.coverage,
    coverageComplete: s.coverageComplete,
    cogsState: s.cogsState,
    refundState: s.refundState,
    unpaidCompleted: s.unpaidCompleted,
    disclosure: {
      netProfitProvisional: true,
      expenseDataEmpty: expenseCount === 0,
      purchaseExcluded: true,
      // D1 — inherited integrity disclosure (revenue orders without items).
      revenueWithoutItems: s.revenueWithoutItems,
      dateBasis: {
        revenue: "order.createdAt",
        refund: "refund.approvedAt",
        cogs: "order.createdAt",
        expense: "expense.spentAt",
      },
    },
  };
}
