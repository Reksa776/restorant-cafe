import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { promoService } from "@/services/promo/promo.service";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";

// ============================================================
// GET /api/public/promos?restaurantId=xxx
// Active promos for a restaurant (public). When the customer session
// cookie is present, each promo includes the customer's claimed/used
// state so the menu can render "Klaim"/"Diklaim" buttons. The session
// is read server-side from the httpOnly cookie — never trusted from the
// query string.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("public-promos", request), 240, 60_000);

    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");

    if (!restaurantId) {
      throw new AppError("restaurantId is required", 400, "VALIDATION_ERROR");
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { id: restaurantId, isActive: true },
      select: { id: true },
    });
    if (!restaurant) {
      throw new AppError("Restaurant not found", 404, "NOT_FOUND");
    }

    const session = tryGetCustomerSessionFromRequest(request);
    const promos = await promoService.listActivePromos(
      restaurantId,
      session?.customerId
    );

    return successResponse({ promos });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching promos:", error);
    return errorResponse("Failed to fetch promos", "INTERNAL_ERROR", 500);
  }
}