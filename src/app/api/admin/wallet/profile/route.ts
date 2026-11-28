import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { updateWalletProfile } from "@/services/wallet/wallet.service";

/**
 * PUT /api/admin/wallet/profile
 *
 * Save the unified payout profile of the authenticated tenant in one request:
 * Data Diri Pemilik (KTP/WA/Alamat) + Rekening Bank Tujuan.
 *
 * ADMIN only; the restaurant is taken from the session, so a merchant can only
 * ever change their OWN identity and destination account. All field validation
 * lives in `updateWalletProfile` (Zod) — this handler only forwards the body.
 */
export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const wallet = await updateWalletProfile(ctx.restaurantId, body);
    return successResponse(
      wallet,
      "Data diri pemilik & rekening pencairan berhasil disimpan"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating wallet profile:", error);
    return errorResponse(
      "Gagal menyimpan profil pencairan",
      "INTERNAL_ERROR",
      500
    );
  }
}
