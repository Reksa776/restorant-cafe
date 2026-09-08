import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * GET /api/shifts/active — the caller's currently OPEN shift (or null) in
 * the current branch context. Used by the UI to decide whether to show
 * "Open Shift" or "Close Shift".
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const shift = await shiftService.getMyOpenShift(
      ctx.restaurantId,
      ctx.userId,
      authorizedBranches(ctx)
    );
    return successResponse({ shift });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching active shift:", error);
    return errorResponse("Gagal memuat shift aktif", "INTERNAL_ERROR", 500);
  }
}
