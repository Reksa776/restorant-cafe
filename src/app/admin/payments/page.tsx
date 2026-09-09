"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { paymentService, type Payment } from "@/services/payment.service";
import { ExternalLink, Banknote, Loader2, RefreshCw, AlertCircle, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  normalizeApiError,
  isUnauthorized,
  type NormalizedApiError,
} from "@/lib/api-error-handler";

const statusColors: Record<string, string> = {
  UNPAID: "bg-gray-100 text-gray-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  EXPIRED: "bg-orange-100 text-orange-800",
};

export default function PaymentsPage() {
  const { isLoading: branchCtxLoading } = useBranchContext();
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<NormalizedApiError | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [markingId, setMarkingId] = useState<string | null>(null);

  const loadPayments = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true);
    setError(null);
    try {
      const result = await paymentService.getPayments({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setPayments(result.items);
    } catch (error) {
      if (isUnauthorized(error)) return; // 401 handled by the axios interceptor
      console.error("Failed to load payments:", error);
      setError(normalizeApiError(error));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    let cancelled = false;
    // Wait for branch context so a stale admin_branch_id is cleared before
    // firing the scoped payments request (Main Outlet cashier 403 root cause).
    if (branchCtxLoading) return;
    Promise.resolve().then(() => {
      if (!cancelled) void loadPayments();
    });
    return () => {
      cancelled = true;
    };
  }, [loadPayments, branchCtxLoading]);

  // Realtime: payment created/status changed → refresh without reload.
  // The currently selected status filter is preserved (closure state).
  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.PAYMENT_CREATED,
      REALTIME_EVENT_TYPES.PAYMENT_UPDATED,
      REALTIME_EVENT_TYPES.PAYMENT_STATUS_CHANGED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    () => {
      if (!isLoading) loadPayments(true);
    }
  );

  // Cashier collects a KASIR payment → mark PAID (server enforces once).
  const handleMarkPaid = async (payment: Payment) => {
    setMarkingId(payment.id);
    try {
      await paymentService.markCashierPaymentPaid(payment.id);
      toast.success("Pembayaran kasir berhasil ditandai lunas");
      await loadPayments(true);
    } catch (error) {
      console.error("Failed to mark cashier payment paid:", error);
      toast.error("Gagal menandai pembayaran kasir");
    } finally {
      setMarkingId(null);
    }
  };

  // Repayment: the Payment Dashboard's "Bayar" / "Repayment" actions now
  // navigate to the dedicated QRIS page (/admin/payments/[orderNumber]/qris)
  // which creates or REUSES the QRIS payment and shows the QR with polling.
  // No payment is created from this list — no duplicate intents from here.
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Pembayaran</h1>
        <p className="text-gray-500">Kelola pembayaran restoran</p>
      </div>

      {/* Filter */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4">
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value || "all")}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua Status</SelectItem>
                <SelectItem value="UNPAID">Belum Bayar</SelectItem>
                <SelectItem value="PENDING">Menunggu</SelectItem>
                <SelectItem value="PAID">Lunas</SelectItem>
                <SelectItem value="FAILED">Gagal</SelectItem>
                <SelectItem value="EXPIRED">Kedaluwarsa</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Payments List */}
      <Card>
        <CardHeader>
          <CardTitle>Daftar Pembayaran</CardTitle>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="flex flex-col items-center justify-center py-8 space-y-3 text-center">
              <AlertCircle className="h-8 w-8 text-red-500" />
              <p className="text-sm text-gray-600">{error.message}</p>
              {error.retryable ? (
                <Button variant="outline" size="sm" onClick={() => loadPayments()}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Coba Lagi
                </Button>
              ) : (
                <p className="text-xs text-gray-400">
                  Silakan pilih cabang yang sesuai dengan akun Anda, atau hubungi admin.
                </p>
              )}
            </div>
          ) : isLoading ? (
            <p className="text-center text-gray-500 py-8">Loading...</p>
          ) : payments.length === 0 ? (
            <p className="text-center text-gray-500 py-8">
              Tidak ada pembayaran ditemukan
            </p>
          ) : (
            <div className="space-y-4">
              {payments.map((payment) => (
                <div
                  key={payment.id}
                  className="flex flex-col gap-3 border-b pb-4 last:border-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {payment.order.orderNumber}
                      </p>
                      <Badge className={statusColors[payment.status]}>
                        {payment.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 truncate">
                      {payment.method === "KASIR"
                        ? "Kasir"
                        : payment.method === "QRIS"
                          ? "QRIS"
                          : payment.method || "N/A"}{" "}
                      • {payment.provider || "—"}
                      {payment.branch && (
                        <>
                          {" "}
                          •{" "}
                          <span className="font-medium text-brand-primary">
                            {payment.branch.name || payment.branch.code}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="text-sm text-gray-400">
                      {new Date(payment.createdAt).toLocaleString("id-ID")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <p className="font-medium whitespace-nowrap">
                      Rp{Number(payment.amount).toLocaleString("id-ID")}
                    </p>
                    {/* QRIS payments (PENDING / FAILED / EXPIRED) open the
                        dedicated QRIS repayment page — it reuses the existing
                        createKasirQrisPayment engine (reuse PENDING, retry
                        FAILED/EXPIRED, never duplicate PAID). */}
                    {payment.method === "QRIS" &&
                      payment.status !== "PAID" &&
                      payment.status !== "UNPAID" && (
                        <Link
                          href={`/admin/payments/${payment.order.orderNumber}/qris`}
                        >
                          <Button variant="outline" size="sm">
                            {payment.status === "PENDING" ? (
                              <QrCode className="h-4 w-4 mr-1" />
                            ) : (
                              <RefreshCw className="h-4 w-4 mr-1" />
                            )}
                            {payment.status === "PENDING" ? "Bayar" : "Repayment"}
                          </Button>
                        </Link>
                      )}
                    {/* Legacy VA payments keep the external gateway redirect. */}
                    {payment.method !== "QRIS" &&
                      payment.paymentUrl &&
                      payment.status !== "PAID" &&
                      payment.status !== "FAILED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            window.open(payment.paymentUrl ?? "", "_blank")
                          }
                        >
                          <ExternalLink className="h-4 w-4 mr-1" />
                          Bayar
                        </Button>
                      )}
                    {payment.method === "KASIR" &&
                      payment.status !== "PAID" && (
                        <Button
                          size="sm"
                          className="bg-green-600 hover:bg-green-700"
                          disabled={markingId === payment.id}
                          onClick={() => handleMarkPaid(payment)}
                        >
                          {markingId === payment.id ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Banknote className="h-4 w-4 mr-1" />
                          )}
                          Tandai Dibayar
                        </Button>
                      )}

                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
