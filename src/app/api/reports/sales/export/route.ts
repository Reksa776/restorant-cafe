import { NextRequest, NextResponse } from "next/server";
import {
  reportService,
  type ReportPeriod,
  REPORT_PERIODS,
  REPORT_PAYMENT_METHODS,
  REPORT_ORDER_TYPES,
  REPORT_PAYMENT_STATUSES,
  type ReportFilters,
} from "@/services/report/report.service";
import { errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

// ============================================================
// GET /api/reports/sales/export
//   ?period=...&startDate=...&endDate=...
//   &orderType=...&paymentMethod=...&status=...&branchId=...
//
// ADMIN only, restaurant-scoped. Branch-scoped via an explicit branchId
// (validated server-side) or the x-branch-id header. Returns an order-level
// CSV download (non-cancelled orders in the period). Never includes payment
// secrets.
// ============================================================

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

    const orderTypeRaw = searchParams.get("orderType");
    const paymentMethodRaw = searchParams.get("paymentMethod");
    const statusRaw = searchParams.get("status");

    const filters: ReportFilters = {
      orderType: REPORT_ORDER_TYPES.includes(orderTypeRaw as never)
        ? (orderTypeRaw as ReportFilters["orderType"])
        : null,
      paymentMethod: REPORT_PAYMENT_METHODS.includes(paymentMethodRaw as never)
        ? (paymentMethodRaw as ReportFilters["paymentMethod"])
        : null,
      status: REPORT_PAYMENT_STATUSES.includes(statusRaw as never)
        ? (statusRaw as ReportFilters["status"])
        : null,
      branchId: branchIdParam ?? null,
    };

    const branchFilters = branchIdParam
      ? [branchIdParam]
      : authorizedBranches(ctx);

    const orders = await reportService.getSalesOrdersForExport(
      ctx.restaurantId,
      period,
      startDate,
      endDate,
      branchFilters,
      filters
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