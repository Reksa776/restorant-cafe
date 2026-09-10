import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";
import {
  getPurchase,
  updateDraftPurchase,
  type PurchaseItemInput,
} from "@/services/purchase/purchase.service";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/purchases/[id] — ADMIN + KASIR (read-only, D3),
 * branch-scoped.
 * PATCH /api/admin/purchases/[id] — ADMIN only, DRAFT purchases only (STEP 4).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;

    const purchase = await getPurchase(
      ctx.restaurantId,
      id,
      authorizedBranches(ctx)
    );
    return successResponse(purchase, "Detail pembelian");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error getting purchase:", error);
    return errorResponse("Failed to get purchase", "INTERNAL_ERROR", 500);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const hasEditableField =
      body.supplierId !== undefined ||
      body.notes !== undefined ||
      body.items !== undefined;
    if (!hasEditableField) {
      return errorResponse("Tidak ada perubahan yang dikirim", "VALIDATION_ERROR", 400);
    }

    await updateDraftPurchase(ctx.restaurantId, id, authorizedBranches(ctx), {
      supplierId: typeof body.supplierId === "string" ? body.supplierId : undefined,
      notes: body.notes === null ? null : (typeof body.notes === "string" ? body.notes : undefined),
      items: Array.isArray(body.items)
        ? (body.items as unknown as PurchaseItemInput[])
        : undefined,
    });

    const updated = await getPurchase(ctx.restaurantId, id, authorizedBranches(ctx));
    return successResponse(updated, "Pembelian draft diperbarui");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating purchase:", error);
    return errorResponse("Failed to update purchase", "INTERNAL_ERROR", 500);
  }
}