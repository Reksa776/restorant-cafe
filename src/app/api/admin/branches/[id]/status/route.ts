import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { branchService } from "@/services/branch/branch.service";

type Params = { params: Promise<{ id: string }> };

/**
 * PATCH /api/admin/branches/[id]/status
 * ADMIN-only. Activates or deactivates a branch.
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body.isActive !== "boolean") {
      return errorResponse("isActive wajib boolean", "VALIDATION_ERROR", 400);
    }

    const branch = await branchService.setBranchActive(
      id,
      ctx.restaurantId,
      ctx.userId,
      body.isActive
    );

    return successResponse(
      branch,
      body.isActive ? "Cabang diaktifkan" : "Cabang dinonaktifkan"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating branch status:", error);
    return errorResponse("Failed to update branch status", "INTERNAL_ERROR", 500);
  }
}