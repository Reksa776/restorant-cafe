"use client";

import { cn } from "@/lib/utils";
import { RESERVATION_STATUS_LABELS } from "./reservation-format";

/** Tailwind pairs mirroring the tables page status chip pattern. */
const STATUS_PILL_CLASSES: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  SEATED: "bg-green-100 text-green-800",
  COMPLETED: "bg-gray-200 text-gray-700",
  CANCELLED: "bg-red-100 text-red-800",
  NO_SHOW: "bg-orange-100 text-orange-800",
};

export function ReservationStatusBadge({
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
        STATUS_PILL_CLASSES[status] ?? "bg-gray-100 text-gray-600",
        className
      )}
    >
      {RESERVATION_STATUS_LABELS[status] ?? status}
    </span>
  );
}