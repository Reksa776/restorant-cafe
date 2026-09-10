import { NextRequest } from "next/server";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, requireAdmin } from "@/lib/auth-helpers";
import {
  listSuppliers,
  createSupplier,
} from "@/services/supplier/supplier.service";

function jsonBody(request: NextRequest) {
  return request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

/**
 * GET /api/admin/suppliers — ADMIN + KASIR (read-only inventory, D3).
 * POST /api/admin/suppliers — ADMIN only (D3: kasir cannot manage suppliers).
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireRoles(["ADMIN", "CASHIER"]);
    const params = request.nextUrl.searchParams;
    const result = await listSuppliers(ctx.restaurantId, {
      search: params.get("search") ?? undefined,
      isActive:
        params.get("isActive") === "true" || params.get("isActive") === "false"
          ? params.get("isActive") === "true"
          : undefined,
    });
    return successResponse(result, "Daftar supplier");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing suppliers:", error);
    return errorResponse("Failed to list suppliers", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await jsonBody(request);
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }
    const supplier = await createSupplier(ctx.restaurantId, {
      name: typeof body.name === "string" ? body.name : "",
      phone: typeof body.phone === "string" ? body.phone : null,
      email: typeof body.email === "string" ? body.email : null,
      address: typeof body.address === "string" ? body.address : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    });
    return createdResponse(supplier, "Supplier berhasil ditambahkan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating supplier:", error);
    return errorResponse("Failed to create supplier", "INTERNAL_ERROR", 500);
  }
}