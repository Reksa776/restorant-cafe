import { NextRequest } from "next/server";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches, effectiveWriteBranchId, assertBranchInScope } from "@/lib/auth-helpers";
import { shiftService } from "@/services/shift/shift.service";

/**
 * GET /api/shifts — list shifts.
 * ADMIN: all cashiers' shifts. CASHIER: own shifts only (server-scoped).
 * Query params (all optional):
 *   branchId   — narrow to ONE branch (validated against the user's
 *                assignments; never widens the authorized scope)
 *   userId     — cashier filter; IGNORED for cashiers (always their own)
 *   status     — "OPEN" | "CLOSED"
 *   startDate  — YYYY-MM-DD (shift openedAt gte local midnight)
 *   endDate    — YYYY-MM-DD (shift openedAt lte local end-of-day)
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { searchParams } = new URL(request.url);
    const branchParam = searchParams.get("branchId") || undefined;
    const userId = searchParams.get("userId") || undefined;
    const status = searchParams.get("status") || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;

    const statusFilter = status === "OPEN" || status === "CLOSED" ? status : undefined;
    const filters: {
      userId?: string;
      status?: "OPEN" | "CLOSED";
      startDate?: string;
      endDate?: string;
    } = {
      userId: ctx.role === "ADMIN" ? userId : undefined,
      status: statusFilter,
      startDate,
      endDate,
    };

    // Resolve the read scope. An explicit branchId must belong to one of the
    // user's authorized branches (assertBranchInScope) — it is a filter, never
    // a widening of access. Otherwise the full authorized scope applies.
    let branchScope: string[] | undefined;
    if (branchParam) {
      await assertBranchInScope(ctx, branchParam);
      branchScope = [branchParam];
    } else {
      branchScope = authorizedBranches(ctx);
    }

    if (ctx.role === "ADMIN") {
      const result = await shiftService.listAllShifts(
        ctx.restaurantId,
        branchScope,
        filters
      );
      return successResponse(result);
    }
    const result = await shiftService.listMyShifts(
      ctx.restaurantId,
      ctx.userId,
      branchScope,
      filters
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
