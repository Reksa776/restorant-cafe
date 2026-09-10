import { NextRequest } from "next/server";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches, effectiveWriteBranchId, requireOpenShift } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const status = searchParams.get("status") || undefined;

    const result = await paymentService.getPayments(
      ctx.restaurantId,
      { page, limit, status },
      authorizedBranches(ctx)
    );

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
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const body = await request.json();

    // A CASHIER may only create a payment (KASIR cash intent, kasir QRIS once
    // open shift, or kasir VA) under an OPEN shift. Rejected with
    // SHIFT_NOT_OPEN BEFORE any payment/order write. Admin bypasses. The
    // branch is resolved server-side (session + authorized branch context).
    await requireOpenShift(ctx, effectiveWriteBranchId(ctx));

    // Optional explicit payment intent on this admin route: "QRIS" (kasir
    // QRIS) or "KASIR" (kasir cash). Absent = legacy gateway flow.
    const method = body.method;
    if (method !== undefined && method !== "QRIS" && method !== "KASIR") {
      throw new ValidationError("Metode pembayaran tidak valid");
    }

    // Support both orderId-based creation and orderNumber-based kasir QRIS.
    // This is the kasir-initiated QRIS path (widened to all order types).
    if (body.orderNumber && method === "QRIS") {
      const result = await paymentService.createKasirQrisPayment(
        body.orderNumber,
        ctx.restaurantId,
        authorizedBranches(ctx)
      );
      return successResponse(result, result.message);
    }

    if (!body.orderId) {
      throw new ValidationError("orderId or orderNumber is required");
    }

    const payment = await paymentService.createPayment(
      body.orderId,
      ctx.restaurantId,
      method ? { method } : undefined,
      authorizedBranches(ctx)
    );

    return createdResponse(payment, "Payment created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating payment:", error);
    return errorResponse("Failed to create payment", "INTERNAL_ERROR", 500);
  }
}
