import api from "@/lib/axios";

export interface Payment {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  method?: string;
  provider?: string;
  paymentUrl?: string;
  paidAt?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
  order: {
    id: string;
    orderNumber: string;
    grandTotal: string;
  };
}

export interface PaymentsResponse {
  items: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const paymentService = {
  async getPayments(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaymentsResponse> {
    const response = await api.get("/payments", { params });
    return response.data.data;
  },

  async getPayment(id: string): Promise<Payment> {
    const response = await api.get(`/payments/${id}`);
    return response.data.data;
  },

  async createPayment(orderId: string): Promise<Payment> {
    const response = await api.post("/payments", { orderId });
    return response.data.data;
  },

  async getPaymentUrl(id: string): Promise<string> {
    const response = await api.get(`/payments/${id}/url`);
    return response.data.data.paymentUrl;
  },
};
