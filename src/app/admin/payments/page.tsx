"use client";

import { useEffect, useState } from "react";
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
import { ExternalLink, Banknote, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";

const statusColors: Record<string, string> = {
  UNPAID: "bg-gray-100 text-gray-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  PAID: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  EXPIRED: "bg-orange-100 text-orange-800",
};

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [markingId, setMarkingId] = useState<string | null>(null);

  const loadPayments = async (silent = false) => {
    if (!silent) setIsLoading(true);
    try {
      const result = await paymentService.getPayments({
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setPayments(result.items);
    } catch (error) {
      console.error("Failed to load payments:", error);
      toast.error("Gagal memuat data pembayaran");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPayments();
  }, [statusFilter]);

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
          {isLoading ? (
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
                    </p>
                    <p className="text-sm text-gray-400">
                      {new Date(payment.createdAt).toLocaleString("id-ID")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <p className="font-medium whitespace-nowrap">
                      Rp{Number(payment.amount).toLocaleString("id-ID")}
                    </p>
                    {payment.paymentUrl &&
                      payment.status !== "PAID" &&
                      payment.status !== "FAILED" && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            window.open(payment.paymentUrl, "_blank")
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
