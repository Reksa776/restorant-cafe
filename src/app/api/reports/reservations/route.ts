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
// PHASE 9B (C8/PART 13) — GET /api/reports/reservations
//   ?period=today|yesterday|week|month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//   &branchId=<id>
//
// ADMIN only, restaurant-scoped. Scoped by Reservation.reservationDate
// (business date). Reservation revenue reuses the canonical engine restricted
// to reservation-linked order ids. No client totals are trusted.
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

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getReservationReport(
      ctx.restaurantId,
      period,
      { startDate, endDate, branchFilters }
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching reservation report:", error);
    return errorResponse(
      "Failed to fetch reservation report",
      "INTERNAL_ERROR",
      500
    );
  }
}
