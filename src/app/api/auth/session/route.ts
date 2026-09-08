import { NextResponse } from "next/server";
import { requireRoles } from "@/lib/auth-helpers";
import { branchService } from "@/services/branch/branch.service";

/**
 * GET /api/auth/session
 *
 * Returns the authenticated restaurant user's public-safe profile for
 * role-aware UI (sidebar visibility, guards) plus branch context:
 *
 *   {
 *     success, data: {
 *       userId, restaurantId, role,
 *       branches: [...],        // branches the user may access
 *       branchId: string|null,  // active branch (validated server-side)
 *       branchScoped: boolean
 *     }
 *   }
 *
 * No secrets, no payment data. 401 when not authenticated; 403 when the
 * session role is not allowed.
 */
export async function GET() {
  try {
    const ctx = await requireRoles(["ADMIN", "CASHIER"]);

    const branchResult = await branchService.listBranches(
      ctx.restaurantId,
      ctx.branchScoped ? ctx.branchIds : undefined
    );

    return NextResponse.json({
      success: true,
      data: {
        userId: ctx.userId,
        restaurantId: ctx.restaurantId,
        role: ctx.role,
        branches: branchResult.items,
        branchId: null,
        branchScoped: ctx.branchScoped,
      },
    });
  } catch {
    return NextResponse.json(
      { success: false, message: "Unauthorized" },
      { status: 401 }
    );
  }
}