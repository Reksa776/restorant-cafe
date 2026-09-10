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
  Package,
  TrendingUp,
  ShoppingCart,
  XCircle,
} from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type ProductReport,
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

export default function ProductsReportPage() {
  const { role } = useUserRole();
  const { isLoading: branchCtxLoading } = useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [categoryId, setCategoryId] = useState("all");
  const [sortBy, setSortBy] = useState<"qty" | "revenue">("qty");
  const [report, setReport] = useState<ProductReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getProductReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          categoryId: categoryId === "all" ? undefined : categoryId,
          sortBy,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load product report:", err);
        setError("Gagal memuat laporan produk");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, categoryId, sortBy]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading, categoryId, sortBy]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Produk</h1>
          <p className="text-gray-500">Penjualan per produk dari transaksi historis</p>
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

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <ReportBranchFilter />

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Kategori</span>
              <Select value={categoryId} onValueChange={(v) => v !== null && setCategoryId(v)}>
                <SelectTrigger className="w-[160px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Kategori</SelectItem>
                  {(report?.categories ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Urutkan</span>
              <Select value={sortBy} onValueChange={(v) => setSortBy(v as "qty" | "revenue")}>
                <SelectTrigger className="w-[140px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="qty">Jumlah Terjual</SelectItem>
                  <SelectItem value="revenue">Pendapatan</SelectItem>
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
              { label: "Produk Terjual", value: report.summary.soldProductCount, icon: Package },
              { label: "Total Qty Terjual", value: report.summary.qtySold, icon: ShoppingCart },
              { label: "Gross Sales", value: rupiah(report.summary.grossSales), icon: TrendingUp },
              { label: "Net Sales", value: rupiah(report.summary.netSales), icon: TrendingUp },
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

          {/* Sold products table */}
          <Card>
            <CardHeader>
              <CardTitle>Produk Terjual</CardTitle>
            </CardHeader>
            <CardContent>
              {report.products.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada penjualan produk pada periode ini
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
                        <th className="pb-2 font-medium text-right">Gross</th>
                        <th className="pb-2 font-medium text-right">Diskon</th>
                        <th className="pb-2 font-medium text-right">Net</th>
                        <th className="pb-2 font-medium text-right">Order</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.products.map((p) => (
                        <tr key={p.productId} className="border-b last:border-0">
                          <td className="py-2 text-gray-400">{p.rank}</td>
                          <td className="py-2 font-medium">{p.name}</td>
                          <td className="py-2 text-gray-500">{p.categoryName ?? "—"}</td>
                          <td className="py-2 text-right tabular-nums">{p.qtySold}</td>
                          <td className="py-2 text-right tabular-nums">{rupiah(p.grossSales)}</td>
                          <td className="py-2 text-right tabular-nums text-red-600">
                            {p.discount > 0 ? `−${rupiah(p.discount)}` : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {rupiah(p.netSales)}
                          </td>
                          <td className="py-2 text-right tabular-nums">{p.orderCount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Unsold products */}
          {report.unsoldProducts.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <XCircle className="h-5 w-5 text-gray-400" />
                  Belum Terjual ({report.unsoldProducts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {report.unsoldProducts.map((p) => (
                    <div
                      key={p.productId}
                      className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.name}</p>
                        <p className="text-xs text-gray-500">{p.categoryName ?? "—"}</p>
                      </div>
                      <Badge variant="outline" className="flex-shrink-0 ml-2">
                        {rupiah(p.price)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}