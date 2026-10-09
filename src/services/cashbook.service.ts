// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into
// /api/admin/accounting/cashbook*. The server-side read-model lives in
// ./accounting/cashbook.service.ts.
// ============================================================
import api from "@/lib/axios";

export type CashbookMethod = "KASIR" | "QRIS" | "CASH" | "TRANSFER" | "CARD" | "OTHER";
export type CashbookType = "IN" | "OUT";
export type CashbookSource = "PAYMENT" | "REFUND" | "EXPENSE";

export interface CashbookEntry {
  id: string;
  source: CashbookSource;
  type: CashbookType;
  method: string | null;
  methodLabel: string;
  status: string | null;
  date: string;
  dateFallback: boolean;
  amount: number;
  signedAmount: number;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  shiftId: string | null;
  shiftNumber: string | null;
  shiftAttributed: boolean;
  categoryName: string | null;
  reference: string | null;
  note: string | null;
  isCash: boolean;
  settlementVerified: boolean;
  onCancelledOrder: boolean;
}

export interface CashbookSummary {
  totalIn: number;
  totalOut: number;
  netMovement: number;
  inflow: { kasir: number; qris: number; other: number; total: number };
  outflow: {
    refundKasir: number;
    refundQris: number;
    refundUnknown: number;
    expenseCash: number;
    expenseTransfer: number;
    expenseQris: number;
    expenseCard: number;
    expenseOther: number;
    total: number;
  };
  attributableCash: { in: number; out: number; net: number };
  nonCash: { in: number; out: number; net: number };
  unattributedShift: { count: number; inAmount: number; outAmount: number };
  collectedOnCancelledOrders: { count: number; amount: number };
  qrisSettlementVerified: false;
  openingBalance: null;
}

export interface CashbookResult {
  items: CashbookEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  range: { start: string | null; end: string | null };
  filters: {
    branchId: string | null;
    type: CashbookType | null;
    method: CashbookMethod | null;
    dateFrom: string | null;
    dateTo: string | null;
    search: string | null;
  };
  summary: CashbookSummary;
  meta: { methods: readonly string[]; types: readonly string[]; truncated: boolean };
}

export interface CashbookParams {
  page?: number;
  limit?: number;
  branchId?: string;
  type?: CashbookType;
  method?: CashbookMethod;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
}

/** Build the CSV export URL from the same filters used by the list. */
export function cashbookExportUrl(params: CashbookParams): string {
  const qs = new URLSearchParams();
  if (params.branchId) qs.set("branchId", params.branchId);
  if (params.type) qs.set("type", params.type);
  if (params.method) qs.set("method", params.method);
  if (params.dateFrom) qs.set("dateFrom", params.dateFrom);
  if (params.dateTo) qs.set("dateTo", params.dateTo);
  if (params.search) qs.set("search", params.search);
  const suffix = qs.toString();
  return `/api/admin/accounting/cashbook/export${suffix ? `?${suffix}` : ""}`;
}

export const cashbookService = {
  async get(params?: CashbookParams): Promise<CashbookResult> {
    const response = await api.get("/admin/accounting/cashbook", { params });
    return response.data.data;
  },
};
