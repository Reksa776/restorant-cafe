import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * POST /api/shifts/[shiftId]/override
 *
 * Cashier requests an admin override for a CLOSED shift (e.g. wrong cash
 * count). Body: { reason, proposedClosingCash? }. The shift stays immutable
 * until an admin approves with their password.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const { restaurantId, userId } = await requireRoles(["ADMIN", "CASHIER"]);
    const { shiftId } = await params;
    const body = await request.json();

    if (!body.reason || typeof body.reason !== "string") {
      throw new ValidationError("Alasan override wajib diisi");
    }

    const override = await shiftService.requestOverride({
      restaurantId,
      userId,
      shiftId,
      reason: body.reason,
      proposedClosingCash:
        body.proposedClosingCash !== undefined &&
        body.proposedClosingCash !== null &&
        body.proposedClosingCash !== ""
          ? Number(body.proposedClosingCash)
          : undefined,
    });

    return successResponse(override, "Permintaan override dikirim ke admin");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error requesting shift override:", error);
    return errorResponse("Gagal mengirim permintaan override", "INTERNAL_ERROR", 500);
  }
}
