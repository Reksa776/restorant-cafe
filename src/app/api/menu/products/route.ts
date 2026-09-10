import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
} from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const categoryId = searchParams.get("categoryId") || undefined;
    const isAvailable = searchParams.get("isAvailable");
    const search = searchParams.get("search") || undefined;

    const products = await menuService.getProducts(restaurantId, {
      categoryId,
      isAvailable: isAvailable != null ? isAvailable === "true" : undefined,
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
    // Resolve the admin's WORKING branch server-side. The client's
    // `x-branch-id` is only a hint; branchHintFrom + requireAdmin() validate
    // it against the session's UserBranch assignments and the branch's
    // restaurantId (never trusting the client as an authorization boundary).
    // When a concrete branch is active (e.g. BDG/JKT selected in the branch
    // selector), the new master Product is ALSO registered as a BranchProduct
    // for THAT branch, so it is immediately part of the branch menu instead of
    // silently resolving to stock 0 / "Habis" on a branch it was never added
    // to. Branch context null ("Semua Cabang") keeps the master-only create.
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const body = await request.json();

    if (!body.categoryId || !body.name || body.price === undefined) {
      throw new ValidationError("categoryId, name, and price are required");
    }

    const product = await menuService.createProduct(ctx.restaurantId, body, {
      branchId: ctx.branchId,
      userId: ctx.userId,
    });

    return createdResponse(product, "Product created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating product:", error);
    return errorResponse("Failed to create product", "INTERNAL_ERROR", 500);
  }
}
