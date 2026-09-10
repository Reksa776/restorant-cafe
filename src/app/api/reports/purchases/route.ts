import { NextRequest } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_PURCHASE_STATUSES,
} from "@/services/report/report.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/purchases
//   ?period=today|yesterday|week|month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//   &branchId=<id>&supplierId=<id>&status=DRAFT|RECEIVED|CANCELLED
//   &page=1&limit=50
//
// Purchase report (purchase value / quantity / status — NEVER COGS/profit).
// ADMIN or CASHIER, restaurant-scoped (restaurantId from the session — never
// from the query string). Branch is resolved server-side: an explicit
// branchId param is validated against the user's assignments. DRAFT is never
// counted as received stock; only RECEIVED goods entered inventory.
// Aggregation is 100% server-side (Prisma aggregate + SQL GROUP BY).
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
    const status = REPORT_PURCHASE_STATUSES.includes(statusRaw as never)
      ? (statusRaw as "DRAFT" | "RECEIVED" | "CANCELLED")
      : null;
    const supplierId = searchParams.get("supplierId") || null;

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50)
    );

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getPurchaseReport(
      ctx.restaurantId,
      period,
      {
        startDate,
        endDate,
        branchFilters,
        filters: {
          branchId: branchIdParam ?? null,
          supplierId,
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
    console.error("Error fetching purchase report:", error);
    return errorResponse("Failed to fetch purchase report", "INTERNAL_ERROR", 500);
  }
}