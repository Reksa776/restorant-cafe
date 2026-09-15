"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";
import {
  DASHBOARD_PERIOD_PRESETS,
  type DashboardPeriodPreset,
} from "@/lib/report-periods";

// ============================================================
// Analytics filter bar.
//
// Reuses the existing period-pill styling from the reports UI and the existing
// `ReportBranchFilter` (which keeps the axios x-branch-id header in sync and
// only offers "Semua Cabang" to non branch-scoped users — the server still
// re-validates every request).
// ============================================================

export interface PeriodFilterProps {
  preset: DashboardPeriodPreset;
  onPresetChange: (preset: DashboardPeriodPreset) => void;
  startDate: string;
  endDate: string;
  onStartDateChange: (value: string) => void;
  onEndDateChange: (value: string) => void;
  onRefresh: () => void;
  loading?: boolean;
  /** Human-readable resolved range, e.g. "01 Sep 2026 — 15 Sep 2026". */
  rangeLabel?: string | null;
}

export function AnalyticsPeriodFilter({
  preset,
  onPresetChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  onRefresh,
  loading = false,
  rangeLabel,
}: PeriodFilterProps) {
  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {DASHBOARD_PERIOD_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => onPresetChange(p.value)}
                className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
                  preset === p.value
                    ? "border-gray-900 bg-gray-900 text-white"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onRefresh}
              disabled={loading}
            >
              <RefreshCw
                className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
        </div>

        {preset === "custom" && (
          <div className="flex flex-wrap items-center gap-3 border-t border-gray-100 pt-3">
            <label className="text-sm text-gray-600" htmlFor="analytics-start">
              Dari
            </label>
            <input
              id="analytics-start"
              type="date"
              value={startDate}
              onChange={(e) => onStartDateChange(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
            <label className="text-sm text-gray-600" htmlFor="analytics-end">
              sampai
            </label>
            <input
              id="analytics-end"
              type="date"
              value={endDate}
              onChange={(e) => onEndDateChange(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm"
            />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 pt-3">
          <ReportBranchFilter />
          {rangeLabel && (
            <p className="text-xs text-muted-foreground">Periode: {rangeLabel}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
