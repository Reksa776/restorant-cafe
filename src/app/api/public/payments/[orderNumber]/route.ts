import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";

/**
 * GET /api/public/payments/[orderNumber]
 * Get payment status for an order (public, no auth required).
 * Customer polls this from the payment page to check if payment succeeded.
 *
 * Only public-safe data is returned: the QR image/payload the customer needs
 * to scan, order reference, amount, status and expiry. Provider credentials
 * and raw gateway payloads are never exposed here.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  try {
    const { orderNumber } = await params;

    const order = await prisma.order.findFirst({
      where: { orderNumber },
      select: {
        id: true,
        orderType: true,
        grandTotal: true,
        paymentStatus: true,
        payments: {
          select: {
            id: true,
            status: true,
            amount: true,
            method: true,
            provider: true,
            providerRef: true,
            qrImage: true,
            qrString: true,
            paidAt: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    if (!order) {
      throw new AppError("Order not found", 404, "NOT_FOUND");
    }

    const latestPayment = order.payments[0] || null;

    return successResponse({
      orderNumber,
      orderType: order.orderType,
      paymentStatus: order.paymentStatus,
      grandTotal: order.grandTotal,
      payment: latestPayment
        ? {
            id: latestPayment.id,
            status: latestPayment.status,
            amount: latestPayment.amount,
            method: latestPayment.method || null,
            provider: latestPayment.provider || null,
            reference: latestPayment.providerRef || null,
            qrImage: latestPayment.qrImage || null,
            qrString: latestPayment.qrString || null,
            paidAt: latestPayment.paidAt,
            expiresAt: latestPayment.expiresAt,
            createdAt: latestPayment.createdAt,
          }
        : null,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching payment status:", error);
    return errorResponse(
      "Failed to fetch payment status",
      "INTERNAL_ERROR",
      500
    );
  }
}