import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id, groupId } = await params;
    const body = await request.json();
    const group = await menuService.updateOptionGroup(groupId, id, restaurantId, body);
    return successResponse(group, "Option group updated successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating option group:", error);
    return errorResponse("Failed to update option group", "INTERNAL_ERROR", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; groupId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id, groupId } = await params;
    await menuService.deleteOptionGroup(groupId, id, restaurantId);
    return successResponse(null, "Option group deleted successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deleting option group:", error);
    return errorResponse("Failed to delete option group", "INTERNAL_ERROR", 500);
  }
}
