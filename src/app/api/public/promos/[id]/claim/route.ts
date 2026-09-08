import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { promoService } from "@/services/promo/promo.service";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";

// ============================================================
// POST /api/public/promos/[id]/claim
// Race-safe claim (per-promo row lock + per-customer limits). Requires
// a valid customer session (httpOnly cookie). Tenant-scoped: the promo
// must belong to the restaurant of the session.
// ============================================================

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertRateLimit(rateLimitKey("promo-claim", request), 30, 60_000);

    const session = getCustomerSessionFromRequest(request);
    const { id: promoId } = await params;

    const promo = await promoService.claimPromo(
      session.restaurantId,
      session.customerId,
      promoId
    );

    return successResponse(
      { promoId: promo.id, code: promo.code, name: promo.name },
      "Promo berhasil diklaim"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error claiming promo:", error);
    return errorResponse("Gagal klaim promo", "INTERNAL_ERROR", 500);
  }
}