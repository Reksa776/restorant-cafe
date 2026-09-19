import { z } from "zod/v4";
import type { ReservationStatus } from "@prisma/client";
import { isValidDateOnly, RESERVATION_DEFAULT_DURATION_MINUTES } from "./reservation.slots";
import { normalizePhone } from "@/lib/phone";

// ============================================================
// PHASE R1 — RESERVATION validation schemas (Zod v4).
//
// Conventions follow the existing service types (see order.types.ts):
// plain Zod objects, `z.enum` with literal tuples, `z.coerce` only where the
// input is genuinely a string (query params).
//
// NOTHING here is trusted as authoritative:
//   - `source` is a LITERAL per entry point, so a public caller can never
//     forge "ADMIN".
//   - `restaurantId` is never accepted from the client at all — it always
//     comes from the resolved branch / session server-side.
//   - availability, capacity and conflict decisions are recomputed in the
//     service from the database; the client only states what it wants.
// ============================================================

// ============================================================
// Shared primitives
// ============================================================

/**
 * Mirrors the Prisma `ReservationStatus` enum. `satisfies` fails to compile
 * if a value is renamed/removed in the schema, so the two cannot drift
 * silently (the reverse check is covered by the Zod enum below being the
 * only accepted input set).
 */
export const RESERVATION_STATUSES = [
  "PENDING",
  "CONFIRMED",
  "SEATED",
  "COMPLETED",
  "CANCELLED",
  "NO_SHOW",
] as const satisfies readonly ReservationStatus[];

export type ReservationStatusValue = (typeof RESERVATION_STATUSES)[number];

/** Where the booking came from. Literal per schema — never client-chosen. */
export const RESERVATION_SOURCES = ["PUBLIC", "ADMIN"] as const;
export type ReservationSourceValue = (typeof RESERVATION_SOURCES)[number];

/**
 * Strict `YYYY-MM-DD` calendar date. `.refine` re-validates real calendar
 * days (2026-02-30 is rejected) using the pure engine helper, so types and
 * engine share ONE date rule.
 */
export const ReservationDateOnlySchema = z
  .string()
  .trim()
  .refine((value) => isValidDateOnly(value), {
    message: "Tanggal reservasi tidak valid (format YYYY-MM-DD)",
  });

/** Minutes from local midnight. */
export const StartMinutesSchema = z
  .number()
  .int("Jam reservasi tidak valid")
  .min(0, "Jam reservasi tidak valid")
  .max(1439, "Jam reservasi tidak valid");

/** Booking length in minutes; multiples of 15 are enforced by the engine. */
export const DurationMinutesSchema = z
  .number()
  .int("Durasi reservasi tidak valid")
  .positive("Durasi reservasi tidak valid");

/** Head count. Same bounds as the existing `visitorCount` (order.types.ts). */
export const PartySizeSchema = z
  .number()
  .int("Jumlah orang tidak valid")
  .min(1, "Jumlah orang minimal 1")
  .max(100, "Jumlah orang maksimal 100");

export const GuestNameSchema = z
  .string()
  .trim()
  .min(1, "Nama wajib diisi")
  .max(100, "Nama maksimal 100 karakter");

export const NotesSchema = z
  .string()
  .trim()
  .max(200, "Catatan maksimal 200 karakter");

/**
 * WhatsApp number. Accepts the Indonesian formats the rest of the app accepts
 * and CANONICALIZES to `62XXXXXXXXXXX` via the existing `normalizePhone`
 * helper (the same helper customer/order flows use), so duplicate/spam checks
 * in the service compare one canonical form. Returns the canonical value —
 * nothing downstream has to re-normalize.
 */
export const GuestPhoneSchema = z
  .string()
  .trim()
  .min(1, "Nomor WhatsApp wajib diisi")
  .max(30, "Nomor WhatsApp terlalu panjang")
  .refine((value) => normalizePhone(value) !== null, {
    message: "Nomor WhatsApp tidak valid",
  })
  .transform((value) => normalizePhone(value) as string);

export const BranchCodeSchema = z
  .string()
  .trim()
  .min(1, "Cabang wajib dipilih")
  .max(50, "Kode cabang tidak valid");

export const ReservationCodeSchema = z
  .string()
  .trim()
  .min(1, "Kode reservasi wajib diisi")
  .max(32, "Kode reservasi tidak valid");

// ============================================================
// Create — public (customer website / QR flow)
// ============================================================

export const CreatePublicReservationSchema = z.object({
  /** Branch is resolved from this code server-side (active branch only). */
  branchCode: BranchCodeSchema,
  reservationDate: ReservationDateOnlySchema,
  startMinutes: StartMinutesSchema,
  durationMinutes: DurationMinutesSchema.default(
    RESERVATION_DEFAULT_DURATION_MINUTES
  ),
  partySize: PartySizeSchema,
  /** Optional table preference — re-validated against the branch server-side. */
  tableId: z.string().trim().min(1).optional().nullable(),
  guestName: GuestNameSchema,
  guestPhone: GuestPhoneSchema,
  notes: NotesSchema.optional().nullable(),
  /** Literal: a public request can never claim to be an ADMIN booking. */
  source: z.literal("PUBLIC").default("PUBLIC"),
});

export type CreatePublicReservationInput = z.infer<
  typeof CreatePublicReservationSchema
>;

// ============================================================
// Create — admin / kasir (walk-in, phone booking, front desk)
// ============================================================

export const CreateAdminReservationSchema = z.object({
  /** Already-validated branch (requireRoles + effectiveWriteBranchId). */
  branchId: z.string().trim().min(1, "Cabang wajib dipilih"),
  reservationDate: ReservationDateOnlySchema,
  startMinutes: StartMinutesSchema,
  durationMinutes: DurationMinutesSchema.default(
    RESERVATION_DEFAULT_DURATION_MINUTES
  ),
  partySize: PartySizeSchema,
  tableId: z.string().trim().min(1).optional().nullable(),
  guestName: GuestNameSchema,
  guestPhone: GuestPhoneSchema,
  /** Link to an existing customer account when the staff picked one. */
  customerId: z.string().trim().min(1).optional().nullable(),
  notes: NotesSchema.optional().nullable(),
  /** Literal: the admin entry point always stamps ADMIN. */
  source: z.literal("ADMIN").default("ADMIN"),
});

export type CreateAdminReservationInput = z.infer<
  typeof CreateAdminReservationSchema
>;

// ============================================================
// Availability query (public)
// ============================================================

/**
 * Availability query. `partySize`/`startMinutes`/`durationMinutes` are coerced
 * because they arrive as URL query strings; everything else is re-validated by
 * the service (`checkAvailability`) so this object is only a first gate.
 */
export const ReservationAvailabilityQuerySchema = z.object({
  branchCode: BranchCodeSchema,
  /** `date` on the wire — the day whose slots are being listed. */
  date: ReservationDateOnlySchema,
  partySize: z.coerce
    .number()
    .int("Jumlah orang tidak valid")
    .min(1, "Jumlah orang minimal 1")
    .max(100, "Jumlah orang maksimal 100"),
  tableId: z.string().trim().min(1).optional(),
  /** The slot being probed (`checkAvailability` needs an explicit start). */
  startMinutes: z.coerce
    .number()
    .int("Jam reservasi tidak valid")
    .min(0, "Jam reservasi tidak valid")
    .max(1439, "Jam reservasi tidak valid"),
  durationMinutes: z.coerce
    .number()
    .int("Durasi reservasi tidak valid")
    .positive("Durasi reservasi tidak valid")
    .default(RESERVATION_DEFAULT_DURATION_MINUTES),
});

export type ReservationAvailabilityQuery = z.infer<
  typeof ReservationAvailabilityQuerySchema
>;

/**
 * Admin availability query — same as the public one but addressed by
 * `branchId` (already scope-validated via assertBranchInScope), not branchCode.
 */
export const ReservationAdminAvailabilityQuerySchema = z.object({
  branchId: z.string().trim().min(1, "Cabang wajib dipilih"),
  date: ReservationDateOnlySchema,
  partySize: z.coerce
    .number()
    .int("Jumlah orang tidak valid")
    .min(1, "Jumlah orang minimal 1")
    .max(100, "Jumlah orang maksimal 100"),
  tableId: z.string().trim().min(1).optional(),
  startMinutes: z.coerce
    .number()
    .int("Jam reservasi tidak valid")
    .min(0, "Jam reservasi tidak valid")
    .max(1439, "Jam reservasi tidak valid"),
  durationMinutes: z.coerce
    .number()
    .int("Durasi reservasi tidak valid")
    .positive("Durasi reservasi tidak valid")
    .default(RESERVATION_DEFAULT_DURATION_MINUTES),
});

export type ReservationAdminAvailabilityQuery = z.infer<
  typeof ReservationAdminAvailabilityQuerySchema
>;

// ============================================================
// Status transition (admin / kasir, plus the customer self-cancel path)
// ============================================================

export const ReservationStatusUpdateSchema = z.object({
  status: z.enum(RESERVATION_STATUSES),
  cancelReason: z
    .string()
    .trim()
    .max(200, "Alasan maksimal 200 karakter")
    .optional()
    .nullable(),
});

export type ReservationStatusUpdateInput = z.infer<
  typeof ReservationStatusUpdateSchema
>;

/**
 * Cancel request body. Cancellation is the status transition to CANCELLED with
 * an optional human reason — a dedicated schema keeps the two entry points
 * (PATCH status and POST .../cancel) independent.
 */
export const ReservationCancelSchema = z.object({
  cancelReason: z
    .string()
    .trim()
    .max(200, "Alasan maksimal 200 karakter")
    .optional()
    .nullable(),
});

export type ReservationCancelInput = z.infer<typeof ReservationCancelSchema>;

// ============================================================
// Admin reservation list (R2 service layer)
// ============================================================

/**
 * Admin board / list query. `page`/`limit` are coerced (query params arrive
 * as strings); everything else is optional server-side filtering. `branchId`
 * is only ever a HINT — a branch-scoped caller is still enforced through the
 * `branchFilters` argument in the service, never trusted from the client.
 */
export const ReservationListQuerySchema = z.object({
  page: z.coerce.number().int().min(1, "Halaman tidak valid").default(1),
  limit: z.coerce.number().int().min(1).max(100, "Limit maksimal 100").default(20),
  branchId: z.string().trim().min(1).optional().nullable(),
  date: ReservationDateOnlySchema.optional().nullable(),
  status: z.enum(RESERVATION_STATUSES).optional().nullable(),
  tableId: z.string().trim().min(1).optional().nullable(),
  search: z.string().trim().max(100, "Pencarian maksimal 100 karakter").optional().nullable(),
  sort: z.enum(["board", "newest"]).default("board"),
});

export type ReservationListQuery = z.infer<
  typeof ReservationListQuerySchema
>;
