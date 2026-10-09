import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireAdmin,
  branchHintFrom,
  authorizedBranches,
} from "@/lib/auth-helpers";
import {
  getExpense,
  updateExpense,
  deleteExpense,
} from "@/services/accounting/expense.service";

// ============================================================
// GET    /api/admin/accounting/expenses/[id]  — detail (ADMIN only)
// PATCH  /api/admin/accounting/expenses/[id]  — update (ADMIN only)
// DELETE /api/admin/accounting/expenses/[id]  — hard delete + audit snapshot
//
// Every operation is restaurant-scoped AND filtered by authorizedBranches,
// so a branch-scoped admin can never read or mutate another branch's expense.
// ============================================================

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin(branchHintFrom(request));
    const { id } = await params;
    const expense = await getExpense(
      ctx.restaurantId,
      id,
      authorizedBranches(ctx)
    );
    return successResponse(expense, "Detail pengeluaran");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error getting expense:", error);
    return errorResponse("Failed to get expense", "INTERNAL_ERROR", 500);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin(branchHintFrom(request));
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const expense = await updateExpense(
      ctx.restaurantId,
      id,
      authorizedBranches(ctx),
      ctx.userId,
      body
    );
    return successResponse(expense, "Pengeluaran diperbarui");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating expense:", error);
    return errorResponse("Failed to update expense", "INTERNAL_ERROR", 500);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    const ctx = await requireAdmin(branchHintFrom(request));
    const { id } = await params;
    const result = await deleteExpense(
      ctx.restaurantId,
      id,
      authorizedBranches(ctx),
      ctx.userId
    );
    return successResponse(result, "Pengeluaran dihapus");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deleting expense:", error);
    return errorResponse("Failed to delete expense", "INTERNAL_ERROR", 500);
  }
}
