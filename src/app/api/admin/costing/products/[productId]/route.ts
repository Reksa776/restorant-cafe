import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { costingService } from "@/services/costing/costing.service";
import { GetCostingDetailSchema } from "@/services/costing/costing.types";

/**
 * GET /api/admin/costing/products/[productId]?branchId=...
 * Costing detail (recipe lines + per-ingredient cost) for one product in one
 * branch. ADMIN ONLY. Foreign product → 404; out-of-scope branch → 403.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productId: string }> }
) {
  try {
    const ctx = await requireAdmin();
    const { productId } = await params;

    const query = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = GetCostingDetailSchema.safeParse(query);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const detail = await costingService.getCostingDetail(
      productId,
      parsed.data.branchId,
      ctx
    );
    return successResponse(detail);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching costing detail:", error);
    return errorResponse("Failed to fetch costing detail", "INTERNAL_ERROR", 500);
  }
}