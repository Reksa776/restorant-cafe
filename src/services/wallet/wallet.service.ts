import { randomInt } from "node:crypto";
import { Prisma, type WithdrawalStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

// ============================================================
// MERCHANT WALLET & PAYOUT — server-side money movement
//
// Design rules (FinTech):
//  1. Every balance mutation runs inside `prisma.$transaction` and takes a
//     `SELECT ... FOR UPDATE` row lock on `restaurantwallet` FIRST, so two
//     webhooks / two withdrawal clicks can never interleave a read-modify-
//     write on the same wallet.
//  2. Debits are GUARDED (`updateMany` with `availableBalance: { gte }`) —
//     no code path can drive a balance below zero, even if the lock is
//     bypassed in a future refactor.
//  3. Order credits are idempotent at two levels: an in-transaction ledger
//     lookup and a DB unique index on (restaurantId, type, referenceId).
//  4. All amounts are integer Rupiah. Client-supplied amounts are never
//     trusted for fees/net: they are recomputed from env + wallet state.
// ============================================================

export const MIN_WITHDRAWAL_AMOUNT = 50_000;

/** Banks offered in the UI; the API rejects anything else. */
export const SUPPORTED_BANKS = [
  "BCA",
  "BRI",
  "Mandiri",
  "BNI",
  "BSI",
  "CIMB Niaga",
  "Permata",
  "Bank Jago",
  "SeaBank",
] as const;

export interface PayoutConfig {
  /** Platform MDR percent withheld from each order credit (0 = none). */
  mdrPercent: number;
  /** Flat bank/admin fee withheld from each withdrawal. */
  payoutFlatFee: number;
  minWithdrawal: number;
}

/**
 * Read payout settings from env at call time (never at module load) so a
 * deployment can change them without a rebuild. Invalid values fall back to
 * the safe defaults instead of throwing inside a payment webhook.
 */
export function getPayoutConfig(): PayoutConfig {
  const mdr = Number.parseFloat(process.env.PLATFORM_MDR_PERCENT ?? "");
  const fee = Number.parseInt(process.env.PAYOUT_FLAT_FEE ?? "", 10);
  return {
    mdrPercent: Number.isFinite(mdr) && mdr >= 0 && mdr <= 100 ? mdr : 0,
    payoutFlatFee: Number.isFinite(fee) && fee >= 0 ? fee : 0,
    minWithdrawal: MIN_WITHDRAWAL_AMOUNT,
  };
}

function toRupiahInt(value: number | string | Prisma.Decimal): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    throw new ValidationError("Nominal tidak valid");
  }
  return Math.round(numeric);
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

const WITHDRAWAL_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** WD-YYYYMMDD-XXXXXX */
function generateWithdrawalCode(date = new Date()): string {
  const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(
    2,
    "0"
  )}${String(date.getDate()).padStart(2, "0")}`;
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix += WITHDRAWAL_CODE_ALPHABET[randomInt(WITHDRAWAL_CODE_ALPHABET.length)];
  }
  return `WD-${stamp}-${suffix}`;
}

/**
 * Ensure the tenant has a wallet row. Called lazily on every read (existing
 * tenants included) and at registration, so a missing row is self-healing
 * rather than a hard failure.
 */
export async function getOrCreateWallet(
  restaurantId: string,
  client?: Prisma.TransactionClient
) {
  if (!restaurantId) {
    throw new ValidationError("Restoran tidak valid");
  }
  const db: Prisma.TransactionClient = client ?? prisma;
  return db.restaurantWallet.upsert({
    where: { restaurantId },
    create: { restaurantId },
    update: {},
  });
}

/**
 * Serialize every mutation of one wallet. Must be called inside a
 * transaction, AFTER getOrCreateWallet (the row has to exist to be locked).
 */
async function lockWalletRow(
  tx: Prisma.TransactionClient,
  restaurantId: string
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM \`restaurantwallet\` WHERE restaurantId = ${restaurantId} FOR UPDATE`;
}

// ============================================================
// AUTO-CREDIT — a PAID online order increases the merchant's balance.
// ============================================================

export interface CreditWalletFromOrderInput {
  restaurantId: string;
  orderId: string;
  orderNumber: string;
  /** Order grand total (gross), in Rupiah. */
  grossAmount: number | string | Prisma.Decimal;
}

export interface CreditWalletResult {
  /** false when this order was already credited (duplicate webhook). */
  credited: boolean;
  amount: number;
  fee: number;
  netAmount: number;
  balanceAfter: number;
}

async function creditOrderInTransaction(
  tx: Prisma.TransactionClient,
  input: CreditWalletFromOrderInput
): Promise<CreditWalletResult> {
  const gross = toRupiahInt(input.grossAmount);
  if (gross <= 0) {
    throw new ValidationError("Nominal pesanan harus lebih dari 0");
  }

  await getOrCreateWallet(input.restaurantId, tx);
  await lockWalletRow(tx, input.restaurantId);

  // Idempotency (level 1): the same order is never credited twice — a
  // duplicate gateway callback must not create money.
  const existing = await tx.walletLedger.findFirst({
    where: {
      restaurantId: input.restaurantId,
      type: "ORDER_CREDIT",
      referenceId: input.orderId,
    },
    select: { balanceAfter: true },
  });
  if (existing) {
    return {
      credited: false,
      amount: 0,
      fee: 0,
      netAmount: 0,
      balanceAfter: existing.balanceAfter,
    };
  }

  const { mdrPercent } = getPayoutConfig();
  const fee = Math.min(gross, Math.max(0, Math.round((gross * mdrPercent) / 100)));
  const netAmount = gross - fee;

  // Credit the GROSS first, then debit the platform MDR as its own ledger row,
  // so the merchant's statement shows exactly where the difference went.
  const afterGross = await tx.restaurantWallet.update({
    where: { restaurantId: input.restaurantId },
    data: { availableBalance: { increment: gross } },
  });

  await tx.walletLedger.create({
    data: {
      restaurantId: input.restaurantId,
      type: "ORDER_CREDIT",
      amount: gross,
      balanceAfter: afterGross.availableBalance,
      referenceId: input.orderId,
      description: `Pembayaran lunas pesanan ${input.orderNumber}`,
    },
  });

  let balanceAfter = afterGross.availableBalance;
  if (fee > 0) {
    const afterFee = await tx.restaurantWallet.update({
      where: { restaurantId: input.restaurantId },
      data: { availableBalance: { decrement: fee } },
    });
    balanceAfter = afterFee.availableBalance;
    await tx.walletLedger.create({
      data: {
        restaurantId: input.restaurantId,
        type: "PLATFORM_FEE",
        amount: -fee,
        balanceAfter,
        referenceId: input.orderId,
        description: `Biaya platform ${mdrPercent}% untuk ${input.orderNumber}`,
      },
    });
  }

  await tx.restaurantWallet.update({
    where: { restaurantId: input.restaurantId },
    data: { totalEarned: { increment: netAmount } },
  });

  return { credited: true, amount: gross, fee, netAmount, balanceAfter };
}

/**
 * Credit a merchant wallet for a PAID order.
 *
 * Pass `tx` to run inside the SAME transaction that marks the order paid
 * (preferred — payment state and money always commit together). Without it a
 * dedicated transaction is opened.
 */
export async function creditWalletFromOrder(
  input: CreditWalletFromOrderInput,
  tx?: Prisma.TransactionClient
): Promise<CreditWalletResult> {
  if (tx) return creditOrderInTransaction(tx, input);
  return prisma.$transaction((inner) => creditOrderInTransaction(inner, input));
}

// ============================================================
// WITHDRAWAL — client requests a payout to their own bank account.
// ============================================================

export interface RequestWithdrawalInput {
  restaurantId: string;
  userId: string;
  amount: number | string;
}

export interface RequestWithdrawalResult {
  withdrawal: {
    id: string;
    withdrawalCode: string;
    amount: number;
    feeAmount: number;
    netAmount: number;
    bankName: string;
    bankAccountNumber: string;
    bankAccountHolder: string;
    status: WithdrawalStatus;
    createdAt: Date;
  };
  wallet: { availableBalance: number; pendingBalance: number };
}

async function requestWithdrawalInTransaction(
  tx: Prisma.TransactionClient,
  input: RequestWithdrawalInput,
  amount: number,
  feeAmount: number
): Promise<RequestWithdrawalResult> {
  await getOrCreateWallet(input.restaurantId, tx);
  await lockWalletRow(tx, input.restaurantId);

  const wallet = await tx.restaurantWallet.findUniqueOrThrow({
    where: { restaurantId: input.restaurantId },
  });

  if (!wallet.bankName || !wallet.bankAccountNumber || !wallet.bankAccountHolder) {
    throw new ValidationError(
      "Lengkapi rekening bank tujuan terlebih dahulu sebelum mengajukan pencairan"
    );
  }
  if (wallet.availableBalance < amount) {
    throw new ValidationError(
      `Saldo siap tarik tidak mencukupi (tersedia Rp${wallet.availableBalance.toLocaleString(
        "id-ID"
      )})`
    );
  }

  // Atomic, guarded move available → pending. `gte` makes the decrement
  // conditional, so even without the lock a concurrent withdrawal could not
  // spend the same Rupiah twice.
  const held = await tx.restaurantWallet.updateMany({
    where: {
      restaurantId: input.restaurantId,
      availableBalance: { gte: amount },
    },
    data: {
      availableBalance: { decrement: amount },
      pendingBalance: { increment: amount },
    },
  });

  if (held.count === 0) {
    throw new ConflictError(
      "Saldo berubah saat pengajuan diproses. Muat ulang lalu coba lagi."
    );
  }

  const after = await tx.restaurantWallet.findUniqueOrThrow({
    where: { restaurantId: input.restaurantId },
  });

  const withdrawal = await tx.withdrawalRequest.create({
    data: {
      withdrawalCode: generateWithdrawalCode(),
      restaurantId: input.restaurantId,
      amount,
      feeAmount,
      netAmount: amount - feeAmount,
      bankName: wallet.bankName,
      bankAccountNumber: wallet.bankAccountNumber,
      bankAccountHolder: wallet.bankAccountHolder,
      status: "PENDING",
      requestedByUserId: input.userId,
    },
    select: {
      id: true,
      withdrawalCode: true,
      amount: true,
      feeAmount: true,
      netAmount: true,
      bankName: true,
      bankAccountNumber: true,
      bankAccountHolder: true,
      status: true,
      createdAt: true,
    },
  });

  await tx.walletLedger.create({
    data: {
      restaurantId: input.restaurantId,
      type: "WITHDRAWAL_HOLD",
      amount: -amount,
      balanceAfter: after.availableBalance,
      referenceId: withdrawal.id,
      description: `Pengajuan pencairan ${withdrawal.withdrawalCode}`,
    },
  });

  return {
    withdrawal,
    wallet: {
      availableBalance: after.availableBalance,
      pendingBalance: after.pendingBalance,
    },
  };
}

/**
 * Create a PENDING withdrawal request and hold the money.
 *
 * The amount is validated server-side (minimum + available balance) and the
 * bank details are snapshotted from the wallet — never trusted from input.
 */
export async function requestWithdrawal(
  input: RequestWithdrawalInput
): Promise<RequestWithdrawalResult> {
  const amount = toRupiahInt(input.amount);
  const { payoutFlatFee, minWithdrawal } = getPayoutConfig();

  if (amount < minWithdrawal) {
    throw new ValidationError(
      `Minimal penarikan Rp${minWithdrawal.toLocaleString("id-ID")}`
    );
  }
  if (payoutFlatFee >= amount) {
    throw new ValidationError(
      "Nominal penarikan harus lebih besar dari biaya transfer"
    );
  }

  // A generated withdrawalCode collision is astronomically unlikely, but the
  // unique index will reject it; retry the whole transaction instead of
  // surfacing a 500.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction((tx) =>
        requestWithdrawalInTransaction(tx, input, amount, payoutFlatFee)
      );
    } catch (error) {
      if (isUniqueViolation(error)) continue;
      throw error;
    }
  }

  throw new ConflictError(
    "Gagal membuat kode pencairan unik. Silakan coba lagi."
  );
}

// ============================================================
// SUPER ADMIN — approve / reject a withdrawal.
// ============================================================

export interface ProcessWithdrawalInput {
  withdrawalId: string;
  action: "APPROVE" | "REJECT";
  transferReference?: string | null;
  rejectionReason?: string | null;
  processedByEmail?: string | null;
}

const OPEN_WITHDRAWAL_STATUSES: WithdrawalStatus[] = ["PENDING", "PROCESSING"];

export async function processWithdrawal(input: ProcessWithdrawalInput) {
  const transferReference = input.transferReference?.trim() || null;
  const rejectionReason = input.rejectionReason?.trim() || null;

  if (input.action === "APPROVE" && (!transferReference || transferReference.length < 3)) {
    throw new ValidationError(
      "Nomor referensi/bukti transfer wajib diisi minimal 3 karakter"
    );
  }
  if (input.action === "REJECT" && (!rejectionReason || rejectionReason.length < 3)) {
    throw new ValidationError("Alasan penolakan wajib diisi minimal 3 karakter");
  }

  return prisma.$transaction(async (tx) => {
    // Unlocked read ONLY to learn the owning restaurant, so the lock order
    // below is always wallet → withdrawalrequest (the same order
    // requestWithdrawal uses). The authoritative status is re-read after both
    // rows are locked.
    const header = await tx.withdrawalRequest.findUnique({
      where: { id: input.withdrawalId },
      select: { restaurantId: true },
    });
    if (!header) {
      throw new NotFoundError("Pengajuan pencairan tidak ditemukan");
    }

    await lockWalletRow(tx, header.restaurantId);

    // Lock the request: two Super Admins clicking "Approve" at the same
    // moment can only ever produce ONE COMPLETED row.
    await tx.$queryRaw`SELECT id FROM \`withdrawalrequest\` WHERE id = ${input.withdrawalId} FOR UPDATE`;

    const withdrawal = await tx.withdrawalRequest.findUnique({
      where: { id: input.withdrawalId },
    });
    if (!withdrawal) {
      throw new NotFoundError("Pengajuan pencairan tidak ditemukan");
    }
    if (!OPEN_WITHDRAWAL_STATUSES.includes(withdrawal.status)) {
      throw new ConflictError(
        `Pengajuan ${withdrawal.withdrawalCode} sudah diproses (${withdrawal.status})`
      );
    }

    const processedAt = new Date();
    const processedByEmail = input.processedByEmail ?? null;

    if (input.action === "APPROVE") {
      const updated = await tx.withdrawalRequest.updateMany({
        where: {
          id: withdrawal.id,
          status: { in: OPEN_WITHDRAWAL_STATUSES },
        },
        data: {
          status: "COMPLETED",
          transferReference,
          rejectionReason: null,
          processedByEmail,
          processedAt,
        },
      });
      if (updated.count === 0) {
        throw new ConflictError("Status pengajuan berubah. Muat ulang data.");
      }

      const settled = await tx.restaurantWallet.updateMany({
        where: {
          restaurantId: withdrawal.restaurantId,
          pendingBalance: { gte: withdrawal.amount },
        },
        data: {
          pendingBalance: { decrement: withdrawal.amount },
          totalWithdrawn: { increment: withdrawal.amount },
        },
      });
      if (settled.count === 0) {
        throw new ConflictError(
          "Saldo pending tidak konsisten dengan pengajuan. Periksa wallet merchant."
        );
      }

      return tx.withdrawalRequest.findUniqueOrThrow({
        where: { id: withdrawal.id },
      });
    }

    // REJECT — the held money goes straight back to the withdrawable balance.
    const updated = await tx.withdrawalRequest.updateMany({
      where: {
        id: withdrawal.id,
        status: { in: OPEN_WITHDRAWAL_STATUSES },
      },
      data: {
        status: "REJECTED",
        rejectionReason,
        processedByEmail,
        processedAt,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError("Status pengajuan berubah. Muat ulang data.");
    }

    const returned = await tx.restaurantWallet.updateMany({
      where: {
        restaurantId: withdrawal.restaurantId,
        pendingBalance: { gte: withdrawal.amount },
      },
      data: {
        pendingBalance: { decrement: withdrawal.amount },
        availableBalance: { increment: withdrawal.amount },
      },
    });
    if (returned.count === 0) {
      throw new ConflictError(
        "Saldo pending tidak konsisten dengan pengajuan. Periksa wallet merchant."
      );
    }

    const after = await tx.restaurantWallet.findUniqueOrThrow({
      where: { restaurantId: withdrawal.restaurantId },
    });

    await tx.walletLedger.create({
      data: {
        restaurantId: withdrawal.restaurantId,
        type: "WITHDRAWAL_RELEASE",
        amount: withdrawal.amount,
        balanceAfter: after.availableBalance,
        referenceId: withdrawal.id,
        description: `Pengajuan ${withdrawal.withdrawalCode} ditolak — dana dikembalikan`,
      },
    });

    return tx.withdrawalRequest.findUniqueOrThrow({
      where: { id: withdrawal.id },
    });
  });
}

// ============================================================
// QUERIES
// ============================================================

const LEDGER_HISTORY_LIMIT = 20;
const WITHDRAWAL_HISTORY_LIMIT = 20;

export async function getWalletOverview(restaurantId: string) {
  const wallet = await getOrCreateWallet(restaurantId);

  const [ledger, withdrawals] = await Promise.all([
    prisma.walletLedger.findMany({
      where: { restaurantId },
      orderBy: { createdAt: "desc" },
      take: LEDGER_HISTORY_LIMIT,
    }),
    prisma.withdrawalRequest.findMany({
      where: { restaurantId },
      orderBy: { createdAt: "desc" },
      take: WITHDRAWAL_HISTORY_LIMIT,
    }),
  ]);

  const config = getPayoutConfig();

  return {
    wallet: {
      availableBalance: wallet.availableBalance,
      pendingBalance: wallet.pendingBalance,
      totalEarned: wallet.totalEarned,
      totalWithdrawn: wallet.totalWithdrawn,
      bankName: wallet.bankName,
      bankAccountNumber: wallet.bankAccountNumber,
      bankAccountHolder: wallet.bankAccountHolder,
      updatedAt: wallet.updatedAt,
    },
    ledger,
    withdrawals,
    config: {
      minWithdrawal: config.minWithdrawal,
      payoutFlatFee: config.payoutFlatFee,
      mdrPercent: config.mdrPercent,
    },
  };
}

export interface UpdateWalletBankInput {
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

export async function updateWalletBank(
  restaurantId: string,
  input: UpdateWalletBankInput
) {
  const bankName = input.bankName.trim();
  if (!(SUPPORTED_BANKS as readonly string[]).includes(bankName)) {
    throw new ValidationError("Bank tidak didukung");
  }

  // Allow spaces/dashes while typing, store digits only.
  const bankAccountNumber = input.bankAccountNumber.replace(/[\s-]/g, "");
  if (!/^\d{6,32}$/.test(bankAccountNumber)) {
    throw new ValidationError("Nomor rekening harus 6–32 digit angka");
  }

  const bankAccountHolder = input.bankAccountHolder.trim();
  if (bankAccountHolder.length < 3 || bankAccountHolder.length > 120) {
    throw new ValidationError("Nama pemilik rekening harus 3–120 karakter");
  }

  await getOrCreateWallet(restaurantId);

  const wallet = await prisma.restaurantWallet.update({
    where: { restaurantId },
    data: { bankName, bankAccountNumber, bankAccountHolder },
    select: {
      bankName: true,
      bankAccountNumber: true,
      bankAccountHolder: true,
      updatedAt: true,
    },
  });

  return wallet;
}

const WITHDRAWAL_STATUSES: WithdrawalStatus[] = [
  "PENDING",
  "PROCESSING",
  "COMPLETED",
  "REJECTED",
];

export function parseWithdrawalStatus(
  value: string | null | undefined
): WithdrawalStatus | undefined {
  if (!value || value === "ALL") return undefined;
  return WITHDRAWAL_STATUSES.includes(value as WithdrawalStatus)
    ? (value as WithdrawalStatus)
    : undefined;
}

/**
 * Cross-tenant withdrawal queue for the SaaS owner. Returns the newest 200
 * requests plus status totals; `pendingNetTotal` is the money the platform
 * still has to transfer.
 */
export async function listWithdrawalsForSuperAdmin(status?: string) {
  const statusFilter = parseWithdrawalStatus(status);

  const [items, grouped] = await Promise.all([
    prisma.withdrawalRequest.findMany({
      where: statusFilter ? { status: statusFilter } : {},
      include: {
        restaurant: { select: { id: true, name: true, slug: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
    prisma.withdrawalRequest.groupBy({
      by: ["status"],
      _sum: { netAmount: true, amount: true },
      _count: { _all: true },
    }),
  ]);

  const totals: Record<
    WithdrawalStatus,
    { count: number; net: number; gross: number }
  > = {
    PENDING: { count: 0, net: 0, gross: 0 },
    PROCESSING: { count: 0, net: 0, gross: 0 },
    COMPLETED: { count: 0, net: 0, gross: 0 },
    REJECTED: { count: 0, net: 0, gross: 0 },
  };

  for (const row of grouped) {
    totals[row.status] = {
      count: row._count._all,
      net: row._sum.netAmount ?? 0,
      gross: row._sum.amount ?? 0,
    };
  }

  return {
    items,
    summary: {
      pendingCount: totals.PENDING.count + totals.PROCESSING.count,
      pendingNetTotal: totals.PENDING.net + totals.PROCESSING.net,
      completedCount: totals.COMPLETED.count,
      completedNetTotal: totals.COMPLETED.net,
      rejectedCount: totals.REJECTED.count,
      totalCount:
        totals.PENDING.count +
        totals.PROCESSING.count +
        totals.COMPLETED.count +
        totals.REJECTED.count,
    },
  };
}
