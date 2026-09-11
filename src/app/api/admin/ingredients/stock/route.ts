import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches, assertBranchInScope } from "@/lib/auth-helpers";
import { listIngredientStock, listIngredientStockMovements } from "@/services/ingredient/ingredient-stock.service";

/**
 * GET /api/admin/ingredients/stock — list ingredient stock (ADMIN + CASHIER).
 * Branch-scoped via authorizedBranches.
 *
 * Query params:
 *   branchId  — optional branch filter (validated against authorizedBranches)
 *   view      — "stock" (default) or "movements"
 *   ingredientId — filter movements by ingredient
 *   type      — filter movements by type (IN/OUT/ADJUSTMENT)
 *   limit     — movement limit (default 100)
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const params = request.nextUrl.searchParams;

    const view = params.get("view") ?? "stock";

    // Validate branch filter if provided
    let requestedBranch: string | undefined;
    const branchParam = params.get("branchId");
    if (branchParam) {
      requestedBranch = branchParam;
      await assertBranchInScope(ctx, requestedBranch);
    }

    if (view === "movements") {
      const movements = await listIngredientStockMovements(
        ctx.restaurantId,
        authorizedBranches(ctx),
        {
          branchId: requestedBranch ?? null,
          ingredientId: params.get("ingredientId") ?? null,
          type: (params.get("type") as "IN" | "OUT" | "ADJUSTMENT") ?? null,
          limit: params.get("limit") ? Number(params.get("limit")) : undefined,
        }
      );
      return successResponse({ items: movements, total: movements.length });
    }

    // Default: stock overview
    const stock = await listIngredientStock(
      ctx.restaurantId,
      authorizedBranches(ctx),
      requestedBranch ?? null
    );
    return successResponse({ items: stock, total: stock.length });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing ingredient stock:", error);
    return errorResponse("Failed to list ingredient stock", "INTERNAL_ERROR", 500);
  }
}
