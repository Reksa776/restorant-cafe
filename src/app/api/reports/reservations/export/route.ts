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
// PHASE 9B (C12/PART 11) — GET /api/reports/reservations/export
//
// ADMIN only, restaurant + branch + date scoped. Per-reservation rows with
// canonical revenue (never a raw grandTotal sum). No internal secrets.
// Reuses the shared buildCsv helper.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const branchIdParam = searchParams.get("branchId") || undefined;
    const ctx = await requireAdmin(branchIdParam || branchHintFrom(request));

    const periodRaw = searchParams.get("period") || "today";
    const period = REPORT_PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const rows = await reportService.getReservationsForExport(
      ctx.restaurantId,
      period,
      { startDate, endDate, branchFilters }
    );

    const header = [
      "Kode",
      "Tanggal",
      "Jam",
      "Customer",
      "Telepon",
      "Jumlah Tamu",
      "Cabang",
      "Meja",
      "Sumber",
      "Status",
      "Status Pembayaran",
      "Revenue",
      "Dibuat",
    ];

    const csv = buildCsv(
      header,
      rows.map((r) => [
        r.code,
        r.date,
        r.time,
        r.customer || r.guestName,
        r.phone || "",
        r.partySize,
        r.branch || "",
        r.table || "",
        r.source,
        r.status,
        r.paymentStatus || "",
        r.revenue,
        r.createdAt.toISOString(),
      ])
    );

    const fileName = `reservation-report-${period}-${new Date()
      .toISOString()
      .slice(0, 10)}.csv`;

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error exporting reservation report:", error);
    return errorResponse(
      "Failed to export reservation report",
      "INTERNAL_ERROR",
      500
    );
  }
}
