import { NextRequest } from "next/server";
import { z } from "zod";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireSuperAdmin } from "@/lib/superadmin";
import { processWithdrawal } from "@/services/wallet/wallet.service";

/**
 * POST /api/superadmin/withdrawals/[id]/process
 *
 * APPROVE — requires the bank transfer reference; moves the held amount out
 *           of pendingBalance into totalWithdrawn and marks the request
 *           COMPLETED.
 * REJECT  — requires a reason; returns the held amount to availableBalance
 *           and records a WITHDRAWAL_RELEASE ledger row.
 *
 * Both paths are single-transaction + row-locked, so two Super Admins cannot
 * settle the same request twice.
 */
const ProcessSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("APPROVE"),
    transferReference: z.string().trim().min(3).max(120),
  }),
  z.object({
    action: z.literal("REJECT"),
    rejectionReason: z.string().trim().min(3).max(500),
  }),
]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const admin = await requireSuperAdmin();
    const { id } = await params;

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = ProcessSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    const updated = await processWithdrawal({
      withdrawalId: id,
      action: parsed.data.action,
      transferReference:
        parsed.data.action === "APPROVE" ? parsed.data.transferReference : null,
      rejectionReason:
        parsed.data.action === "REJECT" ? parsed.data.rejectionReason : null,
      processedByEmail: admin.email,
    });

    return successResponse(
      updated,
      parsed.data.action === "APPROVE"
        ? "Pencairan ditandai selesai"
        : "Pengajuan pencairan ditolak, dana dikembalikan ke saldo merchant"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error processing withdrawal:", error);
    return errorResponse(
      "Gagal memproses pengajuan pencairan",
      "INTERNAL_ERROR",
      500
    );
  }
}
