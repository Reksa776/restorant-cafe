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
  summary: {
    totalSales: number;
    totalOrders: number;
    paidOrders: number;
    totalItemsSold: number;
    averageOrderValue: number;
    totalDiscount: number;
    totalTax: number;
    totalServiceCharge: number;
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

export const reportService = {
  async getSalesReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
  }): Promise<SalesReport> {
    const response = await api.get("/reports/sales", { params });
    return response.data.data;
  },
};