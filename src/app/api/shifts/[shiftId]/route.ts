import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * GET /api/shifts/[shiftId]
 *
 * ADMIN: any shift of the restaurant. CASHIER: only their OWN shifts
 * (server-side scoping in the service — a cashier can never read another
 * cashier's drawer by guessing an id).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { shiftId } = await params;
    const result = await shiftService.getShift(
      shiftId,
      ctx.restaurantId,
      ctx.userId,
      ctx.role === "ADMIN",
      authorizedBranches(ctx)
    );
    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching shift:", error);
    return errorResponse("Gagal memuat shift", "INTERNAL_ERROR", 500);
  }
}
