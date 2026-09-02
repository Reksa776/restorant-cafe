import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id } = await params;
    const groups = await menuService.getOptionGroups(id, restaurantId);
    return successResponse(groups);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching option groups:", error);
    return errorResponse("Failed to fetch option groups", "INTERNAL_ERROR", 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id } = await params;
    const body = await request.json();

    if (!body.name) {
      throw new ValidationError("Group name is required");
    }

    const group = await menuService.createOptionGroup(id, restaurantId, body);
    return createdResponse(group, "Option group created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating option group:", error);
    return errorResponse("Failed to create option group", "INTERNAL_ERROR", 500);
  }
}
