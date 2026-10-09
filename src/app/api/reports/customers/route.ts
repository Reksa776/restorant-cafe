import { NextRequest } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
} from "@/services/report/report.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// PHASE 9B (C4/PART 13) — GET /api/reports/customers
//   ?period=today|yesterday|week|month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//   &search=<text>&branchId=<id>
//
// ADMIN only, restaurant-scoped (restaurantId from the session — never from
// the query string). Branch is resolved server-side: an explicit branchId is
// validated against the user's assignments and becomes the sole read scope;
// otherwise the header hint / assignments apply. Spending follows the
// canonical Sales Report semantics (revenue set, refund-aware net). The
// customer password hash is never included.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get("branchId") || undefined;
    const ctx = await requireAdmin(branchIdParam || branchHintFrom(request));

    const periodRaw = searchParams.get("period") || "today";
    const period = REPORT_PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const search = searchParams.get("search") || undefined;

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getCustomerReport(
      ctx.restaurantId,
      period,
      { startDate, endDate, branchFilters, search }
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customer report:", error);
    return errorResponse(
      "Failed to fetch customer report",
      "INTERNAL_ERROR",
      500
    );
  }
}
