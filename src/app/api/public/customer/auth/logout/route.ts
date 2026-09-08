import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { clearCustomerSessionCookie } from "@/lib/customer-session.server";

// ============================================================
// POST /api/public/customer/auth/logout
// Clears the customer session cookie. Idempotent.
// ============================================================

export async function POST() {
  try {
    const response = successResponse({}, "Logout berhasil");
    return clearCustomerSessionCookie(response);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    return errorResponse("Gagal logout", "INTERNAL_ERROR", 500);
  }
}