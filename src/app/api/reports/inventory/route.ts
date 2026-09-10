import { NextRequest } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_STOCK_MOVEMENT_TYPES,
} from "@/services/report/report.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/inventory
//   ?period=today|yesterday|week|month|custom&startDate=YYYY-MM-DD&endDate=YYYY-MM-DD
//   &branchId=<id>&productId=<id>&categoryId=<id>&type=IN|OUT|ADJUSTMENT
//   &page=1&limit=50
//
// Inventory report — movement history (ledger, paginated) + product stock
// summary. Current stock ALWAYS comes from BranchProduct.stock (never
// replayed from the ledger). Opening this report never creates movements or
// mutates stock. ADMIN or CASHIER, restaurant-scoped; an explicit branchId is
// validated against the user's assignments server-side.
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

    const typeRaw = searchParams.get("type");
    const type = REPORT_STOCK_MOVEMENT_TYPES.includes(typeRaw as never)
      ? (typeRaw as "IN" | "OUT" | "ADJUSTMENT")
      : null;
    const productId = searchParams.get("productId") || null;
    const categoryId = searchParams.get("categoryId") || null;

    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
    const limit = Math.min(
      100,
      Math.max(1, parseInt(searchParams.get("limit") || "50", 10) || 50)
    );

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getInventoryReport(
      ctx.restaurantId,
      period,
      {
        startDate,
        endDate,
        branchFilters,
        filters: {
          branchId: branchIdParam ?? null,
          productId,
          categoryId,
          type,
        },
        pagination: { page, limit },
      }
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching inventory report:", error);
    return errorResponse("Failed to fetch inventory report", "INTERNAL_ERROR", 500);
  }
}