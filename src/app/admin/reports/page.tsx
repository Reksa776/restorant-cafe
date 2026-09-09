"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Download,
  Banknote,
  Landmark,
  ShoppingCart,
  Package,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type SalesReport,
} from "@/services/report.service";

// ============================================================
// Sales Report / Rekapitulasi Penjualan
// Branch-aware: scoped to the active/authorized branch(es) via x-branch-id.
// CSV export remains ADMIN-only (server-enforced); hidden for kasir.
// ============================================================

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

const PAYMENT_META: Record<
  string,
  { label: string; color: string; icon?: typeof Banknote }
> = {
  cash: { label: "Cash (Kasir)", color: "bg-green-100 text-green-800" },
  qris: { label: "QRIS", color: "bg-blue-100 text-blue-800" },
  va: { label: "VA / Gateway", color: "bg-purple-100 text-purple-800" },
  other: { label: "Lainnya", color: "bg-gray-100 text-gray-700" },
  unpaid: { label: "Belum Dibayar", color: "bg-yellow-100 text-yellow-800" },
  failed: { label: "Gagal / Kedaluwarsa", color: "bg-red-100 text-red-800" },
  refunded: { label: "Refund", color: "bg-orange-100 text-orange-800" },
  cancelled: { label: "Dibatalkan", color: "bg-gray-200 text-gray-600" },
};

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine In",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ReportsPage() {
  const { role } = useUserRole();
  const { isLoading: branchCtxLoading } = useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState<SalesReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getSalesReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load report:", err);
        setError("Gagal memuat laporan penjualan");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate]
  );

  useEffect(() => {
    // Wait for branch context so a stale admin_branch_id is cleared before
    // firing the scoped report request (Main Outlet cashier 403 root cause).
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      const res = await fetch(`/api/reports/sales/export?${params.toString()}`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Gagal mengekspor laporan");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `sales-report-${period}-${todayStr()}.csv`;
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

  const summaryCards = useMemo(() => {
    if (!report) return [];
    const s = report.summary;
    return [
      { label: "Total Penjualan", value: rupiah(s.totalSales), icon: TrendingUp },
      { label: "Total Order", value: `${s.totalOrders} (${s.paidOrders} lunas)`, icon: ShoppingCart },
      { label: "Item Terjual", value: `${s.totalItemsSold}`, icon: Package },
      { label: "Rata-rata Order", value: rupiah(s.averageOrderValue), icon: Banknote },
      { label: "Total Diskon", value: rupiah(s.totalDiscount), icon: Banknote },
      { label: "Total Pajak", value: rupiah(s.totalTax), icon: Landmark },
      { label: "Service Charge", value: rupiah(s.totalServiceCharge), icon: Landmark },
      { label: "Net Sales", value: rupiah(s.netSales), icon: TrendingUp },
    ];
  }, [report]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Reports</h1>
          <p className="text-gray-500">Rekapitulasi penjualan restoran</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadReport()}
            disabled={isLoading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          {role === "ADMIN" && (
            <Button size="sm" onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {/* Period filter */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPeriod(p.value)}
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
              <Button variant="secondary" size="sm" onClick={() => loadReport()}>
                Terapkan
              </Button>
            </div>
          )}
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
            {summaryCards.map((card) => (
              <Card key={card.label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    {card.label}
                  </CardTitle>
                  <card.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">{card.value}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Payment + Order type */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Pembayaran</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.summary.totalOrders === 0 &&
                report.summary.paidOrders === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">
                    Belum ada data pada periode ini
                  </p>
                ) : (
                  Object.entries(report.paymentBreakdown).map(([key, v]) => {
                    const meta = PAYMENT_META[key];
                    if (v.count === 0 && Number(v.amount) === 0) return null;
                    return (
                      <div
                        key={key}
                        className="flex items-center justify-between gap-3 py-1.5"
                      >
                        <div className="flex items-center gap-2">
                          {meta?.icon && <meta.icon className="h-4 w-4 text-muted-foreground" />}
                          <span className="text-sm">{meta?.label || key}</span>
                          <Badge className={meta?.color || ""}>{v.count}</Badge>
                        </div>
                        <span className="text-sm font-medium tabular-nums">
                          {rupiah(v.amount)}
                        </span>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Tipe Order</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(report.orderType).map(([key, v]) => (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <span className="text-sm">{TYPE_LABEL[key] || key}</span>
                    <span className="text-sm font-medium tabular-nums">
                      {v.count} order · {rupiah(v.amount)}
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Best sellers */}
          <Card>
            <CardHeader>
              <CardTitle>Produk Terlaris</CardTitle>
            </CardHeader>
            <CardContent>
              {report.bestSellingProducts.length === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">
                  Belum ada produk terjual pada periode ini
                </p>
              ) : (
                <div className="space-y-2">
                  {report.bestSellingProducts.map((p, i) => (
                    <div
                      key={p.productId}
                      className="flex items-center justify-between gap-3 py-1.5"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="text-xs text-gray-400 w-4">
                          {i + 1}.
                        </span>
                        {p.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={p.imageUrl}
                            alt={p.name}
                            className="h-8 w-8 rounded object-cover flex-shrink-0"
                          />
                        )}
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{p.name}</p>
                          <p className="text-xs text-gray-500">
                            {p.categoryName || "—"}
                          </p>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium tabular-nums">
                          {p.quantitySold} terjual
                        </p>
                        <p className="text-xs text-gray-500 tabular-nums">
                          {rupiah(p.revenue)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Busiest hours */}
          {report.busiestHours.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Jam Tersibuk</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-1 h-32">
                  {report.busiestHours.map((h) => {
                    const max = Math.max(
                      ...report.busiestHours.map((x) => x.orders),
                      1
                    );
                    const height = Math.max(
                      Math.round((h.orders / max) * 100),
                      4
                    );
                    return (
                      <div
                        key={h.hour}
                        className="flex-1 flex flex-col items-center gap-1"
                        title={`${h.hour}:00 — ${h.orders} order`}
                      >
                        <div
                          className="w-full rounded-t bg-gray-800"
                          style={{ height: `${height}%` }}
                        />
                        <span className="text-[10px] text-gray-500">
                          {h.hour}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}