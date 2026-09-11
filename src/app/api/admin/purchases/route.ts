import { NextRequest } from "next/server";
import {
  successResponse,
  createdResponse,
  errorResponse,
} from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
  effectiveWriteBranchId,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import {
  createPurchase,
  listPurchases,
  type PurchaseItemInput,
  type PurchaseIngredientInput,
} from "@/services/purchase/purchase.service";

function jsonBody(request: NextRequest) {
  return request.json().catch(() => null) as Promise<Record<string, unknown> | null>;
}

/**
 * GET /api/admin/purchases — ADMIN + KASIR (read-only, D3), branch-scoped.
 * POST /api/admin/purchases — ADMIN only; creates a DRAFT purchase.
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const params = request.nextUrl.searchParams;

    // A client-supplied branch filter must be authorized, never trusted.
    let requestedBranch: string | undefined;
    const branchParam = params.get("branchId");
    if (branchParam) {
      requestedBranch = branchParam;
      await assertBranchInScope(ctx, requestedBranch);
    }

    const result = await listPurchases(
      ctx.restaurantId,
      authorizedBranches(ctx),
      {
        status: params.get("status"),
        supplierId: params.get("supplierId"),
        branchId: requestedBranch,
        startDate: params.get("startDate"),
        endDate: params.get("endDate"),
        limit: params.get("limit") ? Number(params.get("limit")) : undefined,
        skip: params.get("skip") ? Number(params.get("skip")) : undefined,
      }
    );
    return successResponse(result, "Daftar pembelian");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing purchases:", error);
    return errorResponse("Failed to list purchases", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = await jsonBody(request);
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    // The receiving branch is validated server-side — a client can never
    // push an unauthorized branch. Header/single-assignment wins when the
    // body omits it.
    let branchId: string | null =
      typeof body.branchId === "string" && body.branchId
        ? body.branchId
        : effectiveWriteBranchId(ctx);
    if (!branchId) {
      return errorResponse("Pilih cabang terlebih dahulu", "FORBIDDEN", 403);
    }
    await assertBranchInScope(ctx, branchId);

    if (typeof body.supplierId !== "string" || !body.supplierId) {
      return errorResponse("Supplier wajib diisi", "VALIDATION_ERROR", 400);
    }

    const purchase = await createPurchase(ctx.restaurantId, {
      supplierId: body.supplierId,
      branchId,
      notes: typeof body.notes === "string" ? body.notes : null,
      items: (
        Array.isArray(body.items) ? (body.items as unknown[]) : []
      ) as PurchaseItemInput[],
      purchaseIngredients: (
        Array.isArray(body.purchaseIngredients)
          ? (body.purchaseIngredients as unknown[])
          : []
      ) as PurchaseIngredientInput[],
    });

    return createdResponse(purchase, "Pembelian (draft) berhasil dibuat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating purchase:", error);
    return errorResponse("Failed to create purchase", "INTERNAL_ERROR", 500);
  }
}