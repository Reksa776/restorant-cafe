import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import { getCashbook } from "@/services/accounting/cashbook.service";

// ============================================================
// GET /api/admin/accounting/cashbook
//   ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&type=IN|OUT&method=...&
//    branchId=<id>&search=<text>&page=1&limit=50
//
// Read-only cash movement projection (Payment collected + Refund APPROVED +
// Expense). ADMIN only. `restaurantId` comes from the session — never the
// query string. Branch is resolved server-side: an explicit branchId is
// validated against the user's assignments (assertBranchInScope) and the
// service still applies authorizedBranches. All filters are Zod-validated
// before any query runs.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const params = request.nextUrl.searchParams;

    // A client-supplied branch filter must be authorized, never trusted.
    let requestedBranch: string | undefined;
    const branchParam = params.get("branchId");
    if (branchParam) {
      requestedBranch = branchParam;
      await assertBranchInScope(ctx, requestedBranch);
    }

    const result = await getCashbook(
      ctx.restaurantId,
      {
        page: params.get("page") ?? undefined,
        limit: params.get("limit") ?? undefined,
        branchId: requestedBranch,
        type: params.get("type") || undefined,
        method: params.get("method") || undefined,
        dateFrom: params.get("dateFrom") ?? undefined,
        dateTo: params.get("dateTo") ?? undefined,
        search: params.get("search") ?? undefined,
      },
      authorizedBranches(ctx)
    );

    return successResponse(result, "Buku kas");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching cashbook:", error);
    return errorResponse("Failed to fetch cashbook", "INTERNAL_ERROR", 500);
  }
}
