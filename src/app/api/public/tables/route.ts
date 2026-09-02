import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

/**
 * GET /api/public/tables?restaurantId=xxx
 * Get available tables for a restaurant.
 * No authentication required.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");

    if (!restaurantId) {
      throw new AppError("restaurantId is required", 400, "VALIDATION_ERROR");
    }

    // Validate restaurant exists
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: restaurantId, isActive: true },
    });

    if (!restaurant) {
      throw new AppError("Restaurant not found", 404, "NOT_FOUND");
    }

    // Get available tables only
    const tables = await prisma.table.findMany({
      where: {
        restaurantId,
        isActive: true,
        status: "AVAILABLE",
      },
      select: {
        id: true,
        number: true,
        name: true,
        capacity: true,
      },
      orderBy: { number: "asc" },
    });

    return successResponse(tables);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching tables:", error);
    return errorResponse("Failed to fetch tables", "INTERNAL_ERROR", 500);
  }
}
