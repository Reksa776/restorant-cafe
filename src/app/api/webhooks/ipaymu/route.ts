import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    // iPaymu delivers callbacks either as application/json OR as
    // application/x-www-form-urlencoded (both transports are handled by the
    // official iPaymu SDKs/plugins). Read the raw body as text and parse it
    // ourselves — calling request.json() on a form-encoded body throws a
    // SyntaxError that surfaced as a generic 500 INTERNAL_ERROR.
    const rawBody = await request.text();
    let body: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      body =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
    } catch {
      body = Object.fromEntries(new URLSearchParams(rawBody));
    }

    // Extract X-Signature header for webhook validation
    const signatureHeader = request.headers.get("x-signature") || undefined;

    // Log webhook received (safe fields only — no secrets)
    console.log("Received iPaymu webhook:", {
      reference: body.reference_id || body.Reference,
      status: body.status || body.Status,
      hasSignature: !!signatureHeader,
      contentType: request.headers.get("content-type") || "",
      timestamp: new Date().toISOString(),
    });

    const result = await paymentService.handleWebhook(body, signatureHeader);

    console.log("Webhook processed:", {
      paymentId: result.id,
      orderId: result.orderId,
      status: result.status,
    });

    return successResponse(result, "Webhook processed successfully");
  } catch (error) {
    // Never log full error details for webhook — could contain sensitive data
    console.error("Error processing webhook:", error instanceof Error ? error.message : "Unknown error");

    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }

    return errorResponse("Failed to process webhook", "INTERNAL_ERROR", 500);
  }
}
