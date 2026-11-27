import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveBranding } from "@/services/branding/branding.service";
import { resolveRequestTenant, setTenantCookie } from "@/lib/tenant";

/**
 * GET /api/public/tables/lookup?number={tableNumber}[&branchCode={code}]
 * Look up a table for the QR flow. No authentication required.
 *
 * Multi-tenant (Phase 2):
 * - The tenant is resolved from ?slug= / ?restaurantId= / the tenant cookie
 *   when present. The QR itself is a legitimate tenant hint, so a branchCode
 *   with no explicit tenant resolves ONLY when it is unambiguous across all
 *   merchants; two tenants sharing `PUSAT` get a 400 instead of whichever row
 *   Postgres/MySQL returns first.
 * - `branchCode` (multi-branch QR `/t/{branchCode}/{tableNumber}`) resolves
 *   the table within that branch only, so Jakarta Table 01 and Bandung
 *   Table 01 never collide.
 * - A successful lookup SETS the tenant cookie, which scopes the subsequent
 *   menu/order/payment calls to this merchant.
 */

const TABLE_SELECT = {
  id: true,
  number: true,
  name: true,
  capacity: true,
  status: true,
  branchId: true,
  restaurant: {
    select: {
      id: true,
      slug: true,
      name: true,
      settings: {
        select: {
          siteName: true,
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          accentColor: true,
        },
      },
    },
  },
} as const;

type TableLookupRow = {
  id: string;
  number: number;
  name: string;
  capacity: number;
  status: string;
  branchId: string | null;
  restaurant: {
    id: string;
    slug: string;
    name: string;
    settings: {
      siteName: string | null;
      logoUrl: string | null;
      primaryColor: string | null;
      secondaryColor: string | null;
      accentColor: string | null;
    } | null;
  };
};

function presentTable(
  table: TableLookupRow,
  branch: { id: string; code: string; name: string } | null
) {
  if (table.status === "MAINTENANCE") {
    throw new AppError(
      "Meja sedang tidak tersedia",
      400,
      "TABLE_UNAVAILABLE"
    );
  }

  return successResponse({
    tableId: table.id,
    tableNumber: table.number,
    tableName: table.name,
    capacity: table.capacity,
    status: table.status,
    branch: branch
      ? { id: branch.id, code: branch.code, name: branch.name }
      : null,
    restaurant: {
      id: table.restaurant.id,
      slug: table.restaurant.slug,
      name: table.restaurant.name,
      storeUrl: `/r/${table.restaurant.slug}`,
      branding: resolveBranding(table.restaurant.name, table.restaurant.settings),
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(rateLimitKey("public-table-lookup", request), 120, 60_000);

    const { searchParams } = new URL(request.url);
    const numberStr = searchParams.get("number");
    const branchCode = searchParams.get("branchCode");

    if (!numberStr) {
      throw new ValidationError("number is required");
    }

    const number = parseInt(numberStr, 10);
    if (isNaN(number) || number < 1) {
      throw new ValidationError("Invalid table number");
    }

    // Optional explicit tenant context (store link / previous scan).
    const tenant = await resolveRequestTenant(request);

    // (1) Branch-scoped resolution — the table must belong to an ACTIVE
    // branch of an ACTIVE restaurant, and to the resolved tenant when known.
    if (branchCode) {
      let branch: {
        id: string;
        restaurantId: string;
        code: string;
        name: string;
      } | null;

      if (tenant) {
        branch = await prisma.branch.findFirst({
          where: {
            code: branchCode,
            restaurantId: tenant.id,
            isActive: true,
            restaurant: { isActive: true },
          },
          select: { id: true, restaurantId: true, code: true, name: true },
        });
      } else {
        const candidates = await prisma.branch.findMany({
          where: {
            code: branchCode,
            isActive: true,
            restaurant: { isActive: true },
          },
          select: { id: true, restaurantId: true, code: true, name: true },
          take: 2,
        });
        if (candidates.length > 1) {
          // Two merchants use the same branch code — never guess.
          throw new AppError(
            "Kode cabang dipakai lebih dari satu restoran. Sertakan slug restoran atau pindai QR terbaru.",
            400,
            "TENANT_AMBIGUOUS"
          );
        }
        branch = candidates[0] ?? null;
      }

      if (!branch) {
        throw new AppError("Cabang tidak ditemukan", 404, "NOT_FOUND");
      }

      const branchTable = await prisma.table.findFirst({
        where: {
          number,
          branchId: branch.id,
          restaurantId: branch.restaurantId,
          isActive: true,
          restaurant: { isActive: true },
        },
        select: TABLE_SELECT,
      });

      if (!branchTable) {
        throw new AppError(
          "Meja tidak ditemukan di cabang ini",
          404,
          "NOT_FOUND"
        );
      }

      const response = presentTable(branchTable, branch);
      // Persist the tenant for the rest of the customer flow (menu/order/paid).
      setTenantCookie(response, branchTable.restaurant.slug);
      return response;
    }

    // (2) Legacy QR `/t/{tableNumber}`. Scoped to the resolved tenant when we
    // have one; otherwise the number must be unique across ALL tenants.
    const candidates = await prisma.table.findMany({
      where: {
        number,
        isActive: true,
        restaurant: { isActive: true },
        ...(tenant ? { restaurantId: tenant.id } : {}),
      },
      select: TABLE_SELECT,
    });

    if (candidates.length === 0) {
      throw new AppError("Meja tidak ditemukan", 404, "NOT_FOUND");
    }

    if (candidates.length > 1) {
      throw new AppError(
        "Nomor meja tersedia di beberapa cabang — silakan pindai QR baru",
        400,
        "TABLE_AMBIGUOUS"
      );
    }

    const table = candidates[0];
    const branch = table.branchId
      ? await prisma.branch.findUnique({
          where: { id: table.branchId },
          select: { id: true, code: true, name: true },
        })
      : null;

    const response = presentTable(table, branch);
    setTenantCookie(response, table.restaurant.slug);
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error looking up table:", error);
    return errorResponse("Failed to look up table", "INTERNAL_ERROR", 500);
  }
}
