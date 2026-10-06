"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScanLine } from "lucide-react";
import { QrScannerDialog } from "@/components/admin/qr-scanner";

/**
 * "Scan QR Reservasi" — opens the browser camera and decodes a reservation QR.
 * The QR payload is ONLY the reservation code (`R-XXXXXXXX`), so no customer
 * data ever leaves the QR. Reuses the shared QrScannerDialog camera lifecycle;
 * the actual lookup is done by the caller via the existing authorized endpoint
 * (GET /api/admin/reservations/code/[code]).
 */
export const RESERVATION_CODE_PATTERN = /^R-[A-Z0-9]{8}$/;

/** Normalizes + validates a reservation code (QR or manual entry). */
export function normalizeReservationCode(raw: string): string | null {
  const value = (raw || "").trim().toUpperCase();
  return RESERVATION_CODE_PATTERN.test(value) ? value : null;
}

export function ReservationScanner({
  onScan,
  triggerLabel = "Scan QR Reservasi",
  triggerVariant = "outline",
}: {
  onScan: (code: string) => void;
  triggerLabel?: string;
  triggerVariant?: "outline" | "default" | "secondary" | "ghost";
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant={triggerVariant}
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto"
      >
        <ScanLine className="h-4 w-4 mr-1" />
        {triggerLabel}
      </Button>

      <QrScannerDialog
        open={open}
        onOpenChange={setOpen}
        readerId="reservation-qr-reader"
        title="Scan QR Reservasi"
        description="Arahkan kamera ke QR reservasi pelanggan untuk menampilkan detailnya."
        scanningHint="QR belum terdeteksi — arahkan QR reservasi ke kamera"
        validate={normalizeReservationCode}
        onScan={onScan}
      />
    </>
  );
}
