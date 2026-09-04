import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";

/**
 * POST /api/payments/[id]/mark-paid
 *
 * Cashier action — complete a KASIR payment. ADMIN and CASHIER roles may
 * collect; a CASHIER must have an open shift and the payment is linked to
 * their drawer (see paymentService.markCashierPaymentPaid).
 *
 * Body (optional): { "amountReceived": number } — the cash handed by the
 * customer. When omitted (legacy quick-mark button) the received amount
 * defaults to the amount due (change = 0). amountReceived < amountDue is
 * rejected with a validation error before any write.
 *
 * Security (all server-authoritative):
 * - Requires an authenticated session with an allowed role.
 * - The payment must belong to the user's own restaurant (restaurantId is
 *   derived from the session — never from the client).
 * - The payment must have method = KASIR and must still be UNPAID. The
 *   status flip uses a guarded conditional update inside a transaction, so a
 *   double click / concurrent click can never pay twice — a second attempt
 *   on an already-PAID payment returns 409 "Payment already completed".
 * - Every successful collection writes a PaymentTransaction audit row
 *   (amountDue / amountReceived / changeAmount / processedBy / processedAt).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const { id } = await params;

    // Optional cashier-form field.
    let amountReceived: number | undefined;
    const rawBody = await request.text();
    if (rawBody.trim()) {
      const body = JSON.parse(rawBody);
      if (body.amountReceived !== undefined) {
        amountReceived = Number(body.amountReceived);
        if (
          !Number.isFinite(amountReceived) ||
          amountReceived < 0 ||
          Number.isNaN(amountReceived)
        ) {
          throw new ValidationError("Jumlah uang diterima tidak valid");
        }
      }
    }

    const result = await paymentService.markCashierPaymentPaid(
      id,
      restaurantId,
      userId,
      amountReceived !== undefined ? { amountReceived } : undefined
    );

    // A second attempt on an already-PAID payment is blocked explicitly.
    if (result.alreadyPaid) {
      return errorResponse("Payment already completed", "CONFLICT", 409);
    }

    return successResponse(
      result,
      "Pembayaran kasir berhasil ditandai lunas"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    if (error instanceof SyntaxError) {
      return errorResponse(
        "Request body tidak valid",
        "VALIDATION_ERROR",
        400
      );
    }
    console.error("Error marking cashier payment as paid:", error);
    return errorResponse(
      "Gagal menandai pembayaran sebagai lunas",
      "INTERNAL_ERROR",
      500
    );
  }
}
