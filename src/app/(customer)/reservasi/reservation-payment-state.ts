// ============================================================
// PHASE 3 — pure reservation-payment UI state helpers.
//
// Extracted so the state machine and the countdown are unit-testable with the
// project's EXISTING node:test setup (no new test infrastructure). No I/O, no
// React: given the backend DTO, they answer "which view?" and "how long left?".
// ============================================================

/** The slice of the payment DTO these helpers read (matches the backend DTO). */
export interface PaymentLike {
  payment?: { status?: string | null; expiresAt?: string | null } | null;
  paymentStatus?: string | null;
}

/**
 * The status the UI should render. The backend `status` is authoritative,
 * EXCEPT a PENDING payment whose `expiresAt` has passed — the gateway may
 * never deliver an EXPIRED webhook, so the client treats it as EXPIRED (the
 * same rule the existing Order payment page uses).
 */
export function effectivePaymentStatus(
  data: PaymentLike | null,
  now: number = Date.now()
): string {
  const payment = data?.payment ?? null;
  const status = payment?.status || data?.paymentStatus || "UNPAID";
  if (status === "PENDING" && payment?.expiresAt) {
    const t = new Date(payment.expiresAt).getTime();
    if (!Number.isNaN(t) && now > t) return "EXPIRED";
  }
  return status;
}

/** Terminal statuses: polling must stop and no further POST is offered. */
export const TERMINAL_PAYMENT_STATUSES = [
  "PAID",
  "EXPIRED",
  "FAILED",
  "CANCELLED",
  "REFUNDED",
] as const;

export function isTerminalPaymentStatus(status: string): boolean {
  return (TERMINAL_PAYMENT_STATUSES as readonly string[]).includes(status);
}

/** Only a live PENDING payment is polled. */
export function shouldPoll(status: string): boolean {
  return status === "PENDING";
}

/**
 * HH:MM:SS countdown derived ONLY from the server `expiresAt` (never a fixed
 * duration). `now` is injectable for deterministic tests.
 */
export function formatCountdown(
  expiresAt: string | null | undefined,
  now: number = Date.now()
): string | null {
  if (!expiresAt) return null;
  const t = new Date(expiresAt).getTime();
  if (Number.isNaN(t)) return null;
  const remaining = Math.max(0, t - now);
  const totalSec = Math.floor(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":");
}
