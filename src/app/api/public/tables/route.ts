import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/public/tables?restaurantId=xxx[&branchCode=YY]
 * Get available tables for a restaurant.
 *
 * `branchCode` (optional) restricts the list to tables of that branch. The
 * checkout page sends the branch the customer selected so the table picker
 * never offers a table whose branch differs from the menu the customer is
 * ordering from — a cross-branch table would otherwise make the server
 * validate stock against ANOTHER branch and reject an in-stock item with
 * "Produk sudah habis". Each table carries its branch (id/name/code) so the
 * UI can label it. Without branchCode the legacy behavior (all restaurant
 * tables) is preserved. No authentication required.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("public-tables", request), 120, 60_000);

    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");
    const branchCode = searchParams.get("branchCode");

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

    // Resolve the branch context when given — the code must map to an ACTIVE
    // branch of this restaurant (never trusted blindly).
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

    // Get available tables only (scoped to the branch when one is resolved).
    const tables = await prisma.table.findMany({
      where: {
        restaurantId,
        isActive: true,
        status: "AVAILABLE",
        ...(branchId ? { branchId } : {}),
      },
      select: {
        id: true,
        number: true,
        name: true,
        capacity: true,
        branch: { select: { id: true, name: true, code: true } },
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
