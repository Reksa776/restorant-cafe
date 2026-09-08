import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { branchService } from "@/services/branch/branch.service";

type Params = { params: Promise<{ userId: string }> };

/**
 * GET /api/users/[userId]/branches
 * ADMIN-only. Returns the target user's assigned branch IDs.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin();
    const { userId } = await params;
    const branchIds = await branchService.getUserBranchIds(
      userId,
      ctx.restaurantId
    );
    return successResponse({ branchIds });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching user branches:", error);
    return errorResponse("Failed to fetch user branches", "INTERNAL_ERROR", 500);
  }
}

/**
 * PUT /api/users/[userId]/branches
 * ADMIN-only. Replaces the target user's branch assignments with the
 * provided list (user cannot assign branches to themselves).
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin();
    const { userId } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || !Array.isArray(body.branchIds)) {
      return errorResponse("branchIds wajib array", "VALIDATION_ERROR", 400);
    }

    const branchIds = body.branchIds.filter(
      (id): id is string => typeof id === "string"
    );

    const result = await branchService.setUserBranches(
      ctx.restaurantId,
      ctx.userId,
      userId,
      branchIds
    );

    return successResponse(result, "Akses cabang user diperbarui");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error setting user branches:", error);
    return errorResponse("Failed to set user branches", "INTERNAL_ERROR", 500);
  }
}