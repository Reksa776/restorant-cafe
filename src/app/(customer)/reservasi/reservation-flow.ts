// ============================================================
// PHASE R5 — CUSTOMER RESERVATION UI — PURE client helpers.
//
// Everything in this module is pure and runs in the browser:
//   - no axios / fetch / effects
//   - no `@prisma/client` / server modules
//   - no timezone conversion: `reservationDate` stays a strict `YYYY-MM-DD`
//     string and every display formatter builds a local Date from its parts
//     (local noon) so a stored day can never shift to the previous/next day.
//
// Availability truth never lives here: the customer UI only builds the
// candidate slot grid (same engine the server uses) and asks the server per
// slot. This file never decides what is available.
// ============================================================

import {
  addDaysToDateOnly,
  buildSlots,
  isValidDateOnly,
  minutesToLabel,
  RESERVATION_DEFAULT_DURATION_MINUTES,
  RESERVATION_MAX_HORIZON_DAYS,
} from "@/services/reservation/reservation.slots";
import type { ReservationNow } from "@/services/reservation/reservation.slots";

// ============================================================
// Local date-only ("today"), NO timezone shift
// ============================================================

/** The app's local day as a strict `YYYY-MM-DD` string (no UTC conversion). */
export function localDateOnly(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** The injected "now" the slot engine expects, from local wall-clock time. */
export function localReservationNow(now: Date = new Date()): ReservationNow {
  return {
    today: localDateOnly(now),
    nowMinutes: now.getHours() * 60 + now.getMinutes(),
  };
}

/** Earliest selectable date — today (never the past). */
export function minReservationDate(now: Date = new Date()): string {
  return localDateOnly(now);
}

/** Latest selectable date — today + the booking horizon (60 days). */
export function maxReservationDate(now: Date = new Date()): string {
  return addDaysToDateOnly(localDateOnly(now), RESERVATION_MAX_HORIZON_DAYS);
}

/**
 * Candidate hourly slots for a day, from the same engine the server uses.
 * Past/today-elapsed slots are dropped (matches the server's PAST_SLOT rule).
 */
export function buildCandidateSlots(reservationDate: string, now?: ReservationNow) {
  const today = now ?? localReservationNow();
  return buildSlots({
    durationMinutes: RESERVATION_DEFAULT_DURATION_MINUTES,
    now: today,
    reservationDate,
  });
}

// ============================================================
// Display formatting (never internal ids, never timezone shifts)
// ============================================================

/** `2026-09-17` → "17 Sep 2026" (built from parts, local noon — no TZ shift). */
export function formatReservationDate(dateOnly: string): string {
  if (!isValidDateOnly(dateOnly)) return dateOnly;
  const [yearStr, monthStr, dayStr] = dateOnly.split("-");
  const date = new Date(Number(yearStr), Number(monthStr) - 1, Number(dayStr), 12, 0, 0);
  return date.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** `600`, `90` → "10:00–11:30" (start + duration via the shared engine). */
export function formatTimeSlot(startMinutes: number, durationMinutes: number): string {
  return `${minutesToLabel(startMinutes)}–${minutesToLabel(startMinutes + durationMinutes)}`;
}

/** `600` → "10:00" — thin passthrough so pages import display helpers only. */
export function formatStartMinutes(startMinutes: number): string {
  return minutesToLabel(startMinutes);
}

/** ISO timestamp → "17 Sep 2026, 08.30". Returns "-" for null/empty. */
export function formatReservationDateTime(
  iso: string | null | undefined
): string {
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

/** Indonesian labels for the reservation status enum values. */
export const RESERVATION_STATUS_LABELS: Record<string, string> = {
  PENDING: "Menunggu",
  CONFIRMED: "Dikonfirmasi",
  SEATED: "Sudah Duduk",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  NO_SHOW: "Tidak Hadir",
};

// ============================================================
// User-facing conflict copy (409) — no retry, refresh only
// ============================================================

export const RESERVATION_CONFLICT_MESSAGE =
  "Meja/jam tersebut baru saja diambil. Silakan pilih waktu atau meja lain.";