import { NextRequest } from "next/server";
import { z } from "zod";
import { createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { requestWithdrawal } from "@/services/wallet/wallet.service";

/**
 * POST /api/admin/wallet/withdraw
 *
 * Create a withdrawal request for the authenticated tenant. The amount is the
 * ONLY client input: the fee, net amount and bank snapshot are recomputed
 * server-side from env + the stored wallet, and the balance move is atomic
 * and guarded (no double-spend).
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

    return createdResponse(result, "Pengajuan pencairan berhasil dibuat");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating withdrawal:", error);
    return errorResponse(
      "Gagal membuat pengajuan pencairan",
      "INTERNAL_ERROR",
      500
    );
  }
}
