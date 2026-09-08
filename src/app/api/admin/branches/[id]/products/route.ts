import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";
import { branchService } from "@/services/branch/branch.service";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/branches/[id]/products
 * ADMIN or CASHIER. Lists the restaurant's active products with their
 * availability, price override, and inventory stock for the given branch.
 * A branch-scoped user may only view their own branches' products.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;
    const result = await branchService.listBranchProducts(
      ctx.restaurantId,
      id,
      authorizedBranches(ctx)
    );
    return successResponse(result.items);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing branch products:", error);
    return errorResponse("Failed to list branch products", "INTERNAL_ERROR", 500);
  }
}