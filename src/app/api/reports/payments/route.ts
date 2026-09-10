import { NextRequest } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_PAYMENT_METHODS,
  REPORT_PAYMENT_STATUSES,
} from "@/services/report/report.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/payments
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&cashierId=<id>&shiftId=<id>&method=KASIR|QRIS&status=...
//   &page=1&limit=50
//
// Payment activity report (payment rows, NOT revenue unless PAID). Paginated
// with bounded defaults (limit capped at 100). ADMIN or CASHIER — for CASHIER
// the cashierId filter is forced to the session user (own data only). Never
// exposes paymentUrl / provider secrets / QR payloads.
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

    const methodRaw = searchParams.get("method");
    const statusRaw = searchParams.get("status");
    const cashierParam = searchParams.get("cashierId") || null;
    const shiftParam = searchParams.get("shiftId") || null;

    const method = REPORT_PAYMENT_METHODS.includes(methodRaw as never)
      ? (methodRaw as string)
      : null;
    const status = REPORT_PAYMENT_STATUSES.includes(statusRaw as never)
      ? (statusRaw as string)
      : null;

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50)
    );

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getPaymentReport(
      ctx.restaurantId,
      period,
      {
        startDate,
        endDate,
        branchFilters,
        filters: {
          branchId: branchIdParam ?? null,
          cashierId: ctx.role === "CASHIER" ? ctx.userId : cashierParam,
          shiftId: shiftParam,
          method,
          status,
        },
        pagination: { page, limit },
      }
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching payment report:", error);
    return errorResponse("Failed to fetch payment report", "INTERNAL_ERROR", 500);
  }
}