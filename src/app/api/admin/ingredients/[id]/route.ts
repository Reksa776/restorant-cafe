import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { ingredientService } from "@/services/ingredient/ingredient.service";
import { UpdateIngredientSchema } from "@/services/ingredient/ingredient.types";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/ingredients/[id] — get ingredient detail (ADMIN + CASHIER).
 */
export async function GET(_request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireRoles(["ADMIN", "CASHIER"]);
    const { id } = await params;
    const ingredient = await ingredientService.getIngredient(id, ctx.restaurantId);
    return successResponse(ingredient);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error getting ingredient:", error);
    return errorResponse("Failed to get ingredient", "INTERNAL_ERROR", 500);
  }
}

/**
 * PUT /api/admin/ingredients/[id] — update ingredient (ADMIN only).
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireRoles(["ADMIN"]);
    const { id } = await params;
    const body = await request.json();
    const parsed = UpdateIngredientSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const ingredient = await ingredientService.updateIngredient(id, parsed.data, ctx.restaurantId);
    return successResponse(ingredient, "Bahan baku berhasil diupdate");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating ingredient:", error);
    return errorResponse("Failed to update ingredient", "INTERNAL_ERROR", 500);
  }
}
