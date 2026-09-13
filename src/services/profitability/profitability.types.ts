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

/**
 * H2.1 — derived COGS coverage state (NO new DB enum/model).
 *   COVERED      — every relevant OrderItem has a SNAPSHOTTED snapshot
 *   PARTIAL      — some items are covered, others are not (any reason)
 *   PENDING_COGS — order is PAID but NOT COMPLETED (COGS not yet incurred)
 *   UNCOVERED    — a snapshot row exists but its status <> SNAPSHOTTED
 *                  (NO_RECIPE / MISSING_WAC / INACTIVE_INGREDIENT / NO_BRANCH)
 *   LEGACY       — order is COMPLETED but the OrderItem has no snapshot row
 */
export type ProfitabilityCogsState =
  | "COVERED"
  | "PARTIAL"
  | "PENDING_COGS"
  | "UNCOVERED"
  | "LEGACY";

export interface ProfitabilityCoverage {
  totalOrderItems: number;
  /** COVERED — snapshot status SNAPSHOTTED. */
  costedOrderItems: number;
  /** UNCOVERED — snapshot exists but status <> SNAPSHOTTED (see note above). */
  uncostedOrderItems: number;
  /** LEGACY — COMPLETED with no snapshot row. */
  legacyOrderItems: number;
  /** PENDING_COGS — PAID, not COMPLETED, no snapshot (COGS not yet incurred). */
  pendingOrderItems: number;
}

export interface ProfitabilityUnpaidCompleted {
  orders: number;
  orderItems: number;
  cogs: number;
}

/**
 * H3.5 — refund-aware financial state (separate from COGS coverage, which is
 * about whether cost is KNOWN; this is about whether revenue was RETURNED).
 *   NONE    — no approved refund in scope
 *   PARTIAL — at least one order partially refunded
 *   FULL    — every refund in scope fully refunded its order
 */
export type ProfitabilityRefundState = "NONE" | "PARTIAL" | "FULL";

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
  /** True only when every relevant item is COVERED (COGS fully known). */
  coverageComplete: boolean;
  cogsState: ProfitabilityCogsState;
  /** H3.4 — original eligible sales revenue (Σ grandTotal, incl. refunded). */
  grossRevenue: number;
  /** H3.4 — approved refund amount reversed out of revenue. */
  refundReversal: number;
  /** H3.4 — incurred COGS from SNAPSHOTTED snapshots (never reduced here). */
  historicalCogs: number;
  /** H3.4 — COGS released by partial refunds (0 for a FULL refund). */
  cogsReversal: number;
  /** H3.4 — historicalCogs − cogsReversal; never 0 just because revenue is. */
  retainedCogs: number;
  /** H3.5 — explicit refund coverage state. */
  refundState: ProfitabilityRefundState;
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
  coverageComplete: boolean;
  cogsState: ProfitabilityCogsState;
  /** H3.4 — COGS released by partial refunds in this branch. */
  cogsReversal: number;
  /** H3.4 — cogs − cogsReversal. */
  retainedCogs: number;
  /** H3.5 — explicit refund coverage state for the branch. */
  refundState: ProfitabilityRefundState;
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
  pendingItems: number;
  coverageComplete: boolean;
  cogsState: ProfitabilityCogsState;
  /** H3.4 — COGS released by refunds allocated to this product. */
  cogsReversal: number;
  /** H3.4 — cogs − cogsReversal (the cost still retained). */
  retainedCogs: number;
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
