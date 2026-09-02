import crypto from "crypto";
import type {
  PaymentProvider,
  CreatePaymentInput,
  PaymentResult,
  WebhookData,
} from "../../payment.types";
import { PaymentError } from "@/lib/errors";

export class IpaymuProvider implements PaymentProvider {
  private va: string;
  private apiKey: string;
  private baseUrl: string;

  constructor() {
    this.va = process.env.IPAYMU_VA || "";
    this.apiKey = process.env.IPAYMU_API_KEY || "";
    this.baseUrl =
      process.env.IPAYMU_ENV === "production"
        ? "https://my.ipaymu.com/api/v2"
        : "https://sandbox.ipaymu.com/api/v2";
  }

  /**
   * Generate iPaymu API v2 request signature per official Node.js SDK.
   *
   * Algorithm (verified against github.com/ipaymu/ipaymu-nodejs-api/src/curl.ts):
   * 1. JSON.stringify(body)
   * 2. SHA256 hash → lowercase hex
   * 3. StringToSign = POST:VA:HASH:SECRET
   * 4. HMAC-SHA256(StringToSign, apiKey) → raw hex (NOT lowercased)
   *
   * Headers: va, signature, timestamp
   */
  private generateSignature(method: string, body: Record<string, unknown>): string {
    // Step 1: Serialize body to JSON (no spaces)
    const jsonBody = JSON.stringify(body);

    // Step 2: SHA256 hash the JSON body (lowercase hex) — matches official SDK
    const bodyHash = crypto
      .createHash("sha256")
      .update(jsonBody)
      .digest("hex")
      .toLowerCase();

    // Step 3: StringToSign = METHOD:VA:HASH:SECRET
    const stringToSign = `${method.toUpperCase()}:${this.va}:${bodyHash}:${this.apiKey}`;

    // Step 4: HMAC-SHA256 with apiKey as secret — raw hex output (NOT lowercased)
    // Official SDK: hmac.update(Buffer.from(string_to_sign, "utf-8")).digest("hex")
    const signature = crypto
      .createHmac("sha256", this.apiKey)
      .update(Buffer.from(stringToSign, "utf-8"))
      .digest("hex");

    return signature;
  }

  /**
   * Generate timestamp in YYYYMMDDHHmmss format.
   */
  private generateTimestamp(): string {
    const now = new Date();
    const pad = (n: number) => n.toString().padStart(2, "0");
    return (
      now.getFullYear().toString() +
      pad(now.getMonth() + 1) +
      pad(now.getDate()) +
      pad(now.getHours()) +
      pad(now.getMinutes()) +
      pad(now.getSeconds())
    );
  }

  async createPayment(input: CreatePaymentInput): Promise<PaymentResult> {
    try {
      const body = {
        product: input.items.map((item) => ({
          name: item.name,
          price: item.price,
          quantity: item.quantity,
        })),
        amount: input.amount,
        buyerName: input.customerName,
        buyerPhone: input.customerPhone || "",
        buyerEmail: "",
        buyerAddress: "",
        paymentMethod: "va",
        paymentBank: "bca",
        vaName: "Restaurant Bahagia",
        vaNumber: this.va,
        phone: input.customerPhone || "",
        email: "",
        returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/payment/callback`,
        notifyUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/ipaymu`,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/order/${input.orderNumber}`,
        reference: input.orderNumber,
        expired: 24,
      };

      const signature = this.generateSignature("POST", body);
      const timestamp = this.generateTimestamp();

      const response = await fetch(`${this.baseUrl}/payment/direct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          va: this.va,
          signature: signature,
          timestamp: timestamp,
        },
        body: JSON.stringify(body),
      });

      const result = await response.json();

      if (!result.Status || result.Status !== 200) {
        throw new PaymentError(
          result.Message || "Failed to create payment"
        );
      }

      return {
        reference: result.Data?.Reference || input.orderNumber,
        paymentUrl: result.Data?.PaymentUrl || "",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      throw new PaymentError("Failed to communicate with payment provider");
    }
  }

  /**
   * Validate iPaymu webhook/callback signature.
   *
   * Per official Go SDK (github.com/ipaymu/ipaymu-go-api/callback.go):
   * - Signature is sent in the X-Signature HTTP header (NOT in the payload body)
   * - HMAC-SHA256 secret is the VA number (NOT the API key)
   * - Payload is JSON-marshaled with sorted keys (Go default) and forward slashes escaped
   *
   * @param payload - The webhook POST body
   * @param signatureHeader - The X-Signature header value from the request
   */
  async validateWebhook(
    payload: Record<string, unknown>,
    signatureHeader?: string
  ): Promise<boolean> {
    try {
      if (!signatureHeader) return false;

      // Step 1: JSON-marshal the payload with sorted keys (JavaScript objects maintain insertion order)
      // We sort keys to match Go's json.Marshal behavior (A-Z order)
      const sortedPayload: Record<string, unknown> = {};
      const sortedKeys = Object.keys(payload).sort();
      for (const key of sortedKeys) {
        sortedPayload[key] = payload[key];
      }

      const jsonStr = JSON.stringify(sortedPayload);

      // Step 2: Escape forward slashes — iPaymu does this (http:// → http:\/\/)
      const escapedJson = jsonStr.replace(/\//g, "\\/");

      // Step 3: HMAC-SHA256 with VA number as secret (NOT API key)
      const hmac = crypto.createHmac("sha256", this.va);
      hmac.update(Buffer.from(escapedJson, "utf-8"));
      const expectedSignature = hmac.digest("hex");

      // Step 4: Constant-time comparison to prevent timing attacks
      if (expectedSignature.length !== signatureHeader.length) {
        return false;
      }
      return crypto.timingSafeEqual(
        Buffer.from(expectedSignature, "utf-8"),
        Buffer.from(signatureHeader, "utf-8")
      );
    } catch {
      return false;
    }
  }

  /**
   * Parse iPaymu webhook payload.
   *
   * Per official Go SDK CallbackPayload struct, the fields are snake_case:
   * - trx_id, reference_id, status, status_code, total, amount, via, channel,
   *   payment_no, va, buyer_name, buyer_email, buyer_phone, etc.
   *
   * Status values: "berhasil" (success), "pending", "expired"
   */
  async parseWebhookPayload(
    payload: Record<string, unknown>
  ): Promise<WebhookData> {
    // Support both snake_case (official) and PascalCase (legacy) field names
    const referenceId = payload.reference_id || payload.Reference || "";
    const status = payload.status || payload.Status || "";
    const total = payload.total || payload.Amount || payload.Total || "0";
    const amount = payload.amount || payload.Amount || total;

    let mappedStatus: "PAID" | "FAILED" | "EXPIRED";
    switch (String(status).toLowerCase()) {
      case "berhasil":
      case "success":
        mappedStatus = "PAID";
        break;
      case "gagal":
      case "failed":
        mappedStatus = "FAILED";
        break;
      case "expired":
        mappedStatus = "EXPIRED";
        break;
      default:
        // "pending" or unknown — treat as pending, not failed
        mappedStatus = "FAILED";
    }

    return {
      reference: String(referenceId),
      status: mappedStatus,
      amount: parseFloat(String(amount || "0")),
      rawData: payload,
    };
  }
}
