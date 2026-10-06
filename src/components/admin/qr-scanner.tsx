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
import { Loader2, QrCode, XCircle } from "lucide-react";

/**
 * Generic QR reader dialog (html5-qrcode). ONE camera lifecycle for the whole
 * admin app — the order scanner and the reservation scanner are thin wrappers
 * that only supply a validator + copy, so there is never a second scanner
 * engine.
 *
 * Lifecycle guarantees (preserved from the original OrderScanner):
 * - camera starts only while the dialog is open (lazily)
 * - camera stops + resources cleared on close AND on unmount
 * - permission denial / camera errors surface a friendly Indonesian message
 * - invalid payloads are ignored (keeps scanning); a valid hit stops the
 *   camera immediately (first hit wins)
 */
export function QrScannerDialog({
  open,
  onOpenChange,
  readerId,
  title,
  description,
  scanningHint,
  validate,
  onScan,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Unique DOM id for the reader element (one per mounted dialog). */
  readerId: string;
  title: string;
  description: string;
  scanningHint: string;
  /** Returns the normalized payload, or null when the decoded text is not one. */
  validate: (decodedText: string) => string | null;
  onScan: (value: string) => void;
}) {
  const [status, setStatus] = useState<"idle" | "starting" | "scanning" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<{
    stop: () => Promise<void>;
    clear: () => void;
  } | null>(null);
  const onScanRef = useRef(onScan);
  const validateRef = useRef(validate);
  const cancelledRef = useRef(false);

  // Keep the latest callbacks without writing a ref during render.
  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);
  useEffect(() => {
    validateRef.current = validate;
  }, [validate]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setStatus("idle");
      setError(null);
    }
    onOpenChange(next);
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
        if (disposed || !document.getElementById(readerId)) return;

        const html5Qr = new Html5Qrcode(readerId, /* verbose */ false);
        scannerRef.current = html5Qr;
        setStatus("scanning");

        await html5Qr.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            const value = validateRef.current?.(decodedText ?? "");
            if (value) {
              // One hit and we stop — no duplicate callbacks.
              setStatus("idle");
              stopCamera();
              handleOpenChange(false);
              onScanRef.current?.(value);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- handleOpenChange is stable enough; only open/readerId drive the lifecycle
  }, [open, readerId, stopCamera]);

  // Safety net: if the element ever fails to mount we never hang on "starting".
  useEffect(() => {
    if (!open || status !== "starting") return;
    const t = setInterval(() => {
      if (!document.getElementById(readerId)) return;
      clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [open, status, readerId]);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <QrCode className="h-4 w-4" />
            {title}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden bg-gray-950">
            {/* html5-qrcode renders the <video> inside this element */}
            <div id={readerId} className="w-full [&_video]:!w-full" />
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
              {scanningHint}
            </p>
          )}
          {status === "error" && (
            <div className="flex items-start gap-2 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5 text-xs text-red-700">
              <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <Button
            variant="outline"
            className="w-full"
            onClick={() => handleOpenChange(false)}
          >
            Tutup
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Default order-number validator: `ORD-YYYYMMDD-XXXXXX` with a base-36
 * (uppercase A-Z + 0-9) 6-char random suffix (see order.service.ts) — NOT
 * digits-only.
 */
export const ORDER_NUMBER_PATTERN = /^ORD-\d{8}-[A-Z0-9]{6}$/;

export function validateOrderNumber(decodedText: string): string | null {
  const value = (decodedText || "").trim();
  return ORDER_NUMBER_PATTERN.test(value) ? value : null;
}
