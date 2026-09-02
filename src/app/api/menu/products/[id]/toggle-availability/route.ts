import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id } = await params;
    const product = await menuService.toggleProductAvailability(id, restaurantId);

    return successResponse(product, "Product availability toggled");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error toggling product availability:", error);
    return errorResponse(
      "Failed to toggle product availability",
      "INTERNAL_ERROR",
      500
    );
  }
}
