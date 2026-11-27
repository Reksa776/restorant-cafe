// ============================================================
// CLIENT-SIDE API wrapper for SaaS billing (browser bundle).
// The server implementation lives in ./billing/billing.service.ts.
// ============================================================
import api from "@/lib/axios";
import type {
  BillingCycleCode,
  InvoiceType,
  PlanCode,
  PlanDefinition,
} from "@/lib/subscription";

export type { BillingCycleCode, InvoiceType, PlanCode, PlanDefinition };

export interface BillingInvoice {
  id: string;
  invoiceNumber: string;
  type: InvoiceType | string;
  targetPlanCode: PlanCode;
  billingCycle: BillingCycleCode;
  addonBranchesQty: number;
  amount: number;
  status: "PENDING" | "PAID" | "EXPIRED" | "FAILED" | string;
  paymentUrl: string | null;
  paidAt: string | null;
  createdAt: string;
}

export interface BillingOverview {
  subscription: {
    planCode: PlanCode;
    planName: string;
    billingCycle: BillingCycleCode;
    status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
    extraBranchesCount: number;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    daysRemaining: number;
  };
  usage: {
    branches: { used: number; limit: number; extra: number };
    staff: { used: number; limit: number | null };
    transactions: {
      used: number;
      limit: number | null;
      periodStart: string;
    };
  };
  catalog: PlanDefinition[];
  paymentMode: "MOCK" | "IPAYMU";
  invoices: BillingInvoice[];
}

export interface BillingCheckoutInput {
  type: InvoiceType;
  planCode: PlanCode;
  billingCycle: BillingCycleCode;
  addonBranchesQty?: number;
}

export const billingService = {
  async getOverview(): Promise<BillingOverview> {
    const res = await api.get("/admin/billing");
    return res.data.data as BillingOverview;
  },

  async checkout(input: BillingCheckoutInput): Promise<{
    invoice: BillingInvoice;
    paymentMode: "MOCK" | "IPAYMU";
  }> {
    const res = await api.post("/admin/billing/checkout", input);
    return res.data.data;
  },

  async confirmMock(invoiceId: string): Promise<BillingInvoice> {
    const res = await api.post(
      `/admin/billing/invoices/${encodeURIComponent(invoiceId)}/confirm-mock`
    );
    return res.data.data as BillingInvoice;
  },
};
