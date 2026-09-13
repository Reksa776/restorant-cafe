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

/**
 * H2.3 — CSV Cost Status. Maps the derived coverage state (H2.1) to the
 * CSV's historical labels so existing consumers keep working, and adds the
 * new PENDING state for COGS that is not yet incurred (PAID, not COMPLETED).
 * Unknown/uncovered COGS is exported as an empty gross profit, never as 0.
 */
const COGS_STATE_LABEL: Record<string, string> = {
  COVERED: "FULL",
  PARTIAL: "PARTIAL",
  PENDING_COGS: "PENDING",
  UNCOVERED: "UNCOSTED",
  LEGACY: "LEGACY",
};

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
      // H3 — refund-aware cost columns (appended to keep old consumers working).
      "COGS Reversal",
      "Retained COGS",
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
      COGS_STATE_LABEL[p.cogsState] ?? p.cogsState,
      p.cogsReversal,
      p.retainedCogs,
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
