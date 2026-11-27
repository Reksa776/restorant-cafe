import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveBranding } from "@/services/branding/branding.service";
import { resolveRequestTenant } from "@/lib/tenant";

/**
 * GET /api/public/branches[?slug=demo-resto | ?restaurantId=xxx]
 * Get ACTIVE branches of ONE explicit tenant.
 *
 * Phase 2: the "first active restaurant" fallback is removed. Tenant context
 * comes from ?slug=, ?restaurantId= or the tenant cookie; without it the
 * request fails (400), and an unknown tenant is a 404 — the branch selector
 * can never list another merchant's branches.
 *
 * Only public-safe fields are returned — never users, UserBranch rows,
 * payment data, credentials, or internal admin configuration.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("public-branches", request), 240, 60_000);

    const { searchParams } = new URL(request.url);
    const restaurantIdParam = searchParams.get("restaurantId");
    const slugParam = searchParams.get("slug");

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
            "TENANT_REQUIRED"
          );
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: tenant.id },
      select: {
        id: true,
        slug: true,
        name: true,
        settings: {
          select: {
            siteName: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            accentColor: true,
          },
        },
      },
    });

    if (!restaurant) {
      throw new AppError("Restaurant not found", 404, "NOT_FOUND");
    }

    const branches = await prisma.branch.findMany({
      where: { restaurantId: restaurant.id, isActive: true },
      select: {
        id: true,
        code: true,
        name: true,
        address: true,
        isActive: true,
      },
      orderBy: { name: "asc" },
    });

    return successResponse({
      restaurant: {
        id: restaurant.id,
        slug: restaurant.slug,
        name: restaurant.name,
        storeUrl: `/r/${restaurant.slug}`,
        // Website branding with safe defaults — only public-safe fields
        // (siteName/logoUrl/colors), never internal settings or secrets.
        branding: resolveBranding(restaurant.name, restaurant.settings),
      },
      branches,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching branches:", error);
    return errorResponse("Failed to fetch branches", "INTERNAL_ERROR", 500);
  }
}
