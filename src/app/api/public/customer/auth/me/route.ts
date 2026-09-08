import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { getCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { customerAuthService } from "@/services/customer-auth/customer-auth.service";

// ============================================================
// GET /api/public/customer/auth/me
// Returns the logged-in customer (from the httpOnly session cookie).
// 401 when there is no valid session — the customer UI uses this to
// decide whether to show "Masuk" or the customer's name.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const session = getCustomerSessionFromRequest(request);
    const customer = await customerAuthService.me(
      session.customerId,
      session.restaurantId
    );
    return successResponse({ customer });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customer session:", error);
    return errorResponse("Gagal memuat sesi customer", "INTERNAL_ERROR", 500);
  }
}