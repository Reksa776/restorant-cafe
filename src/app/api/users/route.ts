import { NextRequest } from "next/server";
import {
  successResponse,
  createdResponse,
  errorResponse,
} from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { userService } from "@/services/user/user.service";
import { assertCanCreateStaff } from "@/services/billing/plan-guard.service";

/**
 * GET /api/users — list staff users (ADMIN only).
 * Passwords never leave the server.
 */
export async function GET() {
  try {
    const { restaurantId } = await requireAdmin();
    const result = await userService.listUsers(restaurantId);
    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing users:", error);
    return errorResponse("Gagal memuat pengguna", "INTERNAL_ERROR", 500);
  }
}

/**
 * POST /api/users — create a staff user (ADMIN only).
 * Body: { name, email, password, role: "ADMIN" | "CASHIER" | "KITCHEN",
 *         branchId?: string | null }
 */
export async function POST(request: NextRequest) {
  try {
    const { restaurantId, userId } = await requireAdmin();
    // Phase 4 — staff quota (STARTER 2, BASIC 5, PRO/ENTERPRISE unlimited).
    await assertCanCreateStaff(restaurantId);

    const body = await request.json();

    const user = await userService.createUser({
      restaurantId,
      adminId: userId,
      name: body.name,
      email: body.email,
      password: body.password,
      role: body.role,
      branchId: body.branchId ?? null,
    });

    return createdResponse(user, "Pengguna berhasil dibuat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating user:", error);
    return errorResponse("Gagal membuat pengguna", "INTERNAL_ERROR", 500);
  }
}
