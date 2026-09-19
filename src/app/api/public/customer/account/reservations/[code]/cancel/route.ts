import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { reservationService } from "@/services/reservation/reservation.service";
import { ReservationCancelSchema } from "@/services/reservation/reservation.types";
import { toCustomerReservationDetailDto } from "../../_customer-reservation-dto";

// ============================================================
// POST /api/public/customer/account/reservations/[code]/cancel
//
// Self-cancel of a PENDING/CONFIRMED reservation (the service's transition
// matrix rejects everything else). Ownership + tenant are verified server-side
// from the session, and cancellation reuses the SAME cancel kernel as the
// admin flow — including its conditional update, so a duplicate/racing cancel
// yields a ConflictError (409) instead of a silent second write.
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    assertRateLimit(
      rateLimitKey("customer-account-reservation-cancel", request),
      30,
      60_000
    );

    const session = getCustomerSessionFromRequest(request);
    const { code } = await params;

    const body = await request.json().catch(() => null);

    const parsed = ReservationCancelSchema.safeParse(body ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const view = await reservationService.cancelCustomerReservation(
      session.customerId,
      session.restaurantId,
      code,
      parsed.data
    );

    return successResponse(
      toCustomerReservationDetailDto(view),
      "Reservasi dibatalkan"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error cancelling customer reservation:", error);
    return errorResponse(
      "Gagal membatalkan reservasi",
      "INTERNAL_ERROR",
      500
    );
  }
}