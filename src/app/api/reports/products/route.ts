import { NextRequest } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_PAYMENT_METHODS,
  REPORT_ORDER_TYPES,
  REPORT_PAYMENT_STATUSES,
  type ReportFilters,
} from "@/services/report/report.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/products
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&categoryId=<id>&productId=<id>&status=PAID|...
//   &sortBy=qty|revenue|gross
//
// Product report aggregated from OrderItem (historical transaction source).
// ADMIN or CASHIER, restaurant-scoped. Revenue always PAID-only. Unsold list
// reflects the current active catalog; historical sold rows keep showing even
// if a product is now inactive.
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

    const orderTypeRaw = searchParams.get("orderType");
    const paymentMethodRaw = searchParams.get("paymentMethod");
    const statusRaw = searchParams.get("status");
    const categoryId = searchParams.get("categoryId") || null;
    const productId = searchParams.get("productId") || null;
    const sortByRaw = searchParams.get("sortBy");
    const sortBy =
      sortByRaw === "revenue" || sortByRaw === "gross" ? "revenue" : "qty";

    const filters: ReportFilters = {
      orderType: REPORT_ORDER_TYPES.includes(orderTypeRaw as never)
        ? (orderTypeRaw as ReportFilters["orderType"])
        : null,
      paymentMethod: REPORT_PAYMENT_METHODS.includes(paymentMethodRaw as never)
        ? (paymentMethodRaw as ReportFilters["paymentMethod"])
        : null,
      status: REPORT_PAYMENT_STATUSES.includes(statusRaw as never)
        ? (statusRaw as ReportFilters["status"])
        : null,
      branchId: branchIdParam ?? null,
    };

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getProductReport(ctx.restaurantId, period, {
      startDate,
      endDate,
      branchFilters,
      filters,
      categoryId,
      productId,
      sortBy,
    });

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching product report:", error);
    return errorResponse("Failed to fetch product report", "INTERNAL_ERROR", 500);
  }
}