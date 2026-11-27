import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { billingService } from "@/services/billing/billing.service";
import { MAX_ADDON_BRANCHES_PER_INVOICE } from "@/lib/subscription";

/**
 * POST /api/admin/billing/checkout
 *
 * Body: { type, planCode, billingCycle, addonBranchesQty? }
 *
 * The AMOUNT is always recomputed server-side from PLAN_CATALOG — a
 * client-supplied price is ignored. Creates a PENDING SaasInvoice and starts a
 * payment with the platform's master iPaymu credentials (or a local mock when
 * those credentials are not configured).
 */
const CheckoutSchema = z.object({
  type: z.enum(["PLAN_UPGRADE", "BRANCH_ADDON", "RENEWAL"]),
  planCode: z.enum(["STARTER", "BASIC", "PRO", "ENTERPRISE"]),
  billingCycle: z.enum(["MONTHLY", "YEARLY"]),
  addonBranchesQty: z
    .number()
    .int()
    .min(0)
    .max(MAX_ADDON_BRANCHES_PER_INVOICE)
    .optional(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = CheckoutSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const result = await billingService.checkout(ctx.restaurantId, parsed.data);
    return successResponse(result, "Invoice dibuat. Lanjutkan pembayaran.");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating billing checkout:", error);
    return errorResponse(
      "Gagal membuat tagihan",
      "INTERNAL_ERROR",
      500
    );
  }
}
