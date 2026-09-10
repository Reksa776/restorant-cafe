import { NextRequest } from "next/server";
import { createdResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";
import { cancelPurchase } from "@/services/purchase/purchase.service";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/purchases/[id]/cancel — ADMIN only (D3).
 * DRAFT → CANCELLED. Terminal; never applies stock.
 */
export async function POST(request: NextRequest, { params }: Params) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const { id } = await params;

    const result = await cancelPurchase(
      ctx.restaurantId,
      id,
      authorizedBranches(ctx)
    );

    return createdResponse(result, "Pembelian dibatalkan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error cancelling purchase:", error);
    return errorResponse("Failed to cancel purchase", "INTERNAL_ERROR", 500);
  }
}