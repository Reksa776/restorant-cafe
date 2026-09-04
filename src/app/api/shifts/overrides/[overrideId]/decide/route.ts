import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, verifyAdminPassword } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * POST /api/shifts/overrides/[overrideId]/decide
 *
 * ADMIN approves or rejects a pending shift-override request. Sensitive
 * financial override → the admin's password must be re-confirmed in the body
 * ({ password, approve, decisionNote? }) even though the session is already
 * an authenticated ADMIN.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ overrideId: string }> }
) {
  try {
    const { userId, restaurantId } = await requireAdmin();
    const { overrideId } = await params;
    const body = await request.json();

    if (typeof body.approve !== "boolean") {
      throw new ValidationError("approve wajib boolean");
    }

    // Admin password re-confirmation for the sensitive action.
    await verifyAdminPassword(userId, restaurantId, body.password);

    const result = await shiftService.decideOverride({
      restaurantId,
      adminId: userId,
      overrideId,
      approve: body.approve,
      decisionNote:
        typeof body.decisionNote === "string" ? body.decisionNote : undefined,
    });

    return successResponse(
      result,
      body.approve ? "Override disetujui" : "Override ditolak"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deciding shift override:", error);
    return errorResponse("Gagal memproses override", "INTERNAL_ERROR", 500);
  }
}
