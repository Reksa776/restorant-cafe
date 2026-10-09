import { NextRequest } from "next/server";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin, branchHintFrom } from "@/lib/auth-helpers";
import {
  listExpenseCategories,
  createExpenseCategory,
} from "@/services/accounting/expense.service";

// ============================================================
// GET  /api/admin/accounting/expense-categories  — list (ADMIN only)
// POST /api/admin/accounting/expense-categories  — create (ADMIN only)
//
// Expense categories are RESTAURANT-scoped (never branch-scoped): the tenant
// comes from the session, the name is unique within the tenant, and a
// category can never be referenced across tenants.
// ============================================================

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAdmin(branchHintFrom(request));
    const result = await listExpenseCategories(ctx.restaurantId);
    return successResponse(result, "Daftar kategori pengeluaran");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing expense categories:", error);
    return errorResponse("Failed to list expense categories", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin(branchHintFrom(request));
    const body = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!body || typeof body !== "object") {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const category = await createExpenseCategory(ctx.restaurantId, ctx.userId, body);
    return createdResponse(category, "Kategori pengeluaran ditambahkan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating expense category:", error);
    return errorResponse("Failed to create expense category", "INTERNAL_ERROR", 500);
  }
}
