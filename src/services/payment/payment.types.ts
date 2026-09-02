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
  items: PaymentItem[];
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
