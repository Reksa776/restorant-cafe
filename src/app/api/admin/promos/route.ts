import { NextRequest } from "next/server";
import { promoService } from "@/services/promo/promo.service";
import {
  successResponse,
  createdResponse,
  errorResponse,
} from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { z } from "zod/v4";

// ============================================================
// GET/POST /api/admin/promos — ADMIN only, restaurant-scoped.
// ============================================================

const PromoCreateSchema = z.object({
  code: z.string().trim().min(1, "Kode wajib diisi").max(50),
  name: z.string().trim().min(1, "Nama wajib diisi").max(191),
  description: z.string().max(1000).optional(),
  type: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
  value: z.coerce.number().positive("Nilai diskon harus lebih dari 0"),
  minOrder: z.coerce.number().min(0).optional(),
  maxDiscount: z.coerce.number().min(0).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  maxUsage: z.coerce.number().int().min(0).optional(),
  perCustomerLimit: z.coerce.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export async function GET() {
  try {
    const { restaurantId } = await requireAdmin();
    const promos = await promoService.listPromosAdmin(restaurantId);
    return successResponse({ promos });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching promos:", error);
    return errorResponse("Failed to fetch promos", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = PromoCreateSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const promo = await promoService.createPromo(restaurantId, parsed.data);
    return createdResponse(promo, "Promo berhasil dibuat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating promo:", error);
    return errorResponse("Failed to create promo", "INTERNAL_ERROR", 500);
  }
}