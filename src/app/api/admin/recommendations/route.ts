import { NextRequest } from "next/server";
import {
  successResponse,
  errorResponse,
} from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { recommendationService } from "@/services/recommendation/recommendation.service";
import { z } from "zod/v4";

// ============================================================
// GET/PUT /api/admin/recommendations — ADMIN only, restaurant-scoped.
//
// GET  ?productId=xxx → source product + its curated recommendations
//                       (and the full active product list for pickers).
// PUT  { productId, recommendations: [{ recommendedProductId, isActive }] }
//      → transactional replace of the source product's recommendation
//        list (add / reorder / enable-disable / remove in one save).
//        Server re-validates every target (same restaurant, active,
//        available) — cross-restaurant config is impossible.
// ============================================================

const RecommendationEntrySchema = z.object({
  recommendedProductId: z.string().min(1),
  isActive: z.boolean().default(true),
});

const SaveRecommendationsSchema = z.object({
  productId: z.string().min(1, "Produk wajib dipilih"),
  recommendations: z.array(RecommendationEntrySchema).max(50),
});

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();

    const { searchParams } = new URL(request.url);
    const productId = searchParams.get("productId") || undefined;

    const [products, detail] = await Promise.all([
      recommendationService.listActiveProducts(restaurantId),
      recommendationService.listRecommendationsAdmin(restaurantId, productId),
    ]);

    return successResponse({
      products,
      product: detail.product,
      recommendations: detail.recommendations,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching recommendations:", error);
    return errorResponse("Failed to fetch recommendations", "INTERNAL_ERROR", 500);
  }
}

export async function PUT(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = SaveRecommendationsSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const result = await recommendationService.saveRecommendations(
      restaurantId,
      parsed.data.productId,
      parsed.data.recommendations
    );

    return successResponse(result, "Rekomendasi berhasil disimpan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error saving recommendations:", error);
    return errorResponse("Failed to save recommendations", "INTERNAL_ERROR", 500);
  }
}