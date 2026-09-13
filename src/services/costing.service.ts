// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./costing/costing.service.ts
// ============================================================
import api from "@/lib/axios";

export type CostStatus = "NO_RECIPE" | "COMPLETE" | "INCOMPLETE";
export type MissingReason = "MISSING_WAC" | "INACTIVE_INGREDIENT";

/** G.1 — per-branch HPP method. */
export type CostingMode = "INGREDIENT" | "MANUAL";

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
  /** G.1 — method that produced `hpp` for this branch. */
  costingMode: CostingMode;
  /** G.1 — stored manual HPP for this branch (null when unset). */
  manualHpp: string | null;
  /** H4.2 — base HPP (recipe × WAC, or manualHpp). */
  baseHpp: string | null;
  /** H4.2 — selected addon HPP (0 at product level — nothing selected). */
  addonHpp: string | null;
  /** H4.2 — selected option HPP (0 at product level — nothing selected). */
  optionHpp: string | null;
  /** H4.2 — baseHpp + addonHpp + optionHpp. */
  totalHpp: string | null;
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

/** H4.2 — one addon/option mini-BOM line (cost data only). */
export interface CostingComponentItem {
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

/** H4.2 — one addon/option with its per-1-unit HPP. */
export interface CostingComponent {
  kind: "ADDON" | "OPTION";
  id: string;
  name: string;
  /** Selling price / price adjustment — display only, never a cost. */
  sellingPrice: string;
  hpp: string | null;
  status: "COMPLETE" | "INCOMPLETE";
  reasons: string[];
  items: CostingComponentItem[];
}

export interface CostingDetail extends CostingListItem {
  recipeId: string | null;
  items: CostingItem[];
  /** H4.2 — active addons of this product, with per-unit HPP. */
  addons: CostingComponent[];
  /** H4.2 — active options of this product, with per-unit HPP. */
  options: CostingComponent[];
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