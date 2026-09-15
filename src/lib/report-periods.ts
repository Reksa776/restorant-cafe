// ============================================================
// Dashboard period presets → report API params.
//
// The real range resolution is ALWAYS done server-side by
// `resolveReportRange` in src/services/report/report.service.ts — this module
// only maps a UI preset onto the params that engine already accepts
// (today / yesterday / week / month / custom).
//
// Two presets the engine has no period for are expressed as an explicit
// custom range so the engine stays untouched:
//   - last7  = today − 6 days .. today  (a rolling window, NOT "week",
//              which the engine resolves to the current ISO week from Monday)
//   - last30 = today − 29 days .. today (NOT "month", which is the calendar
//              month to date)
//
// Dates are emitted as local calendar days (YYYY-MM-DD) because the engine
// parses custom dates as local time (`new Date(`${startDate}T00:00:00`)`),
// so local parts keep the client and server on the same day boundary.
// ============================================================

import type { ReportPeriod } from "@/services/report.service";

export type DashboardPeriodPreset =
  | "today"
  | "yesterday"
  | "last7"
  | "last30"
  | "month"
  | "custom";

/** Presets offered in the dashboard period filter, in display order. */
export const DASHBOARD_PERIOD_PRESETS: Array<{
  value: DashboardPeriodPreset;
  label: string;
}> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "last7", label: "7 Hari" },
  { value: "last30", label: "30 Hari" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

export interface ReportPeriodParams {
  period: ReportPeriod;
  startDate?: string;
  endDate?: string;
}

/** Local calendar day as `YYYY-MM-DD` (never UTC-shifted). */
export function toLocalDay(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Map a UI preset (+ optional custom dates) onto report API params.
 * A preset gap (last7 / last30) becomes a custom range; everything else is
 * delegated to the server-side engine.
 */
export function presetToReportParams(
  preset: DashboardPeriodPreset,
  custom?: { startDate?: string; endDate?: string }
): ReportPeriodParams {
  const now = new Date();
  const today = toLocalDay(now);

  switch (preset) {
    case "today":
      return { period: "today" };
    case "yesterday":
      return { period: "yesterday" };
    case "month":
      return { period: "month" };
    case "last7": {
      const start = new Date(now);
      start.setDate(start.getDate() - 6);
      return { period: "custom", startDate: toLocalDay(start), endDate: today };
    }
    case "last30": {
      const start = new Date(now);
      start.setDate(start.getDate() - 29);
      return { period: "custom", startDate: toLocalDay(start), endDate: today };
    }
    case "custom":
    default:
      return {
        period: "custom",
        startDate: custom?.startDate || today,
        endDate: custom?.endDate || today,
      };
  }
}
