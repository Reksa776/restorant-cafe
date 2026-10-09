import { z } from "zod/v4";

// ============================================================
// CASHBOOK — validation schemas (Zod v4).
//
// Mirrors the audit-log / expense conventions: query params are `z.coerce`d
// (they arrive as strings), filters are optional, and everything is
// re-validated in the service so the route stays a thin transport layer.
// The tenant (`restaurantId`) is NEVER accepted from the client — it is
// derived server-side from the authenticated admin session.
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

/**
 * Method values an entry can carry:
 *   KASIR / QRIS           → Payment.method (and the parent method of a Refund)
 *   CASH / TRANSFER / QRIS / CARD / OTHER → Expense.method (ExpenseMethod)
 * QRIS is shared by both sources.
 */
export const CASHBOOK_METHODS = [
  "KASIR",
  "QRIS",
  "CASH",
  "TRANSFER",
  "CARD",
  "OTHER",
] as const;
export type CashbookMethod = (typeof CASHBOOK_METHODS)[number];

/** Money direction. */
export const CASHBOOK_TYPES = ["IN", "OUT"] as const;
export type CashbookType = (typeof CASHBOOK_TYPES)[number];

/** Origin table of an entry. */
export const CASHBOOK_SOURCES = ["PAYMENT", "REFUND", "EXPENSE"] as const;
export type CashbookSource = (typeof CASHBOOK_SOURCES)[number];

/**
 * Admin cashbook list query. Server-side filter + pagination over the merged
 * read-model. `branchId` is only a HINT — branch isolation is still enforced
 * through the service's `branchFilters` param (authorizedBranches).
 */
export const CashbookQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, "Halaman tidak valid").default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100, "Limit maksimal 100")
      .default(50),
    branchId: z.string().trim().min(1).max(64).optional().nullable(),
    type: z.enum(CASHBOOK_TYPES).optional().nullable(),
    method: z.enum(CASHBOOK_METHODS).optional().nullable(),
    dateFrom: DateOnlySchema.optional().nullable(),
    dateTo: DateOnlySchema.optional().nullable(),
    /** Free-text over order number / reference / note / category. */
    search: z
      .string()
      .trim()
      .max(100, "Pencarian maksimal 100 karakter")
      .optional()
      .nullable(),
  })
  .refine(
    // An inverted range is a caller mistake, not an empty page. Both sides
    // are strict `YYYY-MM-DD`, so lexicographic compare is chronological.
    (q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo,
    { message: "Tanggal awal tidak boleh melebihi tanggal akhir", path: ["dateTo"] }
  );

export type CashbookQuery = z.infer<typeof CashbookQuerySchema>;
