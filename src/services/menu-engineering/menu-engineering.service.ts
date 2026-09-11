// ============================================================
// F.6 — MENU ENGINEERING + COST INTELLIGENCE (COMPOSITION LAYER)
//
// Reuses the production-tested engines:
//   - profitabilityService (F.5): historical PAID revenue + frozen COGS
//   - costingService (F.4): current per-branch HPP + selling price
//   - existing report range resolver + auth scope helpers
//
// F.6 itself performs NO order/payment/price math of its own — it
// merges engine DTOs, computes scoped MEDIAN thresholds, applies the
// data-sufficiency/uncosted/new guards and returns a compact DTO.
//
// Axis semantics (must stay consistent with F.4/F.5):
//   X = qtySold        (historical sold quantity, PAID-only)
//   Y = grossProfit     (profitabilityService metric, null when not
//                        fully snapshot-covered → never forced to 0)
//   Current HPP/selling price = SELECTED BRANCH ONLY (never mixed
//   silently into the all-branch historical figures).
// ============================================================

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  resolveReportRange,
  type ReportPeriod,
} from "@/services/report/report.service";
import { profitabilityService } from "@/services/profitability/profitability.service";
import type {
  ProfitabilityProductRow,
  ProfitabilityBranchRow,
  ProfitabilityReport,
} from "@/services/profitability/profitability.types";
import { costingService } from "@/services/costing/costing.service";
import type { CostingListItemDto } from "@/services/costing/costing.types";
import { authorizedBranches } from "@/lib/auth-helpers";
import type { AuthenticatedContext } from "@/lib/auth-helpers";
import {
  MIN_ORDER_COUNT,
  MIN_QTY_SOLD,
  NEW_PRODUCT_DAYS,
  DEFAULT_LIMIT,
  MAX_LIMIT,
  PROFITABILITY_FETCH_LIMIT,
  COSTING_FETCH_LIMIT,
  MAX_ACTIVE_PRODUCTS,
  MAX_FETCH_PAGES,
  CLASSIFICATION_INSIGHTS,
  calculateMedian,
  classifyProduct,
  resolveMedianScope,
} from "./menu-engineering.constants";
import type {
  MenuEngineeringReport,
  MenuEngineeringProductRow,
  MenuEngineeringCategoryRow,
  MenuEngineeringBranchRow,
  MenuEngineeringThreshold,
  MenuEngineeringRequest,
} from "./menu-engineering.types";

function num(v: unknown): number {
  return Math.round((Number(v ?? 0) + Number.EPSILON) * 100) / 100;
}

export class MenuEngineeringService {
  async getMenuEngineeringReport(
    input: MenuEngineeringRequest,
    ctx: AuthenticatedContext
  ): Promise<MenuEngineeringReport> {
    const range = resolveReportRange(input.period as ReportPeriod, input.startDate, input.endDate);
    const branchFilters = input.branchId
      ? [input.branchId]
      : authorizedBranches(ctx);

    // Parallel source collection (all read-only, bounded).
    const [
      histResult,
      branchQtyMap,
      activeProducts,
      categories,
      uncostedStatusMap,
      costingBranch,
    ] = await Promise.all([
      this.fetchAllProfitability(ctx.restaurantId, range, branchFilters),
      this.fetchBranchQty(ctx.restaurantId, range, branchFilters),
      prisma.product.findMany({
        where: { restaurantId: ctx.restaurantId, isActive: true },
        select: {
          id: true,
          name: true,
          price: true,
          createdAt: true,
          categoryId: true,
          category: { select: { id: true, name: true } },
        },
        orderBy: { name: "asc" },
        take: MAX_ACTIVE_PRODUCTS,
      }),
      prisma.category.findMany({
        where: { restaurantId: ctx.restaurantId },
        select: { id: true, name: true },
        orderBy: { name: "asc" },
      }),
      this.fetchUncostedStatuses(ctx.restaurantId, range, branchFilters),
      this.resolveCostingBranch(ctx, input),
    ]);

    const histMap = new Map(histResult.products.map((p) => [p.productId, p]));
    const firstProfitability = histResult.firstReport;

    // Current costing (selected branch) — full list from the F.4 engine.
    const costMap: Map<string, CostingListItemDto> = new Map();
    const overrideMap: Map<string, boolean> = new Map();
    if (costingBranch) {
      const costItems = await this.fetchCurrentCosting(ctx, costingBranch, input);
      for (const item of costItems) costMap.set(item.productId, item);
      if (costItems.length > 0) {
        const overrides = await prisma.branchProduct.findMany({
          where: {
            branchId: costingBranch,
            productId: { in: costItems.map((c) => c.productId) },
          },
          select: { productId: true, priceOverride: true },
        });
        for (const o of overrides) {
          overrideMap.set(o.productId, o.priceOverride != null);
        }
      }
    }

    const createdMap = new Map(activeProducts.map((p) => [p.id, p.createdAt]));
    const priceMap = new Map(activeProducts.map((p) => [p.id, p.price]));

    // Build rows for every ACTIVE product in scope.
    const rows: MenuEngineeringProductRow[] = activeProducts.map((p) => {
      const hist = histMap.get(p.id);
      const cur = costMap.get(p.id);
      const historicalCogs = hist?.cogs ?? 0;
      const currentHpp = cur && cur.hpp !== null ? num(cur.hpp) : null;
      const currentSellingPrice = cur
        ? num(cur.sellingPrice)
        : priceMap.get(p.id) != null
          ? num(priceMap.get(p.id))
          : null;
      let currentMarginPct: number | null = null;
      if (
        currentSellingPrice !== null &&
        currentSellingPrice > 0 &&
        currentHpp !== null
      ) {
        currentMarginPct = num(
          ((currentSellingPrice - currentHpp) / currentSellingPrice) * 100
        );
      }
      const negativeMargin =
        currentHpp !== null &&
        currentSellingPrice !== null &&
        currentSellingPrice < currentHpp;

      return {
        rank: 0,
        productId: p.id,
        productName: p.name,
        categoryId: p.categoryId,
        categoryName: p.category?.name ?? null,
        qtySold: hist?.qtySold ?? 0,
        orderCount: hist?.orderCount ?? 0,
        grossSales: hist?.grossSales ?? 0,
        discount: hist?.discount ?? 0,
        netSales: hist?.netSales ?? 0,
        historicalCogs,
        grossProfit: hist?.grossProfit ?? null,
        grossMarginPct: hist?.grossMarginPct ?? null,
        foodCostPct: hist?.foodCostPct ?? null,
        currentHpp,
        currentSellingPrice,
        currentMarginPct,
        currentPriceOverrideActive: overrideMap.get(p.id) === true,
        costStatus: cur?.costStatus ?? null,
        costedItems: hist?.costedItems ?? 0,
        uncostedItems: hist?.uncostedItems ?? 0,
        legacyItems: hist?.legacyItems ?? 0,
        classification: "NO_DATA",
        classificationReason: null,
        insight: CLASSIFICATION_INSIGHTS.NO_DATA,
        negativeMargin,
        isNew: this.isNewProduct(
          createdMap.get(p.id) ?? new Date(0),
          range.start,
          range.end
        ),
      };
    });

    // Scoped MEDIAN threshold over the branch-scoped dataset; category
    // scope only when the category has enough analyzed products.
    const threshold = this.computeThreshold(rows, input);
    const uncostedByProduct = uncostedStatusMap;
    for (const row of rows) {
      this.applyClassification(row, threshold, uncostedByProduct);
    }

    // Page-level row set (category + search narrowing for display only).
    const search = input.search?.trim().toLowerCase();
    let visibleRows = rows.filter(
      (r) =>
        (!input.categoryId || r.categoryId === input.categoryId) &&
        (!search ||
          !r.productName ||
          r.productName.toLowerCase().includes(search)) &&
        (!input.classification || r.classification === input.classification)
    );

    visibleRows.sort((a, b) => b.netSales - a.netSales || b.qtySold - a.qtySold);
    visibleRows.forEach((row, idx) => {
      row.rank = idx + 1;
    });

    const total = visibleRows.length;
    const page = Math.max(1, input.page ?? 1);
    const limit = input.exportAll
      ? Math.max(total, 1)
      : Math.min(MAX_LIMIT, Math.max(1, input.limit ?? DEFAULT_LIMIT));
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const pageStart = (page - 1) * limit;
    const paginatedProducts = visibleRows.slice(pageStart, pageStart + limit);

    const summary = this.buildSummary(rows);
    const classification = this.buildClassificationCounts(visibleRows);

    return {
      period: input.period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      summary,
      classification,
      products: paginatedProducts,
      categories: this.buildCategorySummary(visibleRows),
      branches: this.buildBranchSummary(firstProfitability.branches, branchQtyMap),
      threshold,
      coverage: firstProfitability.summary.coverage,
      currentCostingBranchId: costingBranch,
      pagination: { page, limit, total, totalPages },
      availableCategories: categories.map((c) => ({ id: c.id, name: c.name })),
    };
  }

  // ------------------------------------------------------------
  // F.5 profitability — full product list via the existing engine.
  // Bounded: max MAX_FETCH_PAGES × PROFITABILITY_FETCH_LIMIT rows.
  // ------------------------------------------------------------
  private async fetchAllProfitability(
    restaurantId: string,
    range: { start: Date; end: Date },
    branchFilters: string[] | undefined
  ): Promise<{ products: ProfitabilityProductRow[]; firstReport: ProfitabilityReport }> {
    let firstReport: ProfitabilityReport | null = null;
    const all: ProfitabilityProductRow[] = [];
    for (let page = 1; page <= MAX_FETCH_PAGES; page++) {
      const report = await profitabilityService.getProfitabilityReport(
        restaurantId,
        "custom",
        {
          startDate: range.start.toISOString().slice(0, 10),
          endDate: range.end.toISOString().slice(0, 10),
          branchFilters,
          filters: {
            branchId: null,
            productId: null,
            categoryId: null,
            orderType: null,
            paymentMethod: null,
          },
          pagination: { page, limit: PROFITABILITY_FETCH_LIMIT },
        }
      );
      if (!firstReport) firstReport = report;
      all.push(...report.products);
      if (
        page >= report.pagination.totalPages ||
        all.length >= report.pagination.total
      ) {
        break;
      }
    }
    return { products: all, firstReport: firstReport as ProfitabilityReport };
  }

  // ------------------------------------------------------------
  // F.4 current costing — full list for the selected branch.
  // ------------------------------------------------------------
  private async fetchCurrentCosting(
    ctx: AuthenticatedContext,
    branchId: string,
    input: MenuEngineeringRequest
  ): Promise<CostingListItemDto[]> {
    const all: CostingListItemDto[] = [];
    for (let page = 1; page <= MAX_FETCH_PAGES; page++) {
      const res = await costingService.listCosting(
        {
          branchId,
          categoryId: input.categoryId ?? undefined,
          search: input.search?.trim() || undefined,
          page,
          limit: COSTING_FETCH_LIMIT,
        },
        ctx
      );
      all.push(...res.items);
      if (page >= res.totalPages || all.length >= res.total) break;
    }
    return all;
  }

  // ------------------------------------------------------------
  // Branch-level sold quantity (PAID-only, same scope). Not in the
  // F.5 branch rows, so derived with one lightweight GROUP BY.
  // ------------------------------------------------------------
  private async fetchBranchQty(
    restaurantId: string,
    range: { start: Date; end: Date },
    branchFilters: string[] | undefined
  ): Promise<Map<string, number>> {
    const rows = await prisma.$queryRaw<
      Array<{ branchId: string | null; qty: bigint | number | string }>
    >`
      SELECT o.\`branchId\` AS branchId,
             COALESCE(SUM(oi.\`quantity\`), 0) AS qty
      FROM \`orderitem\` oi
      JOIN \`order\` o ON o.\`id\` = oi.\`orderId\`
      WHERE o.\`restaurantId\` = ${restaurantId}
        AND o.\`createdAt\` >= ${range.start}
        AND o.\`createdAt\` <= ${range.end}
        AND o.\`status\` <> 'CANCELLED'
        AND o.\`paymentStatus\` = 'PAID'
        ${branchFilters?.length ? Prisma.sql`AND o.\`branchId\` IN (${Prisma.join([...branchFilters])})` : Prisma.empty}
      GROUP BY o.\`branchId\`
    `;
    const map = new Map<string, number>();
    for (const r of rows) {
      if (r.branchId) map.set(r.branchId, Number(r.qty));
    }
    return map;
  }

  // ------------------------------------------------------------
  // Dominant snapshot status of the UNCOSTED items per product,
  // used for the UNCOSTED classificationReason.
  // ------------------------------------------------------------
  private async fetchUncostedStatuses(
    restaurantId: string,
    range: { start: Date; end: Date },
    branchFilters: string[] | undefined
  ): Promise<Map<string, string>> {
    const rows = await prisma.$queryRaw<
      Array<{ productId: string; status: string; cnt: bigint | number | string }>
    >`
      SELECT s.\`productId\` AS productId,
             s.\`status\` AS status,
             COUNT(*) AS cnt
      FROM \`orderitemcostsnapshot\` s
      JOIN \`order\` o ON o.\`id\` = s.\`orderId\`
      WHERE o.\`restaurantId\` = ${restaurantId}
        AND o.\`createdAt\` >= ${range.start}
        AND o.\`createdAt\` <= ${range.end}
        AND o.\`status\` <> 'CANCELLED'
        AND o.\`paymentStatus\` = 'PAID'
        AND s.\`status\` <> 'SNAPSHOTTED'
        ${branchFilters?.length ? Prisma.sql`AND o.\`branchId\` IN (${Prisma.join([...branchFilters])})` : Prisma.empty}
      GROUP BY s.\`productId\`, s.\`status\`
    `;
    const best = new Map<string, { status: string; cnt: number }>();
    for (const r of rows) {
      const cnt = Number(r.cnt);
      const existing = best.get(r.productId);
      if (!existing || cnt > existing.cnt) {
        best.set(r.productId, { status: r.status, cnt });
      }
    }
    return new Map(Array.from(best, ([k, v]) => [k, v.status]));
  }

  // ------------------------------------------------------------
  // The branch used for the CURRENT HPP columns. Explicit branch →
  // request branch; else the active branch context; else the FIRST
  // authorized/active branch (all-branch view fallback, labeled in UI).
  // ------------------------------------------------------------
  private async resolveCostingBranch(
    ctx: AuthenticatedContext,
    input: MenuEngineeringRequest
  ): Promise<string | null> {
    if (input.branchId) return input.branchId;
    if (ctx.branchId) return ctx.branchId;
    if (ctx.branchScoped && ctx.branchIds.length > 0) return ctx.branchIds[0];
    const first = await prisma.branch.findFirst({
      where: { restaurantId: ctx.restaurantId, isActive: true },
      orderBy: { name: "asc" },
      select: { id: true },
    });
    return first?.id ?? null;
  }

  private isNewProduct(createdAt: Date, start: Date, end: Date): boolean {
    const inPeriod = createdAt >= start && createdAt <= end;
    const cutoff = new Date(Date.now() - NEW_PRODUCT_DAYS * 24 * 60 * 60 * 1000);
    return inPeriod || createdAt >= cutoff;
  }

  // ------------------------------------------------------------
  // Threshold engine — scoped MEDIAN (never the mean).
  // ------------------------------------------------------------
  private computeThreshold(
    rows: MenuEngineeringProductRow[],
    input: MenuEngineeringRequest
  ): MenuEngineeringThreshold | null {
    const candidates = rows.filter(
      (r) => r.orderCount >= MIN_ORDER_COUNT && r.qtySold >= MIN_QTY_SOLD
    );
    const profitCandidates = candidates.filter((r) => r.grossProfit !== null);
    if (candidates.length === 0 || profitCandidates.length === 0) {
      return null;
    }

    const scope = resolveMedianScope({
      categorySelected: !!input.categoryId,
      branchSelected: !!input.branchId,
      categoryCandidateCount: input.categoryId
        ? candidates.filter((r) => r.categoryId === input.categoryId).length
        : 0,
    });

    let qtySet = candidates;
    let profitSet = profitCandidates;
    let thresholdCategoryId: string | null = null;
    if (scope === "category") {
      thresholdCategoryId = input.categoryId!;
      qtySet = candidates.filter((r) => r.categoryId === input.categoryId);
      profitSet = qtySet.filter((r) => r.grossProfit !== null);
    }
    if (profitSet.length === 0) return null;

    return {
      qtyMedian: calculateMedian(qtySet.map((r) => r.qtySold)),
      profitMedian: calculateMedian(profitSet.map((r) => r.grossProfit as number)),
      scope,
      productCount: qtySet.length,
      categoryId: thresholdCategoryId,
      branchId: input.branchId ?? null,
    };
  }

  // ------------------------------------------------------------
  // Classification pipeline. Guard order is deliberate:
  //   no-sales → data sufficiency → coverage → price → quadrant.
  // Pure logic lives in classifyProduct (unit-testable).
  // ------------------------------------------------------------
  private applyClassification(
    row: MenuEngineeringProductRow,
    threshold: MenuEngineeringThreshold | null,
    uncostedStatusMap: Map<string, string>
  ): void {
    const result = classifyProduct({
      qtySold: row.qtySold,
      orderCount: row.orderCount,
      grossProfit: row.grossProfit,
      currentSellingPrice: row.currentSellingPrice,
      isNew: row.isNew,
      uncostedItems: row.uncostedItems,
      legacyItems: row.legacyItems,
      uncostedStatus:
        (row.legacyItems > 0 && row.uncostedItems === 0
          ? "LEGACY"
          : uncostedStatusMap.get(row.productId)) ?? null,
      negativeMargin: row.negativeMargin,
      qtyMedian: threshold?.qtyMedian ?? null,
      profitMedian: threshold?.profitMedian ?? null,
    });
    row.classification = result.classification;
    row.classificationReason = result.classificationReason;
    row.insight = result.insight;
    row.negativeMargin = result.negativeMargin;
  }

  private buildSummary(rows: MenuEngineeringProductRow[]): MenuEngineeringReport["summary"] {
    const sold = rows.filter((r) => r.qtySold > 0);
    const totalNetSales = num(sold.reduce((s, r) => s + r.netSales, 0));
    const historicalCogs = num(sold.reduce((s, r) => s + r.historicalCogs, 0));
    const grossProfit = num(totalNetSales - historicalCogs);
    return {
      totalNetSales,
      historicalCogs,
      grossProfit,
      grossMarginPct:
        totalNetSales > 0 ? num((grossProfit / totalNetSales) * 100) : null,
      productCount: rows.length,
    };
  }

  private buildClassificationCounts(rows: MenuEngineeringProductRow[]) {
    const counts: MenuEngineeringReport["classification"] = {
      STAR: 0,
      PLOWHORSE: 0,
      PUZZLE: 0,
      DOG: 0,
      NEW: 0,
      NO_DATA: 0,
      INSUFFICIENT_DATA: 0,
      UNCOSTED: 0,
      NO_PRICE: 0,
      total: rows.length,
    };
    for (const r of rows) {
      const key = r.classification;
      if (key in counts) {
        (counts as unknown as Record<string, number>)[key] += 1;
      }
    }
    return counts;
  }

  private buildCategorySummary(
    rows: MenuEngineeringProductRow[]
  ): MenuEngineeringCategoryRow[] {
    const groups = new Map<string, MenuEngineeringCategoryRow>();
    for (const r of rows) {
      const key = r.categoryId ?? "";
      let g = groups.get(key);
      if (!g) {
        g = {
          categoryId: r.categoryId,
          categoryName: r.categoryName ?? "Tanpa Kategori",
          qtySold: 0,
          netSales: 0,
          cogs: 0,
          grossProfit: null,
          grossMarginPct: null,
          productCount: 0,
        };
        groups.set(key, g);
      }
      g.qtySold += r.qtySold;
      if (r.qtySold > 0) {
        g.netSales = num(g.netSales + r.netSales);
        g.cogs = num(g.cogs + r.historicalCogs);
      }
      g.productCount += 1;
    }
    const result: MenuEngineeringCategoryRow[] = [];
    for (const g of groups.values()) {
      if (g.qtySold > 0) {
        g.grossProfit = num(g.netSales - g.cogs);
        g.grossMarginPct =
          g.netSales > 0 ? num((g.grossProfit / g.netSales) * 100) : null;
      }
      result.push(g);
    }
    result.sort((a, b) => b.netSales - a.netSales);
    return result;
  }

  private buildBranchSummary(
    branches: ProfitabilityBranchRow[],
    branchQtyMap: Map<string, number>
  ): MenuEngineeringBranchRow[] {
    return branches.map((b) => ({
      branchId: b.branchId,
      branchName: b.branchName,
      branchCode: b.branchCode,
      orders: b.orders,
      qtySold: branchQtyMap.get(b.branchId) ?? 0,
      netSales: num(b.netSales),
      cogs: num(b.cogs),
      grossProfit: num(b.grossProfit),
      grossMarginPct: b.grossMarginPct,
    }));
  }
}

export const menuEngineeringService = new MenuEngineeringService();