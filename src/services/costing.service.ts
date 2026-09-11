// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./costing/costing.service.ts
// ============================================================
import api from "@/lib/axios";

export type CostStatus = "NO_RECIPE" | "COMPLETE" | "INCOMPLETE";
export type MissingReason = "MISSING_WAC" | "INACTIVE_INGREDIENT";

export interface CostingListItem {
  productId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  sellingPrice: string;
  hpp: string | null;
  grossProfit: string | null;
  grossMarginPct: string | null;
  foodCostPct: string | null;
  costStatus: CostStatus;
  coveredItems: number;
  totalItems: number;
}

export interface CostingItem {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  quantity: string;
  unit: string;
  wac: string | null;
  cost: string | null;
  zeroCost: boolean;
  missingReason: MissingReason | null;
}

export interface CostingDetail extends CostingListItem {
  recipeId: string | null;
  items: CostingItem[];
}

export interface CostingListResponse {
  items: CostingListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CostingListParams {
  branchId: string;
  categoryId?: string;
  search?: string;
  status?: CostStatus | "";
  page?: number;
  limit?: number;
}

export const costingService = {
  async list(params: CostingListParams): Promise<CostingListResponse> {
    const response = await api.get("/admin/costing/products", { params });
    return response.data.data;
  },

  async detail(productId: string, branchId: string): Promise<CostingDetail> {
    const response = await api.get(`/admin/costing/products/${productId}`, {
      params: { branchId },
    });
    return response.data.data;
  },
};