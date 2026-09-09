import { NextRequest } from "next/server";
import { customerService } from "@/services/customer/customer.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1");
    const limit = parseInt(searchParams.get("limit") || "20");
    const search = searchParams.get("search") || undefined;

    const result = await customerService.getCustomers(
      ctx.restaurantId,
      { page, limit, search },
      authorizedBranches(ctx)
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching customers:", error);
    return errorResponse("Failed to fetch customers", "INTERNAL_ERROR", 500);
  }
}

/**
 * POST /api/customers — find-or-create a customer for the kasir manual
 * order flow (ADMIN or CASHIER). The restaurant is ALWAYS taken from the
 * session — a client-supplied restaurantId is never trusted. When no phone
 * is provided the server generates a guest placeholder so the customer row
 * (required by Order.customerId) always exists; name is required.
 */
export async function POST(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const body = await request.json();

    const name =
      typeof body.name === "string" ? body.name.trim() : "";
    if (!name) {
      throw new ValidationError("Nama pelanggan wajib diisi");
    }
    const phone =
      typeof body.phone === "string" ? body.phone.trim() : "";

    // Phone is the dedup key; without one a placeholder is generated (same
    // convention as guest checkout in order.service) so an order can always
    // reference a real Customer row.
    const effectivePhone =
      phone ||
      `guest-kasir-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    const customer = await customerService.findOrCreateCustomer(
      ctx.restaurantId,
      effectivePhone,
      name || undefined
    );

    return createdResponse(customer, "Customer ready");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating customer:", error);
    return errorResponse("Failed to create customer", "INTERNAL_ERROR", 500);
  }
}
