import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { promoService } from "@/services/promo/promo.service";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { z } from "zod/v4";

// ============================================================
// POST /api/public/promos/[id]/claim
// Race-safe claim (per-promo row lock + per-customer limits). Requires
// a valid customer session (httpOnly cookie). Tenant-scoped: the promo
// must belong to the restaurant of the session. `branchCode` (body,
// optional) marks which branch the customer claimed from; branch-only
// promos reject claims from other branches.
// ============================================================

const ClaimSchema = z
  .object({
    branchCode: z.string().trim().min(1).max(50).optional(),
  })
  .optional();

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertRateLimit(rateLimitKey("promo-claim", request), 30, 60_000);

    const session = getCustomerSessionFromRequest(request);
    const { id: promoId } = await params;

    const body = ClaimSchema.safeParse(await request.json().catch(() => null));
    if (!body.success) {
      throw new ValidationError(body.error.message);
    }

    let branchId: string | null = null;
    if (body.data?.branchCode) {
      const branch = await prisma.branch.findFirst({
        where: {
          restaurantId: session.restaurantId,
          code: body.data.branchCode,
          isActive: true,
        },
        select: { id: true },
      });
      if (!branch) {
        throw new ValidationError("Cabang tidak ditemukan");
      }
      branchId = branch.id;
    }

    const promo = await promoService.claimPromo(
      session.restaurantId,
      branchId,
      session.customerId,
      promoId
    );

    return successResponse(
      { promoId: promo.id, code: promo.code, name: promo.name },
      "Promo berhasil diklaim"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error claiming promo:", error);
    return errorResponse("Gagal klaim promo", "INTERNAL_ERROR", 500);
  }
}