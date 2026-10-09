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
import { exportCashbook } from "@/services/accounting/cashbook.service";

// ============================================================
// GET /api/admin/accounting/cashbook/export
//   (same filters as the list)
//
// Cashbook CSV download (ADMIN only). Uses the SAME filters + scope as the
// list endpoint, so the export can never contain rows the page would hide.
// UTF-8 BOM + CRLF + RFC 4180 escaping via the shared CSV helper
// (formula-injection guarded). Never exports `rawData`/gateway payloads.
// ============================================================

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

    const { items, truncated } = await exportCashbook(
      ctx.restaurantId,
      {
        branchId: requestedBranch,
        type: params.get("type") || undefined,
        method: params.get("method") || undefined,
        dateFrom: params.get("dateFrom") ?? undefined,
        dateTo: params.get("dateTo") ?? undefined,
        search: params.get("search") ?? undefined,
      },
      authorizedBranches(ctx)
    );

    // "Basis Tanggal" records the ACTUAL source of each row's date so a CSV
    // consumer can tell a verified date from a createdAt fallback:
    //   PAYMENT → paidAt · REFUND → approvedAt · EXPENSE → spentAt
    //   any source whose own date is null → createdAt (fallback, unverified)
    const dateBasis = (e: (typeof items)[number]) =>
      e.dateFallback
        ? "createdAt (fallback)"
        : e.source === "REFUND"
          ? "approvedAt"
          : e.source === "EXPENSE"
            ? "spentAt"
            : "paidAt";

    const header = [
      "Tanggal",
      "Basis Tanggal",
      "Sumber",
      "Tipe",
      "Metode",
      "Status",
      "Kode Cabang",
      "Cabang",
      "No. Order",
      "Shift",
      "Atribusi Shift",
      "Kategori",
      "Nominal",
      "Arah (+/-)",
    ];

    const rows = items.map((e) => [
      e.date.slice(0, 10),
      dateBasis(e),
      e.source,
      e.type,
      e.methodLabel,
      e.status ?? "",
      e.branchCode ?? "",
      e.branchName ?? "",
      e.orderNumber ?? "",
      e.shiftNumber ?? "",
      e.shiftAttributed ? "teratribusi" : "tidak teratribusi",
      e.categoryName ?? "",
      e.amount,
      e.signedAmount,
    ]);

    const fileName = `cashbook-${new Date().toISOString().slice(0, 10)}.csv`;

    return new NextResponse(buildCsv(header, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        ...(truncated ? { "X-Cashbook-Truncated": "true" } : {}),
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error exporting cashbook:", error);
    return errorResponse("Failed to export cashbook", "INTERNAL_ERROR", 500);
  }
}
