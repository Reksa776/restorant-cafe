import { NextRequest, NextResponse } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
} from "@/services/report/report.service";
import { buildCsv } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/multi-outlet/export
//   ?period=...&startDate=...&endDate=...&branchId=<id>
//
// Cross-outlet CSV download — ADMIN ONLY, restaurant-scoped. Uses the exact
// same database GROUP BY aggregation and revenue semantics as
// GET /api/reports/multi-outlet (PAID + non-cancelled; APPROVED refunds).
// Never exposes internal IDs.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get("branchId") || undefined;
    const ctx = await requireAdmin(
      branchIdParam || branchHintFrom(request)
    );

    const periodRaw = searchParams.get("period") || "today";
    const period = REPORT_PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getMultiOutletReport(
      ctx.restaurantId,
      period,
      startDate,
      endDate,
      branchFilters
    );

    const header = [
      "Rank",
      "Kode Cabang",
      "Cabang",
      "Status",
      "Total Order",
      "Total Item",
      "Gross Sales",
      "Diskon",
      "Pajak",
      "Service Charge",
      "Refund",
      "Total Penjualan",
      "Net Sales",
      "AOV",
      "Cash",
      "QRIS",
      "Lainnya",
      "Dine In (Order)",
      "Dine In (Rp)",
      "Takeaway (Order)",
      "Takeaway (Rp)",
      "Delivery (Order)",
      "Delivery (Rp)",
      "Produk Terlaris",
      "Qty Terlaris",
      "Revenue Terlaris",
    ];

    const rows = report.outlets.map((o) => [
      o.rank,
      o.branchCode,
      o.branchName,
      o.isActive ? "Aktif" : "Nonaktif",
      o.orders,
      o.items,
      o.grossSales,
      o.discount,
      o.tax,
      o.serviceCharge,
      o.refund,
      o.totalSales,
      o.netSales,
      o.aov,
      o.cash,
      o.qris,
      o.other,
      o.orderType.DINE_IN?.count ?? 0,
      o.orderType.DINE_IN?.amount ?? 0,
      o.orderType.TAKEAWAY?.count ?? 0,
      o.orderType.TAKEAWAY?.amount ?? 0,
      o.orderType.DELIVERY?.count ?? 0,
      o.orderType.DELIVERY?.amount ?? 0,
      o.bestSellingProduct?.name ?? "",
      o.bestSellingProduct?.qtySold ?? 0,
      o.bestSellingProduct?.revenue ?? 0,
    ]);

    const fileName = `multi-outlet-report-${period}-${new Date()
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
    console.error("Error exporting multi-outlet report:", error);
    return errorResponse(
      "Failed to export multi-outlet report",
      "INTERNAL_ERROR",
      500
    );
  }
}