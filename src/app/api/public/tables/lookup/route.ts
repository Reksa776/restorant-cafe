import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { resolveBranding } from "@/services/branding/branding.service";

/**
 * GET /api/public/tables/lookup?number={tableNumber}[&branchCode={code}]
 * Look up a table for the QR flow. No authentication required.
 *
 * - `branchCode` (multi-branch QR `/t/{branchCode}/{tableNumber}`): resolves
 *   the table within that branch only, so Jakarta Table 01 and Bandung
 *   Table 01 never collide.
 * - Without `branchCode` (legacy QR `/t/{tableNumber}`): if exactly ONE
 *   table has that number across the restaurant it resolves; if the number
 *   exists in multiple branches an ambiguous error is returned telling the
 *   admin to regenerate the QR (branch-scoped).
 *
 * Returns table + restaurant + branch information.
 */
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

    const branchWhere = {
      restaurant: {
        isActive: true,
      },
      isActive: true,
    };

    // (1) Branch-scoped resolution — the table must belong to an active
    // branch with the given code in an active restaurant.
    if (branchCode) {
      const branch = await prisma.branch.findFirst({
        where: {
          code: branchCode,
          restaurant: { isActive: true },
        },
        select: { id: true, restaurantId: true, code: true, name: true },
      });
      if (!branch) {
        throw new AppError("Cabang tidak ditemukan", 404, "NOT_FOUND");
      }

      const branchTable = await prisma.table.findFirst({
        where: {
          ...branchWhere,
          number,
          branchId: branch.id,
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
      return presentTable(branchTable, branch);
    }

    // (2) Legacy fallback `/t/{tableNumber}`. Only safe when the number is
    // unique across all branches; otherwise the caller must scan the
    // branch-specific QR.
    const candidates = await prisma.table.findMany({
      where: { ...branchWhere, number },
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

    return presentTable(table, branch);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error looking up table:", error);
    return errorResponse("Failed to look up table", "INTERNAL_ERROR", 500);
  }
}

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
      name: table.restaurant.name,
      branding: resolveBranding(table.restaurant.name, table.restaurant.settings),
    },
  });
}
