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
  ShoppingCart,
  Banknote,
  CheckCircle2,
  XCircle,
  Package,
  Layers,
  Truck,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { toast } from "sonner";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type PurchaseReport,
} from "@/services/report.service";
import { supplierService } from "@/services/supplier.service";
import { ReportSubNav } from "@/components/admin/reports/report-nav";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "Semua Status" },
  { value: "DRAFT", label: "Draft" },
  { value: "RECEIVED", label: "Diterima" },
  { value: "CANCELLED", label: "Dibatalkan" },
];

const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-amber-50 text-amber-700 border-amber-300",
  RECEIVED: "bg-green-100 text-green-700 border-green-200",
  CANCELLED: "bg-gray-100 text-gray-600",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  RECEIVED: "Diterima",
  CANCELLED: "Dibatalkan",
};

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function PurchasesReportPage() {
  const { isLoading: branchCtxLoading, branchId: currentBranchId } =
    useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [supplierFilter, setSupplierFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<PurchaseReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getPurchaseReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          supplierId: supplierFilter === "all" ? undefined : supplierFilter,
          status:
            statusFilter === "all"
              ? undefined
              : (statusFilter as "DRAFT" | "RECEIVED" | "CANCELLED"),
          page,
          limit: 50,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load purchase report:", err);
        setError("Gagal memuat laporan pembelian");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, supplierFilter, statusFilter, page]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    supplierService
      .list()
      .then((res) =>
        setSuppliers(res.items.map((s) => ({ id: s.id, name: s.name })))
      )
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchCtxLoading]);

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading, supplierFilter, statusFilter, page]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      if (supplierFilter !== "all") params.set("supplierId", supplierFilter);
      if (statusFilter !== "all") params.set("status", statusFilter);

      const res = await fetch(
        `/api/reports/purchases/export?${params.toString()}`,
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
      a.download = `purchase-report-${period}-${todayStr()}.csv`;
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
      { label: "Total Pembelian", value: `${s.totalPurchases}`, icon: ShoppingCart },
      { label: "Total Nilai Pembelian", value: rupiah(s.totalValue), icon: Banknote },
      { label: "Diterima", value: `${s.totalReceived}`, icon: CheckCircle2 },
      { label: "Dibatalkan", value: `${s.totalCancelled}`, icon: XCircle },
      { label: "Total Item Dibeli", value: `${s.totalItemsPurchased}`, icon: Layers },
      { label: "Total Qty", value: `${s.totalQuantity}`, icon: Package },
    ];
  }, [report]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Pembelian</h1>
          <p className="text-gray-500">
            Nilai, kuantitas, dan status pembelian — bukan COGS/profit
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
              <span className="text-xs text-gray-500">Supplier</span>
              <Select
                value={supplierFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setSupplierFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[180px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Supplier</SelectItem>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">Status</span>
              <Select
                value={statusFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setStatusFilter(v);
                    setPage(1);
                  }
                }}
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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

          {/* Purchase detail table */}
          <Card>
            <CardHeader>
              <CardTitle>
                Daftar Pembelian ({report.summary.totalPurchases} total)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.items.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada pembelian pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Pembelian</th>
                        <th className="pb-2 font-medium">Tanggal</th>
                        <th className="pb-2 font-medium">Supplier</th>
                        <th className="pb-2 font-medium">Cabang</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium text-right">Item</th>
                        <th className="pb-2 font-medium text-right">Qty</th>
                        <th className="pb-2 font-medium text-right">Total</th>
                        <th className="pb-2 font-medium">Dibuat Oleh</th>
                        <th className="pb-2 font-medium">Diterima</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((p) => (
                        <tr key={p.id} className="border-b last:border-0">
                          <td className="py-2 font-mono text-xs text-brand-primary">
                            {p.id.slice(-8).toUpperCase()}
                          </td>
                          <td className="py-2 text-xs text-gray-500">
                            {new Date(p.date).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="py-2 font-medium">{p.supplierName ?? "—"}</td>
                          <td className="py-2 text-sm text-gray-500">
                            {p.branchCode ? `${p.branchCode} (${p.branchName})` : "—"}
                          </td>
                          <td className="py-2">
                            <Badge className={STATUS_BADGE[p.status] ?? "bg-gray-100"}>
                              {STATUS_LABEL[p.status] ?? p.status}
                            </Badge>
                          </td>
                          <td className="py-2 text-right tabular-nums">{p.itemCount}</td>
                          <td className="py-2 text-right tabular-nums">{p.totalQuantity}</td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {rupiah(p.total)}
                          </td>
                          <td className="py-2 text-sm text-gray-500">
                            {p.createdBy ?? "—"}
                          </td>
                          <td className="py-2 text-xs text-gray-500">
                            {p.receivedAt
                              ? new Date(p.receivedAt).toLocaleString("id-ID", {
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

          {/* Product breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5 text-gray-400" />
                Breakdown Produk
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.productBreakdown.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada produk dibeli pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Produk</th>
                        <th className="pb-2 font-medium text-right">Qty Dibeli</th>
                        <th className="pb-2 font-medium text-right">Total Biaya</th>
                        <th className="pb-2 font-medium text-right">Rata-rata Harga Satuan</th>
                        <th className="pb-2 font-medium text-right">Jumlah Pembelian</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.productBreakdown.map((p) => (
                        <tr key={p.productId} className="border-b last:border-0">
                          <td className="py-2 font-medium">{p.name ?? "—"}</td>
                          <td className="py-2 text-right tabular-nums">{p.quantityPurchased}</td>
                          <td className="py-2 text-right tabular-nums">{rupiah(p.totalCost)}</td>
                          <td className="py-2 text-right tabular-nums">{rupiah(p.averageUnitCost)}</td>
                          <td className="py-2 text-right tabular-nums">{p.numberOfPurchases}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Supplier breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-gray-400" />
                Breakdown Supplier
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.supplierBreakdown.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada pembelian pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Supplier</th>
                        <th className="pb-2 font-medium text-right">Jumlah Pembelian</th>
                        <th className="pb-2 font-medium text-right">Qty</th>
                        <th className="pb-2 font-medium text-right">Total Nilai</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.supplierBreakdown.map((s) => (
                        <tr key={s.supplierId} className="border-b last:border-0">
                          <td className="py-2 font-medium">{s.name ?? "—"}</td>
                          <td className="py-2 text-right tabular-nums">{s.numberOfPurchases}</td>
                          <td className="py-2 text-right tabular-nums">{s.quantity}</td>
                          <td className="py-2 text-right tabular-nums font-medium">
                            {rupiah(s.totalValue)}
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