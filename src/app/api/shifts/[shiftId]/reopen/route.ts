import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, verifyAdminPassword, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * POST /api/shifts/[shiftId]/reopen — ADMIN reopens a CLOSED shift.
 * Sensitive financial action → admin password re-confirmation required.
 * Body: { password, reason }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ shiftId: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const { shiftId } = await params;
    const body = await request.json();

    if (!body.reason || typeof body.reason !== "string") {
      throw new ValidationError("Alasan pembukaan kembali wajib diisi");
    }
    await verifyAdminPassword(ctx.userId, ctx.restaurantId, body.password);

    const shift = await shiftService.reopenShift({
      restaurantId: ctx.restaurantId,
      adminId: ctx.userId,
      shiftId,
      reason: body.reason,
      branchFilters: authorizedBranches(ctx),
    });

    return successResponse(shift, "Shift berhasil dibuka kembali");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error reopening shift:", error);
    return errorResponse("Gagal membuka kembali shift", "INTERNAL_ERROR", 500);
  }
}
