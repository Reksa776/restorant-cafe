import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status") || undefined;

    const result = await paymentService.getPayments(restaurantId, { page, limit, status });

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching payments:", error);
    return errorResponse("Failed to fetch payments", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const body = await request.json();

    if (!body.orderId) {
      throw new ValidationError("orderId is required");
    }

    const payment = await paymentService.createPayment(body.orderId, restaurantId);

    return createdResponse(payment, "Payment created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating payment:", error);
    return errorResponse("Failed to create payment", "INTERNAL_ERROR", 500);
  }
}
