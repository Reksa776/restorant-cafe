import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { ReservationCancelSchema } from "@/services/reservation/reservation.types";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

/**
 * POST /api/admin/reservations/[id]/cancel
 * Cancel a PENDING/CONFIRMED reservation. Semantically a status transition to
 * CANCELLED (optional reason), so it returns 200 like the PATCH status flow —
 * unlike the legacy purchase cancel which predates that convention.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;

    const body = await request.json().catch(() => null);

    const parsed = ReservationCancelSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const view = await reservationService.cancelReservation(
      id,
      ctx.restaurantId,
      parsed.data,
      authorizedBranches(ctx)
    );

    return successResponse(view, "Reservasi dibatalkan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error cancelling reservation:", error);
    return errorResponse(
      "Gagal membatalkan reservasi",
      "INTERNAL_ERROR",
      500
    );
  }
}