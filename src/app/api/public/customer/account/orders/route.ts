import { NextRequest } from "next/server";
import { paginatedResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { customerAccountService } from "@/services/customer-auth/customer-account.service";

// ============================================================
// GET /api/public/customer/account/orders?page=1&limit=5
//
// The logged-in customer's OWN order history (newest first, paginated).
//
// Identity comes EXCLUSIVELY from the verified customer session cookie:
// customerId + restaurantId are read server-side, so a customer can never
// read another customer's (or another restaurant's) orders. The response is
// a bounded, safe projection: no payment rows, no providerRef / paymentUrl /
// qrString / qrImage, no gateway payload. Detail for a single order stays on
// the existing public tracking route (/api/public/orders/[orderNumber]).
//
// Read-only: nothing is written.
// ============================================================

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("customer-account-orders", request),
      60,
      60_000
    );

    const session = getCustomerSessionFromRequest(request);

    const { searchParams } = new URL(request.url);
    const page = Math.max(Number(searchParams.get("page")) || 1, 1);
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit")) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    const result = await customerAccountService.getAccountOrders(
      session.customerId,
      session.restaurantId,
      { page, limit }
    );

    return paginatedResponse(
      result.items,
      result.total,
      result.page,
      result.limit,
      "Riwayat pesanan berhasil dimuat"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customer account orders:", error);
    return errorResponse("Gagal memuat riwayat pesanan", "INTERNAL_ERROR", 500);
  }
}
