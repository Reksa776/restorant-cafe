import { NextRequest, NextResponse } from "next/server";
import {
  REPORT_PERIODS,
  type ReportPeriod,
} from "@/services/report/report.service";
import { menuEngineeringService } from "@/services/menu-engineering/menu-engineering.service";
import { buildCsv } from "@/lib/csv";
import { errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom } from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/menu-engineering/export
//
// Menu Engineering CSV (same aggregation + revenue semantics as
// GET /api/reports/menu-engineering). ADMIN-only, restaurant + branch
// scoped. Uses the shared src/lib/csv.ts helper (BOM + RFC 4180 +
// formula-injection guard).
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const ctx = await requireRoles(
      ["ADMIN"],
      searchParams.get("branch") || branchHintFrom(request) || undefined
    );

    const periodRaw = searchParams.get("period") || "today";
    const period = REPORT_PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const branchId = searchParams.get("branch") || null;
    const categoryId = searchParams.get("category") || null;
    const search = searchParams.get("q") || null;

    const report = await menuEngineeringService.getMenuEngineeringReport(
      {
        period,
        startDate,
        endDate,
        branchId,
        categoryId,
        search,
        page: 1,
        limit: 500,
        exportAll: true,
      },
      ctx
    );

    const branchLabel =
      report.branches.length === 1
        ? report.branches[0].branchName
        : "Semua Cabang";

    const header = [
      "Product",
      "Category",
      "Qty Sold",
      "Orders",
      "Gross Sales",
      "Discount",
      "Net Sales",
      "Historical COGS",
      "Gross Profit",
      "Historical Margin",
      "Food Cost",
      "Current HPP",
      "Current Selling Price",
      "Current Margin",
      "Cost Status",
      "Coverage",
      "Classification",
      "Insight",
    ];

    const rows = report.products.map((p) => [
      p.productName,
      p.categoryName ?? "",
      p.qtySold,
      p.orderCount,
      p.grossSales,
      p.discount,
      p.netSales,
      p.historicalCogs,
      p.grossProfit ?? "",
      p.grossMarginPct ?? "",
      p.foodCostPct ?? "",
      p.currentHpp ?? "",
      p.currentSellingPrice ?? "",
      p.currentMarginPct ?? "",
      p.costStatus ?? "",
      `${p.costedItems}/${p.uncostedItems}/${p.legacyItems}`,
      p.classification,
      p.insight,
    ]);

    const fileName = `menu-engineering-${period}-${new Date()
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
    console.error("Error exporting menu engineering report:", error);
    return errorResponse(
      "Failed to export menu engineering report",
      "INTERNAL_ERROR",
      500
    );
  }
}