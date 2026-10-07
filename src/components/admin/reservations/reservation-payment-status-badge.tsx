"use client";

import { cn } from "@/lib/utils";
import {
  PAYMENT_STATUS_BADGE_CLASSES,
  PAYMENT_STATUS_LABELS,
} from "./reservation-format";

/**
 * Phase 4 — payment status pill. `status` is the DERIVED reservation payment
 * status (linked Order.paymentStatus), NOT the reservation status. Unknown
 * values fall back to the muted pill style so a new backend enum value can
 * never crash the admin modal.
 */
export function ReservationPaymentStatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap",
        PAYMENT_STATUS_BADGE_CLASSES[status] ?? "bg-gray-100 text-gray-600",
        className
      )}
    >
      {PAYMENT_STATUS_LABELS[status] ?? status}
    </span>
  );
}
