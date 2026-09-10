import { NextRequest, NextResponse } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_STOCK_MOVEMENT_TYPES,
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
// GET /api/reports/inventory/export
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&productId=<id>&categoryId=<id>&type=IN|OUT|ADJUSTMENT
//
// Inventory movement CSV download — ADMIN or CASHIER (read-only report,
// matches the inventory report GET semantics). Uses the SAME filters as the
// UI. UTF-8 BOM + CRLF + RFC 4180 escaping via the shared CSV helper
// (formula-injection guarded). Bounded to the 5000 most recent movements in
// range, chronological. Never exports payment secrets.
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
        pagination: { page: 1, limit: 5000 },
      }
    );

    const typeLabel: Record<string, string> = {
      IN: "Masuk",
      OUT: "Keluar",
      ADJUSTMENT: "Penyesuaian",
    };

    const header = [
      "Tanggal",
      "Cabang",
      "Produk",
      "Jenis",
      "Jumlah",
      "Saldo Akhir",
      "Referensi",
      "Alasan",
      "Oleh",
    ];

    // Chronological export (the report returns newest-first).
    const rows = [...report.items]
      .reverse()
      .map((m) => [
        m.date,
        m.branchName ?? m.branchCode ?? "",
        m.productName ?? m.productId,
        typeLabel[m.type] ?? m.type,
        m.quantity,
        m.balanceAfter,
        m.refType ? `${m.refType}${m.refId ? ` ${m.refId.slice(-8).toUpperCase()}` : ""}` : "",
        m.reason ?? "",
        m.userName ?? "",
      ]);

    const fileName = `inventory-report-${period}-${new Date()
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
    console.error("Error exporting inventory report:", error);
    return errorResponse("Failed to export inventory report", "INTERNAL_ERROR", 500);
  }
}