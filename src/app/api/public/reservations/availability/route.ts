import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { branchService } from "@/services/branch/branch.service";
import { ReservationAvailabilityQuerySchema } from "@/services/reservation/reservation.types";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolvePublicReservationRestaurant } from "../_resolve-public-context";

/**
 * GET /api/public/reservations/availability
 * Slot availability for the website/QR flow, addressed by branchCode.
 * No authentication required; rate limited.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-reservation-availability", request),
      240,
      60_000
    );

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = ReservationAvailabilityQuerySchema.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const restaurantId = await resolvePublicReservationRestaurant(request, {
      tableId: parsed.data.tableId,
      restaurantId:
        typeof params.restaurantId === "string" ? params.restaurantId : null,
    });

    // branchCode is resolved against the resolved restaurant only — a code
    // belonging to another tenant never resolves.
    const branch = await branchService.findBranchByCode(
      restaurantId,
      parsed.data.branchCode
    );
    if (!branch) {
      throw new NotFoundError("Cabang tidak ditemukan");
    }

    const result = await reservationService.checkAvailability(
      restaurantId,
      branch.id,
      {
        reservationDate: parsed.data.date,
        partySize: parsed.data.partySize,
        startMinutes: parsed.data.startMinutes,
        durationMinutes: parsed.data.durationMinutes,
        tableId: parsed.data.tableId,
      }
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error checking reservation availability:", error);
    return errorResponse(
      "Gagal memuat ketersediaan",
      "INTERNAL_ERROR",
      500
    );
  }
}