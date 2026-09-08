import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { CustomerLoginSchema } from "@/services/customer-auth/customer-auth.types";
import { customerAuthService } from "@/services/customer-auth/customer-auth.service";
import {
  createCustomerSessionToken,
  setCustomerSessionCookie,
} from "@/lib/customer-session.server";

// ============================================================
// POST /api/public/customer/auth/login
// Customer login (tenant-scoped). Sets the httpOnly session cookie.
// ============================================================

export async function POST(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("customer-login", request), 20, 60_000);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = CustomerLoginSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const customer = await customerAuthService.login(parsed.data);
    const token = createCustomerSessionToken(
      customer.id,
      parsed.data.restaurantId
    );

    const response = successResponse({ customer }, "Login berhasil");
    return setCustomerSessionCookie(response, token);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error logging in customer:", error);
    return errorResponse("Gagal login", "INTERNAL_ERROR", 500);
  }
}