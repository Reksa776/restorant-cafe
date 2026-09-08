import { NextRequest } from "next/server";
import {
  createdResponse,
  errorResponse,
} from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { CustomerRegisterSchema } from "@/services/customer-auth/customer-auth.types";
import { customerAuthService } from "@/services/customer-auth/customer-auth.service";
import {
  createCustomerSessionToken,
  setCustomerSessionCookie,
} from "@/lib/customer-session.server";

// ============================================================
// POST /api/public/customer/auth/register
// Register a customer login (tenant-scoped). On success the customer
// session cookie is set (httpOnly, signed).
// ============================================================

export async function POST(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("customer-register", request), 20, 60_000);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = CustomerRegisterSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const customer = await customerAuthService.register(parsed.data);
    const token = createCustomerSessionToken(
      customer.id,
      parsed.data.restaurantId
    );

    const response = createdResponse(
      { customer },
      "Pendaftaran berhasil"
    );
    return setCustomerSessionCookie(response, token);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error registering customer:", error);
    return errorResponse("Gagal mendaftar", "INTERNAL_ERROR", 500);
  }
}