import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { promoService } from "@/services/promo/promo.service";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { resolveRequestTenant } from "@/lib/tenant";

// ============================================================
// GET /api/public/promos?restaurantId=xxx&branchCode=xxx
// Active promos for a restaurant (public). `branchCode` (optional, from the
// table QR URL) scopes the list to restaurant-wide promos + that branch's own
// promos; without it only restaurant-wide promos are shown. When the customer
// session cookie is present, each promo includes the customer's claimed/used
// state so the menu can render "Klaim"/"Diklaim" buttons. The session is read
// server-side from the httpOnly cookie — never trusted from the query string.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("public-promos", request), 240, 60_000);

    const { searchParams } = new URL(request.url);
    const restaurantIdParam = searchParams.get("restaurantId");
    const slugParam = searchParams.get("slug");
    const branchCode = searchParams.get("branchCode");

    // Phase 2 — explicit tenant only (id/slug/cookie); no global fallback.
    const tenant = await resolveRequestTenant(request, {
      id: restaurantIdParam,
      slug: slugParam,
    });
    if (!tenant) {
      throw restaurantIdParam || slugParam
        ? new AppError("Restaurant not found", 404, "NOT_FOUND")
        : new AppError(
            "restaurantId atau slug wajib diisi",
            400,
            "VALIDATION_ERROR"
          );
    }
    const restaurantId = tenant.id;

    let branchId: string | null = null;
    if (branchCode) {
      const branch = await prisma.branch.findFirst({
        where: { restaurantId, code: branchCode, isActive: true },
        select: { id: true },
      });
      if (!branch) {
        throw new AppError("Branch not found", 404, "NOT_FOUND");
      }
      branchId = branch.id;
    }

    const session = tryGetCustomerSessionFromRequest(request);
    const promos = await promoService.listActivePromos(
      restaurantId,
      branchId,
      session?.customerId
    );

    return successResponse({ promos });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching promos:", error);
    return errorResponse("Failed to fetch promos", "INTERNAL_ERROR", 500);
  }
}