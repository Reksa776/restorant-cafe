"use client";

// ============================================================
// PHASE 3 — reservation payment ownership context (client-only).
//
// The public reservation lookup and payment endpoints verify ownership with
// the guest's WhatsApp phone (the SAME mechanism the existing public
// reservation flows use). The wizard already collected that phone, so it is
// stashed here in sessionStorage (per reservation code) and reused by the
// payment page — the customer is never asked to enter it twice.
//
// This is UI convenience ONLY: the phone is still validated SERVER-side
// (normalizePhone + guestPhone match) and is never trusted for pricing or
// status. Nothing sensitive (no tokens, no payment data) is stored.
// ============================================================

export interface ReservationPaymentContext {
  phone?: string;
  restaurantId?: string;
  /**
   * Reservation + order snapshot returned by the create call, so the payment
   * page can render the full summary (items/totals) instantly — the public
   * LOOKUP endpoint returns reservation fields only. Live payment state is
   * ALWAYS re-read from the payment endpoint (the snapshot is display-only).
   */
  details?: unknown;
}

const PREFIX = "reservation_payment_ctx:";
const WIZARD_DRAFT_KEY = "customer-reservation-wizard-draft-v1";

function key(code: string): string {
  return `${PREFIX}${code}`;
}

export function saveReservationPaymentContext(
  code: string,
  ctx: ReservationPaymentContext
): void {
  if (typeof window === "undefined" || !code) return;
  try {
    window.sessionStorage.setItem(key(code), JSON.stringify(ctx));
  } catch {
    // Storage disabled/unavailable — the payment page then asks for the phone.
  }
}

export function readReservationPaymentContext(
  code: string
): ReservationPaymentContext | null {
  if (typeof window === "undefined" || !code) return null;
  try {
    const raw = window.sessionStorage.getItem(key(code));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReservationPaymentContext;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Keep the reservation wizard's success screen in sync after the authoritative
 * payment endpoint confirms a QRIS payment. Returns false when this browser
 * session has no matching wizard draft (for example, a direct link opened in
 * another browser), so callers can keep the self-contained payment result.
 */
export function markReservationWizardPaymentComplete(
  code: string,
  reservationStatus: string
): boolean {
  if (typeof window === "undefined" || !code) return false;
  try {
    const raw = window.sessionStorage.getItem(WIZARD_DRAFT_KEY);
    if (!raw) return false;
    const draft = JSON.parse(raw) as {
      created?: {
        code?: string;
        status?: string;
        order?: { paymentStatus?: string } | null;
      } | null;
    };
    if (!draft.created || draft.created.code !== code || !draft.created.order) {
      return false;
    }
    draft.created.status = reservationStatus;
    draft.created.order.paymentStatus = "PAID";
    window.sessionStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}
