export interface PaymentItem {
  name: string;
  quantity: number;
  price: number;
}

export interface CreatePaymentInput {
  orderId: string;
  orderNumber: string;
  amount: number;
  customerName: string;
  customerPhone: string | null;
  /**
   * Buyer email. The iPaymu direct endpoint rejects requests with an empty
   * `email` (returning a misleading "unauthorized signature"), so the caller
   * should provide a real fallback (e.g. the restaurant's email) whenever the
   * customer has none.
   */
  customerEmail?: string | null;
  items: PaymentItem[];
  /**
   * iPaymu direct-payment channel: "va" (existing BCA virtual account) or
   * "qris". Defaults to "va" when omitted so legacy callers are unchanged.
   */
  channel?: "va" | "qris";
}

export interface PaymentResult {
  reference: string;
  paymentUrl: string;
  expiresAt?: Date;
}

export interface WebhookData {
  reference: string;
  status: "PAID" | "FAILED" | "EXPIRED";
  amount: number;
  rawData: any;
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  validateWebhook(payload: Record<string, unknown>, signatureHeader?: string): Promise<boolean>;
  parseWebhookPayload(payload: Record<string, unknown>): Promise<WebhookData>;
}
