// ============================================================
// CLIENT-SIDE API wrapper for merchant wallet & payouts (browser bundle).
// The server implementation lives in ./wallet/wallet.service.ts.
// ============================================================
import api from "@/lib/axios";

export type WalletTxType =
  | "ORDER_CREDIT"
  | "WITHDRAWAL_HOLD"
  | "WITHDRAWAL_RELEASE"
  | "WITHDRAWAL_DISBURSED"
  | "PLATFORM_FEE"
  | "ADJUSTMENT";

export type WithdrawalStatus =
  | "PENDING"
  | "PROCESSING"
  | "COMPLETED"
  | "REJECTED";

export interface WalletSummary {
  availableBalance: number;
  pendingBalance: number;
  totalEarned: number;
  totalWithdrawn: number;
  bankName: string | null;
  bankAccountNumber: string | null;
  bankAccountHolder: string | null;
  /** Owner KYC — required before any payout (server-validated). */
  ownerFullName: string | null;
  ownerNik: string | null;
  ownerPhone: string | null;
  ownerAddress: string | null;
  kycUpdatedAt: string | null;
  /** true only when owner KYC AND bank details are both valid. */
  profileComplete: boolean;
  updatedAt: string;
}

export interface WalletLedgerEntry {
  id: string;
  type: WalletTxType;
  amount: number;
  balanceAfter: number;
  referenceId: string | null;
  description: string;
  createdAt: string;
}

export interface WithdrawalRecord {
  id: string;
  withdrawalCode: string;
  amount: number;
  feeAmount: number;
  netAmount: number;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  /** Snapshot of the owner identity at withdrawal time. */
  ownerFullName: string | null;
  ownerNik: string | null;
  ownerPhone: string | null;
  status: WithdrawalStatus;
  transferReference: string | null;
  rejectionReason: string | null;
  processedByEmail: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface WalletOverview {
  wallet: WalletSummary;
  ledger: WalletLedgerEntry[];
  withdrawals: WithdrawalRecord[];
  config: {
    minWithdrawal: number;
    payoutFlatFee: number;
    mdrPercent: number;
  };
}

export interface SuperAdminWithdrawal extends WithdrawalRecord {
  restaurant: { id: string; name: string; slug: string };
}

export interface SuperAdminWithdrawalOverview {
  items: SuperAdminWithdrawal[];
  summary: {
    pendingCount: number;
    pendingNetTotal: number;
    completedCount: number;
    completedNetTotal: number;
    rejectedCount: number;
    totalCount: number;
  };
}

export interface WalletProfileInput {
  ownerFullName: string;
  ownerNik: string;
  ownerPhone: string;
  ownerAddress: string;
  bankName: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
}

export const walletService = {
  async getOverview(): Promise<WalletOverview> {
    const res = await api.get("/admin/wallet");
    return res.data.data as WalletOverview;
  },

  /**
   * Save Data Diri Pemilik (KTP/WA/Alamat) + Rekening Bank in one request.
   * The server validates every field and stamps `kycUpdatedAt`.
   */
  async updateProfile(input: WalletProfileInput): Promise<WalletSummary> {
    const res = await api.put("/admin/wallet/profile", input);
    return res.data.data as WalletSummary;
  },

  /**
   * Self-service payout. Resolves once the balance is already debited: the
   * withdrawal comes back COMPLETED with an AUTO-WD-… reference, or PENDING
   * when the external disbursement gateway could not be reached yet.
   */
  async withdraw(amount: number): Promise<{
    withdrawal: WithdrawalRecord;
    wallet: {
      availableBalance: number;
      pendingBalance: number;
      totalWithdrawn: number;
    };
    disbursement: {
      auto: boolean;
      success: boolean;
      reference: string | null;
      message: string | null;
    };
  }> {
    const res = await api.post("/admin/wallet/withdraw", { amount });
    return res.data.data;
  },
};

export const superAdminPayoutService = {
  async list(status: WithdrawalStatus | "ALL" = "ALL") {
    const res = await api.get("/superadmin/withdrawals", {
      params: status === "ALL" ? undefined : { status },
    });
    return res.data.data as SuperAdminWithdrawalOverview;
  },

  async process(
    withdrawalId: string,
    input: {
      action: "APPROVE" | "REJECT";
      transferReference?: string;
      rejectionReason?: string;
    }
  ): Promise<WithdrawalRecord> {
    const res = await api.post(
      `/superadmin/withdrawals/${encodeURIComponent(withdrawalId)}/process`,
      input
    );
    return res.data.data as WithdrawalRecord;
  },
};
