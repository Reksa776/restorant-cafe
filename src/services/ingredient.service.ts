// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./ingredient/ingredient.service.ts
// ============================================================
import api from "@/lib/axios";

export interface Ingredient {
  id: string;
  name: string;
  baseUnit: string;
  isActive: boolean;
  branchCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface IngredientDetail extends Omit<Ingredient, "branchCount"> {
  branchStock: Array<{
    branchId: string;
    branchName: string;
    branchCode: string;
    stock: number;
  }>;
}

export interface IngredientStockRow {
  id: string;
  branchId: string;
  branchName: string;
  branchCode: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  stock: number;
}

export interface IngredientStockMovementRow {
  id: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  ingredientId: string;
  ingredientName: string | null;
  baseUnit: string | null;
  type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  reason: string | null;
  userId: string | null;
  userName: string | null;
  createdAt: string;
}

interface PaginatedResult<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const ingredientService = {
  async list(params?: {
    search?: string;
    isActive?: string;
    page?: number;
    limit?: number;
  }): Promise<PaginatedResult<Ingredient>> {
    const response = await api.get("/admin/ingredients", { params });
    return response.data.data;
  },

  async get(id: string): Promise<IngredientDetail> {
    const response = await api.get(`/admin/ingredients/${id}`);
    return response.data.data;
  },

  async create(data: {
    name: string;
    baseUnit?: string;
  }): Promise<Ingredient> {
    const response = await api.post("/admin/ingredients", data);
    return response.data.data;
  },

  async update(
    id: string,
    data: {
      name?: string;
      baseUnit?: string;
      isActive?: boolean;
    }
  ): Promise<Ingredient> {
    const response = await api.put(`/admin/ingredients/${id}`, data);
    return response.data.data;
  },

  async getStock(params?: {
    branchId?: string;
    view?: string;
    ingredientId?: string;
    type?: string;
    limit?: number;
  }): Promise<{ items: IngredientStockRow[]; total: number }> {
    const response = await api.get("/admin/ingredients/stock", { params });
    return response.data.data;
  },

  async adjustStock(
    ingredientId: string,
    data: {
      branchId: string;
      targetStock: number;
      reason: string;
    }
  ): Promise<{
    ingredientId: string;
    ingredientName: string;
    baseUnit: string;
    branchId: string;
    branchName: string;
    previousStock: number;
    targetStock: number;
    delta: number;
    movementType: string;
    newBalance: number;
  }> {
    const response = await api.put(
      `/admin/ingredients/stock/${ingredientId}`,
      data
    );
    return response.data.data;
  },

  async getMovements(params?: {
    branchId?: string;
    ingredientId?: string;
    type?: string;
    limit?: number;
  }): Promise<{ items: IngredientStockMovementRow[]; total: number }> {
    const response = await api.get("/admin/ingredients/stock", {
      params: { ...params, view: "movements" },
    });
    return response.data.data;
  },
};
