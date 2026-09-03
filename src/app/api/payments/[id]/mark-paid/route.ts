import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

/**
 * POST /api/payments/[id]/mark-paid
 *
 * Cashier action "Tandai Sudah Dibayar" for a KASIR payment.
 *
 * Security (all server-authoritative):
 * - Requires an authenticated ADMIN session.
 * - The payment must belong to the admin's own restaurant (restaurantId is
 *   derived from the session — never from the client).
 * - The payment must have method = KASIR and must still be UNPAID. The
 *   status flip uses a guarded conditional update inside a transaction, so a
 *   double click / concurrent click can never pay twice.
 * - Order STATUS (PENDING → …) is never touched — only the payment state and
 *   the order's payment-status mirror change.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, restaurantId } = await requireAdmin();
    const { id } = await params;

    const result = await paymentService.markCashierPaymentPaid(
      id,
      restaurantId,
      userId
    );

    return successResponse(result, "Pembayaran kasir berhasil ditandai lunas");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error marking cashier payment as paid:", error);
    return errorResponse(
      "Gagal menandai pembayaran sebagai lunas",
      "INTERNAL_ERROR",
      500
    );
  }
}
