import { NextRequest } from "next/server";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches, effectiveWriteBranchId } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * GET /api/shifts — list shifts.
 * ADMIN: all cashiers' shifts. CASHIER: own shifts only (server-scoped).
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    if (ctx.role === "ADMIN") {
      const result = await shiftService.listAllShifts(
        ctx.restaurantId,
        authorizedBranches(ctx)
      );
      return successResponse(result);
    }
    const result = await shiftService.listMyShifts(
      ctx.restaurantId,
      ctx.userId,
      authorizedBranches(ctx)
    );
    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing shifts:", error);
    return errorResponse("Gagal memuat shift", "INTERNAL_ERROR", 500);
  }
}

/**
 * POST /api/shifts — open a shift (cashier). Body: { openingCash, notes }.
 */
export async function POST(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const body = await request.json();
    const openingCash = Number(body.openingCash);
    if (!Number.isFinite(openingCash)) {
      throw new ValidationError("Jumlah kas awal tidak valid");
    }
    const shift = await shiftService.openShift({
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      openingCash,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      branchId: effectiveWriteBranchId(ctx),
    });

    return createdResponse(shift, "Shift berhasil dibuka");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error opening shift:", error);
    return errorResponse("Gagal membuka shift", "INTERNAL_ERROR", 500);
  }
}
