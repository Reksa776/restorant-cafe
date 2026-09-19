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