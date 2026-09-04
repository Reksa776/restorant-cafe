import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { approvalService } from "@/services/approval/approval.service";

/**
 * GET /api/refunds — pending refund requests (admin review queue).
 */
export async function GET() {
  try {
    const { restaurantId } = await requireRoles(["ADMIN"]);
    const result = await approvalService.listPendingForRestaurant(restaurantId);
    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing approvals:", error);
    return errorResponse("Gagal memuat permintaan", "INTERNAL_ERROR", 500);
  }
}

/**
 * POST /api/refunds — cashier initiates a refund request for an order.
 * Body: { orderId, amount, reason }. Approval requires an ADMIN + password.
 */
export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await requireRoles(["ADMIN", "CASHIER"]);
    const body = await request.json();

    if (!body.orderId || typeof body.orderId !== "string") {
      throw new ValidationError("orderId wajib diisi");
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) {
      throw new ValidationError("Jumlah refund tidak valid");
    }
    if (!body.reason || typeof body.reason !== "string") {
      throw new ValidationError("Alasan refund wajib diisi");
    }

    const refund = await approvalService.requestRefund({
      restaurantId,
      userId,
      orderId: body.orderId,
      amount,
      reason: body.reason,
    });

    return successResponse(refund, "Permintaan refund dikirim ke admin");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error requesting refund:", error);
    return errorResponse("Gagal mengirim permintaan refund", "INTERNAL_ERROR", 500);
  }
}
