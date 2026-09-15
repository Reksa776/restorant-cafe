import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { customerAccountService } from "@/services/customer-auth/customer-account.service";

// ============================================================
// GET /api/public/customer/account/promos
//
// "Voucher Saya" — every promo this customer claimed and/or used, with a
// server-computed status (AVAILABLE / CLAIMED / USED / EXPIRED) and a
// server-built discount label (the client never recomputes the discount).
//
// Identity comes EXCLUSIVELY from the verified customer session cookie:
// customerId + restaurantId are read server-side — no query/body input is
// trusted. A claim (PromoUsage.orderId = NULL) is never reported as used.
// Read-only: no PromoUsage is created or modified.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("customer-account-promos", request),
      60,
      60_000
    );

    const session = getCustomerSessionFromRequest(request);
    const vouchers = await customerAccountService.getAccountPromos(
      session.customerId,
      session.restaurantId
    );

    return successResponse({ vouchers });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customer account promos:", error);
    return errorResponse("Gagal memuat voucher", "INTERNAL_ERROR", 500);
  }
}
