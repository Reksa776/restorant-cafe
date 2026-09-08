import { NextRequest, NextResponse } from "next/server";
import { reportService, type ReportPeriod } from "@/services/report/report.service";
import { errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/sales/export
//   ?period=...&startDate=...&endDate=...
//
// ADMIN only, restaurant-scoped. Returns an order-level CSV download
// (non-cancelled orders in the period). Never includes payment secrets.
// ============================================================

const PERIODS: ReportPeriod[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "custom",
];

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  // Quote when the value contains a comma, quote, or newline.
  if (/[",\n\r]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();

    const { searchParams } = new URL(request.url);
    const periodRaw = searchParams.get("period") || "today";
    const period = PERIODS.includes(periodRaw as ReportPeriod)
      ? (periodRaw as ReportPeriod)
      : "today";
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const orders = await reportService.getSalesOrdersForExport(
      restaurantId,
      period,
      startDate,
      endDate
    );

    const header = [
      "Order Number",
      "Tanggal",
      "Tipe",
      "Customer",
      "Subtotal",
      "Diskon",
      "Pajak",
      "Service Charge",
      "Total",
      "Status Order",
      "Status Pembayaran",
      "Metode",
      "Dibayar",
    ];

    const rows = orders.map((o) => {
      const pay = o.payments[0];
      const method =
        pay?.method === "KASIR"
          ? "Kasir"
          : pay?.method === "QRIS"
            ? "QRIS"
            : pay?.provider === "ipaymu" && !pay?.method
              ? "VA iPaymu"
              : pay?.method || "";
      return [
        o.orderNumber,
        o.createdAt.toISOString(),
        o.orderType,
        o.customer?.name || "",
        Number(o.subtotal),
        Number(o.discount),
        Number(o.tax),
        Number(o.serviceCharge),
        Number(o.grandTotal),
        o.status,
        o.paymentStatus,
        method,
        pay?.paidAt ? pay.paidAt.toISOString() : "",
      ];
    });

    const csv = [header, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n");

    const fileName = `sales-report-${period}-${new Date()
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
    console.error("Error exporting sales report:", error);
    return errorResponse("Failed to export sales report", "INTERNAL_ERROR", 500);
  }
}