import { z } from "zod/v4";

// ============================================================
// AUDIT LOG — validation schemas (Zod v4).
//
// Mirrors the reservation types conventions: query params are `z.coerce`d
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
 * Admin audit-log list query. Server-side pagination + safe filters over the
 * existing `AuditLog` rows. `limit` is clamped so a caller can never request
 * an unbounded page. `branchId` is only a HINT — branch isolation is still
 * enforced through the service's `branchFilters` param (authorizedBranches).
 */
export const AuditLogListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Halaman tidak valid").default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(100, "Limit maksimal 100")
    .default(25),
  action: z.string().trim().min(1).max(64).optional().nullable(),
  entityType: z.string().trim().min(1).max(64).optional().nullable(),
  entityId: z.string().trim().min(1).max(64).optional().nullable(),
  userId: z.string().trim().min(1).max(64).optional().nullable(),
  branchId: z.string().trim().min(1).max(64).optional().nullable(),
  dateFrom: DateOnlySchema.optional().nullable(),
  dateTo: DateOnlySchema.optional().nullable(),
  /** Free-text over action / entityType / entityId. */
  search: z
    .string()
    .trim()
    .max(100, "Pencarian maksimal 100 karakter")
    .optional()
    .nullable(),
}).refine(
  // Cross-field: an inverted range is a caller mistake, not an empty page.
  // Both sides are strict `YYYY-MM-DD`, so a lexicographic compare is also a
  // chronological one. Local-day semantics are unchanged.
  (q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo,
  {
    message: "Tanggal awal tidak boleh melebihi tanggal akhir",
    path: ["dateTo"],
  }
);

/**
 * Facet (picker) mode of the same endpoint: only the branch hint is
 * meaningful — the tenant always comes from the session and the scope is
 * still enforced through `authorizedBranches` in the service.
 */
export const AuditLogFacetsQuerySchema = z.object({
  branchId: z.string().trim().min(1).max(64).optional().nullable(),
});

export type AuditLogListQuery = z.infer<typeof AuditLogListQuerySchema>;
