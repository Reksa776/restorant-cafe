import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { getWalletOverview } from "@/services/wallet/wallet.service";

/**
 * GET /api/admin/wallet
 *
 * The authenticated tenant's wallet (balances + saved bank account), the 20
 * most recent ledger mutations and the 20 most recent withdrawal requests.
 *
 * ADMIN only; `restaurantId` always comes from the session — never from the
 * query string, so one merchant can never read another's money.
 */
export async function GET() {
  try {
    const ctx = await requireAdmin();
    const overview = await getWalletOverview(ctx.restaurantId);
    return successResponse(overview, "Data saldo & pencairan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error loading wallet overview:", error);
    return errorResponse("Gagal memuat data saldo", "INTERNAL_ERROR", 500);
  }
}
