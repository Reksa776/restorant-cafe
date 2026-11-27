import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { billingService } from "@/services/billing/billing.service";
import {
  isSaasPaymentMockMode,
  verifySaasWebhookSignature,
} from "@/services/billing/saas-payment";

/**
 * POST /api/webhooks/saas-billing
 *
 * Master-iPaymu callback for SaaS invoices (plan upgrade / branch add-on).
 * Public route (the middleware lets /api/webhooks through).
 *
 * Authentication:
 *   1. `SAAS_BILLING_WEBHOOK_SECRET` set → `x-webhook-secret` must match.
 *   2. otherwise, with real iPaymu credentials → `x-signature` must be the
 *      HMAC-SHA256 of the raw body.
 *   3. otherwise (mock mode) the request is rejected: simulated invoices can
 *      only be settled through the authenticated confirm-mock endpoint.
 *
 * Settlement is idempotent — a re-delivered callback cannot double-apply a
 * branch add-on or extend a period twice.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    let payload: Record<string, unknown> = {};
    try {
      payload = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      // iPaymu may post form-encoded callbacks.
      payload = Object.fromEntries(new URLSearchParams(rawBody));
    }

    const secret = (process.env.SAAS_BILLING_WEBHOOK_SECRET || "").trim();
    if (secret) {
      if (request.headers.get("x-webhook-secret") !== secret) {
        return errorResponse("Signature tidak valid", "UNAUTHORIZED", 401);
      }
    } else if (!isSaasPaymentMockMode()) {
      if (
        !verifySaasWebhookSignature(rawBody, request.headers.get("x-signature"))
      ) {
        return errorResponse("Signature tidak valid", "UNAUTHORIZED", 401);
      }
    } else {
      return errorResponse(
        "Webhook billing belum dikonfigurasi",
        "SERVICE_UNAVAILABLE",
        503
      );
    }

    const invoiceNumber =
      (payload.invoiceNumber as string | undefined) ||
      (payload.referenceId as string | undefined) ||
      (payload.reference_id as string | undefined) ||
      null;
    const externalRef =
      (payload.externalRef as string | undefined) ||
      (payload.transactionId as string | undefined) ||
      (payload.transaction_id as string | undefined) ||
      (payload.sid as string | undefined) ||
      null;
    const status =
      (payload.status as string | undefined) ||
      (payload.Status as string | undefined) ||
      null;

    const invoice = await billingService.handleWebhook({
      invoiceNumber,
      externalRef,
      status,
    });

    if (!invoice) {
      return successResponse({ ignored: true }, "Status pembayaran diabaikan");
    }

    return successResponse(invoice, "Pembayaran langganan diterima");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error handling SaaS billing webhook:", error);
    return errorResponse(
      "Gagal memproses webhook billing",
      "INTERNAL_ERROR",
      500
    );
  }
}
