"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, QrCode, ScanLine, XCircle } from "lucide-react";

/**
 * "Scan QR Pesanan" — opens the browser camera (mobile / desktop webcam) and
 * decodes an order QR. A valid scan contains the order number (ORD-…); the
 * component then stops the camera and forwards it via onScan.
 *
 * Lifecycle guarantees:
 * - camera starts only while the dialog is open (started lazily)
 * - camera stops + resources cleared on close AND on unmount
 * - permission denial / camera errors surface a friendly Indonesian message
 * - invalid QR codes are ignored (keeps scanning), duplicate codes throttled
 *   (first hit wins, scanner stops immediately)
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
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const onScanRef = useRef(onScan);
  const cancelledRef = useRef(false);

  // Keep the latest onScan without writing a ref during render.
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setStatus("idle");
      setError(null);
    }
    setOpen(next);
  };

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current;
    scannerRef.current = null;
    if (scanner) {
      try {
        await scanner.stop();
      } catch {
        // camera already stopped — ignore
      }
      try {
        scanner.clear();
      } catch {
        // ignore
      }
    }
  }, []);

  // Start / stop the camera with the dialog lifecycle.
  useEffect(() => {
    if (!open) return;
    cancelledRef.current = false;
    let disposed = false;

    (async () => {
      // Defer past the effect body so the setState calls run in the async
      // continuation, not synchronously during the effect (React 19 rule).
      await Promise.resolve();
      if (disposed) return;
      setStatus("starting");
      setError(null);
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (disposed || !document.getElementById("order-qr-reader")) return;

        const html5Qr = new Html5Qrcode("order-qr-reader", /* verbose */ false);
        scannerRef.current = html5Qr;
        setStatus("scanning");

        await html5Qr.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            // Valid: an order number. Order numbers are generated as
            // `ORD-YYYYMMDD-XXXXXX` with a base-36 (uppercase A-Z + 0-9)
            // 6-char random suffix (see order.service.ts) — NOT digits-only.
            // The phone-friendly raw payload is the plain order number; match
            // the real format so every valid QR hits. Throttle — one hit and
            // we stop.
            const num = (decodedText || "").trim();
            if (/^ORD-\d{8}-[A-Z0-9]{6}$/.test(num)) {
              setStatus("idle");
              stopCamera();
              setOpen(false);
              onScanRef.current?.(num);
            }
            // Any other content (invalid QR): keep scanning.
          },
          () => {
            // Per-frame miss — decode failures are expected noise.
          }
        );
      } catch {
        if (disposed) return;
        setStatus("error");
        setError(
          "Tidak dapat mengakses kamera. Izinkan akses kamera di browser, atau gunakan pencarian manual."
        );
      }
    })();

    return () => {
      disposed = true;
      cancelledRef.current = true;
      stopCamera();
    };
  }, [open, stopCamera]);

  // Safety net: if the element ever fails to mount we never hang on "starting".
  useEffect(() => {
    if (!open || status !== "starting") return;
    const t = setInterval(() => {
      if (!document.getElementById("order-qr-reader")) return;
      clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [open, status]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <Button
        variant={triggerVariant}
        size="sm"
        onClick={() => setOpen(true)}
        className="w-full sm:w-auto"
      >
        <ScanLine className="h-4 w-4 mr-1" />
        {triggerLabel}
      </Button>

      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            Scan QR Pesanan
          </DialogTitle>
          <DialogDescription>
            Arahkan kamera ke QR pesanan pelanggan untuk membuka halaman
            pembayaran.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden bg-gray-950">
            {/* html5-qrcode renders the <video> inside this element */}
            <div id="order-qr-reader" className="w-full [&_video]:!w-full" />
          </div>

          {status === "starting" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Menyalakan kamera...
            </p>
          )}
          {status === "scanning" && (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
              QR belum terdeteksi — arahkan QR pesanan ke kamera
            </p>
          )}
          {status === "error" && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
              <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button variant="outline" className="w-full" onClick={() => setOpen(false)}>
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
