import { NextRequest } from "next/server";
import { z } from "zod";
import { createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { requestWithdrawal } from "@/services/wallet/wallet.service";

/**
 * POST /api/admin/wallet/withdraw
 *
 * SELF-SERVICE payout for the authenticated tenant. The amount is the ONLY
 * client input: the fee, net amount and bank snapshot are recomputed
 * server-side from env + the stored wallet, and the balance move is atomic
 * and guarded (no double-spend). No Super Admin approval is involved — the
 * wallet is debited and the withdrawal settles immediately (or is held while
 * the external disbursement gateway confirms, when enabled).
 */
const WithdrawSchema = z.object({
  amount: z.coerce.number().finite().positive(),
});

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAdmin();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = WithdrawSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError("Nominal penarikan tidak valid");
    }

    const result = await requestWithdrawal({
      restaurantId: ctx.restaurantId,
      userId: ctx.userId,
      amount: parsed.data.amount,
    });

    return createdResponse(
      result,
      result.disbursement.success
        ? "Pencairan berhasil diproses dan saldo telah dipotong"
        : "Pencairan dibuat — transfer otomatis sedang diproses"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating withdrawal:", error);
    return errorResponse(
      "Gagal memproses pencairan saldo",
      "INTERNAL_ERROR",
      500
    );
  }
}
