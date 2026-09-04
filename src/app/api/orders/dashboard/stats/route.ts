import { orderService } from "@/services/order/order.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";

export async function GET() {
  try {
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const stats = await orderService.getDashboardStats(restaurantId);

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
