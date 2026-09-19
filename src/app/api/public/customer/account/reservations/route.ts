import { NextRequest } from "next/server";
import { paginatedResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { reservationService } from "@/services/reservation/reservation.service";
import { toCustomerReservationListItemDto } from "./_customer-reservation-dto";

// ============================================================
// GET /api/public/customer/account/reservations?page=1&limit=10
//
// The logged-in customer's OWN reservations (newest first, paginated).
//
// Identity comes EXCLUSIVELY from the verified customer session cookie —
// customerId + restaurantId are read server-side and every query is scoped to
// both, so a customer can never read another customer's (or another
// restaurant's) reservations. The response is a safe projection (no internal
// ids, no payment rows). Read-only. Mirrors the existing
// /api/public/customer/account/orders route.
// ============================================================

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("customer-account-reservations", request),
      120,
      60_000
    );

    const session = getCustomerSessionFromRequest(request);

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get("page")) || 1, 1);
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit")) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    const result = await reservationService.listCustomerReservations(
      session.customerId,
      session.restaurantId,
      { page, limit }
    );

    return paginatedResponse(
      result.items.map(toCustomerReservationListItemDto),
      result.total,
      result.page,
      result.limit,
      "Reservasi berhasil dimuat"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customer account reservations:", error);
    return errorResponse("Gagal memuat reservasi", "INTERNAL_ERROR", 500);
  }
}