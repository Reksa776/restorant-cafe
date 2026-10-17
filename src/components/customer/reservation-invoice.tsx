"use client";

import { Download } from "lucide-react";
import { downloadReservationInvoicePdf } from "@/lib/reservation-invoice-pdf";
import type { ReservationInvoiceData } from "@/lib/reservation-invoice-pdf";

export type { ReservationInvoiceData } from "@/lib/reservation-invoice-pdf";

/** Download a real PDF file; this does not open the browser print dialog. */
export function ReservationInvoice({
  reservation,
  siteName,
}: {
  reservation: ReservationInvoiceData;
  siteName: string;
}) {
  return (
    <button
      type="button"
      onClick={() => downloadReservationInvoicePdf(reservation, siteName)}
      className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-primary/30 px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-secondary"
    >
      <Download className="h-4 w-4" />
      Download Invoice PDF
    </button>
  );
}
