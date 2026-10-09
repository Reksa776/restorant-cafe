import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import { getPnlReport } from "@/services/accounting/pnl.service";

// ============================================================
// GET /api/admin/accounting/pnl
//   ?period=today|yesterday|week|month|custom&startDate=&endDate=
//    &branchId=<id>&orderType=&paymentMethod=
//
// Profit & Loss read-model (ADMIN only — it exposes COGS/HPP and operating
// expenses). `restaurantId` comes from the session — never the query string.
// Branch is resolved server-side: an explicit branchId is validated against
// the user's assignments (assertBranchInScope) and the service still applies
// authorizedBranches. All filters are Zod-validated before any query runs.
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

    return successResponse(report, "Laba rugi");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching P&L report:", error);
    return errorResponse("Failed to fetch P&L report", "INTERNAL_ERROR", 500);
  }
}
