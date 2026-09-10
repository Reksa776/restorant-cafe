"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useUserRole } from "@/hooks/use-user-role";
import {
  normalizeApiError,
  isUnauthorized,
  type NormalizedApiError,
} from "@/lib/api-error-handler";
import { shiftService, type CashierShift } from "@/services/shift.service";
import { toast } from "sonner";
import {
  Loader2,
  ArrowLeft,
  Banknote,
  Smartphone,
  TrendingUp,
  Clock,
  Wallet,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type ShiftDetail = {
  shift: CashierShift;
  totals: {
    openingCash: number;
    cashSales: number;
    refunds: number;
    expectedCash: number;
  };
  cashRevenue: number;
  qrisRevenue: number;
  totalRevenue: number;
  transactionCount: number;
};

const rupiah = (n: number | string) =>
  `Rp${Number(n || 0).toLocaleString("id-ID")}`;

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function fmtDuration(openedAt: string, closedAt?: string | null) {
  const start = new Date(openedAt).getTime();
  const end = closedAt ? new Date(closedAt).getTime() : Date.now();
  const diffMs = Math.max(0, end - start);
  const hours = Math.floor(diffMs / 3600000);
  const minutes = Math.floor((diffMs % 3600000) / 60000);
  if (hours === 0) return `${minutes}m`;
  return `${hours}j ${minutes}m`;
}

export default function ShiftDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { role, isLoading: roleLoading } = useUserRole();
  const shiftId = params.shiftId as string;

  const [detail, setDetail] = useState<ShiftDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<NormalizedApiError | null>(null);

  const load = useCallback(async () => {
    if (roleLoading || !role) return;
    setLoading(true);
    setError(null);
    try {
      const res = await shiftService.getShift(shiftId);
      setDetail(res as unknown as ShiftDetail);
    } catch (err) {
      if (isUnauthorized(err)) return;
      console.error("Failed to load shift detail:", err);
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [shiftId, role, roleLoading]);

  useEffect(() => {
    load();
  }, [load]);

  if (roleLoading || loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" size="sm" onClick={() => router.back()}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Kembali
        </Button>
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-gray-600">{error.message}</p>
          {error.retryable && (
            <Button variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Coba Lagi
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (!detail) return null;

  const { shift, totals, cashRevenue, qrisRevenue, totalRevenue, transactionCount } = detail;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Back button */}
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        <ArrowLeft className="h-4 w-4 mr-1" /> Kembali ke Monitoring Shift
      </Button>

      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold font-mono">{shift.shiftNumber}</h1>
          {shift.status === "OPEN" ? (
            <Badge className="bg-green-100 text-green-700 border-green-200">
              Buka
            </Badge>
          ) : (
            <Badge className="bg-gray-100 text-gray-600">Tutup</Badge>
          )}
        </div>
        <p className="text-muted-foreground mt-1">
          Detail laporan shift kasir
        </p>
      </div>

      {/* Shift Information */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Clock className="h-5 w-5 text-muted-foreground" />
          Informasi Shift
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Kasir</p>
            <p className="font-medium">{shift.user?.name || "—"}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cabang</p>
            <p className="font-medium text-blue-700">
              {shift.branch?.name || shift.branch?.code || "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Shift Number</p>
            <p className="font-mono font-medium">{shift.shiftNumber}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status</p>
            <p className="font-medium">
              {shift.status === "OPEN" ? "Aktif" : "Selesai"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Dibuka</p>
            <p className="text-sm">{fmtTime(shift.openedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ditutup</p>
            <p className="text-sm">{fmtTime(shift.closedAt)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Durasi</p>
            <p className="font-medium">
              {fmtDuration(shift.openedAt, shift.closedAt)}
            </p>
          </div>
        </div>
      </div>

      {/* Revenue */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-muted-foreground" />
          Revenue
        </h2>
        <div className="grid grid-cols-3 gap-4">
          <div className="rounded-lg bg-green-50 border border-green-200 p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-green-700 mb-1">
              <Banknote className="h-4 w-4" />
              <span className="text-sm font-medium">CASH</span>
            </div>
            <p className="text-xl font-bold text-green-900">
              {rupiah(cashRevenue)}
            </p>
          </div>
          <div className="rounded-lg bg-blue-50 border border-blue-200 p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-blue-700 mb-1">
              <Smartphone className="h-4 w-4" />
              <span className="text-sm font-medium">QRIS</span>
            </div>
            <p className="text-xl font-bold text-blue-900">
              {rupiah(qrisRevenue)}
            </p>
          </div>
          <div className="rounded-lg bg-purple-50 border border-purple-200 p-4 text-center">
            <div className="flex items-center justify-center gap-1 text-purple-700 mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-sm font-medium">Total</span>
            </div>
            <p className="text-xl font-bold text-purple-900">
              {rupiah(totalRevenue)}
            </p>
          </div>
        </div>
        <div className="mt-3 text-sm text-muted-foreground">
          Transaksi: <span className="font-medium">{transactionCount}</span> order
        </div>
      </div>

      {/* Reconciliation */}
      <div className="rounded-xl border bg-card p-6">
        <h2 className="font-semibold text-lg mb-4 flex items-center gap-2">
          <Wallet className="h-5 w-5 text-muted-foreground" />
          Reconciliasi
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Kas Awal</p>
            <p className="font-medium">{rupiah(totals.openingCash)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Ekspektasi Kas</p>
            <p className="font-medium">{rupiah(totals.expectedCash)}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Kas Aktual</p>
            <p className="font-medium">
              {shift.closingCash != null ? rupiah(shift.closingCash) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Selisih</p>
            <p
              className={`font-medium ${
                shift.difference != null && Number(shift.difference) !== 0
                  ? "text-red-600"
                  : "text-muted-foreground"
              }`}
            >
              {shift.difference != null ? rupiah(shift.difference) : "—"}
            </p>
          </div>
        </div>
        {totals.refunds > 0 && (
          <div className="mt-3 text-sm text-muted-foreground">
            Refunds: <span className="font-medium text-red-600">{rupiah(totals.refunds)}</span>
          </div>
        )}
      </div>

      {/* Transaction list */}
      {shift.payments && shift.payments.length > 0 && (
        <div className="rounded-xl border bg-card overflow-x-auto">
          <div className="p-4 border-b">
            <h2 className="font-semibold">Daftar Transaksi</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted-foreground border-b">
                <th className="px-3 py-2">Order</th>
                <th className="px-3 py-2">Waktu</th>
                <th className="px-3 py-2">Metode</th>
                <th className="px-3 py-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shift.payments.map((p) => (
                <tr key={p.id} className="border-b last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">
                    {p.order?.orderNumber || "—"}
                  </td>
                  <td className="px-3 py-2 text-xs">{fmtTime(p.paidAt)}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-xs">
                      {p.method === "KASIR" ? "CASH" : p.method}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">
                    {rupiah(p.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
