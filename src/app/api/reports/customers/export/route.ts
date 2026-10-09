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
// PHASE 9B (C6/PART 10) — GET /api/reports/customers/export
//
// ADMIN only, restaurant + branch + date scoped. Same report semantics as
// GET /api/reports/customers. The customer password hash is NEVER included;
// only the public customer fields and canonical revenue figures are exported.
// Reuses the shared buildCsv helper (UTF-8 BOM + CRLF + formula guard).
// ============================================================

const iso = (v: Date | string | null | undefined) =>
  v ? new Date(v).toISOString() : "";

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
    const search = searchParams.get("search") || undefined;

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const report = await reportService.getCustomerReport(
      ctx.restaurantId,
      period,
      { startDate, endDate, branchFilters, search }
    );

    const header = [
      "Customer",
      "Phone",
      "Email",
      "Orders",
      "Reservations",
      "Items",
      "Gross Sales",
      "Refund",
      "Net Sales",
      "AOV",
      "First Order",
      "Last Order",
    ];

    const rows = report.customers.map((c) => [
      c.name || "",
      c.phone || "",
      c.email || "",
      c.orders,
      c.reservations.total,
      c.items,
      c.grossSales,
      c.refund,
      c.netSales,
      c.aov,
      iso(c.firstOrderAt),
      iso(c.lastOrderAt),
    ]);

    const csv = buildCsv(header, rows);
    const fileName = `customer-report-${period}-${new Date()
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
    console.error("Error exporting customer report:", error);
    return errorResponse(
      "Failed to export customer report",
      "INTERNAL_ERROR",
      500
    );
  }
}
