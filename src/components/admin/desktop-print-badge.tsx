"use client";

import { useEffect, useState } from "react";
import { Monitor } from "lucide-react";
import { cn } from "@/lib/utils";
import { getDesktopBridge, isSilentPrintEnabled } from "@/lib/desktop-bridge";

/**
 * Subtle indicator shown only inside RestoPOS Kasir Desktop, so the cashier
 * knows receipts go straight to the thermal printer (no Windows dialog).
 *
 * Rendered after mount on purpose: the server has no `window`, and rendering
 * the badge during hydration would otherwise mismatch the server markup.
 */
export function DesktopPrintBadge({ className }: { className?: string }) {
  const [visible, setVisible] = useState(false);
  const [silent, setSilent] = useState(false);

  useEffect(() => {
    if (!getDesktopBridge()) return;
    let cancelled = false;
    void isSilentPrintEnabled().then((enabled) => {
      if (cancelled) return;
      setSilent(enabled);
      setVisible(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <span
      title={
        silent
          ? "Struk dicetak langsung ke printer thermal tanpa dialog Windows."
          : "Cetak struk memakai dialog cetak sistem."
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium",
        silent
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-gray-200 bg-gray-50 text-gray-600",
        className
      )}
    >
      <Monitor className="h-3.5 w-3.5" />
      Desktop App · {silent ? "Silent Print Aktif" : "Print Manual"}
    </span>
  );
}
