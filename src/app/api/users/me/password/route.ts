import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireRoles } from "@/lib/auth-helpers";
import { userService } from "@/services/user/user.service";

/**
 * PATCH /api/users/me/password — change the authenticated user's password.
 * Body: { currentPassword, newPassword }.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { restaurantId, userId } = await requireRoles(["ADMIN", "CASHIER"]);
    const body = await request.json();

    await userService.changeOwnPassword({
      restaurantId,
      userId,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });

    return successResponse({ success: true }, "Password berhasil diubah");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error changing password:", error);
    return errorResponse("Gagal mengubah password", "INTERNAL_ERROR", 500);
  }
}
