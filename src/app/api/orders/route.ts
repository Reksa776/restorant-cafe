import { NextRequest } from "next/server";
import { orderService } from "@/services/order/order.service";
import { GetOrdersSchema } from "@/services/order/order.types";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const params = Object.fromEntries(searchParams);

    const input = GetOrdersSchema.parse(params);
    const result = await orderService.getOrders(input, restaurantId);

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching orders:", error);
    return errorResponse("Failed to fetch orders", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const body = await request.json();
    const order = await orderService.createOrder(body, restaurantId);

    return createdResponse(order, "Order created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating order:", error);
    return errorResponse("Failed to create order", "INTERNAL_ERROR", 500);
  }
}
