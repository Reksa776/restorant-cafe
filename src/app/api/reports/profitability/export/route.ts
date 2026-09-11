import { NextRequest, NextResponse } from "next/server";
import {
  REPORT_PERIODS,
  REPORT_PAYMENT_METHODS,
  REPORT_ORDER_TYPES,
  type ReportPeriod,
} from "@/services/report/report.service";
import { profitabilityService } from "@/services/profitability/profitability.service";
import { buildCsv } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/profitability/export
//
// Product-level profitability CSV (same aggregation + revenue
// semantics as GET /api/reports/profitability). ADMIN-only, restaurant
// + authorized branch scoped. Uses the shared src/lib/csv.ts helper.
// ============================================================

function costStatus(row: {
  costedItems: number;
  uncostedItems: number;
  legacyItems: number;
}): string {
  if (row.legacyItems > 0 && row.costedItems === 0 && row.uncostedItems === 0) {
    return "LEGACY";
  }
  if (row.costedItems > 0 && row.uncostedItems === 0 && row.legacyItems === 0) {
    return "FULL";
  }
  if (row.costedItems > 0) return "PARTIAL";
  return "UNCOSTED";
}

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
        // Bounded full export (product count is small).
        pagination: { page: 1, limit: 200 },
      }
    );

    const branchLabel =
      report.branches.length === 1
        ? report.branches[0].branchName
        : "Semua Cabang";
    const dateLabel = new Date(report.range.start).toISOString().slice(0, 10);

    const header = [
      "Tanggal",
      "Cabang",
      "Produk",
      "Kategori",
      "Qty Terjual",
      "Net Sales",
      "COGS",
      "Gross Profit",
      "Margin %",
      "Food Cost %",
      "Jumlah Order",
      "Cost Status",
    ];

    const rows = report.products.map((p) => [
      dateLabel,
      branchLabel,
      p.name,
      p.categoryName ?? "",
      p.qtySold,
      p.netSales,
      p.cogs,
      p.grossProfit ?? "",
      p.grossMarginPct ?? "",
      p.foodCostPct ?? "",
      p.orderCount,
      costStatus(p),
    ]);

    const fileName = `profitability-report-${period}-${new Date()
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
    console.error("Error exporting profitability report:", error);
    return errorResponse(
      "Failed to export profitability report",
      "INTERNAL_ERROR",
      500
    );
  }
}
