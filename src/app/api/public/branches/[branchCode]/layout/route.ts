import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { NotFoundError, AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { layoutService } from "@/services/layout/layout.service";

type Params = { params: Promise<{ branchCode: string }> };

/**
 * GET /api/public/branches/[branchCode]/layout
 * Customer floor map. READ-ONLY (no POST/PUT/PATCH/DELETE). Rate limited.
 *
 * The branch is resolved SERVER-SIDE from branchCode and must be an ACTIVE
 * branch of an ACTIVE restaurant. The restaurant context comes from that DB
 * relationship (`branch.restaurantId`) — never from a client-supplied
 * restaurantId (none is accepted here at all). A code belonging to another
 * tenant's branch simply fails to resolve (404), and the layout is always
 * read back scoped to the resolved branch's own restaurant, so a branchCode
 * can never cross the tenant boundary. Colliding codes across restaurants
 * resolve exactly like the public table-lookup route (branch.code is unique
 * per restaurant; the query narrows to active branches).
 *
 * Response is a strict allow-list DTO:
 *   { branchCode, branchId, version, canvas, items[] } where each item is
 *   { tableId, number, name, capacity, shape, x, y, width, height, rotation }
 * Only PLACED + ACTIVE tables are returned (a placed table deactivated after
 * the save is dropped here — the floor map never advertises a table that
 * cannot be booked). No restaurantId / layoutId / audit / payment / customer /
 * order data is ever exposed.
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    assertRateLimit(rateLimitKey("public-branch-layout", request), 240, 60_000);

    const { branchCode } = await params;
    const code = branchCode.trim().toUpperCase();

    const branch = await prisma.branch.findFirst({
      where: {
        code,
        isActive: true,
        restaurant: { isActive: true },
      },
      select: { id: true, code: true, restaurantId: true },
    });
    if (!branch) {
      throw new NotFoundError("Cabang tidak ditemukan");
    }

    const layout = await layoutService.getBranchLayout(
      branch.restaurantId,
      branch.id
    );

    // Public floor map advertises only tables that are currently ACTIVE. The
    // layout geometry itself stays untouched; this is a presentation filter.
    const activeIds =
      layout.items.length > 0
        ? new Set(
            (
              await prisma.table.findMany({
                where: {
                  restaurantId: branch.restaurantId,
                  branchId: branch.id,
                  isActive: true,
                },
                select: { id: true },
              })
            ).map((t) => t.id)
          )
        : new Set<string>();

    return successResponse({
      branchCode: branch.code,
      branchId: layout.branchId,
      version: layout.version,
      canvas: layout.canvas,
      items: layout.items.filter((item) => activeIds.has(item.tableId)),
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching branch layout:", error);
    return errorResponse("Gagal memuat layout", "INTERNAL_ERROR", 500);
  }
}