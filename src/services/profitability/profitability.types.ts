import type { ReportPeriod } from "@/services/report.service";

// ============================================================
// F.5 — PROFITABILITY REPORT TYPES
//
// Sales revenue uses the EXISTING revenue set semantics:
//   status != CANCELLED AND paymentStatus = PAID
//
// COGS is frozen per-OrderItem at READY -> COMPLETED via
// OrderItemCostSnapshot (F.5 historical COGS). Rows without a
// snapshot (pre-F.5 / "legacy") or with an incomplete status
// (NO_RECIPE / MISSING_WAC / ...) contribute NULL to COGS.
//
// All numeric values are plain JS numbers (2dp-rounded where
// applicable) for client consumption. Money is always derived
// from Prisma.Decimal on the server, never Number() or parseFloat
// from raw storage.
// ============================================================

export interface ProfitabilityRange {
  start: string;
  end: string;
}

export interface ProfitabilityFilters {
  branchId: string | null;
  productId: string | null;
  categoryId: string | null;
  orderType: string | null;
  paymentMethod: string | null;
}

export interface ProfitabilityCoverage {
  totalOrderItems: number;
  costedOrderItems: number;
  uncostedOrderItems: number;
  legacyOrderItems: number;
}

export interface ProfitabilityUnpaidCompleted {
  orders: number;
  orderItems: number;
  cogs: number;
}

export interface ProfitabilitySummary {
  totalSales: number;
  grossSales: number;
  totalDiscount: number;
  totalTax: number;
  totalServiceCharge: number;
  totalRefund: number;
  netSales: number;
  cogs: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  foodCostPct: number | null;
  coverage: ProfitabilityCoverage;
  unpaidCompleted: ProfitabilityUnpaidCompleted;
}

export interface ProfitabilityBranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  orders: number;
  totalSales: number;
  totalTax: number;
  totalServiceCharge: number;
  totalRefund: number;
  netSales: number;
  cogs: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  foodCostPct: number | null;
}

export interface ProfitabilityProductRow {
  rank: number;
  productId: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  qtySold: number;
  grossSales: number;
  discount: number;
  netSales: number;
  cogs: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  foodCostPct: number | null;
  orderCount: number;
  costedItems: number;
  uncostedItems: number;
  legacyItems: number;
}

export interface ProfitabilityProductSummary {
  totalNetSales: number;
  totalCogs: number;
  totalGrossProfit: number | null;
}

export interface ProfitabilityReport {
  period: ReportPeriod;
  range: ProfitabilityRange;
  filters: ProfitabilityFilters;
  summary: ProfitabilitySummary;
  branches: ProfitabilityBranchRow[];
  products: ProfitabilityProductRow[];
  productSummary: ProfitabilityProductSummary;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  availableProducts: Array<{
    id: string;
    name: string;
    categoryName: string | null;
  }>;
  availableCategories: Array<{
    id: string;
    name: string;
  }>;
}
