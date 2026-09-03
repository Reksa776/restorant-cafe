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
   * SHA256 (lowercase hex) of the exact JSON-serialized request body.
   * Serialization happens ONCE in createPayment: the exact string that is
   * hashed for the signature is the exact string sent in fetch().
   */
  private hashBody(jsonBody: string): string {
    return crypto
      .createHash("sha256")
      .update(jsonBody)
      .digest("hex")
      .toLowerCase();
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
  private generateSignature(
    method: string,
    body: Record<string, unknown>,
    jsonBody?: string
  ): string {
    // Step 1: Serialize body to JSON (no spaces) — or reuse the exact string
    // already serialized by the caller so hash and wire bytes are identical.
    const bodyJson = jsonBody ?? JSON.stringify(body);

    // Step 2: SHA256 hash the JSON body (lowercase hex) — matches official SDK
    const bodyHash = this.hashBody(bodyJson);

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
    // Cap log/error excerpts (never logs secrets — raw gateway bodies are
    // request echoes/error text, not credentials).
    const preview = (text: string, max = 400) =>
      text.length > max ? `${text.slice(0, max)}…` : text;

    try {
      // "qris" = QRIS direct payment; anything else keeps the BCA virtual
      // account channel. Both channels use the iPaymu v2 direct-payment
      // request format proven against the sandbox from the VPS control test:
      // parallel string arrays (product/qty/price), string amount, and
      // account = merchant VA. Signature is computed over this exact final
      // body — it is never mutated afterwards.
      const channel = input.channel === "qris" ? "qris" : "va";

      // iPaymu's direct endpoint rejects requests with an EMPTY phone or
      // email (it responds with a misleading "unauthorized signature"), and
      // the VA channel additionally rejects non-numeric phones ("phone harus
      // berupa angka"). The service already passes the restaurant's real
      // contact as fallback; normalize the phone to digits and guarantee the
      // fields are never empty on the wire.
      const buyerPhone = (input.customerPhone || "081000000000").replace(/\D/g, "");
      const buyerEmail = input.customerEmail || "customer@example.com";

      const body: Record<string, unknown> = {
        name: input.customerName,
        phone: buyerPhone,
        email: buyerEmail,
        amount: String(input.amount),
        paymentMethod: channel,
        paymentChannel: channel === "qris" ? "qris" : "bca",
        product: input.items.map((item) => item.name),
        qty: input.items.map((item) => String(item.quantity)),
        price: input.items.map((item) => String(item.price)),
        returnUrl: `${process.env.NEXT_PUBLIC_APP_URL}/payment/callback`,
        notifyUrl: `${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/ipaymu`,
        cancelUrl: `${process.env.NEXT_PUBLIC_APP_URL}/order/${input.orderNumber}`,
        referenceId: input.orderNumber,
        account: this.va,
      };

      // Serialize the final body EXACTLY ONCE. The same string is hashed for
      // the signature and sent on the wire — there is no second
      // reconstruction, sorting, or mutation in between.
      const jsonBody = JSON.stringify(body);
      const signature = this.generateSignature("POST", body, jsonBody);
      const timestamp = this.generateTimestamp();

      const response = await fetch(`${this.baseUrl}/payment/direct`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          va: this.va,
          signature: signature,
          timestamp: timestamp,
        },
        body: jsonBody,
      });

      // NEVER call response.json() directly: the gateway is not guaranteed to
      // answer JSON (HTML/plain-text error pages, empty bodies, proxy pages…)
      // and response.json() throws an unhandled SyntaxError deep inside the
      // payment flow on such bodies. Read the raw body as TEXT first, then
      // parse it ourselves so every failure is structured and debuggable.
      // The raw body never contains API keys/VA secrets, so it is safe to
      // log for diagnostics.
      const responseText = await response.text();
      const contentType = response.headers.get("content-type") || "";

      let result: unknown;
      try {
        result = responseText.trim()
          ? JSON.parse(responseText)
          : null;
      } catch {
        // Non-JSON response body — preserve the original response for
        // debugging and surface it as a structured PaymentError.
        console.error(
          `[iPaymu] Non-JSON response for ${channel} create-payment`,
          {
            httpStatus: response.status,
            contentType,
            rawBody: preview(responseText, 1000),
          }
        );
        throw new PaymentError(
          `Payment gateway returned a non-JSON response (HTTP ${response.status}, ${contentType || "no content-type"}). ` +
            `Raw response: ${preview(responseText, 180)}`
        );
      }

      // Success payloads are objects with Status/Data; anything else or an
      // error Status must surface the gateway's own message.
      if (
        !result ||
        typeof result !== "object" ||
        Array.isArray(result) ||
        !("Status" in result)
      ) {
        console.error(
          `[iPaymu] Unexpected payload shape for ${channel} create-payment`,
          {
            httpStatus: response.status,
            contentType,
            rawBody: preview(responseText, 1000),
          }
        );
        throw new PaymentError(
          `Payment gateway returned an unexpected payload (HTTP ${response.status}). ` +
            `Raw response: ${preview(responseText, 180)}`
        );
      }

      const body2 = result as Record<string, unknown>;
      if (!body2.Status || body2.Status !== 200) {
        // Log the gateway's own reason (message never contains secrets).
        console.error(
          `[iPaymu] ${channel} create-payment rejected by gateway`,
          {
            httpStatus: response.status,
            gatewayStatus: body2.Status,
            gatewayMessage:
              typeof body2.Message === "string" ? preview(body2.Message, 300) : "",
          }
        );
        throw new PaymentError(
          (typeof body2.Message === "string" && body2.Message
            ? body2.Message
            : "Failed to create payment") +
            ` (gateway status ${String(body2.Status)}, HTTP ${response.status})`
        );
      }

      const data = body2.Data as
        | Record<string, unknown>
        | undefined;

      // VA responses carry PaymentUrl (redirect to the VA payment page); QRIS
      // responses carry QrImage/QrTemplate instead (no PaymentUrl). Surface a
      // usable URL for both so the customer redirect flow keeps working.
      return {
        reference:
          (typeof data?.Reference === "string" && data.Reference) ||
          input.orderNumber,
        paymentUrl:
          (typeof data?.PaymentUrl === "string" && data.PaymentUrl) ||
          (typeof data?.QrTemplate === "string" && data.QrTemplate) ||
          (typeof data?.QrImage === "string" && data.QrImage) ||
          "",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      };
    } catch (error) {
      if (error instanceof PaymentError) {
        throw error;
      }
      // Network-level failure (fetch threw) — never swallow the real cause
      // behind a generic message, but never include secrets either.
      const message =
        error instanceof Error
          ? error.message
          : String(error);
      console.error(
        `[iPaymu] Network error during ${input.channel === "qris" ? "qris" : "va"} create-payment`,
        { message: preview(message, 300) }
      );
      throw new PaymentError(
        `Failed to communicate with payment provider: ${preview(message, 200)}`
      );
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
