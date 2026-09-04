import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, verifyAdminPassword } from "@/lib/auth-helpers";
import { approvalService } from "@/services/approval/approval.service";

/**
 * POST /api/refunds/[refundId]/decide
 *
 * ADMIN approves or rejects a pending refund. Sensitive financial action →
 * the admin's password is re-confirmed in the body ({ password, approve,
 * decisionNote? }).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ refundId: string }> }
) {
  try {
    const { userId, restaurantId } = await requireAdmin();
    const { refundId } = await params;
    const body = await request.json();

    if (typeof body.approve !== "boolean") {
      throw new ValidationError("approve wajib boolean");
    }
    await verifyAdminPassword(userId, restaurantId, body.password);

    const result = await approvalService.decideRefund({
      restaurantId,
      adminId: userId,
      refundId,
      approve: body.approve,
      decisionNote:
        typeof body.decisionNote === "string" ? body.decisionNote : undefined,
    });

    return successResponse(
      result,
      body.approve ? "Refund disetujui" : "Refund ditolak"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deciding refund:", error);
    return errorResponse("Gagal memproses refund", "INTERNAL_ERROR", 500);
  }
}
