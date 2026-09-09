import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveBranding } from "@/services/branding/branding.service";

/**
 * GET /api/public/branches[?restaurantId=xxx]
 * Get ACTIVE branches for the (default/first) active restaurant.
 *
 * Only public-safe fields are returned — never users, UserBranch rows,
 * payment data, credentials, or internal admin configuration.
 *
 * Used by the customer branch selector (/pilih-cabang) and by the root
 * "/" redirect to validate a previously saved customer branch context.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("public-branches", request), 240, 60_000);

    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");

    let restaurant;
    if (restaurantId) {
      restaurant = await prisma.restaurant.findFirst({
        where: { id: restaurantId, isActive: true },
        select: {
          id: true,
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
    } else {
      restaurant = await prisma.restaurant.findFirst({
        where: { isActive: true },
        select: {
          id: true,
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
        name: restaurant.name,
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