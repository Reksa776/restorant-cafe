// ============================================================
// M1 — MENU ENGINEERING SUMMARY (pure, DB-free)
//
// Builds the Menu Engineering headline summary from the F.6 product
// rows plus the header-basis figures already produced by the F.5
// Profitabilitas engine. No query, no I/O here.
//
// M1 basis contract (additive — old numbers never change):
//   totalNetSales       = Σ per-product netSales       → basis PRODUCT
//   netSalesHeaderBasis = Profitabilitas summary.netSales → basis ORDER
//   revenueWithoutItems = D1 disclosure (orders with no OrderItem rows)
//
// Profit is UNKNOWN (null) whenever COGS coverage is incomplete — never
// forced to 0. Revenue is never attributed to products that have no item
// rows; the header basis is exposed as a labelled reference only.
// ============================================================

import { num } from "../../lib/money";
import { isCoverageComplete } from "../profitability/coverage";
import type { ProfitabilityCoverage } from "../profitability/profitability.types";
import type {
  MenuEngineeringProductRow,
  MenuEngineeringSummary,
} from "./menu-engineering.types";

/**
 * The subset of ProfitabilitySummary the ME headline needs. Kept minimal so
 * the builder is a deterministic function of plain data (unit-testable).
 */
export interface MenuEngineeringSourceSummary {
  coverage: ProfitabilityCoverage;
  /** Order/header-basis net sales from the Profitabilitas engine. */
  netSales: number;
  /** D1 — revenue-bearing orders with no OrderItem rows in scope. */
  revenueWithoutItems: { orders: number; headerValue: number };
}

export function buildMenuEngineeringSummary(
  rows: MenuEngineeringProductRow[],
  source: MenuEngineeringSourceSummary
): MenuEngineeringSummary {
  const sold = rows.filter((r) => r.qtySold > 0);
  const totalNetSales = num(sold.reduce((s, r) => s + r.netSales, 0));
  const historicalCogs = num(sold.reduce((s, r) => s + r.historicalCogs, 0));
  // H3 — the profit-bearing cost is RETAINED COGS (partial refunds release
  // cost; a full refund keeps all of it).
  const retainedCogs = num(sold.reduce((s, r) => s + r.retainedCogs, 0));
  // H2 — the summary COGS is the covered (known) COGS; when coverage is
  // incomplete the gross profit is UNKNOWN (null), never revenue − 0.
  // D1 — complete ONLY when at least one in-scope item exists AND every one
  // is SNAPSHOTTED. An empty scope is NEVER complete.
  const coverageComplete = isCoverageComplete(source.coverage);
  const grossProfit = coverageComplete
    ? num(totalNetSales - retainedCogs)
    : null;
  return {
    totalNetSales,
    netSalesBasis: "PRODUCT",
    netSalesHeaderBasis: num(source.netSales),
    revenueWithoutItems: {
      orders: source.revenueWithoutItems.orders,
      headerValue: num(source.revenueWithoutItems.headerValue),
    },
    historicalCogs,
    grossProfit,
    grossMarginPct:
      grossProfit !== null && totalNetSales > 0
        ? num((grossProfit / totalNetSales) * 100)
        : null,
    productCount: rows.length,
    coverageComplete,
  };
}
