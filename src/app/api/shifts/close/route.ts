import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * POST /api/shifts/close — close the caller's OPEN shift.
 * Body: { actualCash, notes } — the physical count in the drawer. The server
 * computes expectedCash (= opening + cash sales − refunds) and difference
 * (= actualCash − expectedCash).
 */
export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await requireRoles(["ADMIN", "CASHIER"]);
    const body = await request.json();
    const actualCash = Number(body.actualCash);
    if (!Number.isFinite(actualCash)) {
      throw new ValidationError("Jumlah kas aktual tidak valid");
    }

    const result = await shiftService.closeShift({
      restaurantId,
      userId,
      actualCash,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    });

    return successResponse(result, "Shift berhasil ditutup");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error closing shift:", error);
    return errorResponse("Gagal menutup shift", "INTERNAL_ERROR", 500);
  }
}
