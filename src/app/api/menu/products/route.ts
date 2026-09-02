import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId") || undefined;
    const isAvailable = searchParams.get("isAvailable");
    const search = searchParams.get("search") || undefined;

    const products = await menuService.getProducts(restaurantId, {
      categoryId,
      isAvailable: isAvailable !== undefined ? isAvailable === "true" : undefined,
      search,
    });

    return successResponse(products);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching products:", error);
    return errorResponse("Failed to fetch products", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const body = await request.json();

    if (!body.categoryId || !body.name || body.price === undefined) {
      throw new ValidationError("categoryId, name, and price are required");
    }

    const product = await menuService.createProduct(restaurantId, body);

    return createdResponse(product, "Product created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating product:", error);
    return errorResponse("Failed to create product", "INTERNAL_ERROR", 500);
  }
}
