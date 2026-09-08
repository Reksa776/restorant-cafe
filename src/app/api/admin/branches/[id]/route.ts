import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin, branchHintFrom, assertBranchInScope } from "@/lib/auth-helpers";
import { branchService } from "@/services/branch/branch.service";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/branches/[id]
 * ADMIN-only. Returns a single branch. A branch-scoped admin may only read
 * their own assigned branches (assertBranchInScope).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin(branchHintFrom(request));
    const { id } = await params;
    await assertBranchInScope(ctx, id);
    const branch = await branchService.getBranch(id, ctx.restaurantId);
    return successResponse(branch);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching branch:", error);
    return errorResponse("Failed to fetch branch", "INTERNAL_ERROR", 500);
  }
}

/**
 * PUT /api/admin/branches/[id]
 * ADMIN-only. Updates branch name/address/phone and optionally the code.
 * A branch-scoped admin may only update their own assigned branches.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin(branchHintFrom(request));
    const { id } = await params;
    await assertBranchInScope(ctx, id);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    let branch = await branchService.getBranch(id, ctx.restaurantId);

    if (typeof body.code === "string" && body.code.trim() !== branch.code) {
      branch = await branchService.updateBranchCode(
        id,
        ctx.restaurantId,
        ctx.userId,
        body.code
      );
    }

    branch = await branchService.updateBranch(id, ctx.restaurantId, ctx.userId, {
      name: typeof body.name === "string" ? body.name : undefined,
      address: typeof body.address === "string" ? body.address : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
    });

    return successResponse(branch, "Cabang berhasil diperbarui");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating branch:", error);
    return errorResponse("Failed to update branch", "INTERNAL_ERROR", 500);
  }
}