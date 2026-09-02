import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; optionId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { groupId, optionId } = await params;
    const body = await request.json();
    const option = await menuService.updateOption(optionId, groupId, restaurantId, body);
    return successResponse(option, "Option updated successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating option:", error);
    return errorResponse("Failed to update option", "INTERNAL_ERROR", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; optionId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { groupId, optionId } = await params;
    await menuService.deleteOption(optionId, groupId, restaurantId);
    return successResponse(null, "Option deleted successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deleting option:", error);
    return errorResponse("Failed to delete option", "INTERNAL_ERROR", 500);
  }
}
