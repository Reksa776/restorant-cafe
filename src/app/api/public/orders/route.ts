import { NextRequest } from "next/server";
import { orderService } from "@/services/order/order.service";
import { CreateCustomerOrderSchema } from "@/services/order/order.types";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";

/**
 * POST /api/public/orders
 * Create a new order from customer website.
 * No authentication required.
 * restaurantId is derived from the first table's restaurant or from request body.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate input with Zod
    const parsed = CreateCustomerOrderSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const input = parsed.data;

    // Determine restaurantId:
    // 1. From tableId (validate server-side)
    // 2. From request body (if provided and valid)
    let restaurantId: string | null = null;

    if (input.tableId) {
      // Look up table to get restaurantId
      const { prisma } = await import("@/lib/prisma");
      const table = await prisma.table.findUnique({
        where: { id: input.tableId },
        select: { restaurantId: true, isActive: true },
      });

      if (!table || !table.isActive) {
        throw new ValidationError("Meja tidak valid");
      }

      restaurantId = table.restaurantId;
    }

    if (!restaurantId) {
      // No table — use first active restaurant
      const { prisma } = await import("@/lib/prisma");
      const restaurant = await prisma.restaurant.findFirst({
        where: { isActive: true },
        select: { id: true },
      });

      if (!restaurant) {
        throw new ValidationError("Tidak ada restoran aktif");
      }

      restaurantId = restaurant.id;
    }

    // Create order
    const order = await orderService.createCustomerOrder(input, restaurantId);

    // KASIR orders get their UNPAID payment row atomically with the order —
    // surface it so the checkout never needs a second request.
    let payment = null;
    if (input.paymentMethod === "KASIR") {
      const { prisma } = await import("@/lib/prisma");
      payment = await prisma.payment.findFirst({
        where: { orderId: order.id, method: "KASIR" },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          status: true,
          method: true,
          amount: true,
        },
      });
    }

    return createdResponse(
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        orderType: order.orderType,
        grandTotal: order.grandTotal,
        items: order.items,
        payment,
        customer: {
          name: order.customer.name,
          phone: order.customer.phone?.startsWith("guest-")
            ? null
            : order.customer.phone,
        },
        table: order.table
          ? { number: order.table.number, name: order.table.name }
          : null,
      },
      "Order created successfully"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating order:", error);
    return errorResponse("Failed to create order", "INTERNAL_ERROR", 500);
  }
}
