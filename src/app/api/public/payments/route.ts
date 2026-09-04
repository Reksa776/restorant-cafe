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

    // Optional DINE-IN payment method: "QRIS" or "KASIR". Absent = the
    // legacy gateway flow (used by TAKEAWAY/DELIVERY and old callers).
    const method = body.method;
    if (method !== undefined && method !== "QRIS" && method !== "KASIR") {
      throw new ValidationError("Metode pembayaran tidak valid");
    }

    // Find order by order number
    const order = await prisma.order.findFirst({
      where: { orderNumber: body.orderNumber },
      select: {
        id: true,
        restaurantId: true,
        paymentStatus: true,
        orderType: true,
      },
    });

    if (!order) {
      throw new AppError("Order not found", 404, "NOT_FOUND");
    }

    // Check if already paid
    if (order.paymentStatus === "PAID") {
      throw new ValidationError("Order already paid");
    }

    // QRIS/KASIR are DINE_IN-only intents — TAKEAWAY/DELIVERY must keep the
    // legacy gateway flow untouched.
    if (method && order.orderType !== "DINE_IN") {
      throw new ValidationError(
        "Metode pembayaran hanya tersedia untuk dine-in"
      );
    }

    // Create payment (amount recomputed server-side from the order row)
    const payment = await paymentService.createPayment(
      order.id,
      order.restaurantId,
      method ? { method } : undefined
    );

    return successResponse(
      {
        orderNumber: body.orderNumber,
        paymentId: payment.id,
        paymentUrl: payment.paymentUrl,
        status: payment.status,
        method: payment.method || null,
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
