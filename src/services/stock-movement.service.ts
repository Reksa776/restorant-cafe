// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./stock/stock.service.ts.
// ============================================================
import api from "@/lib/axios";

export type StockMovementType = "IN" | "OUT" | "ADJUSTMENT";

export interface StockMovementRow {
  id: string;
  branchId: string;
  productId: string;
  type: StockMovementType;
  quantity: number;
  balanceAfter: number;
  refType: string | null;
  refId: string | null;
  reason: string | null;
  createdAt: string;
  branchCode: string | null;
  branchName: string | null;
  productName: string | null;
  userName: string | null;
  userId: string | null;
}

export interface ListStockMovementsResult {
  items: StockMovementRow[];
  total: number;
}

export interface ListStockMovementsFilter {
  branchId?: string;
  productId?: string;
  type?: StockMovementType;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export const stockMovementService = {
  async list(params?: ListStockMovementsFilter): Promise<ListStockMovementsResult> {
    const response = await api.get("/admin/stock-movements", { params });
    return response.data.data;
  },
};