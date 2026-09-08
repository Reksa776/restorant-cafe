import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { recommendationService } from "@/services/recommendation/recommendation.service";

// ============================================================
// GET /api/public/menu/best-sellers
//   ?restaurantId=xxx&categoryId=yyy&limit=10&excludeIds=a,b,c
//
// "🔥 Terlaris" (F4) — REAL sales only, server-side aggregation:
//   - only PAID orders, CANCELLED excluded
//   - ACTIVE + AVAILABLE products only
//   - restaurant-scoped (never another tenant's history)
//   - aggregated by quantity sold, descending
//
// Returns product rows (same shape as /api/public/menu) with totalSold and
// rank. Never exposes customer PII or internal order/payment IDs. If the
// restaurant has no sales history, the list is empty (the UI hides the
// section or falls back to popular products).
// ============================================================

const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 8;

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-menu-best-sellers", request),
      240,
      60_000
    );

    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");
    const categoryId = searchParams.get("categoryId") || undefined;
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit")) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );
    const excludeIds = (searchParams.get("excludeIds") || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);

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

    // Shared aggregation — same engine used by the recommendation tier,
    // but with requirePaid: true (Terlaris counts REAL sales only).
    const products = await recommendationService.getBestSellers(restaurantId, {
      categoryId,
      excludeIds,
      take: limit,
      requirePaid: true,
    });

    // Quantity per product for totalSold / rank.
    const orderWhere: Record<string, unknown> = {
      restaurantId,
      status: { not: "CANCELLED" },
      paymentStatus: "PAID",
    };
    const where: Record<string, unknown> = { order: { is: orderWhere } };
    if (categoryId) {
      where.product = { is: { categoryId } };
    }
    const grouped = await prisma.orderItem.groupBy({
      by: ["productId"],
      where,
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: Math.max(limit, 1),
    });
    const qtyById = new Map(grouped.map((g) => [g.productId, g._sum.quantity ?? 0]));

    const result = products
      .map((p) => ({
        product: p,
        totalSold: qtyById.get(p.id) ?? 0,
        rank: 0, // filled below
      }))
      .sort((a, b) => b.totalSold - a.totalSold)
      .map((row, index) => ({ ...row, rank: index + 1 }));

    return successResponse({ products: result });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching best sellers:", error);
    return errorResponse("Failed to fetch best sellers", "INTERNAL_ERROR", 500);
  }
}