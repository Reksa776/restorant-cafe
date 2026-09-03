import api from "@/lib/axios";

export interface OrderItem {
  productId: string;
  quantity: number;
}

export interface CreateOrderData {
  customerId: string;
  tableId?: string;
  orderType?: string;
  items: OrderItem[];
  notes?: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  orderType: string;
  subtotal: string;
  discount: string;
  tax: string;
  serviceCharge: string;
  grandTotal: string;
  visitorCount?: number | null;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  customer: {
    id: string;
    name: string;
    phone: string | null;
  };
  table?: {
    id: string;
    number: number;
    name: string;
  };
  items: Array<{
    id: string;
    quantity: number;
    unitPrice: string;
    totalPrice: string;
    notes?: string;
    customizations?: string | Record<string, unknown>;
    product: {
      name: string;
    };
  }>;
  payments?: Array<{
    id: string;
    method: string | null;
    provider: string | null;
    status: string;
    amount: string;
    paymentUrl?: string | null;
    paidAt?: string | null;
  }>;
}

export interface OrdersResponse {
  items: Order[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const orderService = {
  async getOrders(params?: {
    page?: number;
    limit?: number;
    status?: string;
    search?: string;
  }): Promise<OrdersResponse> {
    const response = await api.get("/orders", { params });
    return response.data.data;
  },

  async getOrder(id: string): Promise<Order> {
    const response = await api.get(`/orders/${id}`);
    return response.data.data;
  },

  async updateOrderStatus(
    id: string,
    status: string,
    notes?: string
  ): Promise<Order & { whatsappTriggered?: boolean }> {
    const response = await api.patch(`/orders/${id}/status`, { status, notes });
    return response.data.data;
  },

  async getDashboardStats(): Promise<{
    todayOrders: number;
    pendingOrders: number;
    processingOrders: number;
    readyOrders: number;
    completedOrders: number;
    todayRevenue: string;
    pendingPayments: number;
    paidOrders: number;
  }> {
    const response = await api.get("/orders/dashboard/stats");
    return response.data.data;
  },
};
