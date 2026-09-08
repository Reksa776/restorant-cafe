import { NextRequest } from "next/server";
import { successResponse, errorResponse, createdResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { branchService } from "@/services/branch/branch.service";

/**
 * GET /api/admin/branches
 * ADMIN-only. Lists the restaurant's branches, honoring the caller's
 * branch authorization (a branch-scoped admin only sees their branches).
 */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    const { items } = await branchService.listBranches(
      ctx.restaurantId,
      ctx.branchScoped ? ctx.branchIds : undefined
    );
    return successResponse(items);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing branches:", error);
    return errorResponse("Failed to list branches", "INTERNAL_ERROR", 500);
  }
}

/**
 * POST /api/admin/branches
 * ADMIN-only. Creates a new branch for the restaurant.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const branch = await branchService.createBranch({
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      code: typeof body.code === "string" ? body.code : "",
      name: typeof body.name === "string" ? body.name : "",
      address: typeof body.address === "string" ? body.address : undefined,
      phone: typeof body.phone === "string" ? body.phone : undefined,
    });

    return createdResponse(branch, "Cabang berhasil dibuat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating branch:", error);
    return errorResponse("Failed to create branch", "INTERNAL_ERROR", 500);
  }
}