import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { costingService } from "@/services/costing/costing.service";
import { GetCostingListSchema } from "@/services/costing/costing.types";

/**
 * GET /api/admin/costing/products?branchId=...&categoryId=&search=&status=&page=&limit=
 * CURRENT per-branch product HPP. ADMIN ONLY. Cost data is never exposed to
 * public/customer APIs.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = GetCostingListSchema.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const result = await costingService.listCosting(parsed.data, ctx);
    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing costing:", error);
    return errorResponse("Failed to list costing", "INTERNAL_ERROR", 500);
  }
}