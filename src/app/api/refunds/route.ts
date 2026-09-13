import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";
import { approvalService } from "@/services/approval/approval.service";

/**
 * GET /api/refunds — pending refund requests (admin review queue).
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN"], branchId);
    const result = await approvalService.listPendingForRestaurant(
      ctx.restaurantId,
      authorizedBranches(ctx)
    );
    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing approvals:", error);
    return errorResponse("Gagal memuat permintaan", "INTERNAL_ERROR", 500);
  }
}

/**
 * POST /api/refunds — cashier initiates a refund request for an order.
 * Body: { orderId, amount, reason }. Approval requires an ADMIN + password.
 */
export async function POST(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const body = await request.json();

    if (!body.orderId || typeof body.orderId !== "string") {
      throw new ValidationError("orderId wajib diisi");
    }
    const amount = Number(body.amount);
    if (!Number.isFinite(amount)) {
      throw new ValidationError("Jumlah refund tidak valid");
    }
    if (!body.reason || typeof body.reason !== "string") {
      throw new ValidationError("Alasan refund wajib diisi");
    }

    // H3.2 — optional quantity-based allocation. The client supplies only
    // orderItemId + quantity; every price/HPP is resolved server-side.
    let items: Array<{ orderItemId: string; quantity: number }> | undefined;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items)) {
        throw new ValidationError("items harus berupa array");
      }
      items = body.items.map((raw: unknown) => {
        if (!raw || typeof raw !== "object") {
          throw new ValidationError("Item refund tidak valid");
        }
        const it = raw as { orderItemId?: unknown; quantity?: unknown };
        if (typeof it.orderItemId !== "string") {
          throw new ValidationError("orderItemId wajib diisi");
        }
        const qty = Number(it.quantity);
        if (!Number.isInteger(qty) || qty <= 0) {
          throw new ValidationError("quantity refund harus bilangan bulat > 0");
        }
        return { orderItemId: it.orderItemId, quantity: qty };
      });
    }

    const refund = await approvalService.requestRefund({
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      orderId: body.orderId,
      amount,
      reason: body.reason,
      items,
      branchFilters: authorizedBranches(ctx),
    });

    return successResponse(refund, "Permintaan refund dikirim ke admin");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error requesting refund:", error);
    return errorResponse("Gagal mengirim permintaan refund", "INTERNAL_ERROR", 500);
  }
}
