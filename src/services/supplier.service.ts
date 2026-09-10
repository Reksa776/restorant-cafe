// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./supplier/supplier.service.ts.
// ============================================================
import api from "@/lib/axios";

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListSuppliersResult {
  items: Supplier[];
  total: number;
}

export const supplierService = {
  async list(params?: { search?: string; isActive?: boolean }): Promise<ListSuppliersResult> {
    const response = await api.get("/admin/suppliers", { params });
    return response.data.data;
  },

  async create(data: {
    name: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    notes?: string | null;
  }): Promise<Supplier> {
    const response = await api.post("/admin/suppliers", data);
    return response.data.data;
  },

  async update(
    id: string,
    data: {
      name?: string;
      phone?: string | null;
      email?: string | null;
      address?: string | null;
      notes?: string | null;
      isActive?: boolean;
    }
  ): Promise<Supplier> {
    const response = await api.patch(`/admin/suppliers/${id}`, data);
    return response.data.data;
  },
};