import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import {
  SUPPORTED_BANKS,
  updateWalletBank,
} from "@/services/wallet/wallet.service";

/**
 * PUT /api/admin/wallet/bank
 *
 * Save/replace the payout bank account of the authenticated tenant. ADMIN
 * only; the restaurant is taken from the session, so a merchant can only ever
 * change their OWN destination account.
 */
const BankSchema = z.object({
  bankName: z.enum(SUPPORTED_BANKS),
  bankAccountNumber: z.string().trim().min(6).max(40),
  bankAccountHolder: z.string().trim().min(3).max(120),
});

export async function PUT(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = BankSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const wallet = await updateWalletBank(ctx.restaurantId, parsed.data);
    return successResponse(wallet, "Rekening pencairan berhasil disimpan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating wallet bank:", error);
    return errorResponse(
      "Gagal menyimpan rekening bank",
      "INTERNAL_ERROR",
      500
    );
  }
}
