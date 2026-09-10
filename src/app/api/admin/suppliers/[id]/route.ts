import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  updateSupplier,
  setSupplierActive,
} from "@/services/supplier/supplier.service";

type Params = { params: Promise<{ id: string }> };

type SupplierPatch = {
  name?: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
};

/**
 * PATCH /api/admin/suppliers/[id] — ADMIN only (D3).
 * Updates supplier fields and/or toggles isActive (soft disable).
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin();
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;

    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const update: SupplierPatch = {};
    if (body.name !== undefined) update.name = typeof body.name === "string" ? body.name : undefined;
    if (body.phone !== undefined) update.phone = typeof body.phone === "string" ? body.phone : null;
    if (body.email !== undefined) update.email = typeof body.email === "string" ? body.email : null;
    if (body.address !== undefined) update.address = typeof body.address === "string" ? body.address : null;
    if (body.notes !== undefined) update.notes = typeof body.notes === "string" ? body.notes : null;

    const hasFields = Object.values(update).some(
      (v) => v !== undefined
    );

    if (!hasFields && typeof body.isActive !== "boolean") {
      return errorResponse("Tidak ada perubahan yang dikirim", "VALIDATION_ERROR", 400);
    }

    if (hasFields) {
      const supplier = await updateSupplier(ctx.restaurantId, id, update);
      if (typeof body.isActive === "boolean") {
        const withActive = await setSupplierActive(ctx.restaurantId, id, body.isActive);
        return successResponse(
          { ...toPublic(withActive) },
          "Supplier diperbarui"
        );
      }
      return successResponse({ ...toPublic(supplier) }, "Supplier diperbarui");
    }

    const supplier = await setSupplierActive(ctx.restaurantId, id, body.isActive as boolean);
    return successResponse({ ...toPublic(supplier) }, "Supplier diperbarui");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating supplier:", error);
    return errorResponse("Failed to update supplier", "INTERNAL_ERROR", 500);
  }
}

function toPublic(supplier: {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  updatedAt: Date;
}) {
  return {
    id: supplier.id,
    name: supplier.name,
    phone: supplier.phone,
    email: supplier.email,
    address: supplier.address,
    notes: supplier.notes,
    isActive: supplier.isActive,
    updatedAt: supplier.updatedAt,
  };
}