import { NextRequest } from "next/server";
import { orderService } from "@/services/order/order.service";
import { UpdateOrderStatusSchema } from "@/services/order/order.types";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { userId, restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const { id } = await params;
    const body = await request.json();

    const parsed = UpdateOrderStatusSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const result = await orderService.updateOrderStatus(
      id,
      parsed.data,
      restaurantId,
      userId
    );

    return successResponse(
      {
        ...result.order,
        whatsappTriggered: result.whatsappTriggered,
      },
      "Order status updated successfully"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating order status:", error);
    return errorResponse(
      "Failed to update order status",
      "INTERNAL_ERROR",
      500
    );
  }
}
