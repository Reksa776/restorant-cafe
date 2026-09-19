import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";

/**
 * GET /api/admin/reservations/[id]
 * Admin detail by internal reservation id. Tenant + branch scoped.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;

    const view = await reservationService.getReservationById(
      id,
      ctx.restaurantId,
      authorizedBranches(ctx)
    );

    return successResponse(view);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching reservation:", error);
    return errorResponse("Gagal memuat reservasi", "INTERNAL_ERROR", 500);
  }
}