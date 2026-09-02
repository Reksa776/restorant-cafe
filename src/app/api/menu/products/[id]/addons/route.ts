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
    const addons = await menuService.getAddons(id, restaurantId);
    return successResponse(addons);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching addons:", error);
    return errorResponse("Failed to fetch addons", "INTERNAL_ERROR", 500);
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
      throw new ValidationError("Addon name is required");
    }
    if (body.price === undefined) {
      throw new ValidationError("Addon price is required");
    }

    const addon = await menuService.createAddon(id, restaurantId, body);
    return createdResponse(addon, "Addon created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating addon:", error);
    return errorResponse("Failed to create addon", "INTERNAL_ERROR", 500);
  }
}
