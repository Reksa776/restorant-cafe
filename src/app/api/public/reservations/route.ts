import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { CreatePublicReservationSchema } from "@/services/reservation/reservation.types";
import { createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { resolvePublicReservationRestaurant } from "./_resolve-public-context";
import { toPublicReservationDto } from "./_public-dto";

/**
 * POST /api/public/reservations
 * Guest booking from the customer website / QR flow.
 * No authentication required; rate limited.
 */
export async function POST(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-reservation-create", request),
      30,
      60_000
    );

    const body = await request.json();

    const parsed = CreatePublicReservationSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const input = parsed.data;

    // Tenant resolution is never client-dictated (see resolver). The guest
    // session is only used to attach a known customer to the booking.
    const restaurantId = await resolvePublicReservationRestaurant(request, {
      tableId: input.tableId,
      restaurantId:
        typeof body.restaurantId === "string" ? body.restaurantId : null,
    });
    const session = tryGetCustomerSessionFromRequest(request);

    const view = await reservationService.createPublicReservation(
      restaurantId,
      input,
      { customerId: session?.customerId ?? null }
    );

    return createdResponse(
      toPublicReservationDto(view),
      "Reservasi berhasil dibuat"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating public reservation:", error);
    return errorResponse(
      "Gagal membuat reservasi",
      "INTERNAL_ERROR",
      500
    );
  }
}