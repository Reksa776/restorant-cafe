import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { ReservationAdminAvailabilityQuerySchema } from "@/services/reservation/reservation.types";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  assertBranchInScope,
} from "@/lib/auth-helpers";

/**
 * GET /api/admin/reservations/availability
 * Slot availability for the admin board, addressed by branchId (scope
 * validated via assertBranchInScope — no cross-branch probing).
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);

    const params = Object.fromEntries(request.nextUrl.searchParams);
    const parsed = ReservationAdminAvailabilityQuerySchema.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    await assertBranchInScope(ctx, parsed.data.branchId);

    const result = await reservationService.checkAvailability(
      ctx.restaurantId,
      parsed.data.branchId,
      {
        reservationDate: parsed.data.date,
        partySize: parsed.data.partySize,
        startMinutes: parsed.data.startMinutes,
        durationMinutes: parsed.data.durationMinutes,
        tableId: parsed.data.tableId,
      }
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error checking admin reservation availability:", error);
    return errorResponse(
      "Gagal memuat ketersediaan",
      "INTERNAL_ERROR",
      500
    );
  }
}