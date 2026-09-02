import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

/**
 * GET /api/public/restaurant
 * Get restaurant info. Optional ?id= parameter.
 * Returns the first active restaurant if no ID specified.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    let restaurant;

    if (id) {
      restaurant = await prisma.restaurant.findFirst({
        where: { id, isActive: true },
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          email: true,
        },
      });
    } else {
      // Return first active restaurant
      restaurant = await prisma.restaurant.findFirst({
        where: { isActive: true },
        select: {
          id: true,
          name: true,
          address: true,
          phone: true,
          email: true,
        },
      });
    }

    if (!restaurant) {
      throw new AppError("Restaurant not found", 404, "NOT_FOUND");
    }

    return successResponse(restaurant);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching restaurant:", error);
    return errorResponse("Failed to fetch restaurant", "INTERNAL_ERROR", 500);
  }
}
