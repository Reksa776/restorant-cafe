import { NextRequest } from "next/server";
import { reportService, type ReportPeriod } from "@/services/report/report.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/sales
//   ?period=today|yesterday|week|month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//
// ADMIN only, restaurant-scoped (restaurantId from the session — never
// from the query string). Branch-scoped via the x-branch-id header hint and
// the admin's branch assignments. All aggregations run server-side.
// ============================================================

const PERIODS: ReportPeriod[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "custom",
];

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);

    const { searchParams } = new URL(request.url);
    const periodRaw = searchParams.get("period") || "today";
    const period = PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const report = await reportService.getSalesReport(
      ctx.restaurantId,
      period,
      startDate,
      endDate,
      authorizedBranches(ctx)
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching sales report:", error);
    return errorResponse("Failed to fetch sales report", "INTERNAL_ERROR", 500);
  }
}