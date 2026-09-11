// ============================================================
// F.6 — MENU ENGINEERING TYPES
//
// Pure type definitions shared by the server service and the
// browser bundle (no node-only imports). Nothing here duplicates
// the F.4 / F.5 engines — F.6 composes their DTOs.
// ============================================================

export type MenuEngineeringClassification =
  | "STAR"
  | "PLOWHORSE"
  | "PUZZLE"
  | "DOG"
  | "NEW"
  | "NO_DATA"
  | "INSUFFICIENT_DATA"
  | "UNCOSTED"
  | "NO_PRICE";

export type MedianScope = "restaurant" | "branch" | "category";

export type CostStatus = "NO_RECIPE" | "COMPLETE" | "INCOMPLETE";

export interface MenuEngineeringProductRow {
  rank: number;
  productId: string;
  productName: string;
  categoryId: string | null;
  categoryName: string | null;
  qtySold: number;
  orderCount: number;
  grossSales: number;
  discount: number;
  netSales: number;
  historicalCogs: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  foodCostPct: number | null;
  currentHpp: number | null;
  currentSellingPrice: number | null;
  currentMarginPct: number | null;
  currentPriceOverrideActive: boolean;
  costStatus: CostStatus | null;
  costedItems: number;
  uncostedItems: number;
  legacyItems: number;
  classification: MenuEngineeringClassification;
  classificationReason: string | null;
  insight: string;
  negativeMargin: boolean;
  isNew: boolean;
}

export interface MenuEngineeringCategoryRow {
  categoryId: string | null;
  categoryName: string | null;
  qtySold: number;
  netSales: number;
  cogs: number;
  grossProfit: number | null;
  grossMarginPct: number | null;
  productCount: number;
}

export interface MenuEngineeringBranchRow {
  branchId: string;
  branchName: string;
  branchCode: string;
  orders: number;
  qtySold: number;
  netSales: number;
  cogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
}

export interface MenuEngineeringThreshold {
  qtyMedian: number;
  profitMedian: number;
  scope: MedianScope;
  productCount: number;
  categoryId: string | null;
  branchId: string | null;
}

export interface MenuEngineeringSummary {
  totalNetSales: number;
  historicalCogs: number;
  grossProfit: number;
  grossMarginPct: number | null;
  productCount: number;
}

export interface MenuEngineeringCoverage {
  totalOrderItems: number;
  costedOrderItems: number;
  uncostedOrderItems: number;
  legacyOrderItems: number;
}

export interface MenuEngineeringClassificationCounts {
  STAR: number;
  PLOWHORSE: number;
  PUZZLE: number;
  DOG: number;
  NEW: number;
  NO_DATA: number;
  INSUFFICIENT_DATA: number;
  UNCOSTED: number;
  NO_PRICE: number;
  total: number;
}

export interface MenuEngineeringReport {
  period: string;
  range: { start: string; end: string };
  summary: MenuEngineeringSummary;
  classification: MenuEngineeringClassificationCounts;
  products: MenuEngineeringProductRow[];
  categories: MenuEngineeringCategoryRow[];
  branches: MenuEngineeringBranchRow[];
  threshold: MenuEngineeringThreshold | null;
  coverage: MenuEngineeringCoverage;
  /** Branch used for the CURRENT HPP columns (null = no costing data). */
  currentCostingBranchId: string | null;
  pagination: { page: number; limit: number; total: number; totalPages: number };
  availableCategories: Array<{ id: string; name: string }>;
}

export interface MenuEngineeringRequest {
  period: string;
  startDate?: string;
  endDate?: string;
  branchId?: string | null;
  categoryId?: string | null;
  classification?: string | null;
  search?: string | null;
  page?: number;
  limit?: number;
  /** Server-side CSV export: bypass the 100-row UI clamp. */
  exportAll?: boolean;
}