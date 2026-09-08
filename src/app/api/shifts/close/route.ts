import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, effectiveWriteBranchId } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * POST /api/shifts/close — close the caller's OPEN shift (in the current
 * branch context). Body: { actualCash, notes } — the physical count in the
 * drawer. The server computes expectedCash (= opening + cash sales − refunds)
 * and difference (= actualCash − expectedCash).
 *
 * Branch resolution: for a branch-scoped user with a single branch, that
 * branch is used; with multiple branches and no branch context, the request
 * is rejected (ambiguous) so the wrong branch's shift is never closed.
 */
export async function POST(request: NextRequest) {
  try {
    const branchId = request.headers.get("x-branch-id");
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const body = await request.json();
    const actualCash = Number(body.actualCash);
    if (!Number.isFinite(actualCash)) {
      throw new ValidationError("Jumlah kas aktual tidak valid");
    }

    const result = await shiftService.closeShift({
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      actualCash,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      branchId: effectiveWriteBranchId(ctx),
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
