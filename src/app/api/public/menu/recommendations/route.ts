import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { recommendationService } from "@/services/recommendation/recommendation.service";

// ============================================================
// GET /api/public/menu/recommendations
//   ?restaurantId=xxx&categoryId=yyy&productId=zzz&customerId=ccc&limit=10
//
// Product recommendations for the customer menu page — pure server-side
// aggregation over existing order data + admin-curated rows:
//   1. MANUAL admin recommendations (F3 — highest priority)
//   2. Customer favorites (when the session cookie is present)
//   3. Frequently bought together with the currently viewed product
//      (when productId is provided)
//   4. Best sellers restaurant-wide / within the viewed category
//   5. Fallback: active products when there is not enough order data
//
// Always restaurant-scoped, only ACTIVE + AVAILABLE products, and never
// exposes customer PII or raw order history (only product info is returned).
// The logged-in customer is read from the httpOnly session cookie — never
// trusted from a query param.
// ============================================================

const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 10;

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-menu-recommendations", request),
      240,
      60_000
    );

    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");
    const categoryId = searchParams.get("categoryId") || undefined;
    const productId = searchParams.get("productId") || undefined;
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit")) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

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

    // Optional personalization: only a customer of THIS restaurant can be
    // used (never another tenant's history). Session comes from the cookie.
    const session = tryGetCustomerSessionFromRequest(request);
    let verifiedCustomerId: string | undefined;
    if (session?.customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: session.customerId, restaurantId, isActive: true },
        select: { id: true },
      });
      if (customer) verifiedCustomerId = customer.id;
    }

    const recommended = await recommendationService.getRecommendations(
      restaurantId,
      {
        categoryId,
        productId,
        customerId: verifiedCustomerId,
        limit,
      }
    );

    return successResponse({
      products: recommended,
      // Metadata for the UI (e.g. "Rekomendasi Untuk Kamu" vs "Produk Populer").
      source:
        verifiedCustomerId && recommended.length > 0 ? "personalized" : "popular",
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching recommendations:", error);
    return errorResponse(
      "Failed to fetch recommendations",
      "INTERNAL_ERROR",
      500
    );
  }
}