import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/public/menu?restaurantId=xxx&branchCode=JKT
 * Get menu (categories with products) for a restaurant.
 * `branchCode` (optional, from the table QR URL) scopes products to that
 * branch's availability (BranchProduct) and applies per-branch price
 * overrides. Without it, restaurant-wide product defaults apply.
 * No authentication required.
 */
export async function GET(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("public-menu", request), 240, 60_000);

    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");
    const categoryId = searchParams.get("categoryId");
    const branchCode = searchParams.get("branchCode");

    if (!restaurantId) {
      throw new AppError("restaurantId is required", 400, "VALIDATION_ERROR");
    }

    // Validate restaurant exists and is active
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: restaurantId, isActive: true },
    });

    if (!restaurant) {
      throw new AppError("Restaurant not found", 404, "NOT_FOUND");
    }

    // Resolve the branch context (branchCode from the table QR URL).
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

    // Get categories with product counts
    const categories = await prisma.category.findMany({
      where: {
        restaurantId,
        isActive: true,
      },
      include: {
        _count: {
          select: { products: true },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    // Get products with option groups and addons, plus BranchProduct rows for
    // the resolved branch (empty scope when no branch selected).
    const productWhere: Record<string, unknown> = {
      restaurantId,
      isActive: true,
      isAvailable: true,
    };

    if (categoryId) {
      productWhere.categoryId = categoryId;
    }

    const products = await prisma.product.findMany({
      where: productWhere,
      include: {
        category: {
          select: { id: true, name: true },
        },
        optionGroups: {
          where: { isActive: true },
          include: {
            options: {
              where: { isActive: true },
              orderBy: { sortOrder: "asc" },
            },
          },
          orderBy: { sortOrder: "asc" },
        },
        addons: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
        branchProducts: branchId
          ? { where: { branchId } }
          : { where: { branchId: "__none__" } },
      },
      orderBy: { name: "asc" },
    });

    return successResponse({
      restaurant: {
        id: restaurant.id,
        name: restaurant.name,
      },
      categories: categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        description: cat.description,
        sortOrder: cat.sortOrder,
        productCount: cat._count.products,
      })),
      // Apply per-branch availability + price override resolution:
      //   availability = branchProduct.isAvailable ?? product.isAvailable
      //   price        = branchProduct.priceOverride ?? product.price
      //   stock        = branchProduct.stock (0 = SOLD OUT)
      products: products
        .filter((p) => {
          if (!branchId) return true;
          const bp = p.branchProducts[0];
          return bp?.isAvailable ?? true;
        })
        .map((p) => {
          const bp = branchId ? p.branchProducts[0] : undefined;
          const effectivePrice = bp?.priceOverride != null ? bp.priceOverride : p.price;
          return {
            id: p.id,
            name: p.name,
            description: p.description,
            price: effectivePrice,
            imageUrl: p.imageUrl,
            categoryId: p.categoryId,
            category: p.category,
            optionGroups: p.optionGroups,
            addons: p.addons,
            isPriceOverride: bp?.priceOverride != null ? true : false,
            stock: bp?.stock ?? null,
          };
        }),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching menu:", error);
    return errorResponse("Failed to fetch menu", "INTERNAL_ERROR", 500);
  }
}
