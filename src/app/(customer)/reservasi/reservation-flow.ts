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

/**
 * 409 `TABLE_NOT_AVAILABLE` — the chosen table failed the server's FINAL
 * availability gate (it became occupied/maintenance after the read). The
 * customer keeps all earlier wizard state and only picks another table.
 */
export const TABLE_NOT_AVAILABLE_MESSAGE =
  "Maaf, meja ini baru saja tidak tersedia. Silakan pilih meja lain.";

// ============================================================
// Minimum-purchase gate (server-authoritative reservation rule)
// ============================================================

/**
 * 409 `PURCHASE_REQUIRED` code + copy — reservation requires the customer/guest
 * to have at least ONE qualifying purchase (paid, not cancelled, >=1 item) at
 * the same restaurant. The exact wording matches the server message so the
 * wizard can surface it verbatim.
 */
export const PURCHASE_REQUIRED_CODE = "PURCHASE_REQUIRED";
export const PURCHASE_REQUIRED_MESSAGE =
  "Reservasi hanya tersedia setelah Anda menyelesaikan minimal 1 pembelian.";

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
// Wizard step order (R6.5)
//
// The minimum-purchase requirement is a STEP of the reservation wizard, placed
// AFTER the table pick and BEFORE the guest data / review — so the customer
// learns about it early instead of only after Submit
// (`PURCHASE_REQUIRED` on Review). The server rule is unchanged; this is
// position only.
//
//   branch → date → party → time → table → PURCHASE → guest → review
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
// Purchase step copy + view (UX early feedback only)
// ============================================================

/**
 * Client-side state of the early purchase check. This is UX ONLY — it never
 * authorizes anything: `POST /public/reservations` re-runs the same rule
 * server-side and still answers 409 `PURCHASE_REQUIRED` when nothing
 * qualifies (race-safe, authoritative).
 *
 *   idle       → identity unknown yet (guest has not typed a valid phone)
 *   checking   → probe in flight
 *   eligible   → server says a qualifying purchase exists
 *   ineligible → server says no qualifying purchase (show the menu CTA)
 *   error      → probe failed (offer retry; never blocks the flow logic)
 */
export type PurchaseCheckState =
  | "idle"
  | "checking"
  | "eligible"
  | "ineligible"
  | "error";

export const PURCHASE_STEP_TITLE = "Verifikasi Pembelian";
export const PURCHASE_FOUND_TITLE = "Pembelian ditemukan";
export const PURCHASE_FOUND_MESSAGE =
  "Anda memenuhi syarat untuk melakukan reservasi.";
export const PURCHASE_REQUIRED_TITLE = "Pembelian Diperlukan";
export const PURCHASE_REQUIRED_CTA = "Pesan Menu Dulu";
/** Existing customer menu/order flow — no new checkout/order/payment engine. */
export const PURCHASE_CTA_HREF = "/menu";
export const PURCHASE_IDLE_MESSAGE =
  "Masukkan nomor WhatsApp yang Anda gunakan saat memesan untuk memverifikasi pembelian Anda.";
export const PURCHASE_CHECKING_MESSAGE = "Memeriksa pembelian…";
export const PURCHASE_ERROR_MESSAGE =
  "Gagal memeriksa pembelian. Silakan coba lagi.";

export interface PurchaseStepView {
  tone: "idle" | "checking" | "eligible" | "required" | "error";
  title: string;
  message: string;
  /** Label of the purchase-required CTA, or null when not applicable. */
  ctaLabel: string | null;
  ctaHref: string | null;
  /** True only when the customer may advance (server-confirmed purchase). */
  canContinue: boolean;
}

/** Pure mapping of the purchase check state to what the step renders. */
export function purchaseStepView(state: PurchaseCheckState): PurchaseStepView {
  switch (state) {
    case "eligible":
      return {
        tone: "eligible",
        title: PURCHASE_FOUND_TITLE,
        message: PURCHASE_FOUND_MESSAGE,
        ctaLabel: null,
        ctaHref: null,
        canContinue: true,
      };
    case "ineligible":
      return {
        tone: "required",
        title: PURCHASE_REQUIRED_TITLE,
        message: PURCHASE_REQUIRED_MESSAGE,
        ctaLabel: PURCHASE_REQUIRED_CTA,
        ctaHref: PURCHASE_CTA_HREF,
        canContinue: false,
      };
    case "checking":
      return {
        tone: "checking",
        title: PURCHASE_STEP_TITLE,
        message: PURCHASE_CHECKING_MESSAGE,
        ctaLabel: null,
        ctaHref: null,
        canContinue: false,
      };
    case "error":
      return {
        tone: "error",
        title: PURCHASE_STEP_TITLE,
        message: PURCHASE_ERROR_MESSAGE,
        ctaLabel: null,
        ctaHref: null,
        canContinue: false,
      };
    default:
      return {
        tone: "idle",
        title: PURCHASE_STEP_TITLE,
        message: PURCHASE_IDLE_MESSAGE,
        ctaLabel: null,
        ctaHref: null,
        canContinue: false,
      };
  }
}

// ============================================================
// Return-to-reservation draft (minimal mechanism)
//
// The app has NO return-url/session mechanism for "go order first, then come
// back". When the customer is sent to the existing menu flow from the
// purchase step, the wizard snapshots its selections in sessionStorage so
// reopening /reservasi resumes AT the purchase step (re-checking the purchase)
// instead of starting over. Pure serialize/parse only — no auth, no order.
// ============================================================

export const RESERVATION_DRAFT_STORAGE_KEY = "reservation_draft";

export interface ReservationDraft {
  branchCode: string;
  date: string;
  partySize: number | null;
  selectedStart: number | null;
  selectedTableId: string | null;
  guestName: string;
  guestPhone: string;
  notes: string;
}

/** JSON snapshot of the wizard selections (never any auth/payment data). */
export function serializeReservationDraft(draft: ReservationDraft): string {
  return JSON.stringify({ version: 1, ...draft });
}

/**
 * Parse + defensively validate a stored draft. Returns null for anything that
 * is not a plausible draft (missing branch/date, malformed JSON, future
 * schema) so a corrupt value can never break the wizard.
 */
export function parseReservationDraft(raw: string | null): ReservationDraft | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.branchCode !== "string" || !value.branchCode) return null;
  if (typeof value.date !== "string" || !isValidDateOnly(value.date)) return null;

  const optionalNumber = (input: unknown): number | null =>
    typeof input === "number" && Number.isFinite(input) ? input : null;
  const optionalString = (input: unknown): string =>
    typeof input === "string" ? input : "";

  return {
    branchCode: value.branchCode,
    date: value.date,
    partySize: optionalNumber(value.partySize),
    selectedStart: optionalNumber(value.selectedStart),
    selectedTableId:
      typeof value.selectedTableId === "string" && value.selectedTableId
        ? value.selectedTableId
        : null,
    guestName: optionalString(value.guestName),
    guestPhone: optionalString(value.guestPhone),
    notes: optionalString(value.notes),
  };
}