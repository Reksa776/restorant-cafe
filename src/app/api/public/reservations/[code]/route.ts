import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/phone";
import { resolvePublicReservationRestaurant } from "../_resolve-public-context";

/**
 * GET /api/public/reservations/[code]
 * Guest self-service lookup: code + `?phone=` (+ optional `?restaurantId=`).
 * No authentication required; rate limited. Returns the explicit public DTO.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    assertRateLimit(
      rateLimitKey("public-reservation-lookup", request),
      120,
      60_000
    );

    const { code } = await params;
    const searchParams = request.nextUrl.searchParams;

    const phone = searchParams.get("phone");
    if (!phone) {
      throw new ValidationError("Nomor WhatsApp wajib diisi");
    }

    const restaurantId = await resolvePublicReservationRestaurant(request, {
      restaurantId: searchParams.get("restaurantId"),
    });

    const dto = await reservationService.getReservationByCodeForGuest(
      restaurantId,
      code,
      normalizePhone(phone) as string
    );

    return successResponse(dto);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error looking up public reservation:", error);
    return errorResponse(
      "Gagal memuat reservasi",
      "INTERNAL_ERROR",
      500
    );
  }
}