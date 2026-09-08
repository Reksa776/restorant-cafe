import { NextRequest } from "next/server";
import { orderService } from "@/services/order/order.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

/**
 * GET /api/orders/by-number/[orderNumber]
 *
 * Admin (restaurant-scoped) lookup of an order by its public order number —
 * the endpoint behind the "Scan QR Pesanan" flow and the
 * /admin/orders/[orderNumber] page. The order number alone is never enough
 * to cross the restaurant boundary: restaurantId comes from the session.
 * When the caller is branch-scoped, the order must also belong to that
 * branch.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { orderNumber } = await params;

    const order = await orderService.getOrderByNumberScoped(
      orderNumber,
      ctx.restaurantId,
      authorizedBranches(ctx)
    );

    return successResponse(order);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching order by number:", error);
    return errorResponse("Failed to fetch order", "INTERNAL_ERROR", 500);
  }
}
