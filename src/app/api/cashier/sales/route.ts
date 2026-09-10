import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import { getCashierSales } from "@/services/cashier-sales/cashier-sales.service";

/**
 * GET /api/cashier/sales — Cashier sales history (transaction ledger).
 *
 * KASIR: server forces userId from session — cannot see other cashiers' data.
 * ADMIN: can filter by cashierId, branchId, shiftId, paymentMethod, status, orderType, date range.
 *
 * Query params (all optional):
 *   page           — page number (default 1)
 *   limit          — items per page (max 50, default 30)
 *   startDate      — YYYY-MM-DD
 *   endDate        — YYYY-MM-DD
 *   shiftId        — filter by specific shift
 *   paymentMethod  — KASIR | QRIS
 *   paymentStatus  — PAID | FAILED | EXPIRED | CANCELLED
 *   orderType      — DINE_IN | TAKEAWAY | DELIVERY
 *   cashierId      — ADMIN only: filter by specific cashier
 *   branchId       — validated branch filter
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { searchParams } = new URL(request.url);

    // Parse filters
    const page = parseInt(searchParams.get("page") || "1", 10);
    const limit = parseInt(searchParams.get("limit") || "30", 10);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const shiftId = searchParams.get("shiftId") || undefined;
    const paymentMethod = searchParams.get("paymentMethod") || undefined;
    const paymentStatus = searchParams.get("paymentStatus") || undefined;
    const orderType = searchParams.get("orderType") || undefined;
    const cashierIdParam = searchParams.get("cashierId") || undefined;
    const branchParam = searchParams.get("branchId") || undefined;

    // Resolve branch scope
    let branchScope: string[] | undefined;
    if (branchParam) {
      await assertBranchInScope(ctx, branchParam);
      branchScope = [branchParam];
    } else {
      branchScope = authorizedBranches(ctx);
    }

    // Cashier userId is forced server-side. Client-provided cashierId is
    // IGNORED for KASIR role — they can only see their own transactions.
    const forcedUserId = ctx.role === "CASHIER" ? ctx.userId : null;
    const cashierId =
      ctx.role === "ADMIN" ? cashierIdParam : undefined;

    const result = await getCashierSales(
      ctx.restaurantId,
      {
        page,
        limit,
        startDate,
        endDate,
        shiftId,
        paymentMethod,
        paymentStatus,
        orderType,
        cashierId,
        branchId: branchParam,
      },
      {
        userId: forcedUserId,
        branchFilters: branchScope,
      }
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching cashier sales:", error);
    return errorResponse("Gagal memuat riwayat penjualan", "INTERNAL_ERROR", 500);
  }
}
