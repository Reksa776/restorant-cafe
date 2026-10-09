import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import { getIntegrityReport } from "@/services/accounting/integrity.service";

// ============================================================
// GET /api/admin/accounting/integrity
//   ?branchId=<id>&sampleLimit=<1..50>
//
// ADMIN-only, READ-ONLY integrity monitor over Order → OrderItem →
// OrderItemCostSnapshot. It writes nothing and repairs nothing.
//
// `restaurantId` comes from the session — never the query string. Branch is
// resolved server-side: an explicit branchId is validated against the user's
// assignments (assertBranchInScope) and the service still applies
// authorizedBranches. All params are Zod-validated in the service before any
// query runs.
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

    const report = await getIntegrityReport(
      ctx.restaurantId,
      {
        branchId: requestedBranch,
        sampleLimit: params.get("sampleLimit") ?? undefined,
      },
      authorizedBranches(ctx)
    );

    return successResponse(report, "Pemeriksaan integritas");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error checking accounting integrity:", error);
    return errorResponse("Failed to check accounting integrity", "INTERNAL_ERROR", 500);
  }
}
