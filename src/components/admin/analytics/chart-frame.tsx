"use client";

import type { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, BarChart3, Loader2, RefreshCw } from "lucide-react";

// ============================================================
// Shared shell for every analytics widget so loading / empty / error
// rendering stays consistent across charts and never shows an empty chart
// for a failed request (a failure is always surfaced explicitly).
// ============================================================

export interface ChartFrameProps {
  title: string;
  subtitle?: string;
  /** Extra header content (e.g. a badge or a toggle). */
  actions?: ReactNode;
  /** Widget state. `ready` renders `children`. */
  state?: "loading" | "ready" | "error";
  onRetry?: () => void;
  /** Human-readable failure reason shown in the error state. */
  errorMessage?: string;
  /**
   * Whether retrying could plausibly succeed. A hard 403 (wrong branch) is not
   * retryable — the existing dashboard makes the same distinction.
   */
  retryable?: boolean;
  /** When true (and state is `ready`), the empty state replaces `children`. */
  empty?: boolean;
  emptyMessage?: string;
  /** Fixed body height so loading/empty/ready never jump. */
  height?: number;
  children?: ReactNode;
}

export function ChartFrame({
  title,
  subtitle,
  actions,
  state = "ready",
  onRetry,
  errorMessage,
  retryable = true,
  empty = false,
  emptyMessage = "Belum ada data pada periode ini",
  height = 280,
  children,
}: ChartFrameProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
        {actions}
      </CardHeader>
      <CardContent>
        <div style={{ minHeight: height }} className="flex flex-col">
          {state === "loading" ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : state === "error" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <p className="text-sm text-gray-600">
                {errorMessage || "Gagal memuat data analitik"}
              </p>
              {!retryable && (
                <p className="text-xs text-gray-400">
                  Silakan pilih cabang yang sesuai dengan akun Anda, atau
                  hubungi admin.
                </p>
              )}
              {onRetry && retryable && (
                <Button variant="outline" size="sm" onClick={onRetry}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Coba Lagi
                </Button>
              )}
            </div>
          ) : empty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-muted-foreground">
              <BarChart3 className="h-8 w-8 text-gray-300" />
              <p className="text-sm">{emptyMessage}</p>
            </div>
          ) : (
            <div className="flex-1">{children}</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Compact KPI tile used by the analytics overview rows. Kept separate from
 * ChartFrame because it needs no chart body/state wrapper.
 */
export function MetricTile({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: typeof BarChart3;
  tone?: "default" | "positive" | "negative" | "muted";
}) {
  const toneClass =
    tone === "positive"
      ? "text-green-700"
      : tone === "negative"
        ? "text-red-600"
        : tone === "muted"
          ? "text-muted-foreground"
          : "text-foreground";

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{label}</p>
        {Icon && <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />}
      </div>
      <p className={`mt-1 text-xl font-bold tabular-nums ${toneClass}`}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
