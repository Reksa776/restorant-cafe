"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import {
  ReservationWizardPage,
  type ReservationRouteStep,
} from "@/components/customer/reservation-wizard";

const RESERVATION_STEPS = new Set<ReservationRouteStep>([
  "branch",
  "date",
  "party",
  "time",
  "table",
  "purchase",
  "guest",
  "review",
  "success",
]);

/** Keep the wizard mounted as its individual step URLs change. */
export default function ReservationLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const step = pathname.split("/")[2] as ReservationRouteStep | undefined;

  if (step && RESERVATION_STEPS.has(step)) {
    return <ReservationWizardPage routeStep={step} />;
  }

  // Lookup and payment routes render their own pages under this layout.
  return children;
}
