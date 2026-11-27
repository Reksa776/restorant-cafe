import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveBranding } from "@/services/branding/branding.service";
import { resolveRequestTenant, tenantSlugFromHost } from "@/lib/tenant";

/**
 * GET /api/public/restaurant?slug=demo-resto   (or ?id=<restaurantId>)
 * Get the PUBLIC profile of ONE explicit tenant.
 *
 * Phase 2 (True SaaS): the previous "return the first active restaurant"
 * fallback is GONE. The tenant is resolved from (in order) ?slug=, ?id=,
 * ?restaurantId=, or the tenant cookie set by /r/[slug] / a table QR scan.
 * No tenant context → 400; unknown/inactive tenant → 404. A customer can
 * therefore never see another merchant's profile/branding by omission.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-restaurant", request),
      240,
      60_000
    );

    const { searchParams } = new URL(request.url);
    const idParam = searchParams.get("id");
    const slugParam = searchParams.get("slug");

    const tenant = await resolveRequestTenant(request, {
      id: idParam,
      slug: slugParam,
    });

    if (!tenant) {
      const hasExplicitHint =
        Boolean(idParam) ||
        Boolean(slugParam) ||
        Boolean(searchParams.get("restaurantId"));
      // An unknown merchant SUBDOMAIN (ngasal.domainlo.com) is a missing
      // storefront → 404, exactly like an unknown ?slug=. Only a request with
      // no tenant context at all gets 400.
      const hasSubdomain =
        tenantSlugFromHost(request.headers) !== null ||
        Boolean(request.headers.get("x-tenant-slug"));
      throw hasExplicitHint || hasSubdomain
        ? new AppError("Restaurant not found", 404, "NOT_FOUND")
        : new AppError(
            "slug atau id restoran wajib diisi",
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
        address: true,
        phone: true,
        email: true,
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

    const { settings, ...restaurantInfo } = restaurant;
    return successResponse({
      ...restaurantInfo,
      storeUrl: `/r/${restaurant.slug}`,
      // Website branding with safe defaults — never exposes internal
      // settings rows or admin config.
      branding: resolveBranding(restaurant.name, settings),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching restaurant:", error);
    return errorResponse("Failed to fetch restaurant", "INTERNAL_ERROR", 500);
  }
}
