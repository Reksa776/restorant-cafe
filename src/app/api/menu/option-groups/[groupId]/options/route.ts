import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { groupId } = await params;
    const options = await menuService.getOptions(groupId, restaurantId);
    return successResponse(options);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching options:", error);
    return errorResponse("Failed to fetch options", "INTERNAL_ERROR", 500);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { groupId } = await params;
    const body = await request.json();

    if (!body.name) {
      throw new ValidationError("Option name is required");
    }

    const option = await menuService.createOption(groupId, restaurantId, body);
    return createdResponse(option, "Option created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating option:", error);
    return errorResponse("Failed to create option", "INTERNAL_ERROR", 500);
  }
}
