import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { ReservationStatusUpdateSchema } from "@/services/reservation/reservation.types";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

/**
 * PATCH /api/admin/reservations/[id]/status
 * Status transition (PENDING/CONFIRMED/SEATED/COMPLETED/CANCELLED/NO_SHOW).
 * The transition matrix (and cancel-window rules) stay in the R2 service.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;

    const body = await request.json();

    const parsed = ReservationStatusUpdateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const view = await reservationService.updateStatus(
      id,
      ctx.restaurantId,
      parsed.data,
      authorizedBranches(ctx)
    );

    return successResponse(view, "Status reservasi diperbarui");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating reservation status:", error);
    return errorResponse(
      "Gagal memperbarui status reservasi",
      "INTERNAL_ERROR",
      500
    );
  }
}