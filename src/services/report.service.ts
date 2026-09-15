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
    /** H3.4 — original eligible sales revenue (Σ grandTotal, incl. refunded). */
    grossRevenue: number;
    /** H3.4 — approved refund amount reversed out of revenue. */
    refundReversal: number;
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
  /**
   * Daily trend, densified (zero-filled) so a chart axis has no holes.
   * `sales` shares summary.totalSales' refund-aware revenue basis, therefore
   * Σ sales across the series equals summary.totalSales. `date` is `YYYY-MM-DD`
   * (DB-side UTC convention, same as busiestHours' HOUR()). Empty when the
   * range is too long to densify (> 366 days) — the sparse rows are returned
   * instead, so a caller must never assume a fixed length.
   */
  dailySeries: Array<{ date: string; orders: number; sales: number }>;
  /**
   * Promo performance for the same period/filters (real usage only — claims
   * are never counted; the discount is the persisted Order.discount and the
   * revenue is the same gross basis as summary.totalSales).
   */
  promoPerformance: Array<{
    promoId: string;
    code: string;
    name: string;
    type: string;
    isActive: boolean;
    orders: number;
    usage: number;
    totalDiscount: number;
    revenue: number;
  }>;
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

export type PurchaseReportStatus = "DRAFT" | "RECEIVED" | "CANCELLED";

export interface PurchaseReport {
  period: ReportPeriod;
  range: { start: string; end: string };
  filters: {
    branchId: string | null;
    supplierId: string | null;
    status: string | null;
  };
  summary: {
    totalPurchases: number;
    totalValue: number;
    totalReceived: number;
    totalCancelled: number;
    totalItemsPurchased: number;
    totalQuantity: number;
  };
  items: Array<{
    id: string;
    date: string;
    supplierName: string | null;
    branchCode: string | null;
    branchName: string | null;
    status: string;
    itemCount: number;
    totalQuantity: number;
    total: number;
    createdBy: string | null;
    receivedAt: string | null;
  }>;
  productBreakdown: Array<{
    productId: string;
    name: string | null;
    quantityPurchased: number;
    totalCost: number;
    averageUnitCost: number;
    numberOfPurchases: number;
  }>;
  supplierBreakdown: Array<{
    supplierId: string;
    name: string | null;
    numberOfPurchases: number;
    quantity: number;
    totalValue: number;
  }>;
  /**
   * Daily purchasing trend, densified exactly like the sales report's
   * `dailySeries`. `value` is purchase VALUE (Purchase.total) — the model has
   * no paid/unpaid state, so this is never a cash-flow claim.
   */
  dailySeries: Array<{ date: string; purchases: number; value: number }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface InventoryReport {
  period: ReportPeriod;
  range: { start: string; end: string };
  filters: {
    branchId: string | null;
    productId: string | null;
    categoryId: string | null;
    type: string | null;
  };
  summary: {
    totalStock: number;
    stockIn: number;
    stockOut: number;
    adjustment: number;
    movements: number;
  };
  items: Array<{
    id: string;
    date: string;
    branchId: string;
    branchCode: string | null;
    branchName: string | null;
    productId: string;
    productName: string | null;
    type: "IN" | "OUT" | "ADJUSTMENT";
    quantity: number;
    balanceAfter: number;
    refType: string | null;
    refId: string | null;
    reason: string | null;
    userId: string | null;
    userName: string | null;
  }>;
  productStockSummary: Array<{
    branchId: string;
    branchName: string | null;
    branchCode: string | null;
    productId: string;
    productName: string | null;
    currentStock: number;
    stockIn: number;
    stockOut: number;
    adjustment: number;
    lastMovement: string | null;
  }>;
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  stockPagination: {
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

  async getPurchaseReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    supplierId?: string;
    status?: PurchaseReportStatus;
    page?: number;
    limit?: number;
  }): Promise<PurchaseReport> {
    const response = await api.get("/reports/purchases", { params });
    return response.data.data;
  },

  async getInventoryReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    productId?: string;
    categoryId?: string;
    type?: "IN" | "OUT" | "ADJUSTMENT";
    page?: number;
    limit?: number;
  }): Promise<InventoryReport> {
    const response = await api.get("/reports/inventory", { params });
    return response.data.data;
  },
};