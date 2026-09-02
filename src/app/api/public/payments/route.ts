import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";

/**
 * POST /api/public/payments
 * Create a payment for an order (public, no auth required).
 * Customer calls this after creating an order to initiate payment.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    if (!body.orderNumber) {
      throw new ValidationError("orderNumber is required");
    }

    // Find order by order number
    const order = await prisma.order.findFirst({
      where: { orderNumber: body.orderNumber },
      select: { id: true, restaurantId: true, paymentStatus: true },
    });

    if (!order) {
      throw new AppError("Order not found", 404, "NOT_FOUND");
    }

    // Check if already paid
    if (order.paymentStatus === "PAID") {
      throw new ValidationError("Order already paid");
    }

    // Create payment
    const payment = await paymentService.createPayment(
      order.id,
      order.restaurantId
    );

    return successResponse(
      {
        paymentId: payment.id,
        paymentUrl: payment.paymentUrl,
        status: payment.status,
        amount: payment.amount,
      },
      "Payment created successfully"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating payment:", error);
    return errorResponse("Failed to create payment", "INTERNAL_ERROR", 500);
  }
}
