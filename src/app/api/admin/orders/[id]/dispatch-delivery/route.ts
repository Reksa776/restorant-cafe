import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";
import { deliveryService } from "@/services/delivery/delivery.service";

// ============================================================
// POST /api/admin/orders/[id]/dispatch-delivery
//
// Manual "Panggil Ulang Driver" — used when auto-dispatch failed (network,
// courier balance, no driver found) or when the tenant dispatches manually.
// ADMIN + CASHIER (the cashier runs the handover), scoped to the session
// tenant AND the caller's authorized branches. Idempotent: an order with a
// live shipment returns it without booking a second driver.
// ============================================================
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;

    const shipment = await deliveryService.dispatchOrderShipment(
      id,
      ctx.restaurantId,
      { branchFilters: authorizedBranches(ctx) }
    );

    return successResponse(shipment, "Driver berhasil dipanggil");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error dispatching delivery:", error);
    return errorResponse(
      "Gagal memanggil driver",
      "INTERNAL_ERROR",
      500
    );
  }
}
