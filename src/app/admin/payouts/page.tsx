"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownToLine,
  Building2,
  CheckCircle2,
  Clock,
  Copy,
  History,
  Landmark,
  Loader2,
  RefreshCw,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  walletService,
  type WalletLedgerEntry,
  type WalletOverview,
  type WithdrawalRecord,
  type WithdrawalStatus,
} from "@/services/wallet.service";
import { cn } from "@/lib/utils";

// ============================================================
// /admin/payouts — merchant wallet, bank account and withdrawals.
//
// Every number shown here is informational: the server recomputes the fee and
// net amount, and performs the balance move atomically.
// ============================================================

const BANKS = [
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

const STATUS_META: Record<
  WithdrawalStatus,
  { label: string; className: string }
> = {
  PENDING: {
    label: "Menunggu",
    className: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  },
  PROCESSING: {
    label: "Diproses",
    className: "bg-sky-50 text-sky-700 ring-1 ring-sky-200",
  },
  COMPLETED: {
    label: "Selesai",
    className: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  },
  REJECTED: {
    label: "Ditolak",
    className: "bg-rose-50 text-rose-700 ring-1 ring-rose-200",
  },
};

const LEDGER_META: Record<
  WalletLedgerEntry["type"],
  { label: string; tone: string }
> = {
  ORDER_CREDIT: { label: "Pesanan lunas", tone: "text-emerald-600" },
  PLATFORM_FEE: { label: "Biaya platform", tone: "text-amber-600" },
  WITHDRAWAL_HOLD: { label: "Penarikan ditahan", tone: "text-slate-600" },
  WITHDRAWAL_RELEASE: { label: "Dana dikembalikan", tone: "text-sky-600" },
  ADJUSTMENT: { label: "Penyesuaian", tone: "text-slate-600" },
};

function rupiah(value: number): string {
  return `Rp${Number(value || 0).toLocaleString("id-ID")}`;
}

function formatDateTime(value: string | null): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function errorMessage(error: unknown, fallback: string): string {
  return (
    (error as { response?: { data?: { message?: string } } })?.response?.data
      ?.message || fallback
  );
}

function BalanceCard({
  label,
  value,
  hint,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof Wallet;
  accent: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
            accent
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-0.5 truncate text-2xl font-bold tracking-tight text-gray-900">
            {value}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status }: { status: WithdrawalStatus }) {
  const meta = STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
        meta.className
      )}
    >
      {meta.label}
    </span>
  );
}

export default function PayoutsPage() {
  const [data, setData] = useState<WalletOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab, setTab] = useState<"withdrawals" | "ledger">("withdrawals");

  const [bankName, setBankName] = useState<string>(BANKS[0]);
  const [accountNumber, setAccountNumber] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [savingBank, setSavingBank] = useState(false);

  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const overview = await walletService.getOverview();
      setData(overview);
      if (overview.wallet.bankName) {
        setBankName(overview.wallet.bankName);
        setAccountNumber(overview.wallet.bankAccountNumber ?? "");
        setAccountHolder(overview.wallet.bankAccountHolder ?? "");
      }
    } catch (error) {
      toast.error(errorMessage(error, "Gagal memuat data saldo"));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) void load();
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const wallet = data?.wallet;
  const config = data?.config;
  const hasBank = Boolean(
    wallet?.bankName && wallet?.bankAccountNumber && wallet?.bankAccountHolder
  );

  const numericAmount = useMemo(() => {
    const parsed = Number(amount);
    return Number.isFinite(parsed) ? Math.floor(parsed) : 0;
  }, [amount]);

  const netEstimate = config
    ? Math.max(0, numericAmount - config.payoutFlatFee)
    : 0;

  const saveBank = async () => {
    setSavingBank(true);
    try {
      await walletService.updateBank({
        bankName,
        bankAccountNumber: accountNumber,
        bankAccountHolder: accountHolder,
      });
      toast.success("Rekening pencairan tersimpan");
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Gagal menyimpan rekening"));
    } finally {
      setSavingBank(false);
    }
  };

  const withdraw = async () => {
    if (!config) return;
    if (!hasBank) {
      toast.error("Simpan rekening bank tujuan terlebih dahulu");
      return;
    }
    if (numericAmount < config.minWithdrawal) {
      toast.error(
        `Minimal penarikan ${rupiah(config.minWithdrawal)}`
      );
      return;
    }
    if (numericAmount > (wallet?.availableBalance ?? 0)) {
      toast.error("Nominal melebihi saldo siap tarik");
      return;
    }

    setSubmitting(true);
    try {
      const result = await walletService.withdraw(numericAmount);
      toast.success(
        `Pengajuan ${result.withdrawal.withdrawalCode} dibuat — menunggu persetujuan Super Admin`
      );
      setAmount("");
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Gagal mengajukan pencairan"));
    } finally {
      setSubmitting(false);
    }
  };

  const copyAccount = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Nomor rekening disalin");
    } catch {
      toast.error("Gagal menyalin — salin manual dari kartu rekening");
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Memuat data saldo…
      </div>
    );
  }

  if (!data || !wallet || !config) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Data saldo belum bisa dimuat.
          </p>
          <Button variant="outline" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Coba lagi
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-gray-900">
            Saldo &amp; Pencairan
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Dana dari pembayaran online yang lunas otomatis masuk ke saldo
            kafe Anda. Ajukan pencairan ke rekening bank kapan saja.
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Muat ulang
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <BalanceCard
          label="Saldo Siap Tarik"
          value={rupiah(wallet.availableBalance)}
          hint="Bisa diajukan pencairan sekarang"
          icon={Wallet}
          accent="bg-emerald-50 text-emerald-600"
        />
        <BalanceCard
          label="Sedang Diproses"
          value={rupiah(wallet.pendingBalance)}
          hint="Menunggu persetujuan Super Admin"
          icon={Clock}
          accent="bg-amber-50 text-amber-600"
        />
        <BalanceCard
          label="Total Sudah Dicairkan"
          value={rupiah(wallet.totalWithdrawn)}
          hint={`Total pendapatan bersih ${rupiah(wallet.totalEarned)}`}
          icon={CheckCircle2}
          accent="bg-sky-50 text-sky-600"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        {/* Bank destination */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Rekening Bank Tujuan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="bankName">Bank</Label>
              <select
                id="bankName"
                value={bankName}
                onChange={(event) => setBankName(event.target.value)}
                className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {BANKS.map((bank) => (
                  <option key={bank} value={bank}>
                    {bank}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="accountNumber">Nomor Rekening</Label>
              <Input
                id="accountNumber"
                inputMode="numeric"
                placeholder="Contoh: 1234567890"
                value={accountNumber}
                onChange={(event) => setAccountNumber(event.target.value)}
                className="h-10"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="accountHolder">Nama Pemilik Rekening</Label>
              <Input
                id="accountHolder"
                placeholder="Sesuai buku tabungan"
                value={accountHolder}
                onChange={(event) => setAccountHolder(event.target.value)}
                className="h-10"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => void saveBank()}
                disabled={
                  savingBank ||
                  !accountNumber.trim() ||
                  accountHolder.trim().length < 3
                }
              >
                {savingBank && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Simpan Rekening
              </Button>
              {hasBank && (
                <Button
                  variant="ghost"
                  onClick={() =>
                    void copyAccount(wallet.bankAccountNumber ?? "")
                  }
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Salin No. Rekening
                </Button>
              )}
            </div>

            {!hasBank && (
              <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 ring-1 ring-amber-200">
                Rekening wajib dilengkapi sebelum pengajuan pencairan bisa
                dibuat.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Withdraw */}
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ArrowDownToLine className="h-4 w-4 text-muted-foreground" />
              Tarik Dana
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2">
              <Label htmlFor="amount">Nominal Penarikan</Label>
              <Input
                id="amount"
                type="number"
                inputMode="numeric"
                min={0}
                step={1000}
                placeholder={`Minimal ${rupiah(config.minWithdrawal)}`}
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-11 text-lg font-semibold"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setAmount(String(Math.floor(wallet.availableBalance / 2)))
                }
                disabled={wallet.availableBalance < config.minWithdrawal * 2}
              >
                50%
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAmount(String(wallet.availableBalance))}
                disabled={wallet.availableBalance < config.minWithdrawal}
              >
                Tarik Semua
              </Button>
            </div>

            <div className="space-y-1 rounded-lg bg-gray-50 p-3 text-sm ring-1 ring-gray-200">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nominal diajukan</span>
                <span className="font-medium">{rupiah(numericAmount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">
                  Biaya transfer
                </span>
                <span className="font-medium">
                  −{rupiah(config.payoutFlatFee)}
                </span>
              </div>
              <div className="flex justify-between border-t border-gray-200 pt-1">
                <span className="font-medium text-gray-700">
                  Estimasi diterima
                </span>
                <span className="font-bold text-emerald-700">
                  {rupiah(netEstimate)}
                </span>
              </div>
            </div>

            <Button
              className="h-11 w-full"
              onClick={() => void withdraw()}
              disabled={
                submitting ||
                !hasBank ||
                numericAmount < config.minWithdrawal ||
                numericAmount > wallet.availableBalance
              }
            >
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Ajukan Pencairan
            </Button>

            <p className="text-xs text-muted-foreground">
              Minimal {rupiah(config.minWithdrawal)}. Dana diproses manual oleh
              Super Admin ke rekening yang tersimpan.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* History */}
      <Card>
        <CardHeader className="border-b">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <History className="h-4 w-4 text-muted-foreground" />
              Riwayat
            </CardTitle>
            <div className="inline-flex rounded-lg bg-gray-100 p-1">
              <button
                type="button"
                onClick={() => setTab("withdrawals")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  tab === "withdrawals"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                Pengajuan Pencairan
              </button>
              <button
                type="button"
                onClick={() => setTab("ledger")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                  tab === "ledger"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                Mutasi Saldo
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {tab === "withdrawals" ? (
            data.withdrawals.length === 0 ? (
              <EmptyState
                icon={Landmark}
                title="Belum ada pengajuan pencairan"
                description="Pengajuan yang Anda buat akan tampil di sini beserta statusnya."
              />
            ) : (
              <div className="divide-y divide-gray-100">
                {data.withdrawals.map((item: WithdrawalRecord) => (
                  <div
                    key={item.id}
                    className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-gray-900">
                          {item.withdrawalCode}
                        </span>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDateTime(item.createdAt)} ·{" "}
                        {item.bankName} · {item.bankAccountNumber} ·{" "}
                        {item.bankAccountHolder}
                      </p>
                      {item.status === "COMPLETED" &&
                        item.transferReference && (
                          <p className="mt-1 text-xs text-emerald-700">
                            Referensi transfer:{" "}
                            <span className="font-mono">
                              {item.transferReference}
                            </span>
                          </p>
                        )}
                      {item.status === "REJECTED" &&
                        item.rejectionReason && (
                          <p className="mt-1 text-xs text-rose-700">
                            Alasan ditolak: {item.rejectionReason}
                          </p>
                        )}
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="font-semibold text-gray-900">
                        {rupiah(item.netAmount)}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        diajukan {rupiah(item.amount)} · fee{" "}
                        {rupiah(item.feeAmount)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : data.ledger.length === 0 ? (
            <EmptyState
              icon={Wallet}
              title="Belum ada mutasi saldo"
              description="Setiap pembayaran online yang lunas dan setiap penarikan akan tercatat di sini."
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {data.ledger.map((entry) => {
                const meta = LEDGER_META[entry.type];
                return (
                  <div
                    key={entry.id}
                    className="flex items-start justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">
                        {meta.label}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {entry.description}
                      </p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p
                        className={cn(
                          "text-sm font-bold",
                          entry.amount >= 0 ? "text-emerald-600" : meta.tone
                        )}
                      >
                        {entry.amount >= 0 ? "+" : "−"}
                        {rupiah(Math.abs(entry.amount))}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        saldo {rupiah(entry.balanceAfter)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof Wallet;
  title: string;
  description: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <Icon className="h-5 w-5" />
      </span>
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <p className="max-w-sm text-xs text-muted-foreground">{description}</p>
    </div>
  );
}
