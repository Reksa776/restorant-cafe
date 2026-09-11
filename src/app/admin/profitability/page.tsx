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
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Download,
  TrendingUp,
  Wallet,
  Percent,
  AlertTriangle,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  profitabilityService,
  type ProfitabilityReport,
} from "@/services/profitability.service";
import type { ReportPeriod } from "@/services/report.service";
import { ReportSubNav } from "@/components/admin/reports/report-nav";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

const rupiah = (v: number | null) =>
  v === null ? "—" : `Rp${Math.round(v).toLocaleString("id-ID")}`;
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ProfitabilityPage() {
  const { isLoading: branchCtxLoading, branchId: currentBranchId } =
    useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [productId, setProductId] = useState("all");
  const [categoryId, setCategoryId] = useState("all");
  const [report, setReport] = useState<ProfitabilityReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await profitabilityService.getProfitabilityReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          productId: productId === "all" ? undefined : productId,
          categoryId: categoryId === "all" ? undefined : categoryId,
          limit: 100,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load profitability report:", err);
        setError("Gagal memuat laporan profitabilitas");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, productId, categoryId]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading, productId, categoryId]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      if (productId !== "all") params.set("productId", productId);
      if (categoryId !== "all") params.set("categoryId", categoryId);

      const res = await fetch(
        `/api/reports/profitability/export?${params.toString()}`,
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
      a.download = `profitability-report-${period}-${todayStr()}.csv`;
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

  const summary = report?.summary;
  const hasUncosted = (summary?.coverage.uncostedOrderItems ?? 0) > 0;
  const hasLegacy = (summary?.coverage.legacyOrderItems ?? 0) > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Profitabilitas</h1>
          <p className="text-gray-500">
            Margin historis dari HPP yang dibekukan saat order selesai
          </p>
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

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <ReportBranchFilter />

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Produk</span>
              <Select
                value={productId}
                onValueChange={(v) => v !== null && setProductId(v)}
              >
                <SelectTrigger className="w-[180px] text-sm h-8">
                  <SelectValue>
                    {productId === "all"
                      ? "Semua Produk"
                      : (report?.availableProducts ?? []).find(
                          (p) => p.id === productId
                        )?.name ?? "Semua Produk"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Produk</SelectItem>
                  {(report?.availableProducts ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Kategori</span>
              <Select
                value={categoryId}
                onValueChange={(v) => v !== null && setCategoryId(v)}
              >
                <SelectTrigger className="w-[160px] text-sm h-8">
                  <SelectValue>
                    {categoryId === "all"
                      ? "Semua Kategori"
                      : (report?.availableCategories ?? []).find(
                          (c) => c.id === categoryId
                        )?.name ?? "Semua Kategori"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {(report?.availableCategories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
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
      ) : !report || !summary ? null : (
        <div className="space-y-6">
          {(hasUncosted || hasLegacy) && (
            <div className="space-y-2">
              {hasUncosted && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Sebagian transaksi belum memiliki HPP historis (
                    {summary.coverage.uncostedOrderItems} item tanpa resep / WAC).
                    COGS tidak dihitung untuk item tersebut.
                  </span>
                </div>
              )}
              {hasLegacy && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Transaksi sebelum fitur historical costing tidak memiliki
                    snapshot HPP ({summary.coverage.legacyOrderItems} item).
                    Revenue tetap valid, COGS tidak tersedia.
                  </span>
                </div>
              )}
            </div>
          )}

          {summary.unpaidCompleted.orders > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
              <Info className="h-4 w-4 mt-0.5 shrink-0" />
              <span>
                {summary.unpaidCompleted.orders} order selesai namun belum
                dibayar — COGS {rupiah(summary.unpaidCompleted.cogs)} sudah
                terjadi tanpa revenue (belum masuk perhitungan margin).
              </span>
            </div>
          )}

          {/* Summary */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[
              { label: "Net Sales", value: rupiah(summary.netSales), icon: TrendingUp },
              { label: "COGS (HPP Historis)", value: rupiah(summary.cogs), icon: Wallet },
              {
                label: "Gross Profit",
                value: rupiah(summary.grossProfit),
                icon: TrendingUp,
              },
              { label: "Gross Margin", value: pct(summary.grossMarginPct), icon: Percent },
              { label: "Food Cost", value: pct(summary.foodCostPct), icon: Percent },
              {
                label: "Ditutup Biaya",
                value: `${summary.coverage.costedOrderItems}/${summary.coverage.totalOrderItems} item`,
                icon: Wallet,
              },
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

          {/* Branch breakout (multi-branch only) */}
          {report.branches.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>Profitabilitas per Cabang</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Cabang</th>
                        <th className="pb-2 font-medium text-right">Order</th>
                        <th className="pb-2 font-medium text-right">Net Sales</th>
                        <th className="pb-2 font-medium text-right">COGS</th>
                        <th className="pb-2 font-medium text-right">Gross Profit</th>
                        <th className="pb-2 font-medium text-right">Margin</th>
                        <th className="pb-2 font-medium text-right">Food Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.branches.map((b) => (
                        <tr key={b.branchId} className="border-b last:border-0">
                          <td className="py-2 font-medium">
                            {b.branchName} ({b.branchCode})
                          </td>
                          <td className="py-2 text-right tabular-nums">{b.orders}</td>
                          <td className="py-2 text-right tabular-nums">
                            {rupiah(b.netSales)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {rupiah(b.cogs)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {rupiah(b.grossProfit)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {pct(b.grossMarginPct)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {pct(b.foodCostPct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Product profitability */}
          <Card>
            <CardHeader>
              <CardTitle>Profitabilitas Produk</CardTitle>
            </CardHeader>
            <CardContent>
              {report.products.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada penjualan pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">#</th>
                        <th className="pb-2 font-medium">Produk</th>
                        <th className="pb-2 font-medium">Kategori</th>
                        <th className="pb-2 font-medium text-right">Qty</th>
                        <th className="pb-2 font-medium text-right">Net Sales</th>
                        <th className="pb-2 font-medium text-right">COGS</th>
                        <th className="pb-2 font-medium text-right">Gross Profit</th>
                        <th className="pb-2 font-medium text-right">Margin</th>
                        <th className="pb-2 font-medium text-right">Food Cost</th>
                        <th className="pb-2 font-medium text-right">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.products.map((p) => (
                        <tr key={p.productId} className="border-b last:border-0">
                          <td className="py-2 text-gray-400">{p.rank}</td>
                          <td className="py-2 font-medium">{p.name}</td>
                          <td className="py-2 text-gray-500">
                            {p.categoryName ?? "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums">{p.qtySold}</td>
                          <td className="py-2 text-right tabular-nums">
                            {rupiah(p.netSales)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {rupiah(p.cogs)}
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {rupiah(p.grossProfit)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {pct(p.grossMarginPct)}
                          </td>
                          <td className="py-2 text-right tabular-nums">
                            {pct(p.foodCostPct)}
                          </td>
                          <td className="py-2 text-right">
                            {p.uncostedItems > 0 || p.legacyItems > 0 ? (
                              <Badge className="bg-amber-100 text-amber-800">
                                {p.costedItems > 0 ? "PARTIAL" : "UNCOSTED"}
                              </Badge>
                            ) : (
                              <Badge className="bg-green-100 text-green-800">
                                FULL
                              </Badge>
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
        </div>
      )}
    </div>
  );
}
