import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";

/**
 * GET /api/public/tables/lookup?number={tableNumber}
 * Look up a table by number for the QR flow.
 * Returns table + restaurant information.
 * No authentication required.
 *
 * Note: Table number is unique per restaurant (@@unique([restaurantId, number])).
 * If multiple active restaurants have the same table number, this will return
 * the first match. In practice, most deployments have a single active restaurant.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const numberStr = searchParams.get("number");

    if (!numberStr) {
      throw new ValidationError("number is required");
    }

    const number = parseInt(numberStr, 10);
    if (isNaN(number) || number < 1) {
      throw new ValidationError("Invalid table number");
    }

    // Find active table with active restaurant
    const table = await prisma.table.findFirst({
      where: {
        number,
        isActive: true,
        restaurant: {
          isActive: true,
        },
      },
      select: {
        id: true,
        number: true,
        name: true,
        capacity: true,
        status: true,
        restaurant: {
          select: {
            id: true,
            name: true,
          },
        },
      },
      orderBy: {
        restaurant: {
          name: "asc",
        },
      },
    });

    if (!table) {
      throw new AppError("Meja tidak ditemukan", 404, "NOT_FOUND");
    }

    if (table.status === "MAINTENANCE") {
      throw new AppError("Meja sedang tidak tersedia", 400, "TABLE_UNAVAILABLE");
    }

    return successResponse({
      tableId: table.id,
      tableNumber: table.number,
      tableName: table.name,
      capacity: table.capacity,
      status: table.status,
      restaurant: {
        id: table.restaurant.id,
        name: table.restaurant.name,
      },
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error looking up table:", error);
    return errorResponse("Failed to look up table", "INTERNAL_ERROR", 500);
  }
}
