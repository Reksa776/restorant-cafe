import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, verifyAdminPassword } from "@/lib/auth-helpers";
import { approvalService } from "@/services/approval/approval.service";

/**
 * POST /api/cancellations/[requestId]/decide
 *
 * ADMIN approves or rejects a pending order-cancellation request. Sensitive
 * action → admin password re-confirmation required ({ password, approve,
 * decisionNote? }). Approval cancels the order, frees the table, and voids
 * live payment intents.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> }
) {
  try {
    const { userId, restaurantId } = await requireAdmin();
    const { requestId } = await params;
    const body = await request.json();

    if (typeof body.approve !== "boolean") {
      throw new ValidationError("approve wajib boolean");
    }
    await verifyAdminPassword(userId, restaurantId, body.password);

    const result = await approvalService.decideCancellation({
      restaurantId,
      adminId: userId,
      requestId,
      approve: body.approve,
      decisionNote:
        typeof body.decisionNote === "string" ? body.decisionNote : undefined,
    });

    return successResponse(
      result,
      body.approve ? "Pembatalan disetujui" : "Pembatalan ditolak"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deciding cancellation:", error);
    return errorResponse("Gagal memproses pembatalan", "INTERNAL_ERROR", 500);
  }
}
