// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./payment/payment.service.ts
// (Prisma + iPaymu). (LOW-1)
// ============================================================
import api from "@/lib/axios";

export interface PaymentTransaction {
  id: string;
  type: string;
  status: string;
  amount: string;
  createdAt: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rawData?: any;
}

/**
 * Single shared Payment domain type (client wrapper). All payment rows the
 * API returns use this shape, including the QRIS display fields the provider
 * fills (qrImage / qrString / providerRef) and the audit transactions that
 * admin order/payment endpoints include. The kasir barcode flow and the
 * payment dashboard both derive from this — there is no parallel payment
 * domain type.
 */
export interface Payment {
  id: string;
  orderId: string;
  status: string;
  amount: string;
  method?: string | null;
  provider?: string | null;
  providerRef?: string | null;
  paymentUrl?: string | null;
  /** Gateway QR image — either a direct image URL or an already-resolved data URI. */
  qrImage?: string | null;
  /** Raw QR payload string — used only as a fallback to re-render the QR. */
  qrString?: string | null;
  paidAt?: string | null;
  expiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
  order: {
    id: string;
    orderNumber: string;
    grandTotal: string;
  };
  transactions?: PaymentTransaction[];
}

export interface PaymentsResponse {
  items: Payment[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const paymentService = {
  async getPayments(params?: {
    page?: number;
    limit?: number;
    status?: string;
  }): Promise<PaymentsResponse> {
    const response = await api.get("/payments", { params });
    return response.data.data;
  },

  async getPayment(id: string): Promise<Payment> {
    const response = await api.get(`/payments/${id}`);
    return response.data.data;
  },

  async createPayment(
    orderId: string,
    options?: { method?: "QRIS" | "KASIR" }
  ): Promise<Payment> {
    const response = await api.post("/payments", {
      orderId,
      ...(options?.method ? { method: options.method } : {}),
    });
    return response.data.data;
  },

  async getPaymentUrl(id: string): Promise<string> {
    const response = await api.get(`/payments/${id}/url`);
    return response.data.data.paymentUrl;
  },

  /**
   * Create QRIS payment from kasir context (barcode scan).
   * Supports retry on FAILED/EXPIRED payments.
   *
   * `restaurantId` is optional on the client wrapper because the existing
   * POST /api/payments route derives restaurantId from the session; it is
   * accepted here for typing consistency with the server service signature.
   */
  async createKasirQrisPayment(
    orderNumber: string,
    _restaurantId?: string
  ): Promise<{
    payment: Payment;
    kind: string;
    message: string;
  }> {
    const response = await api.post("/payments", {
      orderNumber,
      method: "QRIS",
    });
    return response.data.data;
  },

  /**
   * Cashier action — complete a KASIR payment (admin only).
   *
   * `amountReceived` is the cash handed by the customer (payment form); when
   * omitted the server treats it as exact payment (change = 0). A second
   * attempt on an already-PAID payment is rejected with HTTP 409.
   */
  async markCashierPaymentPaid(
    paymentId: string,
    amountReceived?: number
  ): Promise<{
    payment: Payment;
    alreadyPaid: boolean;
    orderAdvanced: boolean;
    changedBy: string | null;
    audit: { amountDue: number; amountReceived: number; changeAmount: number };
  }> {
    const response = await api.post(
      `/payments/${paymentId}/mark-paid`,
      amountReceived !== undefined ? { amountReceived } : {}
    );
    return response.data.data;
  },
};
