"use client";

import { toast } from "sonner";

/**
 * Central "Shift belum dibuka" notification used by every kasir order/payment
 * surface (manual order, scan → CASH/QRIS, mark paid, repayment QRIS).
 *
 * The backend ALREADY enforces the guard (SHIFT_NOT_OPEN) — this helper only
 * translates the semantic error into clear UX with a "Buka Shift" CTA pointing
 * at the existing /admin/shifts page. ADMIN and CASHIER both hold open-shift
 * access (requireRoles(["ADMIN","CASHIER"])), so the action is always
 * actionable for the session that hit the guard.
 */
export function notifyShiftNotOpen(serverMessage?: string): void {
  toast.error("Shift Belum Dibuka", {
    description:
      serverMessage ||
      "Silakan buka shift terlebih dahulu untuk memproses transaksi.",
    action: {
      label: "Buka Shift",
      onClick: () => {
        window.location.href = "/admin/shifts";
      },
    },
    duration: 6000,
  });
}