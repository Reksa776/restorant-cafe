import api from "@/lib/axios";

export interface SalesTransaction {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderType: string;
  paymentMethod: string | null;
  paymentStatus: string;
  amount: number;
  grandTotal: number;
  paidAt: string | null;
  createdAt: string;
  shiftId: string | null;
  shiftNumber: string | null;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  cashierId: string | null;
  cashierName: string | null;
}

export interface SalesSummary {
  totalTransactions: number;
  totalSales: number;
  totalCash: number;
  totalQris: number;
  totalRefund: number;
  netSales: number;
}

export interface SalesPageResult {
  items: SalesTransaction[];
  summary: SalesSummary;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export const cashierSalesService = {
  async getSales(filters?: {
    page?: number;
    limit?: number;
    startDate?: string;
    endDate?: string;
    shiftId?: string;
    paymentMethod?: string;
    paymentStatus?: string;
    orderType?: string;
    cashierId?: string;
    branchId?: string;
  }): Promise<SalesPageResult> {
    const params = new URLSearchParams();
    if (filters?.page) params.set("page", String(filters.page));
    if (filters?.limit) params.set("limit", String(filters.limit));
    if (filters?.startDate) params.set("startDate", filters.startDate);
    if (filters?.endDate) params.set("endDate", filters.endDate);
    if (filters?.shiftId) params.set("shiftId", filters.shiftId);
    if (filters?.paymentMethod) params.set("paymentMethod", filters.paymentMethod);
    if (filters?.paymentStatus) params.set("paymentStatus", filters.paymentStatus);
    if (filters?.orderType) params.set("orderType", filters.orderType);
    if (filters?.cashierId) params.set("cashierId", filters.cashierId);
    if (filters?.branchId) params.set("branchId", filters.branchId);
    const qs = params.toString();
    const response = await api.get(`/cashier/sales${qs ? `?${qs}` : ""}`);
    return response.data.data;
  },
};
