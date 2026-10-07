// ============================================================
// R4 — PURE reservation display helpers (no components, no effects).
//
// All `reservationDate` values arrive as `YYYY-MM-DD` (date-only) and are
// rendered WITHOUT timezone conversion by splitting the parts and building a
// local Date at local noon, so a stored day can never shift to the previous
// or next day. `startMinutes`/`durationMinutes` are minute-of-day integers —
// formatted via the existing `minutesToLabel` engine helper.
// ============================================================
import {
  isValidDateOnly,
  minutesToLabel,
} from "@/services/reservation/reservation.slots";

/** Indonesian labels for reservation status enum values. */
export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Menunggu",
  CONFIRMED: "Dikonfirmasi",
  SEATED: "Sudah Duduk",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  NO_SHOW: "Tidak Hadir",
};

/** Indonesian labels for the server-side `source` stamp. */
export const RESERVATION_SOURCE_LABELS: Record<string, string> = {
  PUBLIC: "Website",
  ADMIN: "Admin",
};

/**
 * Phase 4 — Indonesian labels for the DERIVED reservation payment status
 * (server value = linked Order.paymentStatus). Distinct from
 * RESERVATION_STATUS_LABELS: the two states must never be conflated.
 */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Belum Bayar",
  PENDING: "Menunggu Pembayaran",
  PAID: "Lunas",
  FAILED: "Pembayaran Gagal",
  EXPIRED: "Pembayaran Kedaluwarsa",
  CANCELLED: "Dibatalkan",
  REFUNDED: "Dana Dikembalikan",
};

/** Tailwind pairs for the payment status pill (mirrors ReservationStatusBadge). */
export const PAYMENT_STATUS_BADGE_CLASSES: Record<string, string> = {
  UNPAID: "bg-gray-100 text-gray-600",
  PENDING: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  EXPIRED: "bg-orange-100 text-orange-800",
  CANCELLED: "bg-gray-200 text-gray-600",
  REFUNDED: "bg-blue-100 text-blue-800",
};

/** Indonesian labels for payment method enum values. */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  QRIS: "QRIS",
  KASIR: "Kasir",
  VA: "Virtual Account",
};

/** `2026-09-17` → "17 Sep 2026" (local date built from parts, no TZ shift). */
export function formatReservationDate(dateOnly: string): string {
  if (!isValidDateOnly(dateOnly)) return dateOnly;
  const [yearStr, monthStr, dayStr] = dateOnly.split("-");
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `600`, `90` → "10:00–11:30" (start + duration, both via minutesToLabel). */
export function formatTimeSlot(
  startMinutes: number,
  durationMinutes: number
): string {
  return `${minutesToLabel(startMinutes)}–${minutesToLabel(
    startMinutes + durationMinutes
  )}`;
}

/** ISO timestamp → "17 Sep 2026, 08.30". Returns "-" for null/empty. */
export function formatReservationDateTime(iso: string | null | undefined): string {
  if (!iso) return "-";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** `600` → "10:00". Thin passthrough so components don't import the engine. */
export function formatStartMinutes(startMinutes: number): string {
  return minutesToLabel(startMinutes);
}

/**
 * `125000` → "Rp125.000" (same convention as the other admin components).
 * Non-finite input (null/undefined/NaN) renders as "Rp0" rather than leaking
 * a broken string into the detail modal.
 */
export function formatRupiah(value: number | null | undefined): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "Rp0";
  return `Rp${n.toLocaleString("id-ID")}`;
}