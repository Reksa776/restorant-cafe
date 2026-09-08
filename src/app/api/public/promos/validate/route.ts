import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { promoService } from "@/services/promo/promo.service";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { z } from "zod/v4";

// ============================================================
// POST /api/public/promos/validate
//
// NON-MUTATING voucher preview for the checkout "Cek Voucher" step (F2).
//   - REQUIRES a logged-in customer session (vouchers need login).
//   - Accepts a promoCode OR promoId plus the cart subtotal (advisory —
//     only used to compute the preview discount; the order-creation path
//     recomputes subtotal from DB prices and re-validates everything).
//   - NEVER creates a PromoUsage row and NEVER consumes quota.
//   - Tenant-scoped: the promo must belong to the session's restaurant.
//
// Returns the same validation errors the order path would throw so the
// UI can show clear invalid/expired/quota messages BEFORE submit.
// ============================================================

const ValidatePromoSchema = z
  .object({
    promoCode: z.string().trim().min(1).max(50).optional(),
    promoId: z.string().min(1).optional(),
    subtotal: z.coerce.number().min(0).default(0),
  })
  .refine((v) => Boolean(v.promoCode || v.promoId), {
    message: "promoCode atau promoId wajib diisi",
  });

export async function POST(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("promo-validate", request), 60, 60_000);

    // Vouchers require a verified customer session (httpOnly cookie).
    const session = getCustomerSessionFromRequest(request);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = ValidatePromoSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const preview = await promoService.validatePromoPreview(
      session.restaurantId,
      session.customerId,
      { promoCode: parsed.data.promoCode, promoId: parsed.data.promoId },
      parsed.data.subtotal
    );

    return successResponse(preview, "Promo valid");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error validating promo:", error);
    return errorResponse("Gagal memvalidasi promo", "INTERNAL_ERROR", 500);
  }
}