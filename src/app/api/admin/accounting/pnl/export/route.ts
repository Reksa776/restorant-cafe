import { NextRequest, NextResponse } from "next/server";
import { buildCsv } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import { getPnlReport } from "@/services/accounting/pnl.service";

// ============================================================
// GET /api/admin/accounting/pnl/export
//   (same filters + scope as the list)
//
// P&L CSV (ADMIN only). Uses the SAME service call as the list, so the export
// can never contain numbers the page would not show. UTF-8 BOM + CRLF +
// RFC 4180 escaping via the shared CSV helper (formula-injection guarded).
// Unknown (null) profit values are exported as an EMPTY cell, never as 0.
// ============================================================

const COGS_STATE_LABEL: Record<string, string> = {
  NO_ITEMS: "NO_ITEMS",
  COVERED: "COVERED",
  PARTIAL: "PARTIAL",
  PENDING_COGS: "PENDING",
  UNCOVERED: "UNCOVERED",
  LEGACY: "LEGACY",
};

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const params = request.nextUrl.searchParams;

    let requestedBranch: string | undefined;
    const branchParam = params.get("branchId");
    if (branchParam) {
      requestedBranch = branchParam;
      await assertBranchInScope(ctx, requestedBranch);
    }

    const report = await getPnlReport(
      ctx.restaurantId,
      {
        period: params.get("period") || undefined,
        startDate: params.get("startDate") ?? undefined,
        endDate: params.get("endDate") ?? undefined,
        branchId: requestedBranch,
        orderType: params.get("orderType") || undefined,
        paymentMethod: params.get("paymentMethod") || undefined,
      },
      authorizedBranches(ctx)
    );

    const branchLabel = report.filters.branchId
      ? report.filters.branchId
      : "Semua Cabang";

    const header = [
      "Periode",
      "Dari",
      "Sampai",
      "Cabang",
      "Gross Sales",
      "Diskon",
      "Pajak",
      "Service Charge",
      "Refund",
      "Net Sales",
      "COGS (ditahan)",
      "COGS Historis",
      "COGS Dibalik (Refund)",
      "Gross Profit",
      "Operating Expenses",
      "Net Profit",
      "Jumlah Expense",
      "COGS Status",
      "Coverage Lengkap",
      "Order Revenue Tanpa Item",
      "Nilai Header Tanpa Item",
      "Net Profit Sementara",
    ];

    const rows = [
      [
        report.period,
        report.range.start.slice(0, 10),
        report.range.end.slice(0, 10),
        branchLabel,
        report.summary.grossSales,
        report.summary.totalDiscount,
        report.summary.totalTax,
        report.summary.totalServiceCharge,
        report.summary.totalRefund,
        report.summary.netSales,
        report.summary.cogs,
        report.summary.historicalCogs,
        report.summary.cogsReversal,
        // Unknown profit is an EMPTY cell, never 0.
        report.summary.grossProfit ?? "",
        report.summary.operatingExpenses,
        report.summary.netProfit ?? "",
        report.opex.count,
        COGS_STATE_LABEL[report.cogsState] ?? report.cogsState,
        report.coverageComplete ? "ya" : "tidak",
        report.disclosure.revenueWithoutItems.orders,
        report.disclosure.revenueWithoutItems.headerValue,
        report.disclosure.netProfitProvisional ? "ya" : "tidak",
      ],
    ];

    const fileName = `laba-rugi-${report.period}-${new Date()
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
    console.error("Error exporting P&L report:", error);
    return errorResponse("Failed to export P&L report", "INTERNAL_ERROR", 500);
  }
}
