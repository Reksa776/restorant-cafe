import { NextRequest } from "next/server";
import { reservationService } from "@/services/reservation/reservation.service";
import {
  CreateAdminReservationSchema,
  ReservationListQuerySchema,
} from "@/services/reservation/reservation.types";
import {
  createdResponse,
  paginatedResponse,
  errorResponse,
} from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
  assertBranchInScope,
} from "@/lib/auth-helpers";

async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);

    const params = Object.fromEntries(request.nextUrl.searchParams);

    const parsed = ReservationListQuerySchema.safeParse(params);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    // ?branchId= is a validated filter, never a crossed boundary (mirrors
    // GET /api/orders): an explicit branch must be in scope; without it the
    // caller is limited to their authorized branches.
    let scope: string[] | undefined;
    if (parsed.data.branchId) {
      await assertBranchInScope(ctx, parsed.data.branchId);
      scope = [parsed.data.branchId];
    } else {
      scope = authorizedBranches(ctx);
    }

    const result = await reservationService.listReservations(
      ctx.restaurantId,
      parsed.data,
      scope
    );

    return paginatedResponse(
      result.items,
      result.total,
      result.page,
      result.limit,
      "Daftar reservasi"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing reservations:", error);
    return errorResponse("Gagal memuat reservasi", "INTERNAL_ERROR", 500);
  }
}

async function POST(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);

    const body = await request.json();

    const parsed = CreateAdminReservationSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    // The body branchId is a validated write target, never trusted blindly:
    // it must belong to the user's restaurant AND, for branch-scoped callers,
    // be one of their assigned branches.
    await assertBranchInScope(ctx, parsed.data.branchId);

    const view = await reservationService.createAdminReservation(
      ctx.restaurantId,
      parsed.data
    );

    return createdResponse(view, "Reservasi berhasil dibuat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating admin reservation:", error);
    return errorResponse("Gagal membuat reservasi", "INTERNAL_ERROR", 500);
  }
}

export { GET, POST };