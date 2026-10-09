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
import { exportExpenses } from "@/services/accounting/expense.service";

// ============================================================
// GET /api/admin/accounting/expenses/export
//   ?branchId=&categoryId=&method=&dateFrom=&dateTo=&search=
//
// Expense CSV download (ADMIN only). Uses the SAME filters + scope as the
// list endpoint, so the export can never contain rows the page would hide.
// UTF-8 BOM + CRLF + RFC 4180 escaping via the shared CSV helper
// (formula-injection guarded). Bounded to the 5000 most recent rows in range.
// No credential/secret is exported.
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

    const { items } = await exportExpenses(
      ctx.restaurantId,
      {
        branchId: requestedBranch,
        categoryId: params.get("categoryId") ?? undefined,
        method: params.get("method") || undefined,
        dateFrom: params.get("dateFrom") ?? undefined,
        dateTo: params.get("dateTo") ?? undefined,
        search: params.get("search") ?? undefined,
      },
      authorizedBranches(ctx)
    );

    const header = [
      "Tanggal",
      "Kode Cabang",
      "Cabang",
      "Kategori",
      "Metode",
      "Nominal",
      "Catatan",
      "Dibuat Oleh",
      "Dibuat Pada",
    ];

    const rows = items.map((e) => [
      e.spentAt,
      e.branchCode ?? "",
      e.branchName ?? "",
      e.categoryName ?? "",
      e.methodLabel,
      e.amount,
      e.note ?? "",
      e.createdByName ?? "",
      new Date(e.createdAt).toISOString(),
    ]);

    const fileName = `expense-report-${new Date().toISOString().slice(0, 10)}.csv`;

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
    console.error("Error exporting expenses:", error);
    return errorResponse("Failed to export expenses", "INTERNAL_ERROR", 500);
  }
}
