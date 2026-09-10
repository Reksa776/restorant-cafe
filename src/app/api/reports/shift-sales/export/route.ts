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
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/shift-sales/export
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&cashierId=<id>&status=OPEN|CLOSED
//
// Per-shift sales CSV download — ADMIN or CASHIER. Uses the exact same
// semantics as GET /api/reports/shift-sales: a CASHIER only ever gets their
// OWN shifts (a client-provided cashierId is ignored for that role); branch
// scoping via authorizedBranches(ctx) / an explicit validated branchId. Never
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

    const statusRaw = searchParams.get("status");
    const cashierParam = searchParams.get("cashierId") || null;
    const status =
      statusRaw === "OPEN" || statusRaw === "CLOSED" ? statusRaw : null;

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
          // CASHIER can only ever export their own shifts (server-side).
          cashierId:
            ctx.role === "CASHIER" ? ctx.userId : (cashierParam ?? null),
          status,
        },
      }
    );

    const header = [
      "Shift",
      "Kasir",
      "Kode Cabang",
      "Cabang",
      "Status",
      "Dibuka",
      "Ditutup",
      "Uang Awal",
      "Penjualan Cash",
      "Penjualan QRIS",
      "Pembayaran Lain",
      "Total Penjualan",
      "Refund",
      "Kas Diharapkan",
      "Kas Aktual",
      "Selisih",
      "Jumlah Transaksi",
    ];

    const rows = report.items.map((s) => [
      s.shiftNumber,
      s.cashierName ?? "",
      s.branchCode ?? "",
      s.branchName ?? "",
      s.status,
      s.openedAt,
      s.closedAt ?? "",
      s.openingCash,
      s.cashSales,
      s.qrisSales,
      s.otherPayment,
      s.totalSales,
      s.refund,
      s.expectedCash,
      s.actualCash ?? "",
      s.difference ?? "",
      s.transactionCount,
    ]);

    const fileName = `shift-report-${period}-${new Date()
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
    console.error("Error exporting shift sales report:", error);
    return errorResponse(
      "Failed to export shift sales report",
      "INTERNAL_ERROR",
      500
    );
  }
}