// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios call into
// /api/admin/accounting/pnl*. The server-side read-model lives in
// ./accounting/pnl.service.ts. Never aggregates anything itself.
// ============================================================
import api from "@/lib/axios";
import type { PnlReport, PnlPeriod } from "@/services/accounting/pnl.types";

export type { PnlReport, PnlPeriod } from "@/services/accounting/pnl.types";

export interface PnlParams {
  period?: PnlPeriod;
  startDate?: string;
  endDate?: string;
  branchId?: string;
  orderType?: string;
  paymentMethod?: string;
}

/** Build the CSV export URL from the same filters used by the list. */
export function pnlExportUrl(params: PnlParams): string {
  const qs = new URLSearchParams();
  if (params.period) qs.set("period", params.period);
  if (params.startDate) qs.set("startDate", params.startDate);
  if (params.endDate) qs.set("endDate", params.endDate);
  if (params.branchId) qs.set("branchId", params.branchId);
  if (params.orderType) qs.set("orderType", params.orderType);
  if (params.paymentMethod) qs.set("paymentMethod", params.paymentMethod);
  const suffix = qs.toString();
  return `/api/admin/accounting/pnl/export${suffix ? `?${suffix}` : ""}`;
}

export const pnlService = {
  async get(params?: PnlParams): Promise<PnlReport> {
    const response = await api.get("/admin/accounting/pnl", { params });
    return response.data.data;
  },
};
