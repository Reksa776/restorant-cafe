import { NextRequest } from "next/server";
import { orderService } from "@/services/order/order.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const stats = await orderService.getDashboardStats(
      ctx.restaurantId,
      authorizedBranches(ctx)
    );

    return successResponse(stats);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching dashboard stats:", error);
    return errorResponse(
      "Failed to fetch dashboard stats",
      "INTERNAL_ERROR",
      500
    );
  }
}