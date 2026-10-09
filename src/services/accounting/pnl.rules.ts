import { round2 } from "@/lib/money";

// ============================================================
// D1 — P&L RULES (pure, DB-free)
//
// Kept free of `prisma`/server-only imports so the null-awareness rule can be
// unit-tested deterministically. Re-exported from `pnl.service.ts` to preserve
// the existing public surface.
// ============================================================

/**
 * Net Profit = Gross Profit − Operating Expenses.
 *
 * When the Gross Profit is UNKNOWN (COGS coverage incomplete OR an empty
 * scope, i.e. `NO_ITEMS`) the Net Profit is UNKNOWN too — it is NEVER computed
 * as `revenue − 0`. D1: an empty/headless revenue set must not masquerade as a
 * fully-costed, full-margin profit.
 */
export function computeNetProfit(
  grossProfit: number | null,
  operatingExpenses: number
): number | null {
  return grossProfit === null ? null : round2(grossProfit - operatingExpenses);
}
