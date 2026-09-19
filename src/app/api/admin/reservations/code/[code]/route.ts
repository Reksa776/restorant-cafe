import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";
import { ReservationCodeSchema } from "@/services/reservation/reservation.types";

/**
 * GET /api/admin/reservations/code/[code]
 * Admin detail by non-sequential reservation code. Tenant + branch scoped
 * (codes are unique per restaurant, so they can never cross tenants).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { code } = await params;

    const parsed = ReservationCodeSchema.safeParse(code);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const view = await reservationService.getReservationByCode(
      ctx.restaurantId,
      parsed.data,
      authorizedBranches(ctx)
    );

    return successResponse(view);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching reservation by code:", error);
    return errorResponse("Gagal memuat reservasi", "INTERNAL_ERROR", 500);
  }
}