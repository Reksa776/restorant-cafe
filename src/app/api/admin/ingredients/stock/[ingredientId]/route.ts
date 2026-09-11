import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";
import { adjustIngredientStock } from "@/services/ingredient/ingredient-stock.service";
import { AdjustIngredientStockSchema } from "@/services/ingredient/ingredient.types";

type Params = { params: Promise<{ ingredientId: string }> };

/**
 * PUT /api/admin/ingredients/stock/[ingredientId] — adjust ingredient stock (ADMIN only).
 *
 * Body: { branchId, targetStock, reason }
 *
 * Calculates delta from current stock, applies atomic movement with
 * FOR UPDATE row lock, negative stock prevention, and ledger entry.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN"], branchId);
    const { ingredientId } = await params;
    const body = await request.json();

    const parsed = AdjustIngredientStockSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const result = await adjustIngredientStock(
      ctx.restaurantId,
      ingredientId,
      parsed.data.branchId,
      parsed.data.targetStock,
      parsed.data.reason,
      ctx.userId,
      authorizedBranches(ctx)
    );

    return successResponse(result, "Stok bahan baku berhasil disesuaikan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error adjusting ingredient stock:", error);
    return errorResponse("Failed to adjust ingredient stock", "INTERNAL_ERROR", 500);
  }
}
