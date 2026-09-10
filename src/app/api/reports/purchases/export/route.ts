import { NextRequest, NextResponse } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_PURCHASE_STATUSES,
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
// GET /api/reports/purchases/export
//   ?period=...&startDate=...&endDate=...
//   &branchId=<id>&supplierId=<id>&status=DRAFT|RECEIVED|CANCELLED
//
// Purchase report CSV download — ADMIN or CASHIER (read-only report, matches
// the purchase report GET semantics). Uses the SAME filters as the UI. UTF-8
// BOM + CRLF + RFC 4180 escaping via the shared CSV helper (formula-injection
// guarded). Bounded to the 5000 most recent purchases in range. Never exports
// payment secrets. The CSV only reports purchase value/quantity/status —
// never COGS/profit.
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
    const status = REPORT_PURCHASE_STATUSES.includes(statusRaw as never)
      ? (statusRaw as "DRAFT" | "RECEIVED" | "CANCELLED")
      : null;
    const supplierId = searchParams.get("supplierId") || null;

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getPurchaseReport(
      ctx.restaurantId,
      period,
      {
        startDate,
        endDate,
        branchFilters,
        filters: {
          branchId: branchIdParam ?? null,
          supplierId,
          status,
        },
        pagination: { page: 1, limit: 5000 },
      }
    );

    const header = [
      "Tanggal",
      "Kode Cabang",
      "Cabang",
      "Supplier",
      "Status",
      "Jumlah Item",
      "Total Qty",
      "Total Nilai",
      "Dibuat Oleh",
      "Diterima",
    ];

    const statusLabel: Record<string, string> = {
      DRAFT: "Draft",
      RECEIVED: "Diterima",
      CANCELLED: "Dibatalkan",
    };

    const rows = report.items.map((p) => [
      p.date,
      p.branchCode ?? "",
      p.branchName ?? "",
      p.supplierName ?? "",
      statusLabel[p.status] ?? p.status,
      p.itemCount,
      p.totalQuantity,
      p.total,
      p.createdBy ?? "",
      p.receivedAt ?? "",
    ]);

    const fileName = `purchase-report-${period}-${new Date()
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
    console.error("Error exporting purchase report:", error);
    return errorResponse("Failed to export purchase report", "INTERNAL_ERROR", 500);
  }
}