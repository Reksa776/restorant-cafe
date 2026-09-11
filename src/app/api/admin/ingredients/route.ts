import { NextRequest } from "next/server";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { ingredientService } from "@/services/ingredient/ingredient.service";
import { CreateIngredientSchema, GetIngredientsSchema } from "@/services/ingredient/ingredient.types";

/**
 * GET /api/admin/ingredients — list ingredients (ADMIN + CASHIER), restaurant-scoped.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRoles(["ADMIN", "CASHIER"]);
    const params = Object.fromEntries(request.nextUrl.searchParams);
    const input = GetIngredientsSchema.parse(params);
    const result = await ingredientService.listIngredients(input, ctx.restaurantId);
    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing ingredients:", error);
    return errorResponse("Failed to list ingredients", "INTERNAL_ERROR", 500);
  }
}

/**
 * POST /api/admin/ingredients — create ingredient (ADMIN only).
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireRoles(["ADMIN"]);
    const body = await request.json();
    const parsed = CreateIngredientSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const ingredient = await ingredientService.createIngredient(parsed.data, ctx.restaurantId);
    return createdResponse(ingredient, "Bahan baku berhasil dibuat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating ingredient:", error);
    return errorResponse("Failed to create ingredient", "INTERNAL_ERROR", 500);
  }
}
