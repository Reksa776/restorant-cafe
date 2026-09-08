import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;
    const payment = await paymentService.getPayment(
      id,
      ctx.restaurantId,
      authorizedBranches(ctx)
    );

    return successResponse(payment);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching payment:", error);
    return errorResponse("Failed to fetch payment", "INTERNAL_ERROR", 500);
  }
}
