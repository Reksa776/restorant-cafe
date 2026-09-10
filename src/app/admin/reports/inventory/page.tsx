"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  Boxes,
  ArrowDownToLine,
  ArrowUpFromLine,
  SlidersHorizontal,
  Activity,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type InventoryReport,
} from "@/services/report.service";
import { menuService } from "@/services/menu.service";
import { ReportSubNav } from "@/components/admin/reports/report-nav";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

const TYPE_OPTIONS = [
  { value: "all", label: "Semua Jenis" },
  { value: "IN", label: "Masuk" },
  { value: "OUT", label: "Keluar" },
  { value: "ADJUSTMENT", label: "Penyesuaian" },
];

function typeBadge(type: string) {
  if (type === "IN") {
    return <Badge className="bg-green-100 text-green-700 border border-green-200">Masuk</Badge>;
  }
  if (type === "OUT") {
    return <Badge className="bg-red-100 text-red-700 border border-red-200">Keluar</Badge>;
  }
  return <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">Penyesuaian</Badge>;
}

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function InventoryReportPage() {
  const { isLoading: branchCtxLoading, branchId: currentBranchId } =
    useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [productFilter, setProductFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<InventoryReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getInventoryReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          productId: productFilter === "all" ? undefined : productFilter,
          categoryId: categoryFilter === "all" ? undefined : categoryFilter,
          type: typeFilter === "all" ? undefined : (typeFilter as "IN" | "OUT" | "ADJUSTMENT"),
          page,
          limit: 50,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load inventory report:", err);
        setError("Gagal memuat laporan inventory");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, productFilter, categoryFilter, typeFilter, page]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    menuService
      .getProducts()
      .then((prods) => setProducts(prods.map((p) => ({ id: p.id, name: p.name }))))
      .catch(() => {});
    menuService
      .getCategories()
      .then((cats) =>
        setCategories(
          cats
            .filter((c) => c.isActive)
            .map((c) => ({ id: c.id, name: c.name }))
        )
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchCtxLoading]);

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading, productFilter, categoryFilter, typeFilter, page]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      if (productFilter !== "all") params.set("productId", productFilter);
      if (categoryFilter !== "all") params.set("categoryId", categoryFilter);
      if (typeFilter !== "all") params.set("type", typeFilter);

      const res = await fetch(
        `/api/reports/inventory/export?${params.toString()}`,
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
      a.download = `inventory-report-${period}-${todayStr()}.csv`;
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
      { label: "Total Stok Saat Ini", value: `${s.totalStock}`, icon: Boxes },
      { label: "Stok Masuk", value: `${s.stockIn > 0 ? "+" : ""}${s.stockIn}`, icon: ArrowDownToLine },
      { label: "Stok Keluar", value: `${Math.abs(s.stockOut)}`, icon: ArrowUpFromLine },
      { label: "Penyesuaian", value: `${s.adjustment > 0 ? "+" : ""}${s.adjustment}`, icon: SlidersHorizontal },
      { label: "Jumlah Pergerakan", value: `${s.movements}`, icon: Activity },
    ];
  }, [report]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Inventory</h1>
          <p className="text-gray-500">
            Riwayat pergerakan stok dan ringkasan stok per produk
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
                onClick={() => {
                  setPeriod(p.value);
                  setPage(1);
                }}
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
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setPage(1);
                  loadReport();
                }}
              >
                Terapkan
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <ReportBranchFilter />

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Produk</span>
              <Select
                value={productFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setProductFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[180px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Produk</SelectItem>
                  {products.map((p) => (
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
                value={categoryFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setCategoryFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[160px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Jenis</span>
              <Select
                value={typeFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setTypeFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[150px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
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

          {/* Movement table */}
          <Card>
            <CardHeader>
              <CardTitle>
                Riwayat Pergerakan Stok ({report.summary.movements} total)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.items.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada pergerakan stok pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Tanggal</th>
                        <th className="pb-2 font-medium">Produk</th>
                        <th className="pb-2 font-medium">Cabang</th>
                        <th className="pb-2 font-medium">Jenis</th>
                        <th className="pb-2 font-medium text-right">Jumlah</th>
                        <th className="pb-2 font-medium text-right">Saldo Akhir</th>
                        <th className="pb-2 font-medium">Referensi</th>
                        <th className="pb-2 font-medium">Alasan</th>
                        <th className="pb-2 font-medium">Oleh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((m) => (
                        <tr key={m.id} className="border-b last:border-0">
                          <td className="py-2 whitespace-nowrap text-xs text-gray-500">
                            {new Date(m.date).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-2 font-medium">
                            {m.productName ?? m.productId}
                          </td>
                          <td className="py-2 text-sm text-gray-500">
                            {m.branchCode ? `${m.branchCode} (${m.branchName})` : "—"}
                          </td>
                          <td className="py-2">{typeBadge(m.type)}</td>
                          <td
                            className={`py-2 text-right font-medium tabular-nums ${
                              m.quantity < 0 ? "text-red-600" : "text-green-700"
                            }`}
                          >
                            {m.quantity > 0 ? `+${m.quantity}` : m.quantity}
                          </td>
                          <td className="py-2 text-right tabular-nums">{m.balanceAfter}</td>
                          <td className="py-2 text-xs text-gray-500">
                            {m.refType ? (
                              <span className="font-mono">
                                {m.refType}
                                {m.refId ? ` · ${m.refId.slice(-8).toUpperCase()}` : ""}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="py-2 max-w-[160px] truncate text-sm text-gray-500">
                            {m.reason || "—"}
                          </td>
                          <td className="py-2 text-sm text-gray-500">{m.userName || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

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

          {/* Product stock summary */}
          <Card>
            <CardHeader>
              <CardTitle>
                Ringkasan Stok Produk ({report.stockPagination.total} total)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.productStockSummary.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada produk dengan stok pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Produk</th>
                        <th className="pb-2 font-medium">Cabang</th>
                        <th className="pb-2 font-medium text-right">Stok Saat Ini</th>
                        <th className="pb-2 font-medium text-right">Masuk</th>
                        <th className="pb-2 font-medium text-right">Keluar</th>
                        <th className="pb-2 font-medium text-right">Penyesuaian</th>
                        <th className="pb-2 font-medium">Pergerakan Terakhir</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.productStockSummary.map((s) => (
                        <tr key={`${s.branchId}-${s.productId}`} className="border-b last:border-0">
                          <td className="py-2 font-medium">{s.productName ?? s.productId}</td>
                          <td className="py-2 text-sm text-gray-500">
                            {s.branchId.slice(-8).toUpperCase()}
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {s.currentStock}
                          </td>
                          <td className="py-2 text-right tabular-nums text-green-700">
                            {s.stockIn > 0 ? `+${s.stockIn}` : s.stockIn}
                          </td>
                          <td className="py-2 text-right tabular-nums text-red-600">
                            {s.stockOut}
                          </td>
                          <td className="py-2 text-right tabular-nums text-blue-700">
                            {s.adjustment > 0 ? `+${s.adjustment}` : s.adjustment}
                          </td>
                          <td className="py-2 text-xs text-gray-500">
                            {s.lastMovement
                              ? new Date(s.lastMovement).toLocaleString("id-ID", {
                                  day: "2-digit",
                                  month: "short",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {report.stockPagination.totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 mt-4 border-t">
                  <p className="text-xs text-gray-500">
                    Halaman {report.stockPagination.page} dari {report.stockPagination.totalPages}
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
                      disabled={page >= report.stockPagination.totalPages}
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