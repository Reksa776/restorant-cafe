import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, requireAdmin } from "@/lib/auth-helpers";
import { recipeService } from "@/services/recipe/recipe.service";
import { SaveRecipeSchema } from "@/services/recipe/recipe.types";

/**
 * GET /api/admin/menu/products/[productId]/recipe
 * Recipe composition for a product. ADMIN + CASHIER. Restaurant-scoped.
 * Returns null when the product has no active recipe.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const ctx = await requireRoles(["ADMIN", "CASHIER"]);
    const { productId } = await params;
    const recipe = await recipeService.getRecipe(productId, ctx.restaurantId);
    return successResponse(recipe);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching recipe:", error);
    return errorResponse("Failed to fetch recipe", "INTERNAL_ERROR", 500);
  }
}

/**
 * PUT /api/admin/menu/products/[productId]/recipe
 * Full replace of the recipe composition (or create when none exists).
 * ADMIN only. Restaurant-scoped.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { productId } = await params;
    const body = await request.json();
    const parsed = SaveRecipeSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const recipe = await recipeService.saveRecipe(
      productId,
      ctx.restaurantId,
      parsed.data
    );
    return successResponse(recipe, "Komposisi berhasil disimpan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error saving recipe:", error);
    return errorResponse("Failed to save recipe", "INTERNAL_ERROR", 500);
  }
}

/**
 * DELETE /api/admin/menu/products/[productId]/recipe
 * Soft delete (isActive = false) of the recipe. ADMIN only.
 * Restaurant-scoped. Ingredients are never touched.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { productId } = await params;
    await recipeService.deleteRecipe(productId, ctx.restaurantId);
    return successResponse(null, "Komposisi berhasil dihapus");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deleting recipe:", error);
    return errorResponse("Failed to delete recipe", "INTERNAL_ERROR", 500);
  }
}