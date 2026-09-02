import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id, addonId } = await params;
    const body = await request.json();
    const addon = await menuService.updateAddon(addonId, id, restaurantId, body);
    return successResponse(addon, "Addon updated successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating addon:", error);
    return errorResponse("Failed to update addon", "INTERNAL_ERROR", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id, addonId } = await params;
    await menuService.deleteAddon(addonId, id, restaurantId);
    return successResponse(null, "Addon deleted successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deleting addon:", error);
    return errorResponse("Failed to delete addon", "INTERNAL_ERROR", 500);
  }
}
