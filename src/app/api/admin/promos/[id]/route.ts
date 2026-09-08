import { NextRequest } from "next/server";
import { promoService } from "@/services/promo/promo.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

// ============================================================
// PATCH /api/admin/promos/[id] — toggle active (ADMIN, tenant-scoped).
// ============================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body.isActive !== "boolean") {
      throw new ValidationError("isActive wajib diisi");
    }

    const promo = await promoService.setPromoActive(
      restaurantId,
      id,
      body.isActive
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