import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { billingService } from "@/services/billing/billing.service";
import { isSaasPaymentMockMode } from "@/services/billing/saas-payment";

/**
 * POST /api/admin/billing/invoices/[id]/confirm-mock
 *
 * Local/staging convenience: settles a simulated invoice as PAID so the
 * upgrade/add-on flow can be tested without an iPaymu account.
 *
 * Available ONLY when the app is not running in production, or when no master
 * iPaymu credentials are configured (mock mode). In production with real
 * credentials this endpoint is a 403 — the webhook is the only settlement path.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    if (process.env.NODE_ENV === "production" && !isSaasPaymentMockMode()) {
      return errorResponse(
        "Simulasi pembayaran tidak tersedia di production",
        "FORBIDDEN",
        403
      );
    }

    const ctx = await requireAdmin();
    const { id } = await params;

    // Tenant ownership check BEFORE any state change (404 for foreign ids).
    await billingService.getInvoiceForRestaurant(id, ctx.restaurantId);
    const invoice = await billingService.confirmInvoicePaid(id);

    return successResponse(invoice, "Invoice ditandai lunas (simulasi)");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error confirming mock invoice:", error);
    return errorResponse(
      "Gagal mengonfirmasi invoice",
      "INTERNAL_ERROR",
      500
    );
  }
}
