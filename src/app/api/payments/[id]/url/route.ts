import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const { id } = await params;
    const result = await paymentService.getPaymentUrl(
      id,
      ctx.restaurantId,
      authorizedBranches(ctx)
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching payment URL:", error);
    return errorResponse("Failed to fetch payment URL", "INTERNAL_ERROR", 500);
  }
}
