import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveBranding } from "@/services/branding/branding.service";

/**
 * GET /api/public/restaurant
 * Get restaurant info. Optional ?id= parameter.
 * Returns the first active restaurant if no ID specified.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-restaurant", request),
      240,
      60_000
    );

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    const baseSelect = {
      id: true,
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
    } as const;

    let restaurant;

    if (id) {
      restaurant = await prisma.restaurant.findFirst({
        where: { id, isActive: true },
        select: baseSelect,
      });
    } else {
      // Return first active restaurant
      restaurant = await prisma.restaurant.findFirst({
        where: { isActive: true },
        select: baseSelect,
      });
    }

    if (!restaurant) {
      throw new AppError("Restaurant not found", 404, "NOT_FOUND");
    }

    const { settings, ...restaurantInfo } = restaurant;
    return successResponse({
      ...restaurantInfo,
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
