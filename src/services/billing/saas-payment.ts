import crypto from "crypto";
import { PaymentError } from "@/lib/errors";

// ============================================================
// MASTER iPaymu CLIENT — SaaS billing (platform → merchant)
//
// Deliberately separate from the per-tenant order payment provider: SaaS
// invoices always use the PLATFORM's credentials (`IPAYMU_VA` /
// `IPAYMU_API_KEY`), never a merchant's own gateway account, and their
// return/notify URLs point at /admin/billing + /api/webhooks/saas-billing.
//
// Signature algorithm mirrors the official iPaymu v2 SDK:
//   hash = sha256(jsonBody) (lowercase hex)
//   sign = HMAC_SHA256(`POST:${va}:${hash}:${apiKey}`, apiKey) (hex)
//   headers: va, signature, timestamp (YYYYMMDDHHmmss)
//
// When the platform credentials are absent the caller gets a MOCK payment
// (no network, no charge) so the whole upgrade flow can be exercised locally.
// ============================================================

export interface SaasPaymentInput {
  invoiceNumber: string;
  amount: number;
  description: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
}

export interface SaasPaymentResult {
  mode: "IPAYMU" | "MOCK";
  paymentUrl: string;
  externalRef: string;
  raw: Record<string, unknown>;
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(
    /\/+$/,
    ""
  );
}

function credentials(): { va: string; apiKey: string } {
  return {
    va: (process.env.IPAYMU_VA || "").trim(),
    apiKey: (process.env.IPAYMU_API_KEY || "").trim(),
  };
}

/** True when no master credentials exist → invoices are simulated. */
export function isSaasPaymentMockMode(): boolean {
  const { va, apiKey } = credentials();
  return !va || !apiKey;
}

function baseUrl(): string {
  const envName = (
    process.env.IPAYMU_ENV ||
    process.env.IPAYMU_ENVIRONMENT ||
    ""
  )
    .trim()
    .toLowerCase();
  if (envName === "production") {
    return (
      (process.env.IPAYMU_PRODUCTION_BASE_URL || "")
        .trim()
        .replace(/\/+$/, "") || "https://my.ipaymu.com/api/v2"
    );
  }
  const override = (
    process.env.IPAYMU_SANDBOX_BASE_URL || process.env.IPAYMU_BASE_URL || ""
  )
    .trim()
    .replace(/\/+$/, "");
  if (override) {
    return /^https?:\/\/[^/]+$/i.test(override) ? `${override}/api/v2` : override;
  }
  return "https://sandbox.ipaymu.com/api/v2";
}

function timestamp(): string {
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

function sign(va: string, apiKey: string, jsonBody: string): string {
  const bodyHash = crypto
    .createHash("sha256")
    .update(jsonBody)
    .digest("hex")
    .toLowerCase();
  return crypto
    .createHmac("sha256", apiKey)
    .update(Buffer.from(`POST:${va}:${bodyHash}:${apiKey}`, "utf-8"))
    .digest("hex");
}

/** HMAC of the raw webhook body — accepted as `x-signature` on callbacks. */
export function verifySaasWebhookSignature(
  rawBody: string,
  signature: string | null
): boolean {
  const { apiKey } = credentials();
  if (!apiKey || !signature) return false;
  const expected = crypto
    .createHmac("sha256", apiKey)
    .update(Buffer.from(rawBody, "utf-8"))
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature.trim());
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export async function createSaasPayment(
  input: SaasPaymentInput
): Promise<SaasPaymentResult> {
  const { va, apiKey } = credentials();

  if (!va || !apiKey) {
    // Local / staging simulation: the invoice stays PENDING and the admin UI
    // exposes "Simulasi Lunas" (confirm-mock) to complete the upgrade.
    return {
      mode: "MOCK",
      paymentUrl: `${appUrl()}/admin/billing?invoice=${encodeURIComponent(
        input.invoiceNumber
      )}`,
      externalRef: `MOCK-SAAS-${input.invoiceNumber}`,
      raw: { simulated: true, amount: input.amount },
    };
  }

  const body: Record<string, unknown> = {
    name: input.customerName,
    phone: input.customerPhone.replace(/\D/g, "") || "081000000000",
    email: input.customerEmail,
    amount: String(input.amount),
    paymentMethod: "qris",
    paymentChannel: "qris",
    product: [input.description],
    qty: ["1"],
    price: [String(input.amount)],
    returnUrl: `${appUrl()}/admin/billing`,
    notifyUrl: `${appUrl()}/api/webhooks/saas-billing`,
    cancelUrl: `${appUrl()}/admin/billing`,
    referenceId: input.invoiceNumber,
    account: va,
  };

  const jsonBody = JSON.stringify(body);

  try {
    const response = await fetch(`${baseUrl()}/payment/direct`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        va,
        signature: sign(va, apiKey, jsonBody),
        timestamp: timestamp(),
      },
      body: jsonBody,
    });

    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text.trim() ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }

    const payload = (parsed ?? {}) as {
      Status?: number;
      Message?: string;
      Data?: { Url?: string; SessionID?: string; TransactionId?: string };
    };

    const paymentUrl = payload.Data?.Url;
    if (!response.ok || !paymentUrl) {
      throw new PaymentError(
        `Gagal membuat pembayaran iPaymu${
          payload.Message ? `: ${payload.Message}` : ` (HTTP ${response.status})`
        }`
      );
    }

    return {
      mode: "IPAYMU",
      paymentUrl,
      externalRef:
        payload.Data?.TransactionId ||
        payload.Data?.SessionID ||
        input.invoiceNumber,
      raw: payload as Record<string, unknown>,
    };
  } catch (error) {
    if (error instanceof PaymentError) throw error;
    throw new PaymentError(
      `Gagal menghubungi iPaymu: ${
        error instanceof Error ? error.message : "unknown error"
      }`
    );
  }
}
