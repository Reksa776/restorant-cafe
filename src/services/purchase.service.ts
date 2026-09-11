// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./purchase/purchase.service.ts.
// ============================================================
import api from "@/lib/axios";

export type PurchaseStatus = "DRAFT" | "RECEIVED" | "CANCELLED";

export interface PurchaseListItem {
  id: string;
  status: PurchaseStatus;
  statusLabel: string;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  supplierId: string;
  supplierName: string | null;
  total: number;
  notes: string | null;
  receivedAt: string | null;
  createdAt: string;
  itemCount: number;
}

export interface PurchaseItem {
  id: string;
  productId: string;
  productName: string | null;
  productPrice: number | null;
  quantity: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseMovement {
  id: string;
  productId: string;
  type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  userName: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface PurchaseIngredientLine {
  id: string;
  ingredientId: string;
  ingredientName: string | null;
  baseUnit: string | null;
  quantity: number;
  unit: string;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseIngredientMovement {
  id: string;
  ingredientId: string;
  ingredientName: string | null;
  baseUnit: string | null;
  type: "IN" | "OUT" | "ADJUSTMENT";
  quantity: number;
  balanceAfter: number;
  reason: string | null;
  userName: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface PurchaseDetail {
  id: string;
  status: PurchaseStatus;
  branchId: string;
  branchCode: string | null;
  branchName: string | null;
  supplierId: string;
  supplierName: string | null;
  supplierPhone: string | null;
  total: number;
  notes: string | null;
  receivedAt: string | null;
  createdAt: string;
  items: PurchaseItem[];
  purchaseIngredients: PurchaseIngredientLine[];
  movements: PurchaseMovement[];
  ingredientMovements: PurchaseIngredientMovement[];
}

export interface CreatePurchaseItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface CreatePurchaseIngredientInput {
  ingredientId: string;
  quantity: number;
  unit: string;
  unitCost: number;
}

export interface CreatePurchaseInput {
  supplierId: string;
  branchId: string;
  notes?: string | null;
  items?: CreatePurchaseItemInput[];
  purchaseIngredients?: CreatePurchaseIngredientInput[];
}

export interface ListPurchasesFilter {
  status?: PurchaseStatus;
  supplierId?: string;
  branchId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
  skip?: number;
}

export interface ListPurchasesResult {
  items: PurchaseListItem[];
  total: number;
}

export const purchaseService = {
  async list(params?: ListPurchasesFilter): Promise<ListPurchasesResult> {
    const response = await api.get("/admin/purchases", { params });
    return response.data.data;
  },

  async get(id: string): Promise<PurchaseDetail> {
    const response = await api.get(`/admin/purchases/${id}`);
    return response.data.data;
  },

  async create(data: CreatePurchaseInput): Promise<PurchaseDetail> {
    const response = await api.post("/admin/purchases", data);
    return response.data.data;
  },

  async updateDraft(
    id: string,
    data: {
      supplierId?: string;
      notes?: string | null;
      items?: CreatePurchaseItemInput[];
      purchaseIngredients?: CreatePurchaseIngredientInput[];
    }
  ): Promise<void> {
    await api.patch(`/admin/purchases/${id}`, data);
  },

  async receive(id: string): Promise<PurchaseDetail> {
    const response = await api.post(`/admin/purchases/${id}/receive`);
    return response.data.data;
  },

  async cancel(id: string): Promise<{ id: string; status: PurchaseStatus }> {
    const response = await api.post(`/admin/purchases/${id}/cancel`);
    return response.data.data;
  },
};