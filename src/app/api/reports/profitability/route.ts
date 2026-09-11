import { NextRequest } from "next/server";
import {
  REPORT_PERIODS,
  REPORT_PAYMENT_METHODS,
  REPORT_ORDER_TYPES,
  type ReportPeriod,
} from "@/services/report/report.service";
import { profitabilityService } from "@/services/profitability/profitability.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/profitability
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&productId=<id>&categoryId=<id>
//   &orderType=...&paymentMethod=...&page=&limit=
//
// Historical profitability — revenue uses the existing PAID-only
// report semantics; COGS comes from the F.5 OrderItemCostSnapshot
// (frozen at READY → COMPLETED). ADMIN-only: exposes HPP/COGS/margin
// (same sensitivity as /api/admin/costing). Restaurant + authorized
// branch scope enforced server-side. Never trusts client totals.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get("branchId") || undefined;
    const ctx = await requireRoles(
      ["ADMIN"],
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
    const productId = searchParams.get("productId") || null;
    const categoryId = searchParams.get("categoryId") || null;
    const page = Math.max(1, Number(searchParams.get("page") || "1") || 1);
    const limit = Math.min(
      200,
      Math.max(1, Number(searchParams.get("limit") || "50") || 50)
    );

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await profitabilityService.getProfitabilityReport(
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
          orderType: REPORT_ORDER_TYPES.includes(orderTypeRaw as never)
            ? orderTypeRaw
            : null,
          paymentMethod: REPORT_PAYMENT_METHODS.includes(paymentMethodRaw as never)
            ? paymentMethodRaw
            : null,
        },
        pagination: { page, limit },
      }
    );

    return successResponse(report);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching profitability report:", error);
    return errorResponse(
      "Failed to fetch profitability report",
      "INTERNAL_ERROR",
      500
    );
  }
}
