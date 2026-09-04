import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/auth-helpers";

/**
 * GET /api/auth/session
 *
 * Returns the authenticated restaurant user's public-safe profile for
 * role-aware UI (sidebar visibility, guards). No secrets, no payment data.
 * 401 when not authenticated; 403 when the session role is not allowed.
 */
export async function GET() {
  try {
    const ctx = await requireRoles(["ADMIN", "CASHIER"]);
    return NextResponse.json({
      success: true,
      data: {
        userId: ctx.userId,
        restaurantId: ctx.restaurantId,
        role: ctx.role,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }
}
