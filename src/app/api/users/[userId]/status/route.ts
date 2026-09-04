import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { userService } from "@/services/user/user.service";

/**
 * PATCH /api/users/[userId]/status — activate/deactivate a staff user
 * (ADMIN only). Body: { isActive: boolean }.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ userId: string }> }
) {
  try {
    const { restaurantId, userId: adminId } = await requireAdmin();
    const { userId } = await params;
    const body = await request.json();

    const user = await userService.setUserActive({
      restaurantId,
      adminId,
      userId,
      isActive: !!body.isActive,
    });

    return successResponse(
      user,
      body.isActive ? "Pengguna diaktifkan" : "Pengguna dinonaktifkan"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating user status:", error);
    return errorResponse("Gagal memperbarui pengguna", "INTERNAL_ERROR", 500);
  }
}
