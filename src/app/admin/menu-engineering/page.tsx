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
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  menuEngineeringService,
  type MenuEngineeringReport,
  type MenuEngineeringProductRow,
  type MenuEngineeringClassification,
} from "@/services/menu-engineering.service";
import { ReportSubNav } from "@/components/admin/reports/report-nav";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";

const PERIODS = [
  { value: "today" as const, label: "Hari Ini" },
  { value: "yesterday" as const, label: "Kemarin" },
  { value: "week" as const, label: "Minggu Ini" },
  { value: "month" as const, label: "Bulan Ini" },
  { value: "custom" as const, label: "Custom" },
];

const rupiah = (v: number | null) =>
  v === null ? "—" : `Rp${Math.round(v).toLocaleString("id-ID")}`;
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(2)}%`);
const todayStr = () => new Date().toISOString().slice(0, 10);

const CLASS_BG: Record<MenuEngineeringClassification, string> = {
  STAR: "bg-green-100 text-green-800",
  PLOWHORSE: "bg-blue-100 text-blue-800",
  PUZZLE: "bg-amber-100 text-amber-800",
  DOG: "bg-red-100 text-red-800",
  NEW: "bg-indigo-100 text-indigo-800",
  NO_DATA: "bg-gray-100 text-gray-500",
  INSUFFICIENT_DATA: "bg-gray-100 text-gray-500",
  UNCOSTED: "bg-orange-100 text-orange-800",
  NO_PRICE: "bg-red-50 text-red-700",
};

const QUADRANT_CFG: Array<{
  zone: string;
  class: MenuEngineeringClassification;
  bg: string;
  text: string;
  row: "top" | "bottom";
  col: "left" | "right";
  label: string;
}> = [
  { zone: "Puzzle", class: "PUZZLE", bg: "bg-amber-50 border-amber-200", text: "text-amber-900", row: "top", col: "left", label: "Low Vol · High Profit" },
  { zone: "Star", class: "STAR", bg: "bg-green-50 border-green-200", text: "text-green-900", row: "top", col: "right", label: "High Vol · High Profit" },
  { zone: "Dog", class: "DOG", bg: "bg-red-50 border-red-200", text: "text-red-900", row: "bottom", col: "left", label: "Low Vol · Low Profit" },
  { zone: "Plowhorse", class: "PLOWHORSE", bg: "bg-blue-50 border-blue-200", text: "text-blue-900", row: "bottom", col: "right", label: "High Vol · Low Profit" },
];

export default function MenuEngineeringPage() {
  const { isLoading: branchCtxLoading, branchId: currentBranchId } =
    useBranchContext();
  const [period, setPeriod] = useState<string>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [categoryId, setCategoryId] = useState("all");
  const [classification, setClassification] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<MenuEngineeringReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<MenuEngineeringProductRow | null>(null);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await menuEngineeringService.getReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          category: categoryId === "all" ? undefined : categoryId,
          classification: classification || undefined,
          q: search || undefined,
          page,
          limit: 25,
        });
        setReport(data);
        setSelectedProduct(null);
      } catch (err) {
        console.error("Failed to load menu engineering:", err);
        setError("Gagal memuat menu engineering");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, categoryId, classification, search, page]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading, categoryId, classification, page]);

  const handleSearch = () => {
    setPage(1);
    loadReport(false);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      if (categoryId !== "all") params.set("category", categoryId);
      if (search) params.set("q", search);

      const res = await fetch(
        `/api/reports/menu-engineering/export?${params.toString()}`,
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
      a.download = `menu-engineering-${period}-${todayStr()}.csv`;
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
  const coverage = report?.coverage;
  const hasUncosted = (coverage?.uncostedOrderItems ?? 0) > 0;
  const hasLegacy = (coverage?.legacyOrderItems ?? 0) > 0;
  const counts = report?.classification;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Menu Engineering</h1>
          <p className="text-gray-500">
            Analisis performa menu berdasarkan penjualan dan profitabilitas
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
              <Button variant="secondary" size="sm" onClick={() => loadReport()}>
                Terapkan
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <ReportBranchFilter />

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Kategori</span>
              <Select
                value={categoryId}
                onValueChange={(v) => {
                if (v !== null) {
                  setCategoryId(v);
                  setPage(1);
                }
              }}
              >
                <SelectTrigger className="w-[160px] text-sm h-8">
                  <SelectValue>
                    {categoryId === "all"
                      ? "Semua Kategori"
                      : report?.availableCategories.find(
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

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                placeholder="Cari produk..."
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm w-[180px]"
              />
              <Button variant="secondary" size="sm" onClick={handleSearch}>
                Cari
              </Button>
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
      ) : !report || !summary ? (
        <div className="flex flex-col items-center justify-center py-16 space-y-3">
          <p className="text-gray-500">No menu performance data for this period.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {(hasUncosted || hasLegacy) && (
            <div className="space-y-2">
              {hasUncosted && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Sebagian transaksi belum memiliki HPP historis (
                    {coverage?.uncostedOrderItems} item tanpa resep / WAC).
                    COGS tidak dihitung untuk item tersebut.
                  </span>
                </div>
              )}
              {hasLegacy && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Transaksi sebelum fitur historical costing tidak memiliki
                    snapshot HPP ({coverage?.legacyOrderItems} item).
                    Revenue tetap valid, COGS tidak tersedia.
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Summary */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Total Net Sales", value: rupiah(summary.totalNetSales), icon: TrendingUp },
              { label: "Historical COGS", value: rupiah(summary.historicalCogs), icon: Wallet },
              { label: "Gross Profit", value: rupiah(summary.grossProfit), icon: TrendingUp },
              { label: "Gross Margin", value: pct(summary.grossMarginPct), icon: Percent },
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

          {/* Quadrant matrix */}
          {counts && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium">
                  Classification Matrix
                </CardTitle>
                <p className="text-xs text-gray-500">
                  Klik kuadran untuk memfilter tabel. Threshold menggunakan median dari data scope saat ini.
                </p>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-[1fr_auto_1fr] grid-rows-[auto_1fr_auto] gap-1 text-center">
                  <div />
                  <p className="text-[11px] font-medium text-gray-500 pb-1">HIGH PROFIT</p>
                  <div />
                  <div className="flex items-center justify-end text-[11px] text-gray-400 pr-2 rotate-[-90deg] origin-bottom-right">LOW VOLUME</div>
                  <div className="grid grid-cols-2 gap-1 bg-gray-200 p-1 rounded-lg">
                    {QUADRANT_CFG.map((q) => (
                      <button
                        key={q.class}
                        type="button"
                        onClick={() => {
                          setPage(1);
                          setClassification(classification === q.class ? null : q.class);
                        }}
                        className={`rounded-lg p-3 text-left transition-all border ${
                          q.bg
                        } ${
                          classification === q.class
                            ? "ring-2 ring-gray-400 scale-[1.02]"
                            : "hover:opacity-90"
                        }`}
                      >
                        <p className={`text-xs font-bold uppercase ${q.text}`}>{q.zone}</p>
                        <p className={`text-2xl font-bold ${q.text}`}>{(counts as unknown as Record<string, number>)[q.class] ?? 0}</p>
                        <p className="text-[10px] text-gray-500 mt-1">{q.label}</p>
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-start text-[11px] text-gray-400 pl-2 rotate-[90deg] origin-bottom-left">HIGH VOLUME</div>
                  <div className="grid grid-cols-4 gap-1 text-[11px] mt-1">
                    <button type="button" onClick={() => { setPage(1); setClassification(classification === "NEW" ? null : "NEW"); }} className={`rounded px-2 py-1 ${classification === "NEW" ? "bg-indigo-200" : "bg-indigo-50 hover:bg-indigo-100"} transition-colors`}>New {counts.NEW}</button>
                    <button type="button" onClick={() => { setPage(1); setClassification(classification === "NO_DATA" ? null : "NO_DATA"); }} className={`rounded px-2 py-1 ${classification === "NO_DATA" ? "bg-gray-200" : "bg-gray-50 hover:bg-gray-100"} transition-colors`}>No Data {counts.NO_DATA}</button>
                    <button type="button" onClick={() => { setPage(1); setClassification(classification === "INSUFFICIENT_DATA" ? null : "INSUFFICIENT_DATA"); }} className={`rounded px-2 py-1 ${classification === "INSUFFICIENT_DATA" ? "bg-gray-200" : "bg-gray-50 hover:bg-gray-100"} transition-colors`}>Insufficient {counts.INSUFFICIENT_DATA}</button>
                    <button type="button" onClick={() => { setPage(1); setClassification(classification === "UNCOSTED" ? null : "UNCOSTED"); }} className={`rounded px-2 py-1 ${classification === "UNCOSTED" ? "bg-orange-200" : "bg-orange-50 hover:bg-orange-100"} transition-colors`}>Uncosted {counts.UNCOSTED}</button>
                  </div>
                  <div />
                  <p className="text-[11px] font-medium text-gray-500 pt-1">LOW PROFIT</p>
                  <div />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Selected product detail */}
          {selectedProduct && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Detail Produk</CardTitle>
                <Button variant="ghost" size="sm" onClick={() => setSelectedProduct(null)}>
                  Tutup
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 text-sm">
                  <div>
                    <p className="text-gray-500">Product</p>
                    <p className="font-medium">{selectedProduct.productName}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Category</p>
                    <p>{selectedProduct.categoryName ?? "—"}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Classification</p>
                    <Badge className={CLASS_BG[selectedProduct.classification]}>
                      {selectedProduct.classification}
                    </Badge>
                    {selectedProduct.currentPriceOverrideActive && (
                      <Badge className="ml-1 bg-amber-100 text-amber-800">Branch Override</Badge>
                    )}
                  </div>
                  <div>
                    <p className="text-gray-500">Insight</p>
                    <p className="text-gray-700">{selectedProduct.insight}</p>
                  </div>

                  <div className="border-t pt-3 space-y-1">
                    <p className="text-gray-500">Historical</p>
                    <p>Qty: {selectedProduct.qtySold} · Orders: {selectedProduct.orderCount}</p>
                    <p>Net Sales: {rupiah(selectedProduct.netSales)}</p>
                    <p>COGS: {rupiah(selectedProduct.historicalCogs)}</p>
                    <p>Gross Profit: {rupiah(selectedProduct.grossProfit)}</p>
                    <p>Margin: {pct(selectedProduct.grossMarginPct)}</p>
                    <p>Food Cost: {pct(selectedProduct.foodCostPct)}</p>
                  </div>

                  <div className="border-t pt-3 space-y-1">
                    <p className="text-gray-500">Current (selected branch)</p>
                    <p>HPP: {selectedProduct.currentHpp !== null ? rupiah(selectedProduct.currentHpp) : "—"}</p>
                    <p>Selling Price: {selectedProduct.currentSellingPrice !== null ? rupiah(selectedProduct.currentSellingPrice) : "—"}</p>
                    <p>Margin: {pct(selectedProduct.currentMarginPct)}</p>
                    <p>Cost Status: <Badge className={selectedProduct.costStatus === "COMPLETE" ? "bg-green-100 text-green-800" : selectedProduct.costStatus === "NO_RECIPE" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}>{selectedProduct.costStatus ?? "—"}</Badge></p>
                  </div>

                  <div className="border-t pt-3 space-y-1">
                    <p className="text-gray-500">Coverage</p>
                    <p>Costed: {selectedProduct.costedItems} · Uncosted: {selectedProduct.uncostedItems} · Legacy: {selectedProduct.legacyItems}</p>
                  </div>
                </div>
                <p className="text-[11px] text-gray-400 mt-2">
                  * Current margin berdasarkan harga cabang terpilih. Historical margin berdasarkan harga aktual order.
                </p>
              </CardContent>
            </Card>
          )}

          {/* Product table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">
                Daftar Produk
                {classification && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2 h-6 text-xs"
                    onClick={() => { setClassification(null); setPage(1); }}
                  >
                    Clear filter
                  </Button>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.products.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Tidak ada data performa menu untuk periode ini.
                </p>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-gray-500">
                          <th className="pb-2 font-medium">#</th>
                          <th className="pb-2 font-medium">Produk</th>
                          <th className="pb-2 font-medium">Kategori</th>
                          <th className="pb-2 font-medium text-right">Qty</th>
                          <th className="pb-2 font-medium text-right">Orders</th>
                          <th className="pb-2 font-medium text-right">Net Sales</th>
                          <th className="pb-2 font-medium text-right">COGS</th>
                          <th className="pb-2 font-medium text-right">Gross Profit</th>
                          <th className="pb-2 font-medium text-right">Margin</th>
                          <th className="pb-2 font-medium text-right">Current Price</th>
                          <th className="pb-2 font-medium text-right">Current Margin</th>
                          <th className="pb-2 font-medium">Class</th>
                          <th className="pb-2 font-medium">Coverage</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.products.map((p) => (
                          <tr
                            key={p.productId}
                            onClick={() => setSelectedProduct(p)}
                            className="border-b last:border-0 cursor-pointer hover:bg-gray-50 transition-colors"
                          >
                            <td className="py-2 text-gray-400">{p.rank}</td>
                            <td className="py-2 font-medium">
                              {p.productName}
                              {p.currentPriceOverrideActive && (
                                <Badge className="ml-1 bg-amber-100 text-amber-800 text-[10px]">Override</Badge>
                              )}
                            </td>
                            <td className="py-2 text-gray-500">{p.categoryName ?? "—"}</td>
                            <td className="py-2 text-right tabular-nums">{p.qtySold}</td>
                            <td className="py-2 text-right tabular-nums">{p.orderCount}</td>
                            <td className="py-2 text-right tabular-nums">{rupiah(p.netSales)}</td>
                            <td className="py-2 text-right tabular-nums">{rupiah(p.historicalCogs)}</td>
                            <td className="py-2 text-right tabular-nums font-medium">{rupiah(p.grossProfit)}</td>
                            <td className="py-2 text-right tabular-nums">{pct(p.grossMarginPct)}</td>
                            <td className="py-2 text-right tabular-nums">{p.currentSellingPrice !== null ? rupiah(p.currentSellingPrice) : "—"}</td>
                            <td className="py-2 text-right tabular-nums">{pct(p.currentMarginPct)}</td>
                            <td className="py-2">
                              <Badge className={CLASS_BG[p.classification]}>
                                {p.classification}
                              </Badge>
                            </td>
                            <td className="py-2 text-xs text-gray-500">
                              {p.costedItems}/{p.uncostedItems}/{p.legacyItems}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between pt-4">
                    <p className="text-xs text-gray-500">
                      {report.pagination.total} produk · Halaman {report.pagination.page}/{report.pagination.totalPages}
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                      >
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setPage((p) =>
                            Math.min(report.pagination.totalPages, p + 1)
                          )
                        }
                        disabled={page >= report.pagination.totalPages}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}