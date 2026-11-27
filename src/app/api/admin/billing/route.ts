import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { billingService } from "@/services/billing/billing.service";

/**
 * GET /api/admin/billing
 *
 * Current subscription, quota usage (branches / staff / transactions this
 * month), the full plan catalog and the tenant's invoice history.
 *
 * ADMIN only; `restaurantId` comes from the session — never the query string.
 */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    const overview = await billingService.getOverview(ctx.restaurantId);
    return successResponse(overview);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error loading billing overview:", error);
    return errorResponse(
      "Gagal memuat data billing",
      "INTERNAL_ERROR",
      500
    );
  }
}
