"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ScanLine } from "lucide-react";
import {
  QrScannerDialog,
  validateOrderNumber,
} from "@/components/admin/qr-scanner";

/**
 * "Scan QR Pesanan" — opens the browser camera (mobile / desktop webcam) and
 * decodes an order QR (`ORD-…`). Thin wrapper over the shared QrScannerDialog
 * so the camera lifecycle lives in exactly ONE place; the external API is
 * unchanged for existing callers.
 */
export function OrderScanner({
  onScan,
  triggerLabel = "Scan QR Pesanan",
  triggerVariant = "outline",
}: {
  onScan: (orderNumber: string) => void;
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
        readerId="order-qr-reader"
        title="Scan QR Pesanan"
        description="Arahkan kamera ke QR pesanan pelanggan untuk membuka halaman pembayaran."
        scanningHint="QR belum terdeteksi — arahkan QR pesanan ke kamera"
        validate={validateOrderNumber}
        onScan={onScan}
      />
    </>
  );
}
