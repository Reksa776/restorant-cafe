// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./promo/promo.service.ts.
// (LOW-1 pattern)
// ============================================================
import api from "@/lib/axios";

export interface AdminPromo {
  id: string;
  code: string;
  name: string;
  description: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: string | null;
  expiresAt: string | null;
  maxUsage: number;
  perCustomerLimit: number;
  isActive: boolean;
  createdAt: string;
  usageCount: number;
  claimCount: number;
  /** null = restaurant-wide (all branches), otherwise branch-scoped. */
  branchId?: string | null;
  branch?: { id: string; code: string; name: string } | null;
}

export interface CreatePromoInput {
  code: string;
  name: string;
  description?: string;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrder?: number;
  maxDiscount?: number | null;
  startsAt?: string | null;
  expiresAt?: string | null;
  maxUsage?: number;
  perCustomerLimit?: number;
  isActive?: boolean;
  /** Branch scope (null = all branches). Server validates ownership. */
  branchId?: string | null;
}

export const promoService = {
  async getPromos(): Promise<AdminPromo[]> {
    const response = await api.get("/admin/promos");
    return response.data.data.promos;
  },

  async createPromo(input: CreatePromoInput): Promise<AdminPromo> {
    const response = await api.post("/admin/promos", input);
    return response.data.data;
  },

  async setPromoActive(id: string, isActive: boolean): Promise<AdminPromo> {
    const response = await api.patch(`/admin/promos/${id}`, { isActive });
    return response.data.data;
  },
};