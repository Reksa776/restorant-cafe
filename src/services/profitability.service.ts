import api from "@/lib/axios";
import type { ReportPeriod } from "@/services/report.service";
import type { ProfitabilityReport } from "@/services/profitability/profitability.types";

export type { ProfitabilityReport } from "@/services/profitability/profitability.types";

/**
 * Client-side wrapper (browser bundle) — thin axios call into
 * `/api/reports/profitability`. Same LOW-1 pattern as other report
 * services. Never does aggregation itself.
 */
export const profitabilityService = {
  async getProfitabilityReport(params?: {
    period?: ReportPeriod;
    startDate?: string;
    endDate?: string;
    branchId?: string;
    productId?: string;
    categoryId?: string;
    orderType?: string;
    paymentMethod?: string;
    page?: number;
    limit?: number;
  }): Promise<ProfitabilityReport> {
    const response = await api.get("/reports/profitability", { params });
    return response.data.data;
  },
};
