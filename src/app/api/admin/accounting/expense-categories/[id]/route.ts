import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin, branchHintFrom } from "@/lib/auth-helpers";
import { updateExpenseCategory } from "@/services/accounting/expense.service";

// ============================================================
// PATCH /api/admin/accounting/expense-categories/[id]
//   — rename and/or toggle active (ADMIN only)
//
// Restaurant-scoped: the category is only reachable when it belongs to the
// caller's tenant. Categories are never hard-deleted (soft-disabled via
// isActive) so historical expenses keep a valid reference.
// ============================================================

type Params = { params: Promise<{ id: string }> };

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

    const category = await updateExpenseCategory(
      ctx.restaurantId,
      id,
      ctx.userId,
      body
    );
    return successResponse(category, "Kategori pengeluaran diperbarui");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating expense category:", error);
    return errorResponse("Failed to update expense category", "INTERNAL_ERROR", 500);
  }
}
