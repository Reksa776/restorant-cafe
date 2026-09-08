// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in
// ./recommendation/recommendation.service.ts (Prisma, tenant-scoped).
// (LOW-1 pattern)
// ============================================================
import api from "@/lib/axios";

export interface RecommendationProduct {
  id: string;
  name: string;
  category?: { name: string } | null;
}

export interface AdminRecommendation {
  id: string;
  recommendedProductId: string;
  name: string;
  imageUrl: string | null;
  isAvailable: boolean;
  recommendedIsActive: boolean;
  isActive: boolean;
  sortOrder: number;
}

export interface RecommendationAdminData {
  products: RecommendationProduct[];
  product: { id: string; name: string } | null;
  recommendations: AdminRecommendation[];
}

export const recommendationService = {
  /** GET /api/admin/recommendations?productId=… (ADMIN, tenant-scoped). */
  async getRecommendations(productId?: string): Promise<RecommendationAdminData> {
    const response = await api.get("/admin/recommendations", {
      params: productId ? { productId } : {},
    });
    return response.data.data;
  },

  /**
   * PUT /api/admin/recommendations — transactional replace of one source
   * product's recommendation list. Array order becomes sortOrder.
   */
  async saveRecommendations(
    productId: string,
    recommendations: Array<{ recommendedProductId: string; isActive: boolean }>
  ): Promise<RecommendationAdminData> {
    const response = await api.put("/admin/recommendations", {
      productId,
      recommendations,
    });
    return response.data.data;
  },
};