import { NextRequest } from "next/server";
import { orderService } from "@/services/order/order.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";

/**
 * GET /api/public/orders/[orderNumber]
 * Get order details by order number (public tracking).
 * No authentication required.
 *
 * Security (H3):
 * - Rate limited per IP (order numbers are customer-facing; a bounded
 *   window prevents enumeration/screen-scraping even with higher entropy).
 * - Returns an EXPLICIT DTO: customer phone, internal payment fields
 *   (provider / paymentUrl / providerRef) and DB identifiers are never
 *   exposed. The service layer already avoids selecting them.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ orderNumber: string }> }
) {
  try {
    assertRateLimit(
      rateLimitKey("public-order-lookup", request),
      120,
      60_000
    );

    const { orderNumber } = await params;
    const order = await orderService.getOrderByNumber(orderNumber);

    // Explicit public DTO — nothing is spread from the Prisma object.
    return successResponse({
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      orderType: order.orderType,
      grandTotal: order.grandTotal,
      subtotal: order.subtotal,
      tax: order.tax,
      serviceCharge: order.serviceCharge,
      discount: order.discount,
      visitorCount: order.visitorCount,
      notes: order.notes,
      createdAt: order.createdAt,
      customer: {
        name: order.customer?.name ?? null,
      },
      table: order.table
        ? { number: order.table.number, name: order.table.name }
        : null,
      items: order.items.map((item) => {
        // Parse customization snapshot if present
        let customizations = null;
        if (item.customizations) {
          try {
            customizations = typeof item.customizations === "string"
              ? JSON.parse(item.customizations as string)
              : item.customizations;
          } catch {
            // ignore parse errors
          }
        }
        return {
          name: item.product.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          totalPrice: item.totalPrice,
          notes: item.notes,
          customizations,
        };
      }),
      payments: order.payments.map((p) => ({
        method: p.method,
        status: p.status,
        amount: p.amount,
        paidAt: p.paidAt,
      })),
      statusHistory: order.statusHistory.map((h) => ({
        status: h.status,
        notes: h.notes,
        createdAt: h.createdAt,
      })),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching order:", error);
    return errorResponse("Failed to fetch order", "INTERNAL_ERROR", 500);
  }
}