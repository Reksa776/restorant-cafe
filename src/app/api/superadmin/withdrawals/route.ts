import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireSuperAdmin } from "@/lib/superadmin";
import { listWithdrawalsForSuperAdmin } from "@/services/wallet/wallet.service";

/**
 * GET /api/superadmin/withdrawals?status=PENDING|PROCESSING|COMPLETED|REJECTED
 *
 * Cross-tenant payout queue for the SaaS owner (SUPERADMIN_EMAILS). Includes
 * the restaurant name/slug and the totals still waiting to be transferred.
 */
export async function GET(request: NextRequest) {
  try {
    await requireSuperAdmin();

    const status = request.nextUrl.searchParams.get("status");
    const data = await listWithdrawalsForSuperAdmin(status ?? undefined);
    return successResponse(data, "Daftar pengajuan pencairan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing superadmin withdrawals:", error);
    return errorResponse(
      "Gagal memuat pengajuan pencairan",
      "INTERNAL_ERROR",
      500
    );
  }
}
