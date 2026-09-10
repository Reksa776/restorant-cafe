"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Download,
  Banknote,
  CreditCard,
  ShoppingCart,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type PaymentReport,
} from "@/services/report.service";
import { ReportSubNav } from "@/components/admin/reports/report-nav";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

const METHOD_OPTIONS = [
  { value: "all", label: "Semua Metode" },
  { value: "KASIR", label: "Cash (Kasir)" },
  { value: "QRIS", label: "QRIS" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "PAID", label: "Lunas" },
  { value: "PENDING", label: "Pending" },
  { value: "FAILED", label: "Gagal" },
  { value: "EXPIRED", label: "Kedaluwarsa" },
  { value: "UNPAID", label: "Belum Dibayar" },
  { value: "REFUNDED", label: "Refund" },
  { value: "CANCELLED", label: "Dibatalkan" },
];

const STATUS_BADGE: Record<string, string> = {
  PAID: "bg-green-100 text-green-800",
  PENDING: "bg-yellow-100 text-yellow-800",
  FAILED: "bg-red-100 text-red-800",
  EXPIRED: "bg-orange-100 text-orange-800",
  UNPAID: "bg-yellow-100 text-yellow-800",
  REFUNDED: "bg-purple-100 text-purple-800",
  CANCELLED: "bg-gray-200 text-gray-600",
};

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function PaymentsReportPage() {
  const { role } = useUserRole();
  const { isLoading: branchCtxLoading, branchId: currentBranchId } =
    useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [methodFilter, setMethodFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<PaymentReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getPaymentReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          method: methodFilter === "all" ? undefined : methodFilter,
          status: statusFilter === "all" ? undefined : statusFilter,
          page,
          limit: 50,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load payment report:", err);
        setError("Gagal memuat laporan pembayaran");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, methodFilter, statusFilter, page]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading, methodFilter, statusFilter, page]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      // Export is the FULL bounded dataset — never page/limit.
      if (methodFilter !== "all") params.set("method", methodFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(
        `/api/reports/payments/export?${params.toString()}`,
        {
          credentials: "same-origin",
          headers: currentBranchId
            ? { "x-branch-id": currentBranchId }
            : undefined,
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Gagal mengekspor laporan");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `payment-report-${period}-${todayStr()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to export:", err);
      toast.error(err instanceof Error ? err.message : "Gagal mengekspor laporan");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Pembayaran</h1>
          <p className="text-gray-500">Aktivitas pembayaran berdasarkan status dan metode</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => loadReport()} disabled={isLoading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={handleExport} disabled={isExporting}>
            {isExporting ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-2" />
            )}
            Download CSV
          </Button>
        </div>
      </div>

      <ReportSubNav />

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => { setPeriod(p.value); setPage(1); }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium border transition-colors ${
                  period === p.value
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {period === "custom" && (
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm text-gray-600">Dari</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
              <label className="text-sm text-gray-600">sampai</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
              <Button variant="secondary" size="sm" onClick={() => { setPage(1); loadReport(); }}>
                Terapkan
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <ReportBranchFilter />

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Metode</span>
              <Select
                value={methodFilter}
                onValueChange={(v) => { if (v !== null) { setMethodFilter(v); setPage(1); } }}
              >
                <SelectTrigger className="w-[150px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METHOD_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Status</span>
              <Select
                value={statusFilter}
                onValueChange={(v) => { if (v !== null) { setStatusFilter(v); setPage(1); } }}
              >
                <SelectTrigger className="w-[150px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {report && (
            <p className="text-xs text-gray-500">
              Periode:{" "}
              {new Date(report.range.start).toLocaleDateString("id-ID")} —{" "}
              {new Date(report.range.end).toLocaleDateString("id-ID")}
            </p>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="text-gray-600">{error}</p>
          <Button variant="outline" onClick={() => loadReport()}>
            Coba Lagi
          </Button>
        </div>
      ) : !report ? null : (
        <div className="space-y-6">
          {/* Summary */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Pembayaran", value: `${report.summary.totalPayments}`, icon: CreditCard },
              { label: "Total Nominal", value: rupiah(report.summary.totalAmount), icon: Banknote },
              { label: "Pembayaran Lunas", value: `${report.summary.paidCount}`, icon: Banknote },
              { label: "Nominal Lunas", value: rupiah(report.summary.paidAmount), icon: Banknote },
            ].map((c) => (
              <Card key={c.label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
                  <c.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">{c.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Status breakdown */}
          {report.statusBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Breakdown Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.statusBreakdown.map((s) => (
                  <div key={s.status} className="flex items-center justify-between gap-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <Badge className={STATUS_BADGE[s.status] ?? "bg-gray-100"}>
                        {s.status}
                      </Badge>
                      <span className="text-sm text-gray-500">{s.count} transaksi</span>
                    </div>
                    <span className="text-sm font-medium tabular-nums">{rupiah(s.amount)}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Payment list */}
          <Card>
            <CardHeader>
              <CardTitle>
                Daftar Pembayaran ({report.summary.totalPayments} total)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.items.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Tidak ada data pembayaran pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Order</th>
                        <th className="pb-2 font-medium">Tanggal</th>
                        <th className="pb-2 font-medium">Kasir</th>
                        <th className="pb-2 font-medium">Shift</th>
                        <th className="pb-2 font-medium">Metode</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium text-right">Nominal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((p) => (
                        <tr key={p.paymentId} className="border-b last:border-0">
                          <td className="py-2 font-medium">{p.orderNumber ?? "—"}</td>
                          <td className="py-2 text-xs text-gray-500">
                            {new Date(p.date).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-2">{p.cashierName ?? "—"}</td>
                          <td className="py-2 text-xs text-gray-500">{p.shiftNumber ?? "—"}</td>
                          <td className="py-2">{p.method ?? "—"}</td>
                          <td className="py-2">
                            <Badge className={STATUS_BADGE[p.status] ?? "bg-gray-100"}>
                              {p.status}
                            </Badge>
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {rupiah(p.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination */}
              {report.pagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 mt-4 border-t">
                  <p className="text-xs text-gray-500">
                    Halaman {report.pagination.page} dari {report.pagination.totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= report.pagination.totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      <ChevronRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}