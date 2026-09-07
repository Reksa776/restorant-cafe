import { NextRequest } from "next/server";
import { orderService } from "@/services/order/order.service";
import { CreateOrderSchema, GetOrdersSchema } from "@/services/order/order.types";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
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
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const body = await request.json();

    // Explicit schema validation (H6) — quantity must be a positive integer,
    // orderType must be a valid enum, items must be non-empty, and
    // productId/customerId must be well-formed strings. Never trust the raw
    // body straight into the service/database.
    const parsed = CreateOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const order = await orderService.createOrder(parsed.data, restaurantId);

    return createdResponse(order, "Order created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating order:", error);
    return errorResponse("Failed to create order", "INTERNAL_ERROR", 500);
  }
}
