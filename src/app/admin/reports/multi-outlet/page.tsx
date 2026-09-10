"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  TrendingUp,
  ShoppingCart,
  Store,
  Banknote,
  Award,
} from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type MultiOutletReport,
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

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function MultiOutletReportPage() {
  const { role } = useUserRole();
  const { isLoading: branchCtxLoading } = useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState<MultiOutletReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getMultiOutletReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load multi-outlet report:", err);
        setError("Gagal memuat laporan multi outlet");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading]);

  // ADMIN-only guard at the UI layer (server also enforces).
  if (role !== "ADMIN") {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <AlertCircle className="h-10 w-10 text-gray-400 mb-3" />
        <p className="text-gray-500 text-lg font-medium">Hanya admin yang dapat mengakses halaman ini</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Multi Outlet</h1>
          <p className="text-gray-500">Perbandingan performa seluruh cabang</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => loadReport()} disabled={isLoading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <ReportSubNav />

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
            {[
              { label: "Total Net Sales", value: rupiah(report.summary.netSales), icon: TrendingUp },
              { label: "Total Order", value: `${report.summary.totalOrders}`, icon: ShoppingCart },
              { label: "Total Refund", value: rupiah(report.summary.refund), icon: Banknote },
              { label: "Total Outlet", value: `${report.outlets.length}`, icon: Store },
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

          {/* Outlet ranking cards */}
          {report.outlets.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-gray-500">
                Tidak ada data outlet pada periode ini
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {report.outlets
                .sort((a, b) => a.rank - b.rank)
                .map((o, idx) => (
                  <Card
                    key={o.branchId}
                    className={idx === 0 ? "ring-2 ring-yellow-400 bg-yellow-50/30" : ""}
                  >
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">
                          <span className="inline-flex items-center gap-2">
                            {idx === 0 && <Award className="h-5 w-5 text-yellow-500" />}
                            #{o.rank} — {o.branchName}
                            <span className="text-xs text-gray-400 font-normal ml-1">
                              ({o.branchCode})
                            </span>
                          </span>
                        </CardTitle>
                        {!o.isActive && (
                          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                            Nonaktif
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div>
                          <p className="text-xs text-gray-500">Net Sales</p>
                          <p className="text-sm font-bold tabular-nums">{rupiah(o.netSales)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">Order</p>
                          <p className="text-sm font-bold tabular-nums">{o.orders}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500">AOV</p>
                          <p className="text-sm font-bold tabular-nums">{rupiah(o.aov)}</p>
                        </div>
                      </div>

                      <div className="border-t pt-3 space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>Cash</span>
                          <span className="tabular-nums font-medium text-gray-700">{rupiah(o.cash)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>QRIS</span>
                          <span className="tabular-nums font-medium text-gray-700">{rupiah(o.qris)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs text-gray-500">
                          <span>Refund</span>
                          <span className="tabular-nums font-medium text-red-600">
                            {o.refund > 0 ? `−${rupiah(o.refund)}` : "—"}
                          </span>
                        </div>
                      </div>

                      {o.bestSellingProduct && (
                        <div className="border-t pt-3">
                          <p className="text-xs text-gray-400 mb-1">Produk Terlaris</p>
                          <p className="text-sm font-medium">
                            {o.bestSellingProduct.name ?? "(produk dihapus)"}
                            <span className="text-gray-400 font-normal ml-2">
                              {o.bestSellingProduct.qtySold} terjual
                            </span>
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between text-xs pt-2 border-t">
                        <span className="text-gray-400">
                          Dine In: {o.orderType.DINE_IN?.count ?? 0} ·
                          Takeaway: {o.orderType.TAKEAWAY?.count ?? 0} ·
                          Delivery: {o.orderType.DELIVERY?.count ?? 0}
                        </span>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}