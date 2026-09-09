// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./order/order.service.ts
// (Prisma). Keeping the two trees distinct avoids importing Prisma into
// client components. (LOW-1)
// ============================================================
import api from "@/lib/axios";
import type { Payment } from "@/services/payment.service";

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
  /**
   * Branch name/code so the admin UI can label the order's branch when
   * viewing "Semua Cabang" — the database id is never rendered.
   */
  branch?: {
    id: string;
    name: string;
    code: string;
  } | null;
  /**
   * Restaurant header for the print bill — included on admin order detail
   * endpoints (name/address/phone + branding logo/site name). Null on the
   * public/legacy shapes that intentionally do not carry it.
   */
  restaurant?: {
    name: string;
    address?: string | null;
    phone?: string | null;
    settings?: {
      siteName?: string | null;
      logoUrl?: string | null;
    } | null;
  } | null;
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
  /**
   * Payment rows use the shared Payment domain type (from the payment service)
   * so the whole app has a single representation of a payment. Admin order
   * endpoints return the same payment shape (including audit transactions).
   */
  payments?: Array<Payment>;
  statusHistory?: Array<{
    status: string;
    notes?: string | null;
    createdAt: string;
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

  /**
   * Get an order by its order number using the admin restaurant-scoped
   * endpoint (/admin/orders/[orderNumber]). This is the authoritative
   * cashier lookup and enforces tenant isolation.
   */
  async getOrderByNumberScoped(orderNumber: string): Promise<Order> {
    const response = await api.get(`/orders/by-number/${orderNumber}`);
    return response.data.data;
  },

  /** Get an order by its public order number (admin /admin/orders/[orderNumber]). */
  async getOrderByNumber(orderNumber: string): Promise<Order> {
    const response = await api.get(`/orders/by-number/${orderNumber}`);
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
