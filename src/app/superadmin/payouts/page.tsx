"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  CheckCircle2,
  Copy,
  Loader2,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  superAdminPayoutService,
  type SuperAdminWithdrawal,
  type SuperAdminWithdrawalOverview,
} from "@/services/wallet.service";
import { cn } from "@/lib/utils";

// ============================================================
// /superadmin/payouts — cross-tenant withdrawal approval queue.
//
// Access is enforced server-side by SUPERADMIN_EMAILS (requireSuperAdmin);
// this page only renders what the API returns. The sidebar shortcut appears
// only for allow-listed emails.
// ============================================================

type FilterKey = "ALL" | "OPEN" | "COMPLETED" | "REJECTED";

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: "ALL", label: "Semua" },
  { key: "OPEN", label: "Menunggu Approval" },
  { key: "COMPLETED", label: "Selesai" },
  { key: "REJECTED", label: "Ditolak" },
];

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
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

function rupiah(value: number): string {
  return `Rp${Number(value || 0).toLocaleString("id-ID")}`;
}

function formatDateTime(value: string): string {
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

type ModalState =
  | { mode: "APPROVE"; request: SuperAdminWithdrawal }
  | { mode: "REJECT"; request: SuperAdminWithdrawal }
  | null;

export default function SuperAdminPayoutsPage() {
  const [data, setData] = useState<SuperAdminWithdrawalOverview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterKey>("OPEN");
  const [modal, setModal] = useState<ModalState>(null);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      const overview = await superAdminPayoutService.list("ALL");
      setData(overview);
      setLoadError(null);
    } catch (error) {
      const message = errorMessage(error, "Gagal memuat pengajuan pencairan");
      setLoadError(message);
      toast.error(message);
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

  const items = useMemo(() => {
    const list = data?.items ?? [];
    if (filter === "ALL") return list;
    if (filter === "OPEN") {
      return list.filter(
        (item) => item.status === "PENDING" || item.status === "PROCESSING"
      );
    }
    return list.filter((item) => item.status === filter);
  }, [data, filter]);

  const openModal = (mode: "APPROVE" | "REJECT", request: SuperAdminWithdrawal) => {
    setModal({ mode, request });
    setReference("");
    setReason("");
  };

  const submit = async () => {
    if (!modal) return;
    setSubmitting(true);
    try {
      await superAdminPayoutService.process(modal.request.id, {
        action: modal.mode,
        ...(modal.mode === "APPROVE"
          ? { transferReference: reference.trim() }
          : { rejectionReason: reason.trim() }),
      });
      toast.success(
        modal.mode === "APPROVE"
          ? `Pencairan ${modal.request.withdrawalCode} ditandai selesai`
          : `Pengajuan ${modal.request.withdrawalCode} ditolak — dana dikembalikan`
      );
      setModal(null);
      await load();
    } catch (error) {
      toast.error(errorMessage(error, "Gagal memproses pengajuan"));
    } finally {
      setSubmitting(false);
    }
  };

  const copyAccount = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Nomor rekening disalin");
    } catch {
      toast.error("Gagal menyalin — salin manual dari tabel");
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <ShieldCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Super Admin SaaS
              </p>
              <h1 className="text-lg font-bold text-gray-900">
                Pencairan Dana Merchant
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => void load()}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Muat ulang
            </Button>
            <Link
              href="/admin/dashboard"
              className={buttonVariants({ variant: "ghost" })}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6">
        {loadError && !data ? (
          <Card>
            <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-50 text-rose-600">
                <ShieldCheck className="h-6 w-6" />
              </span>
              <p className="text-base font-semibold text-gray-900">
                Panel ini hanya untuk Super Admin SaaS
              </p>
              <p className="max-w-md text-sm text-muted-foreground">
                {loadError} Pastikan email akun Anda terdaftar di
                SUPERADMIN_EMAILS, lalu masuk kembali.
              </p>
              <Link
                href="/admin/dashboard"
                className={buttonVariants({ variant: "outline" })}
              >
                <ArrowLeft className="mr-2 h-4 w-4" />
                Kembali ke Dashboard
              </Link>
            </CardContent>
          </Card>
        ) : (
          <>
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Harus Ditransfer
              </p>
              <p className="mt-1 text-2xl font-bold text-gray-900">
                {rupiah(data?.summary.pendingNetTotal ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">
                {data?.summary.pendingCount ?? 0} pengajuan menunggu / diproses
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Sudah Ditransfer
              </p>
              <p className="mt-1 text-2xl font-bold text-emerald-700">
                {rupiah(data?.summary.completedNetTotal ?? 0)}
              </p>
              <p className="text-xs text-muted-foreground">
                {data?.summary.completedCount ?? 0} pencairan selesai
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Ditolak
              </p>
              <p className="mt-1 text-2xl font-bold text-rose-700">
                {data?.summary.rejectedCount ?? 0}
              </p>
              <p className="text-xs text-muted-foreground">
                Dana dikembalikan ke saldo merchant
              </p>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="border-b">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>Daftar Pengajuan</CardTitle>
              <div className="flex flex-wrap gap-1 rounded-lg bg-gray-100 p-1">
                {FILTERS.map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setFilter(entry.key)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
                      filter === entry.key
                        ? "bg-white text-gray-900 shadow-sm"
                        : "text-gray-500 hover:text-gray-700"
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Memuat pengajuan…
              </div>
            ) : items.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center gap-1 text-center">
                <p className="text-sm font-medium text-gray-900">
                  Tidak ada pengajuan pada filter ini
                </p>
                <p className="text-xs text-muted-foreground">
                  Pengajuan baru dari merchant akan muncul di sini.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="pb-2 pr-3 font-medium">Merchant</th>
                      <th className="pb-2 pr-3 font-medium">Pengajuan</th>
                      <th className="pb-2 pr-3 font-medium">Rekening Tujuan</th>
                      <th className="pb-2 pr-3 text-right font-medium">
                        Transfer Bersih
                      </th>
                      <th className="pb-2 pr-3 font-medium">Status</th>
                      <th className="pb-2 text-right font-medium">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {items.map((item) => (
                      <tr key={item.id} className="align-top">
                        <td className="py-3 pr-3">
                          <p className="font-medium text-gray-900">
                            {item.restaurant.name}
                          </p>
                          <p className="font-mono text-[11px] text-muted-foreground">
                            /{item.restaurant.slug}
                          </p>
                        </td>
                        <td className="py-3 pr-3">
                          <p className="font-mono text-xs font-semibold text-gray-900">
                            {item.withdrawalCode}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            {formatDateTime(item.createdAt)}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            diajukan {rupiah(item.amount)} · fee{" "}
                            {rupiah(item.feeAmount)}
                          </p>
                        </td>
                        <td className="py-3 pr-3">
                          <p className="text-xs font-semibold text-gray-900">
                            {item.bankName}
                          </p>
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-xs text-gray-700">
                              {item.bankAccountNumber}
                            </span>
                            <button
                              type="button"
                              aria-label={`Salin nomor rekening ${item.withdrawalCode}`}
                              onClick={() =>
                                void copyAccount(item.bankAccountNumber)
                              }
                              className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700"
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <p className="text-[11px] text-muted-foreground">
                            a.n. {item.bankAccountHolder}
                          </p>
                        </td>
                        <td className="py-3 pr-3 text-right">
                          <p className="font-bold text-gray-900">
                            {rupiah(item.netAmount)}
                          </p>
                        </td>
                        <td className="py-3 pr-3">
                          <span
                            className={cn(
                              "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                              STATUS_LABEL[item.status]?.className
                            )}
                          >
                            {STATUS_LABEL[item.status]?.label ?? item.status}
                          </span>
                          {item.status === "COMPLETED" &&
                            item.transferReference && (
                              <p className="mt-1 max-w-[160px] truncate font-mono text-[11px] text-emerald-700">
                                {item.transferReference}
                              </p>
                            )}
                          {item.status === "REJECTED" &&
                            item.rejectionReason && (
                              <p className="mt-1 max-w-[180px] text-[11px] text-rose-700">
                                {item.rejectionReason}
                              </p>
                            )}
                        </td>
                        <td className="py-3 text-right">
                          {item.status === "PENDING" ||
                          item.status === "PROCESSING" ? (
                            <div className="flex flex-col items-end gap-1">
                              <Button
                                size="sm"
                                onClick={() => openModal("APPROVE", item)}
                              >
                                <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
                                Konfirmasi Transfer
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                                onClick={() => openModal("REJECT", item)}
                              >
                                <XCircle className="mr-1.5 h-3.5 w-3.5" />
                                Tolak
                              </Button>
                            </div>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">
                              {item.processedByEmail ?? "-"}
                              <br />
                              {item.processedAt
                                ? formatDateTime(item.processedAt)
                                : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="text-center text-[11px] text-muted-foreground">
          Akses dibatasi oleh daftar email SUPERADMIN_EMAILS. Setelah
          &ldquo;Konfirmasi Transfer&rdquo;, dana dianggap sudah dikirim dan
          saldo pending merchant berkurang permanen.
        </p>
          </>
        )}
      </main>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-gray-900">
                  {modal.mode === "APPROVE"
                    ? "Konfirmasi Sudah Transfer"
                    : "Tolak Pengajuan"}
                </h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {modal.request.withdrawalCode} ·{" "}
                  {modal.request.restaurant.name}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setModal(null)}
                className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <XCircle className="h-5 w-5" />
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div className="rounded-lg bg-gray-50 p-3 text-sm ring-1 ring-gray-200">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Transfer bersih</span>
                  <span className="font-bold text-gray-900">
                    {rupiah(modal.request.netAmount)}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                  <span>
                    {modal.request.bankName} ·{" "}
                    {modal.request.bankAccountNumber}
                  </span>
                  <span>a.n. {modal.request.bankAccountHolder}</span>
                </div>
              </div>

              {modal.mode === "APPROVE" ? (
                <div className="grid gap-2">
                  <Label htmlFor="transferReference">
                    Nomor Resi / Referensi Transfer
                  </Label>
                  <Input
                    id="transferReference"
                    placeholder="Contoh: 20261129BCA0012345"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                    className="h-10"
                    autoFocus
                  />
                </div>
              ) : (
                <div className="grid gap-2">
                  <Label htmlFor="rejectionReason">Alasan Penolakan</Label>
                  <Textarea
                    id="rejectionReason"
                    placeholder="Contoh: nomor rekening tidak valid"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    autoFocus
                  />
                </div>
              )}
            </div>

            <div className="mt-5 flex items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => setModal(null)}>
                Batal
              </Button>
              <Button
                variant={modal.mode === "APPROVE" ? "default" : "destructive"}
                onClick={() => void submit()}
                disabled={
                  submitting ||
                  (modal.mode === "APPROVE"
                    ? reference.trim().length < 3
                    : reason.trim().length < 3)
                }
              >
                {submitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                {modal.mode === "APPROVE" ? (
                  <>
                    <ArrowUpRight className="mr-1.5 h-4 w-4" />
                    Tandai Selesai
                  </>
                ) : (
                  "Tolak & Kembalikan Dana"
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
