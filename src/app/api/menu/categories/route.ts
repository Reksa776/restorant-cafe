import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET() {
  try {
    const { restaurantId } = await requireAdmin();
    const categories = await menuService.getCategories(restaurantId);

    return successResponse(categories);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching categories:", error);
    return errorResponse("Failed to fetch categories", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const body = await request.json();

    if (!body.name) {
      throw new ValidationError("Category name is required");
    }

    const category = await menuService.createCategory(restaurantId, body);

    return createdResponse(category, "Category created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating category:", error);
    return errorResponse("Failed to create category", "INTERNAL_ERROR", 500);
  }
}
