import { NextRequest } from "next/server";
import { customerService } from "@/services/customer/customer.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || undefined;

    const result = await customerService.getCustomers(
      ctx.restaurantId,
      { page, limit, search },
      authorizedBranches(ctx)
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customers:", error);
    return errorResponse("Failed to fetch customers", "INTERNAL_ERROR", 500);
  }
}
