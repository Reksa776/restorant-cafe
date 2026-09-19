import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { reservationService } from "@/services/reservation/reservation.service";
import { toCustomerReservationDetailDto } from "../_customer-reservation-dto";

// ============================================================
// GET /api/public/customer/account/reservations/[code]
//
// Detail of ONE of the logged-in customer's own reservations, addressed by its
// non-sequential code. Ownership + tenant isolation are enforced server-side
// via the session; another customer's (or another restaurant's) reservation is
// reported as NotFound. Read-only.
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    assertRateLimit(
      rateLimitKey("customer-account-reservation-detail", request),
      120,
      60_000
    );

    const session = getCustomerSessionFromRequest(request);
    const { code } = await params;

    const view = await reservationService.getCustomerReservation(
      session.customerId,
      session.restaurantId,
      code
    );

    return successResponse(
      toCustomerReservationDetailDto(view),
      "Detail reservasi berhasil dimuat"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customer reservation detail:", error);
    return errorResponse("Gagal memuat reservasi", "INTERNAL_ERROR", 500);
  }
}