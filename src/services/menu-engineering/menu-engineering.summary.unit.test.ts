import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMenuEngineeringSummary,
  type MenuEngineeringSourceSummary,
} from "./menu-engineering.summary";
import type { MenuEngineeringProductRow } from "./menu-engineering.types";
import type { ProfitabilityCoverage } from "../profitability/profitability.types";

// ------------------------------------------------------------
// M1 unit tests — Menu Engineering headline basis contract.
// Pure (no DB / no Prisma). Run:
//   npx tsx --test src/services/menu-engineering/menu-engineering.summary.unit.test.ts
// ------------------------------------------------------------

/** A fully SNAPSHOTTED, non-empty scope (COGS known). */
const COVERED: ProfitabilityCoverage = {
  totalOrderItems: 3,
  costedOrderItems: 3,
  uncostedOrderItems: 0,
  legacyOrderItems: 0,
  pendingOrderItems: 0,
};

/** D1 — empty scope: COGS unverifiable, never "covered". */
const NO_ITEMS: ProfitabilityCoverage = {
  totalOrderItems: 0,
  costedOrderItems: 0,
  uncostedOrderItems: 0,
  legacyOrderItems: 0,
  pendingOrderItems: 0,
};

function row(
  overrides: Partial<MenuEngineeringProductRow> = {}
): MenuEngineeringProductRow {
  return {
    rank: 1,
    productId: "p1",
    productName: "Product 1",
    categoryId: "c1",
    categoryName: "Category 1",
    qtySold: 10,
    orderCount: 5,
    grossSales: 100000,
    discount: 0,
    netSales: 100000,
    historicalCogs: 40000,
    cogsReversal: 0,
    retainedCogs: 40000,
    grossProfit: 60000,
    grossMarginPct: 60,
    foodCostPct: 40,
    currentHpp: 4000,
    currentSellingPrice: 10000,
    currentMarginPct: 60,
    currentPriceOverrideActive: false,
    costStatus: "COMPLETE",
    costedItems: 10,
    uncostedItems: 0,
    legacyItems: 0,
    pendingItems: 0,
    classification: "STAR",
    classificationReason: null,
    insight: "",
    negativeMargin: false,
    isNew: false,
    ...overrides,
  };
}

function source(
  overrides: Partial<MenuEngineeringSourceSummary> = {}
): MenuEngineeringSourceSummary {
  return {
    coverage: COVERED,
    netSales: 100000,
    revenueWithoutItems: { orders: 0, headerValue: 0 },
    ...overrides,
  };
}

test("M1: totalNetSales keeps the PRODUCT (item-attributed) basis", () => {
  const rows = [
    row({ productId: "a", netSales: 100000 }),
    row({ productId: "b", netSales: 50000 }),
  ];
  const s = buildMenuEngineeringSummary(rows, source({ netSales: 999000 }));
  assert.equal(s.netSalesBasis, "PRODUCT");
  assert.equal(s.totalNetSales, 150000);
});

test("M1: netSalesHeaderBasis is passed through unchanged as a reference", () => {
  const rows = [row({ netSales: 100000 })];
  const s = buildMenuEngineeringSummary(
    rows,
    source({ netSales: 487000 })
  );
  assert.equal(s.netSalesHeaderBasis, 487000);
  // The product headline is NOT overwritten by the header basis.
  assert.equal(s.totalNetSales, 100000);
  assert.notEqual(s.totalNetSales, s.netSalesHeaderBasis);
});

test("M1: revenueWithoutItems is forwarded with its header value", () => {
  const s = buildMenuEngineeringSummary(
    [],
    source({
      coverage: NO_ITEMS,
      netSales: 487000,
      revenueWithoutItems: { orders: 16, headerValue: 517000 },
    })
  );
  assert.deepEqual(s.revenueWithoutItems, { orders: 16, headerValue: 517000 });
});

test("M1: incident period — product total 0 but header reference stays visible", () => {
  const s = buildMenuEngineeringSummary(
    [],
    source({
      coverage: NO_ITEMS,
      netSales: 517000,
      revenueWithoutItems: { orders: 16, headerValue: 517000 },
    })
  );
  assert.equal(s.totalNetSales, 0);
  assert.equal(s.netSalesHeaderBasis, 517000);
  assert.equal(s.coverageComplete, false);
  // Unknown profit is null, never 0.
  assert.equal(s.grossProfit, null);
  assert.equal(s.grossMarginPct, null);
});

test("M1: normal period (no revenueWithoutItems) — both bases agree and profit is unchanged", () => {
  const rows = [
    row({ productId: "a", netSales: 100000, historicalCogs: 40000, retainedCogs: 40000 }),
    row({ productId: "b", netSales: 50000, historicalCogs: 10000, retainedCogs: 10000 }),
  ];
  const s = buildMenuEngineeringSummary(
    rows,
    source({
      coverage: COVERED,
      netSales: 150000,
      revenueWithoutItems: { orders: 0, headerValue: 0 },
    })
  );
  assert.equal(s.totalNetSales, 150000);
  assert.equal(s.netSalesHeaderBasis, 150000);
  assert.equal(s.totalNetSales, s.netSalesHeaderBasis);
  assert.equal(s.revenueWithoutItems.orders, 0);
  assert.equal(s.coverageComplete, true);
  assert.equal(s.grossProfit, 100000); // 150000 − (40000 + 10000)
  assert.equal(s.grossMarginPct, 66.67); // round2(100000 / 150000 × 100)
});

test("M1: legacy fields are preserved (historicalCogs, productCount, coverage, retained-COGS profit)", () => {
  const rows = [
    // Fully-refunded-style product: historical cost > retained cost.
    row({
      productId: "a",
      qtySold: 5,
      netSales: 30000,
      historicalCogs: 12000,
      retainedCogs: 2000,
    }),
    // Zero-sales product: excluded from money totals, counted in productCount.
    row({ productId: "b", qtySold: 0, netSales: 0, historicalCogs: 0, retainedCogs: 0 }),
  ];
  const s = buildMenuEngineeringSummary(rows, source({ coverage: COVERED }));
  assert.equal(s.productCount, 2);
  assert.equal(s.totalNetSales, 30000);
  assert.equal(s.historicalCogs, 12000);
  assert.equal(s.coverageComplete, true);
  // Profit uses RETAINED COGS, not historical.
  assert.equal(s.grossProfit, 28000);
});
