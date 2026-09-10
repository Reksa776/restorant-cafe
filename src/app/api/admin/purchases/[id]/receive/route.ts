import { NextRequest } from "next/server";
import { createdResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";
import { receivePurchase } from "@/services/purchase/purchase.service";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/purchases/[id]/receive — ADMIN only (D3).
 * Atomically flips DRAFT → RECEIVED and applies an IN stock movement per item.
 * Idempotent: a second receive of the same purchase conflicts with no stock.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const { id } = await params;

    const purchase = await receivePurchase(
      ctx.restaurantId,
      id,
      ctx.userId,
      authorizedBranches(ctx)
    );

    return createdResponse(purchase, "Barang berhasil diterima");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error receiving purchase:", error);
    return errorResponse("Failed to receive purchase", "INTERNAL_ERROR", 500);
  }
}