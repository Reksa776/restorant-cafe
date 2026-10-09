import { NextRequest } from "next/server";
import {
  successResponse,
  createdResponse,
  errorResponse,
} from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
  effectiveWriteBranchId,
  assertBranchInScope,
} from "@/lib/auth-helpers";
import {
  listExpenses,
  createExpense,
} from "@/services/accounting/expense.service";

// ============================================================
// GET  /api/admin/accounting/expenses   — list + summary (ADMIN only)
// POST /api/admin/accounting/expenses   — create an operational expense
//
// Tenant (`restaurantId`) and actor (`createdByUserId`) come from the
// authenticated session — never from the body. The write branch is resolved
// server-side (header branch / single assignment) and re-validated against
// the caller's assignments, so an unauthorized branch can never be written.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);
    const params = request.nextUrl.searchParams;

    // A client-supplied branch filter must be authorized, never trusted.
    let requestedBranch: string | undefined;
    const branchParam = params.get("branchId");
    if (branchParam) {
      requestedBranch = branchParam;
      await assertBranchInScope(ctx, requestedBranch);
    }

    const result = await listExpenses(
      ctx.restaurantId,
      {
        page: params.get("page") ?? undefined,
        limit: params.get("limit") ?? undefined,
        branchId: requestedBranch,
        categoryId: params.get("categoryId") ?? undefined,
        method: params.get("method") || undefined,
        dateFrom: params.get("dateFrom") ?? undefined,
        dateTo: params.get("dateTo") ?? undefined,
        search: params.get("search") ?? undefined,
      },
      authorizedBranches(ctx)
    );

    return successResponse(result, "Daftar pengeluaran");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing expenses:", error);
    return errorResponse("Failed to list expenses", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    // The receiving branch is validated server-side. Header/single-assignment
    // wins when the body omits it; `restaurantId`/actor from the body are
    // ignored (the schema strips unknown keys).
    const branchId: string | null =
      typeof body.branchId === "string" && body.branchId
        ? body.branchId
        : effectiveWriteBranchId(ctx);
    if (!branchId) {
      return errorResponse("Pilih cabang terlebih dahulu", "FORBIDDEN", 403);
    }
    await assertBranchInScope(ctx, branchId);

    const expense = await createExpense(ctx.restaurantId, ctx.userId, {
      ...body,
      branchId,
    });

    return createdResponse(expense, "Pengeluaran berhasil dicatat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating expense:", error);
    return errorResponse("Failed to create expense", "INTERNAL_ERROR", 500);
  }
}
