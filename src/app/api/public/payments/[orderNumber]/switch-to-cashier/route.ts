import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

/**
 * POST /api/public/payments/[orderNumber]/switch-to-cashier
 *
 * Fallback flow when a QRIS payment has expired or failed: the customer
 * switches to KASIR on the SAME order. The old QRIS payment is preserved as
 * history (never modified, never converted); a NEW KASIR UNPAID payment row
 * becomes the active intent. Idempotent — an existing UNPAID KASIR row is
 * returned instead of creating a duplicate.
 *
 * Validation (server-authoritative, order found by orderNumber):
 * - order exists                  → else 404
 * - DINE_IN only                  → else 400 (KASIR is dine-in only)
 * - order not CANCELLED           → else 409
 * - order not PAID                → else 409 (a PAID QRIS can never switch)
 * - latest payment exists         → else 400
 * - latest payment EXPIRED/FAILED (or stale PENDING past expiresAt, which is
 *   atomically marked EXPIRED first)
 *                                 → else 409 while the QRIS is still live
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  try {
    const { orderNumber } = await params;

    const result = await paymentService.switchToCashier(orderNumber);
    const payment = result.payment;

    return successResponse(
      {
        paymentId: payment.id,
        orderNumber,
        paymentMethod: "KASIR",
        status: payment.status,
        amount: payment.amount,
        reference: payment.providerRef || null,
        alreadyExisted: result.alreadyExisted,
      },
      "Pembayaran dialihkan ke kasir"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error switching payment to cashier:", error);
    return errorResponse(
      "Gagal mengalihkan pembayaran ke kasir",
      "INTERNAL_ERROR",
      500
    );
  }
}
