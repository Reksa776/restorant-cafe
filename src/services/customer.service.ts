import api from "@/lib/axios";

export interface Customer {
  id: string;
  name?: string;
  phone: string;
  whatsappId?: string;
  createdAt: string;
  updatedAt: string;
  orderCount?: number;
  totalSpent?: string;
  lastOrderAt?: string;
}

export interface CustomersResponse {
  items: Customer[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const customerService = {
  async getCustomers(params?: {
    page?: number;
    limit?: number;
    search?: string;
  }): Promise<CustomersResponse> {
    const response = await api.get("/customers", { params });
    return response.data.data;
  },

  async getCustomer(id: string): Promise<Customer> {
    const response = await api.get(`/customers/${id}`);
    return response.data.data;
  },

  async updateCustomer(
    id: string,
    data: { name?: string; phone?: string }
  ): Promise<Customer> {
    const response = await api.put(`/customers/${id}`, data);
    return response.data.data;
  },
};
