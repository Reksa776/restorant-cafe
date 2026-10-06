import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { resolvePublicReservationRestaurant } from "../_resolve-public-context";

/**
 * GET /api/public/reservations/purchase-eligibility
 *
 * READ-ONLY, UX-ONLY probe backing the reservation wizard's "Pembelian" step:
 * the customer/guest is told whether they already have a qualifying purchase
 * BEFORE the guest/review steps, instead of only after Submit.
 *
 * NOT an authorization. `POST /api/public/reservations` still re-runs the same
 * rule inside its transaction and still answers 409 `PURCHASE_REQUIRED`, so a
 * spoofed/stale answer here can never bypass the gate.
 *
 * Identity is resolved SERVER-SIDE, never from the client:
 *   - logged-in  → the verified customer-session `customerId`;
 *   - guest      → the `phone` query param, matched against the SAME normalized
 *                  form every guest flow stores (the known gap remains: the
 *                  guest phone is not OTP-verified).
 * The response is a single boolean — no PII, no order/customer ids.
 *
 * No authentication required; rate limited.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-reservation-purchase-eligibility", request),
      60,
      60_000
    );

    const params = request.nextUrl.searchParams;
    const session = tryGetCustomerSessionFromRequest(request);

    // Tenant resolution is never client-dictated (see the shared resolver).
    const restaurantId = await resolvePublicReservationRestaurant(request, {
      tableId: null,
      restaurantId: params.get("restaurantId"),
    });

    const { eligible } = await reservationService.checkPurchaseEligibility(
      restaurantId,
      {
        customerId: session?.customerId ?? null,
        guestPhone: params.get("phone"),
      }
    );

    return successResponse({ eligible });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error checking reservation purchase eligibility:", error);
    return errorResponse(
      "Gagal memeriksa pembelian",
      "INTERNAL_ERROR",
      500
    );
  }
}
