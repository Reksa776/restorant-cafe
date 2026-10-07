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
//
// The PURCHASE helpers below are a LOCAL wizard cart (display only). Prices,
// totals, tax and the grand total are ALWAYS recomputed server-side by the
// existing order engine — this module only builds the payload and the preview.
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

/** `73000` → "Rp73.000" (id-ID grouping). Display only — never authoritative. */
export function formatRupiah(value: number): string {
  const amount = Number.isFinite(value) ? Math.round(value) : 0;
  return `Rp${amount.toLocaleString("id-ID")}`;
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

/** Indonesian labels for the payment status enum values. */
export const PAYMENT_STATUS_LABELS: Record<string, string> = {
  UNPAID: "Belum Dibayar",
  PENDING: "Menunggu Pembayaran",
  PAID: "Lunas",
  FAILED: "Gagal",
  EXPIRED: "Kedaluwarsa",
  REFUNDED: "Dikembalikan",
  CANCELLED: "Dibatalkan",
};

/** DINE-IN payment intent for a reservation purchase. */
export type ReservationPaymentMethod = "QRIS" | "KASIR";

export const RESERVATION_PAYMENT_METHOD_LABELS: Record<
  ReservationPaymentMethod,
  string
> = {
  QRIS: "QRIS (bayar sekarang)",
  KASIR: "Bayar di Kasir",
};

// ============================================================
// User-facing conflict copy (409) — no retry, refresh only
// ============================================================

export const RESERVATION_CONFLICT_MESSAGE =
  "Meja/jam tersebut baru saja diambil. Silakan pilih waktu atau meja lain.";

/**
 * 409 `TABLE_NOT_AVAILABLE` — the chosen table failed the server's FINAL
 * availability gate (it became occupied/maintenance after the read). The
 * customer keeps all earlier wizard state and only picks another table.
 */
export const TABLE_NOT_AVAILABLE_MESSAGE =
  "Maaf, meja ini baru saja tidak tersedia. Silakan pilih meja lain.";

// ============================================================
// Reservation QR payload
// ============================================================

/**
 * The EXACT text encoded in the customer reservation QR: the reservation code
 * (`R-XXXXXXXX`) and nothing else. The QR is a LOOKUP HINT only — never
 * authorization — so the payload deliberately excludes the guest name, phone,
 * email, restaurant/branch/table ids, and any payment/secret. The server
 * re-validates every scan server-side.
 */
export function reservationQrPayload(code: string): string {
  return (code || "").trim().toUpperCase();
}

// ============================================================
// Wizard step order
//
// Reservation and purchase are ONE flow: the customer picks products INSIDE
// the wizard on the "Pembelian" step (between the table pick and the guest
// data). There is no redirect to the menu and no historical-purchase
// prerequisite.
//
//   branch → date → party → time → table → purchase → guest → review
// ============================================================

export type ReservationWizardStep =
  | "branch"
  | "date"
  | "party"
  | "time"
  | "table"
  | "purchase"
  | "guest"
  | "review"
  | "success";

/** Customer-facing label per step (the purchase step is shown as "Pembelian"). */
export const RESERVATION_STEP_LABELS: Record<ReservationWizardStep, string> = {
  branch: "Pilih Cabang",
  date: "Pilih Tanggal",
  party: "Jumlah Orang",
  time: "Pilih Jam",
  table: "Pilih Meja",
  purchase: "Pembelian",
  guest: "Data Tamu",
  review: "Review Reservasi",
  success: "Reservasi Berhasil",
};

/**
 * Ordered wizard steps (the terminal `success` screen is excluded, exactly as
 * the progress header counts them). `purchase` sits between `table` and
 * `guest` — the single source of truth for the flow order.
 */
export const RESERVATION_WIZARD_STEPS: ReservationWizardStep[] = [
  "branch",
  "date",
  "party",
  "time",
  "table",
  "purchase",
  "guest",
  "review",
];

/** Next ordered wizard step, or null at the end (`review` / `success`). */
export function nextWizardStep(
  step: ReservationWizardStep
): ReservationWizardStep | null {
  const index = RESERVATION_WIZARD_STEPS.indexOf(step);
  if (index < 0 || index >= RESERVATION_WIZARD_STEPS.length - 1) return null;
  return RESERVATION_WIZARD_STEPS[index + 1];
}

/**
 * Previous ordered wizard step, or null at the start (`branch`). Back
 * navigation walks this order so every step keeps its state.
 */
export function previousWizardStep(
  step: ReservationWizardStep
): ReservationWizardStep | null {
  const index = RESERVATION_WIZARD_STEPS.indexOf(step);
  if (index <= 0) return null;
  return RESERVATION_WIZARD_STEPS[index - 1];
}

// ============================================================
// Reservation purchase — LOCAL wizard cart (display only)
//
// This is deliberately NOT the global `useCart` (localStorage `restaurant_cart`)
// so a reservation never leaks items into the shared menu/cart/checkout. It is
// a pure display model; the server re-prices everything from the database.
// ============================================================

export interface ReservationPurchaseSelection {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceAdjustment: number;
}

export interface ReservationPurchaseAddon {
  addonId: string;
  name: string;
  price: number;
  quantity: number;
}

export interface ReservationPurchaseLine {
  /** Client-only line identity (never sent to the server). */
  lineId: string;
  productId: string;
  name: string;
  /** Base (variant-adjusted) unit price for DISPLAY only. */
  unitPrice: number;
  quantity: number;
  selections: ReservationPurchaseSelection[];
  addons: ReservationPurchaseAddon[];
  notes?: string;
}

/** One line's display total = unit price × quantity. */
export function reservationPurchaseLineTotal(
  line: ReservationPurchaseLine
): number {
  return line.unitPrice * line.quantity;
}

/** Display subtotal across all lines (server recomputes authoritatively). */
export function reservationPurchaseSubtotal(
  lines: ReservationPurchaseLine[]
): number {
  return lines.reduce(
    (sum, line) => sum + reservationPurchaseLineTotal(line),
    0
  );
}

/** Display total quantity across all lines. */
export function reservationPurchaseCount(
  lines: ReservationPurchaseLine[]
): number {
  return lines.reduce((sum, line) => sum + line.quantity, 0);
}

/** Human summary of a line's choices, e.g. "Level 2, Keju, Extra Shot ×2". */
export function reservationPurchaseLineNotes(
  line: ReservationPurchaseLine
): string {
  const parts = [
    ...line.selections.map((s) => s.optionName),
    ...line.addons.map((a) =>
      a.quantity > 1 ? `${a.name} ×${a.quantity}` : a.name
    ),
  ];
  return parts.join(", ");
}

/**
 * Build the EXACT `items[]` payload the server expects (identical shape to the
 * public order input). Only ids + quantities + notes cross the wire — never a
 * price. `selections`/`addons` are omitted when empty.
 */
export function toReservationOrderItems(lines: ReservationPurchaseLine[]) {
  return lines.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    ...(line.selections.length
      ? {
          selections: line.selections.map((s) => ({
            groupId: s.groupId,
            groupName: s.groupName,
            optionId: s.optionId,
            optionName: s.optionName,
            priceAdjustment: s.priceAdjustment,
          })),
        }
      : {}),
    ...(line.addons.length
      ? {
          addons: line.addons.map((a) => ({
            addonId: a.addonId,
            name: a.name,
            price: a.price,
            quantity: a.quantity,
          })),
        }
      : {}),
    ...(line.notes ? { notes: line.notes } : {}),
  }));
}

/** Customer-facing copy for the purchase step. */
export const PURCHASE_STEP_TITLE = "Pembelian untuk Reservasi";
export const PURCHASE_STEP_SUBTITLE =
  "Pilih makanan/minuman untuk meja Anda. Pembayaran mengikuti alur pembayaran yang tersedia.";
export const PURCHASE_EMPTY_MESSAGE =
  "Belum ada produk dipilih. Pilih minimal 1 produk untuk melanjutkan reservasi.";
export const PURCHASE_REQUIRED_HINT =
  "Reservasi harus menyertakan minimal 1 produk.";
