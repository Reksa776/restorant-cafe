import { NextRequest } from "next/server";
import {
  REPORT_PERIODS,
  type ReportPeriod,
} from "@/services/report/report.service";
import { menuEngineeringService } from "@/services/menu-engineering/menu-engineering.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/menu-engineering
//   ?period=...&startDate=...&endDate=...
//   &branch=<id>&category=<id>&q=<search>&page=&limit=
//
// Menu Engineering = COMPOSITION over the F.4 (current HPP) and F.5
// (historical COGS/profitability) engines. Classification axes use the
// scoped MEDIAN; data-sufficiency / uncosted / new / no-price guards
// are applied server-side. ADMIN-only (exposes HPP/COGS/margin, same
// sensitivity as costing + profitability). Revenue semantics inherited
// unchanged (PAID-only, non-cancelled).
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    // Scoping from the auth context; query params are hints only.
    const ctx = await requireRoles(
      ["ADMIN"],
      searchParams.get("branch") || branchHintFrom(request) || undefined
    );

    const periodRaw = searchParams.get("period") || "today";
    const period = REPORT_PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const branchId = searchParams.get("branch") || null;
    const categoryId = searchParams.get("category") || null;
    const search = searchParams.get("q") || null;
    const classification = searchParams.get("classification") || null;

    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(
      100,
      Math.max(1, Number(searchParams.get("limit") || "25") || 25)
    );

    const report = await menuEngineeringService.getMenuEngineeringReport(
      {
        period,
        startDate,
        endDate,
        branchId,
        categoryId,
        classification,
        search,
        page,
        limit,
      },
      ctx
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching menu engineering report:", error);
    return errorResponse(
      "Failed to fetch menu engineering report",
      "INTERNAL_ERROR",
      500
    );
  }
}