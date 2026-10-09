import { z } from "zod/v4";
import type {
  ProfitabilityCogsState,
  ProfitabilityCoverage,
  ProfitabilityRefundState,
} from "@/services/profitability/profitability.types";

// ============================================================
// P&L (ACCOUNTING PHASE D) — query schema + result types.
//
// A READ-ONLY composition: revenue/net sales from the canonical engine,
// COGS + Gross Profit from Profitabilitas, Operating Expenses from Expense
// (PHASE B). No new ledger/engine and no migration. Query params arrive as
// strings and are coerced/validated here; the tenant (`restaurantId`) is
// NEVER accepted from the client.
// ============================================================

/** Strict `YYYY-MM-DD` calendar date (no timezone math — a plain day). */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value: string): boolean {
  if (!DATE_ONLY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

const DateOnlySchema = z
  .string()
  .trim()
  .refine(isValidDateOnly, { message: "Tanggal tidak valid (format YYYY-MM-DD)" });

/** Same period vocabulary as the report engine (`resolveReportRange`). */
export const PNL_PERIODS = ["today", "yesterday", "week", "month", "custom"] as const;
export type PnlPeriod = (typeof PNL_PERIODS)[number];

export const PNL_ORDER_TYPES = ["DINE_IN", "TAKEAWAY", "DELIVERY"] as const;
export const PNL_PAYMENT_METHODS = ["KASIR", "QRIS"] as const;

/**
 * Admin P&L query. `branchId` is only a HINT — branch isolation is still
 * enforced through the service's `branchFilters` param (authorizedBranches).
 */
export const PnlQuerySchema = z
  .object({
    period: z.enum(PNL_PERIODS).default("month"),
    startDate: DateOnlySchema.optional().nullable(),
    endDate: DateOnlySchema.optional().nullable(),
    branchId: z.string().trim().min(1).max(64).optional().nullable(),
    orderType: z.enum(PNL_ORDER_TYPES).optional().nullable(),
    paymentMethod: z.enum(PNL_PAYMENT_METHODS).optional().nullable(),
  })
  .refine((q) => q.period !== "custom" || (!!q.startDate && !!q.endDate), {
    message: "Periode custom memerlukan tanggal awal dan akhir",
    path: ["startDate"],
  })
  .refine((q) => !q.startDate || !q.endDate || q.startDate <= q.endDate, {
    message: "Tanggal awal tidak boleh melebihi tanggal akhir",
    path: ["endDate"],
  });

export type PnlQuery = z.infer<typeof PnlQuerySchema>;

// ------------------------------------------------------------
// Result shapes.
// ------------------------------------------------------------

export interface PnlSummary {
  /** Canonical gross revenue — Σ order.grandTotal over the revenue set. */
  grossSales: number;
  totalDiscount: number;
  totalTax: number;
  totalServiceCharge: number;
  /** Approved refunds (raw amount) reversed out of revenue. */
  totalRefund: number;
  /** Canonical net sales (product basis) — NOT grossSales − refund. */
  netSales: number;
  /** COGS actually retained against revenue (historical − refund reversal). */
  cogs: number;
  historicalCogs: number;
  cogsReversal: number;
  /** null when COGS coverage is incomplete (never revenue − 0). */
  grossProfit: number | null;
  operatingExpenses: number;
  /** null whenever Gross Profit is null (COGS unknown). */
  netProfit: number | null;
}

export interface PnlOpexCategory {
  categoryId: string;
  categoryName: string;
  total: number;
  count: number;
}

export interface PnlReport {
  period: PnlPeriod;
  range: { start: string; end: string };
  filters: {
    branchId: string | null;
    orderType: string | null;
    paymentMethod: string | null;
  };
  summary: PnlSummary;
  opex: {
    total: number;
    count: number;
    byCategory: PnlOpexCategory[];
  };
  coverage: ProfitabilityCoverage;
  coverageComplete: boolean;
  cogsState: ProfitabilityCogsState;
  refundState: ProfitabilityRefundState;
  unpaidCompleted: { orders: number; orderItems: number; cogs: number };
  /**
   * Explicit limitations. Net Profit is ALWAYS provisional in this phase:
   * only `Expense` rows are counted as operating cost, so payroll/rent/
   * depreciation/etc. are not represented.
   */
  disclosure: {
    netProfitProvisional: true;
    expenseDataEmpty: boolean;
    purchaseExcluded: true;
    /**
     * D1 — revenue-bearing orders with NO OrderItem rows in scope. Their
     * header value inflates Net Sales without any verifiable COGS, so when
     * this is > 0 the Gross/Net Profit must be treated as unknown.
     */
    revenueWithoutItems: {
      orders: number;
      headerValue: number;
    };
    dateBasis: {
      revenue: string;
      refund: string;
      cogs: string;
      expense: string;
    };
  };
}
