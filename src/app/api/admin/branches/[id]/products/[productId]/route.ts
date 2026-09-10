import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";
import { branchService } from "@/services/branch/branch.service";

type Params = { params: Promise<{ id: string; productId: string }> };

/**
 * PUT /api/admin/branches/[id]/products/[productId]
 * Mutates per-branch product availability, optional price override, and
 * inventory stock.
 *
 * Stock changes (D3): ADMIN only, and MUST carry a `reason` — the write goes
 * through the StockMovement ADJUSTMENT ledger (consolidated in Phase C). KASIR
 * is read-only for inventory; availability/price tweaks remain available to
 * both roles. A branch-scoped user may only modify their own branches.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const branchId = branchHintFrom(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const { id, productId } = await params;
    const changingStock = typeof body.stock === "number";

    // Stock mutation = inventory adjustment → ADMIN only. Anything else
    // (availability/price) keeps the legacy ADMIN + KASIR permission.
    const ctx = changingStock
      ? await requireRoles(["ADMIN"], branchId)
      : await requireRoles(["ADMIN", "CASHIER"], branchId);

    const bp = await branchService.updateBranchProduct(
      ctx.restaurantId,
      id,
      productId,
      ctx.userId,
      {
        isAvailable:
          typeof body.isAvailable === "boolean" ? body.isAvailable : undefined,
        priceOverride:
          body.priceOverride === null ||
          typeof body.priceOverride === "number"
            ? (body.priceOverride as number | null)
            : undefined,
        stock: changingStock ? (body.stock as number) : undefined,
        reason: changingStock
          ? (typeof body.reason === "string" ? body.reason : "")
          : undefined,
      },
      authorizedBranches(ctx)
    );

    return successResponse(
      {
        productId,
        isAvailable: bp.isAvailable,
        priceOverride: bp.priceOverride ? Number(bp.priceOverride) : null,
        stock: bp.stock,
      },
      "Ketersediaan produk cabang diperbarui"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating branch product:", error);
    return errorResponse("Failed to update branch product", "INTERNAL_ERROR", 500);
  }
}