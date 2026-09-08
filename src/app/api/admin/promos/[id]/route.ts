import { NextRequest } from "next/server";
import { promoService } from "@/services/promo/promo.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

// ============================================================
// PATCH /api/admin/promos/[id] — toggle active (ADMIN, tenant-scoped,
// branch-filtered via the x-branch-id header).
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.isActive !== "boolean") {
      throw new ValidationError("isActive wajib diisi");
    }

    const promo = await promoService.setPromoActive(
      ctx.restaurantId,
      id,
      body.isActive,
      authorizedBranches(ctx)
    );

    return successResponse(
      { id: promo.id, isActive: promo.isActive },
      body.isActive ? "Promo diaktifkan" : "Promo dinonaktifkan"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating promo:", error);
    return errorResponse("Failed to update promo", "INTERNAL_ERROR", 500);
  }
}