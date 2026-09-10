import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import {
  listStockMovements,
  type StockMovementType,
} from "@/services/stock/stock.service";

/**
 * GET /api/admin/stock-movements — ADMIN + KASIR (read-only ledger, D3),
 * branch-scoped. Filters: branchId, productId, type, limit.
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const params = request.nextUrl.searchParams;

    const type = params.get("type") as StockMovementType | null;

    // A client-supplied branch filter must be authorized, never trusted — a
    // scoped user cannot read another branch's ledger (STEP 14).
    let requestedBranch: string | undefined;
    const branchParam = params.get("branchId");
    if (branchParam) {
      requestedBranch = branchParam;
      await assertBranchInScope(ctx, requestedBranch);
    }

    const rows = await listStockMovements(
      ctx.restaurantId,
      authorizedBranches(ctx),
      {
        branchId: requestedBranch ?? null,
        productId: params.get("productId") ?? null,
        type,
        startDate: params.get("startDate"),
        endDate: params.get("endDate"),
        limit: params.get("limit") ? Number(params.get("limit")) : undefined,
      }
    );

    return successResponse({ items: rows, total: rows.length }, "Riwayat stok");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing stock movements:", error);
    return errorResponse("Failed to list stock movements", "INTERNAL_ERROR", 500);
  }
}