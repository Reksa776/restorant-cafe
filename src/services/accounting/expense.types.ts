import { z } from "zod/v4";

// ============================================================
// EXPENSE MANAGEMENT — validation schemas (Zod v4).
//
// Mirrors the audit-log type conventions: query params are `z.coerce`d
// (they arrive as strings), everything is optional except the fields a write
// genuinely needs, and the whole payload is re-validated in the service so
// the route stays a thin transport layer.
//
// The tenant (`restaurantId`), the actor (`createdByUserId`) and the write
// branch are NEVER accepted from the client body — they are derived
// server-side from the authenticated admin session and the validated
// `x-branch-id` context (see the expense service / route).
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

/** The only payment methods an operational expense may carry. */
export const EXPENSE_METHODS = ["CASH", "TRANSFER", "QRIS", "CARD", "OTHER"] as const;
export type ExpenseMethodValue = (typeof EXPENSE_METHODS)[number];

/** Upper bound that still fits the Decimal(12, 2) column. */
const MAX_AMOUNT = 9_999_999_999.99;

/**
 * Admin expense list query. Server-side pagination + filters over the
 * tenant's expenses. `branchId` is only a HINT — branch isolation is still
 * enforced through the service's `branchFilters` param (authorizedBranches).
 */
export const ExpenseListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1, "Halaman tidak valid").default(1),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100, "Limit maksimal 100")
      .default(50),
    branchId: z.string().trim().min(1).max(64).optional().nullable(),
    categoryId: z.string().trim().min(1).max(64).optional().nullable(),
    method: z.enum(EXPENSE_METHODS).optional().nullable(),
    dateFrom: DateOnlySchema.optional().nullable(),
    dateTo: DateOnlySchema.optional().nullable(),
    /** Free-text over the expense note. */
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

/** Create expense payload. */
export const CreateExpenseSchema = z.object({
  /** Optional client hint; the server resolves the effective write branch. */
  branchId: z.string().trim().min(1).max(191).optional().nullable(),
  categoryId: z.string().trim().min(1, "Kategori wajib dipilih").max(191),
  amount: z.coerce
    .number({ message: "Nominal tidak valid" })
    .finite("Nominal tidak valid")
    .positive("Nominal harus lebih dari 0")
    .max(MAX_AMOUNT, "Nominal terlalu besar"),
  spentAt: DateOnlySchema,
  method: z.enum(EXPENSE_METHODS).default("CASH"),
  note: z.string().trim().max(1000, "Catatan maksimal 1000 karakter").optional().nullable(),
});

/** Update expense payload — at least one field must be present. */
export const UpdateExpenseSchema = z
  .object({
    branchId: z.string().trim().min(1).max(191).optional(),
    categoryId: z.string().trim().min(1).max(191).optional(),
    amount: z.coerce
      .number({ message: "Nominal tidak valid" })
      .finite("Nominal tidak valid")
      .positive("Nominal harus lebih dari 0")
      .max(MAX_AMOUNT, "Nominal terlalu besar")
      .optional(),
    spentAt: DateOnlySchema.optional(),
    method: z.enum(EXPENSE_METHODS).optional(),
    note: z.string().trim().max(1000, "Catatan maksimal 1000 karakter").nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  });

/** Create expense category payload. */
export const CreateExpenseCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Nama kategori wajib diisi")
    .max(100, "Nama kategori maksimal 100 karakter"),
});

/** Update expense category payload — rename and/or toggle active. */
export const UpdateExpenseCategorySchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Nama kategori wajib diisi")
      .max(100, "Nama kategori maksimal 100 karakter")
      .optional(),
    isActive: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, {
    message: "Tidak ada perubahan yang dikirim",
  });

export type ExpenseListQuery = z.infer<typeof ExpenseListQuerySchema>;
export type CreateExpenseInput = z.infer<typeof CreateExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof UpdateExpenseSchema>;
