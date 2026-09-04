import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * GET /api/shifts/active — the caller's currently OPEN shift (or null).
 * Used by the UI to decide whether to show "Open Shift" or "Close Shift".
 */
export async function GET() {
  try {
    const { restaurantId, userId } = await requireRoles(["ADMIN", "CASHIER"]);
    const shift = await shiftService.getMyOpenShift(restaurantId, userId);
    return successResponse({ shift });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching active shift:", error);
    return errorResponse("Gagal memuat shift aktif", "INTERNAL_ERROR", 500);
  }
}
