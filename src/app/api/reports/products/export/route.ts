import { NextRequest, NextResponse } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_PAYMENT_METHODS,
  REPORT_ORDER_TYPES,
  REPORT_PAYMENT_STATUSES,
  type ReportFilters,
} from "@/services/report/report.service";
import { buildCsv } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/products/export
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&categoryId=<id>&sortBy=qty|revenue|gross
//   &orderType=...&paymentMethod=...&status=...
//
// Product CSV download — ADMIN or CASHIER, restaurant-scoped. Uses the exact
// same aggregation and revenue semantics as GET /api/reports/products (PAID +
// non-cancelled only, product-level discount = pro-rata allocation). Never
// exposes internal IDs.
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

    const report = await reportService.getProductReport(
      ctx.restaurantId,
      period,
      {
        startDate,
        endDate,
        branchFilters,
        filters,
        categoryId,
        sortBy,
      }
    );

    const header = [
      "Rank",
      "Produk",
      "Kategori",
      "Harga Satuan",
      "Qty Terjual",
      "Gross Sales",
      "Diskon",
      "Net Sales",
      "Rata-rata Harga",
      "Jumlah Order",
    ];

    const rows = report.products.map((p) => [
      p.rank,
      p.name,
      p.categoryName ?? "",
      p.price,
      p.qtySold,
      p.grossSales,
      p.discount,
      p.netSales,
      p.qtySold > 0 ? Math.round((p.netSales / p.qtySold) * 100) / 100 : 0,
      p.orderCount,
    ]);

    const fileName = `product-report-${period}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    return new NextResponse(buildCsv(header, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error exporting product report:", error);
    return errorResponse(
      "Failed to export product report",
      "INTERNAL_ERROR",
      500
    );
  }
}