import { NextRequest } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
} from "@/services/report/report.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/shift-sales
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&cashierId=<id>&status=OPEN|CLOSED
//
// Per-shift sales report. ADMIN or CASHIER. A CASHIER may only ever see their
// OWN shifts — the route forces userId = session.userId for CASHIER (a
// client-provided cashierId is ignored for that role). Branch scoping via
// authorizedBranches(ctx) / an explicit validated branchId.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get("branchId") || undefined;
    const ctx = await requireRoles(
      ["ADMIN", "CASHIER"],
      branchIdParam || branchHintFrom(request)
    );

    const periodRaw = searchParams.get("period") || "today";
    const period = REPORT_PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const statusRaw = searchParams.get("status");
    const cashierParam = searchParams.get("cashierId") || null;
    const status = statusRaw === "OPEN" || statusRaw === "CLOSED" ? statusRaw : null;

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getShiftSalesReport(
      ctx.restaurantId,
      period,
      {
        startDate,
        endDate,
        branchFilters,
        filters: {
          branchId: branchIdParam ?? null,
          // CASHIER can only ever read their own shifts (server-side).
          cashierId: ctx.role === "CASHIER" ? ctx.userId : (cashierParam ?? null),
          status,
        },
      }
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching shift sales report:", error);
    return errorResponse("Failed to fetch shift sales report", "INTERNAL_ERROR", 500);
  }
}