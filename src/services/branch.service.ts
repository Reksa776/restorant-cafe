// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./branch/branch.service.ts
// (Prisma + authorization).
// ============================================================
import api from "@/lib/axios";

export interface Branch {
  id: string;
  restaurantId: string;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface BranchProductRow {
  productId: string;
  name: string;
  price: number;
  categoryId: string;
  defaultAvailable: boolean;
  isAvailable: boolean;
  priceOverride: number | null;
  effectivePrice: number;
  stock: number;
}

export const branchService = {
  async getBranches(): Promise<Branch[]> {
    const response = await api.get("/admin/branches");
    return response.data.data;
  },

  async getBranch(id: string): Promise<Branch> {
    const response = await api.get(`/admin/branches/${id}`);
    return response.data.data;
  },

  async createBranch(data: {
    code: string;
    name: string;
    address?: string;
    phone?: string;
  }): Promise<Branch> {
    const response = await api.post("/admin/branches", data);
    return response.data.data;
  },

  async updateBranch(
    id: string,
    data: {
      name?: string;
      address?: string;
      phone?: string;
      code?: string;
    }
  ): Promise<Branch> {
    const response = await api.put(`/admin/branches/${id}`, data);
    return response.data.data;
  },

  async setBranchActive(id: string, isActive: boolean): Promise<Branch> {
    const response = await api.patch(`/admin/branches/${id}/status`, {
      isActive,
    });
    return response.data.data;
  },

  async getBranchProducts(branchId: string): Promise<BranchProductRow[]> {
    const response = await api.get(`/admin/branches/${branchId}/products`);
    return response.data.data;
  },

  async updateBranchProduct(
    branchId: string,
    productId: string,
    data: {
      isAvailable?: boolean;
      priceOverride?: number | null;
      stock?: number;
    }
  ): Promise<{
    productId: string;
    isAvailable: boolean;
    priceOverride: number | null;
    stock: number;
  }> {
    const response = await api.put(
      `/admin/branches/${branchId}/products/${productId}`,
      data
    );
    return response.data.data;
  },
};