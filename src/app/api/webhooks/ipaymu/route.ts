import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Extract X-Signature header for webhook validation
    const signatureHeader = request.headers.get("x-signature") || undefined;

    // Log webhook received (safe fields only — no secrets)
    console.log("Received iPaymu webhook:", {
      reference: body.reference_id || body.Reference,
      status: body.status || body.Status,
      hasSignature: !!signatureHeader,
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
