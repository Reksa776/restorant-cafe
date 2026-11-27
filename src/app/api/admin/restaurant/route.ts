import { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { buildTenantPublicUrl, resolveRootDomain } from "@/lib/tenant-url";

// ============================================================
// GET   /api/admin/restaurant — current tenant profile (+ public slug)
// PATCH /api/admin/restaurant — update name / address / phone / email
//
// Tenant isolation: the target row is ALWAYS the session's restaurantId
// (`requireAdmin` reads it from the DB user row). No restaurant id is accepted
// from the client, so an admin can never edit another merchant's profile.
// The public slug is immutable here — changing it would break already-printed
// QR codes and shared store URLs.
// ============================================================

const optionalText = (max: number) =>
  z
    .union([z.string().max(max), z.null()])
    .optional()
    .transform((value) => {
      if (value === undefined) return undefined;
      if (value === null) return null;
      const trimmed = value.trim();
      return trimmed.length === 0 ? null : trimmed;
    });

const UpdateRestaurantSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Nama restoran minimal 2 karakter")
    .max(120, "Nama restoran maksimal 120 karakter"),
  address: optionalText(300),
  phone: optionalText(30),
  email: z
    .union([z.string().trim().email("Email tidak valid").max(190), z.literal(""), z.null()])
    .optional()
    .transform((value) => (value ? value : null)),
});

const profileSelect = {
  id: true,
  slug: true,
  name: true,
  address: true,
  phone: true,
  email: true,
} as const;

/**
 * Public addresses of the tenant: the canonical subdomain storefront plus
 * the `/r/<slug>` path fallback. `subdomainEnabled` is false when the app is
 * reached through a raw IP / no root domain, so the UI can show the path
 * link only.
 */
function tenantAddress(slug: string, request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  return {
    storeUrl: `/r/${slug}`,
    subdomainUrl: buildTenantPublicUrl(slug, request.headers),
    subdomainEnabled: Boolean(
      resolveRootDomain(host, process.env.NEXT_PUBLIC_ROOT_DOMAIN)
    ),
  };
}

/** GET /api/admin/restaurant — profile of the authenticated tenant. */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: ctx.restaurantId },
      select: profileSelect,
    });

    if (!restaurant) {
      throw new AppError("Restoran tidak ditemukan", 404, "NOT_FOUND");
    }

    return successResponse({
      ...restaurant,
      ...tenantAddress(restaurant.slug, request),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching restaurant profile:", error);
    return errorResponse("Gagal memuat profil restoran", "INTERNAL_ERROR", 500);
  }
}

/** PATCH /api/admin/restaurant — ADMIN updates the restaurant profile. */
export async function PATCH(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = UpdateRestaurantSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    // Never allow a client-supplied slug / id to overwrite another tenant:
    // the where clause is the session's restaurantId only.
    const restaurant = await prisma.restaurant.update({
      where: { id: ctx.restaurantId },
      data: {
        name: parsed.data.name,
        ...(parsed.data.address !== undefined ? { address: parsed.data.address } : {}),
        ...(parsed.data.phone !== undefined ? { phone: parsed.data.phone } : {}),
        ...(parsed.data.email !== undefined ? { email: parsed.data.email } : {}),
      },
      select: profileSelect,
    });

    return successResponse(
      { ...restaurant, ...tenantAddress(restaurant.slug, request) },
      "Profil restoran berhasil disimpan"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating restaurant profile:", error);
    return errorResponse("Gagal menyimpan profil restoran", "INTERNAL_ERROR", 500);
  }
}
