import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import {
  getBranding,
  updateBranding,
  type UpdateBrandingInput,
} from "@/services/branding/branding.service";

/**
 * GET /api/admin/settings/branding
 * Authenticated staff endpoint (ADMIN + CASHIER — the KASIR shell applies the
 * same restaurant branding as the ADMIN shell through AdminBrandingProvider).
 * Returns the CURRENT restaurant's branding configuration with safe fallbacks
 * (siteName → Restaurant.name, colors → default palette):
 *
 *   { success, message, data: { restaurantName, branding: {...} } }
 *
 * Tenant isolation: restaurantId is ALWAYS derived from the authenticated
 * session (requireRoles → requireRestaurantContext) — never from the client.
 */
export async function GET() {
  try {
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { name: true },
    });
    const branding = await getBranding(restaurantId);

    return successResponse({
      restaurantName: restaurant?.name ?? null,
      branding,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching branding:", error);
    return errorResponse("Failed to fetch branding", "INTERNAL_ERROR", 500);
  }
}

/**
 * PUT /api/admin/settings/branding
 * ADMIN-only. Upserts the restaurant's branding configuration. Colors must
 * be #RRGGBB hex; logoUrl must be a locally managed upload owned by this
 * restaurant. Returns the persisted branding DTO.
 */
export async function PUT(request: NextRequest) {
  try {
    const { restaurantId } = await requireRoles(["ADMIN"], undefined);

    const body = (await request.json().catch(() => null)) as
      | (UpdateBrandingInput & Record<string, unknown>)
      | null;

    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const branding = await updateBranding(restaurantId, {
      siteName:
        body.siteName === null || typeof body.siteName === "string"
          ? body.siteName
          : undefined,
      logoUrl:
        body.logoUrl === null || typeof body.logoUrl === "string"
          ? body.logoUrl
          : undefined,
      primaryColor:
        body.primaryColor === null || typeof body.primaryColor === "string"
          ? body.primaryColor
          : undefined,
      secondaryColor:
        body.secondaryColor === null || typeof body.secondaryColor === "string"
          ? body.secondaryColor
          : undefined,
      accentColor:
        body.accentColor === null || typeof body.accentColor === "string"
          ? body.accentColor
          : undefined,
    });

    return successResponse(branding, "Branding updated successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating branding:", error);
    return errorResponse("Failed to update branding", "INTERNAL_ERROR", 500);
  }
}