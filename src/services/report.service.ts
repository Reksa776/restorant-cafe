// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./report/report.service.ts
// (Prisma aggregation). (LOW-1 pattern)
// ============================================================
import api from "@/lib/axios";

export type ReportPeriod = "today" | "yesterday" | "week" | "month" | "custom";

export interface SalesReport {
  period: ReportPeriod;
  range: { start: string; end: string };
  filters: {
    orderType: string | null;
    paymentMethod: string | null;
    status: string | null;
    branchId: string | null;
  };
  summary: {
    totalSales: number;
    grossSales: number;
    totalOrders: number;
    paidOrders: number;
    totalItemsSold: number;
    averageOrderValue: number;
    totalDiscount: number;
    totalTax: number;
    totalServiceCharge: number;
    totalRefund: number;
    netSales: number;
  };
  paymentBreakdown: Record<
    "cash" | "qris" | "va" | "other" | "unpaid" | "failed" | "refunded" | "cancelled",
    { count: number; amount: number }
  >;
  orderType: Record<
    "DINE_IN" | "TAKEAWAY" | "DELIVERY",
    { count: number; amount: number }
  >;
  bestSellingProducts: Array<{
    productId: string;
    name: string;
    imageUrl: string | null;
    categoryName: string | null;
    quantitySold: number;
    revenue: number;
  }>;
  bestCategories: Array<{ name: string; quantitySold: number; revenue: number }>;
  busiestHours: Array<{ hour: number; orders: number; revenue: number }>;
}

export interface ReportCommonFilters {
  branchId?: string;
  orderType?: string;
  paymentMethod?: string;
  status?: string;
}

export interface ProductReport {
  period: ReportPeriod;
  range: { start: string; end: string };
  filters: {
    branchId: string | null;
    categoryId: string | null;
    productId: string | null;
    sortBy: string;
  };
  summary: {
    soldProductCount: number;
    qtySold: number;
    grossSales: number;
    discount: number;
    netSales: number;
    orderCount: number;
  };
  products: Array<{
    rank: number;
    productId: string;
    name: string;
    categoryId: string | null;
    categoryName: string | null;
    price: number;
    isActive: boolean;
    isAvailable: boolean;
    qtySold: number;
    grossSales: number;
    discount: number;
    netSales: number;
    revenue: number;
    orderCount: number;
  }>;
  unsoldProducts: Array<{
    productId: string;
    name: string;
    categoryId: string | null;
    categoryName: string | null;
    price: number;
    isActive: boolean;
    isAvailable: boolean;
  }>;
  categories: Array<{ id: string; name: string }>;
}

export interface ShiftSalesReport {
  period: ReportPeriod;
  range: { start: string; end: string };
  filters: {
    branchId: string | null;
    cashierId: string | null;
    status: string | null;
  };
  summary: {
    totalSales: number;
    cash: number;
    qris: number;
    other: number;
    refund: number;
    transactions: number;
    difference: number;
  };
  items: Array<{
    shiftId: string;
    shiftNumber: string;
    cashierId: string;
    cashierName: string | null;
    branchId: string | null;
    branchName: string | null;
    branchCode: string | null;
    status: "OPEN" | "CLOSED";
    openedAt: string;
    closedAt: string | null;
    openingCash: number;
    cashSales: number;
    qrisSales: number;
    otherPayment: number;
    totalSales: number;
    refund: number;
    expectedCash: number;
    actualCash: number | null;
    difference: number | null;
    transactionCount: number;
  }>;
}

export interface PaymentReport {
  period: ReportPeriod;
  range: { start: string; end: string };
  filters: {
    branchId: string | null;
    cashierId: string | null;
    shiftId: string | null;
    method: string | null;
    status: string | null;
  };
  summary: {
    totalPayments: number;
    totalAmount: number;
    paidAmount: number;
    paidCount: number;
    totalOrders: number;
  };
  statusBreakdown: Array<{ status: string; count: number; amount: number }>;
  items: Array<{
    paymentId: string;
    orderId: string;
    orderNumber: string | null;
    date: string;
    paidAt: string | null;
    branchId: string | null;
    branchCode: string | null;
    branchName: string | null;
    shiftNumber: string | null;
    cashierId: string | null;
    cashierName: string | null;
    method: string | null;
    status: string;
    amount: number;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface MultiOutletReport {
  period: ReportPeriod;
  range: { start: string; end: string };
  summary: {
    totalOrders: number;
    totalItems: number;
    grossSales: number;
    discount: number;
    tax: number;
    serviceCharge: number;
    refund: number;
    netSales: number;
    cash: number;
    qris: number;
    other: number;
  };
  outlets: Array<{
    branchId: string;
    branchCode: string;
    branchName: string;
    isActive: boolean;
    orders: number;
    items: number;
    grossSales: number;
    discount: number;
    tax: number;
    serviceCharge: number;
    refund: number;
    totalSales: number;
    netSales: number;
    aov: number;
    cash: number;
    qris: number;
    other: number;
    paymentCount: number;
    orderType: Record<
      "DINE_IN" | "TAKEAWAY" | "DELIVERY",
      { count: number; amount: number }
    >;
    bestSellingProduct: {
      productId: string;
      name: string | null;
      qtySold: number;
      revenue: number;
    } | null;
    rank: number;
    rankBySales: number;
    rankByOrders: number;
  }>;
}

export const reportService = {
  async getSalesReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    orderType?: string;
    paymentMethod?: string;
    status?: string;
    branchId?: string;
  }): Promise<SalesReport> {
    const response = await api.get("/reports/sales", { params });
    return response.data.data;
  },

  async getProductReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    orderType?: string;
    paymentMethod?: string;
    status?: string;
    categoryId?: string;
    productId?: string;
    sortBy?: "qty" | "revenue" | "gross";
  }): Promise<ProductReport> {
    const response = await api.get("/reports/products", { params });
    return response.data.data;
  },

  async getShiftSalesReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    cashierId?: string;
    status?: string;
  }): Promise<ShiftSalesReport> {
    const response = await api.get("/reports/shift-sales", { params });
    return response.data.data;
  },

  async getPaymentReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    cashierId?: string;
    shiftId?: string;
    method?: string;
    status?: string;
    page?: number;
    limit?: number;
  }): Promise<PaymentReport> {
    const response = await api.get("/reports/payments", { params });
    return response.data.data;
  },

  async getMultiOutletReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    branchId?: string;
  }): Promise<MultiOutletReport> {
    const response = await api.get("/reports/multi-outlet", { params });
    return response.data.data;
  },
};