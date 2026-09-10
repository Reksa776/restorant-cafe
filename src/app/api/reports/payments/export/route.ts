import { NextRequest, NextResponse } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_PAYMENT_METHODS,
  REPORT_PAYMENT_STATUSES,
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
// GET /api/reports/payments/export
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&cashierId=<id>&shiftId=<id>&method=...&status=...
//
// Payment activity CSV download — ADMIN or CASHIER. Uses the exact same
// filters/semantics as GET /api/reports/payments but exports the FULL bounded
// dataset (take: 5000, chronological) independent of the UI pagination. A
// CASHIER's cashierId is forced to the session user (own data only). Never
// exposes paymentUrl / provider / providerRef / qrString / qrImage or
// internal IDs.
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
      ? (methodRaw as "KASIR" | "QRIS")
      : null;
    const status = REPORT_PAYMENT_STATUSES.includes(statusRaw as never)
      ? (statusRaw as string)
      : null;

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const data = await reportService.getPaymentsForExport(
      ctx.restaurantId,
      period,
      {
        startDate,
        endDate,
        branchFilters,
        filters: {
          branchId: branchIdParam ?? null,
          // CASHIER can only ever export their own payments (server-side).
          cashierId:
            ctx.role === "CASHIER" ? ctx.userId : (cashierParam ?? null),
          shiftId: shiftParam,
          method,
          status,
        },
      }
    );

    const header = [
      "Tanggal",
      "Order",
      "Kode Cabang",
      "Cabang",
      "Kasir",
      "Metode",
      "Status",
      "Jumlah",
      "Refund",
      "Shift",
      "Dibayar",
    ];

    const rows = data.items.map((p) => [
      p.createdAt,
      p.orderNumber,
      p.branchCode,
      p.branchName,
      p.cashierName,
      p.method,
      p.status,
      p.amount,
      p.refund,
      p.shiftNumber,
      p.paidAt,
    ]);

    const fileName = `payment-report-${period}-${new Date()
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
    console.error("Error exporting payment report:", error);
    return errorResponse(
      "Failed to export payment report",
      "INTERNAL_ERROR",
      500
    );
  }
}