import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { approvalService } from "@/services/approval/approval.service";

/**
 * GET /api/cancellations — pending cancellation requests (admin review).
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
 * POST /api/cancellations — cashier requests order cancellation.
 * Body: { orderId, reason }. Approval requires an ADMIN + password.
 */
export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await requireRoles(["ADMIN", "CASHIER"]);
    const body = await request.json();

    if (!body.orderId || typeof body.orderId !== "string") {
      throw new ValidationError("orderId wajib diisi");
    }
    if (!body.reason || typeof body.reason !== "string") {
      throw new ValidationError("Alasan pembatalan wajib diisi");
    }

    const request2 = await approvalService.requestCancellation({
      restaurantId,
      userId,
      orderId: body.orderId,
      reason: body.reason,
    });

    return successResponse(request2, "Permintaan pembatalan dikirim ke admin");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error requesting cancellation:", error);
    return errorResponse(
      "Gagal mengirim permintaan pembatalan",
      "INTERNAL_ERROR",
      500
    );
  }
}
