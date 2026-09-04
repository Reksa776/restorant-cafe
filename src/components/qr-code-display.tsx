"use client";

import { useEffect, useState } from "react";
import { QrCode } from "lucide-react";

/**
 * Render a QR code from a text value (e.g. an order number) using the
 * project's existing `qrcode` dependency. Used on the customer order page so
 * the cashier can scan the order, and in the KASIR payment view.
 */
export function QrCodeDisplay({
  value,
  size = 180,
  ariaLabel = "QR Code",
}: {
  value: string;
  size?: number;
  ariaLabel?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setFailed(false);
    if (!value) return;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(value, {
          width: size * 2,
          margin: 1,
          errorCorrectionLevel: "M",
        });
        if (!cancelled) setSrc(url);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  if (failed) {
    return (
      <div
        className="flex items-center justify-center bg-gray-100 rounded-lg text-gray-400"
        style={{ width: size, height: size }}
      >
        <QrCode className="h-6 w-6" />
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className="flex items-center justify-center bg-white rounded-lg border border-gray-200"
        style={{ width: size, height: size }}
      >
        <QrCode className="h-6 w-6 text-gray-300" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={ariaLabel}
      className="rounded-lg bg-white"
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}
