import api from "@/lib/axios";
import type { MenuEngineeringReport } from "@/services/menu-engineering/menu-engineering.types";

export type {
  MenuEngineeringReport,
  MenuEngineeringProductRow,
  MenuEngineeringCategoryRow,
  MenuEngineeringBranchRow,
  MenuEngineeringThreshold,
  MenuEngineeringClassification,
  MenuEngineeringSummary,
  MenuEngineeringClassificationCounts,
} from "@/services/menu-engineering/menu-engineering.types";

/**
 * Client-side wrapper (browser bundle) — thin axios call into
 * `/api/reports/menu-engineering`. Same LOW-1 pattern as other report
 * services; the server never sends full order datasets to the browser.
 */
export const menuEngineeringService = {
  async getReport(params?: {
    period?: string;
    startDate?: string;
    endDate?: string;
    branch?: string;
    category?: string;
    classification?: string;
    q?: string;
    page?: number;
    limit?: number;
  }): Promise<MenuEngineeringReport> {
    const response = await api.get("/reports/menu-engineering", { params });
    return response.data.data;
  },
};