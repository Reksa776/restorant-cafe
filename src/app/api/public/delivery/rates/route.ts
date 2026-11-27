import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { requireRequestTenant } from "@/lib/tenant";
import { deliveryService } from "@/services/delivery/delivery.service";

// ============================================================
// POST /api/public/delivery/rates
//
// Tenant-scoped instant-courier quote. The tenant comes from ?slug= /
// restaurantId / the tenant cookie (requireRequestTenant) — never from the
// body — so a customer can only quote a branch of the merchant they are
// shopping at.
//
// The branch may be addressed by id OR by its public code (the customer
// checkout only knows the branch code). The server resolves it inside the
// tenant and rejects a branch without pickup coordinates.
// ============================================================

const RatesSchema = z
  .object({
    branchId: z.string().trim().min(1).optional(),
    branchCode: z.string().trim().min(1).max(50).optional(),
    address: z.string().trim().min(5, "Alamat terlalu pendek").max(500),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    postalCode: z.string().trim().max(20).optional(),
    courierCode: z.string().trim().max(40).optional(),
    serviceType: z.string().trim().max(40).optional(),
  })
  .refine((data) => Boolean(data.branchId || data.branchCode), {
    message: "branchId atau branchCode wajib diisi",
    path: ["branchId"],
  });

export async function POST(request: NextRequest) {
  try {
    // Quotes are cheap but public — bound them per client.
    assertRateLimit(rateLimitKey("public-delivery-rates", request), 40, 60_000);

    const tenant = await requireRequestTenant(request);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = RatesSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const data = parsed.data;
    const rates = await deliveryService.getRates({
      restaurantId: tenant.id,
      branchId: data.branchId ?? null,
      branchCode: data.branchCode ?? null,
      destination: {
        address: data.address,
        latitude: data.latitude,
        longitude: data.longitude,
        postalCode: data.postalCode ?? null,
        contactName: null,
        contactPhone: null,
      },
      courierCode: data.courierCode ?? null,
      serviceType: data.serviceType ?? null,
    });

    return successResponse(
      {
        provider: rates[0]?.provider ?? null,
        rates,
      },
      "Tarif pengiriman berhasil dihitung"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error quoting delivery rates:", error);
    return errorResponse(
      "Gagal menghitung tarif pengiriman",
      "INTERNAL_ERROR",
      500
    );
  }
}
