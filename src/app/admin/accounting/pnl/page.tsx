"use client";

import { useCallback, useEffect, useState } from "react";
import {
  pnlService,
  pnlExportUrl,
  type PnlReport,
  type PnlPeriod,
} from "@/services/pnl.service";
import { normalizeApiError } from "@/lib/api-error-handler";
import { useBranchContext } from "@/hooks/use-branch-context";
import { useUserRole } from "@/hooks/use-user-role";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";
import {
  AlertCircle,
  AlertTriangle,
  Download,
  Info,
  Loader2,
  RefreshCw,
  Scale,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";

// ============================================================
// P&L page (ACCOUNTING PHASE D) — READ-ONLY view over the existing
// revenue/COGS engines plus Expense. Mirrors the cashbook/expenses UI
// patterns (no redesign).
// ============================================================

const PERIODS: Array<{ value: PnlPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Pilih Tanggal" },
];

const COGS_BADGE: Record<string, { label: string; className: string }> = {
  // D1 — empty scope: COGS cannot be verified.
  NO_ITEMS: { label: "Belum Ada Data", className: "bg-red-100 text-red-800" },
  COVERED: { label: "Data Lengkap", className: "bg-green-100 text-green-800" },
  PARTIAL: { label: "Sebagian Lengkap", className: "bg-amber-100 text-amber-800" },
  PENDING_COGS: { label: "Belum Dihitung", className: "bg-blue-100 text-blue-800" },
  UNCOVERED: { label: "Belum Lengkap", className: "bg-amber-100 text-amber-800" },
  LEGACY: { label: "Data Lama", className: "bg-gray-100 text-gray-700" },
};

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const rupiahOrUnknown = (v: number | null) =>
  v === null ? "Tidak diketahui" : rupiah(v);
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStartStr = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};

export default function PnlPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";
  const { branchId: currentBranchId, isLoading: branchCtxLoading } =
    useBranchContext();

  const [period, setPeriod] = useState<PnlPeriod>("month");
  const [startDate, setStartDate] = useState(monthStartStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState<PnlReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await pnlService.get({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load P&L report:", err);
        setError(normalizeApiError(err).message);
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate]
  );

  useEffect(() => {
    if (branchCtxLoading || roleLoading) return;
    if (!isAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchCtxLoading, roleLoading, isAdmin, period, startDate, endDate]);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const url = pnlExportUrl({
        period,
        startDate: period === "custom" ? startDate : undefined,
        endDate: period === "custom" ? endDate : undefined,
      });
      const res = await fetch(url, {
        credentials: "same-origin",
        headers: currentBranchId ? { "x-branch-id": currentBranchId } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Gagal mengekspor laporan laba rugi");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `laba-rugi-${period}-${todayStr()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("Failed to export P&L report:", err);
      toast.error(
        err instanceof Error ? err.message : "Gagal mengekspor laporan laba rugi"
      );
    } finally {
      setIsExporting(false);
    }
  };

  if (!roleLoading && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <p className="text-gray-600">Halaman ini hanya untuk admin.</p>
      </div>
    );
  }

  const s = report?.summary;
  const cogsBadge = report
    ? (COGS_BADGE[report.cogsState] ?? {
        label: "Perlu Dicek",
        className: "bg-gray-100 text-gray-700",
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Laporan Laba Rugi</h1>
          <p className="text-gray-500">
            Ringkasan uang hasil penjualan setelah dikurangi biaya bahan dan biaya operasional.
          </p>
        </div>
        <Button size="sm" onClick={handleExport} disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Unduh Laporan
        </Button>
      </div>

      {/* Explicit, non-negotiable warnings */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
        <p>
          • <strong>Laba bersih belum final</strong> — hanya pengeluaran yang
          tercatat di menu Pengeluaran yang dihitung; biaya lain (gaji, sewa,
          penyusutan, dll.) belum termasuk.
        </p>
        <p>• Laba rugi berbeda dari uang tunai yang masuk dan keluar (lihat Buku Kas).</p>
        <p>• Pembelian bahan untuk stok baru dihitung sebagai biaya bahan saat bahan tersebut terpakai untuk produk yang terjual.</p>
        <p>
          • HPP (Harga Pokok Penjualan) adalah biaya bahan yang dipakai untuk membuat produk. Jika datanya belum lengkap, laba kotor dan laba bersih ditampilkan
          &quot;Tidak diketahui&quot;, bukan dihitung dengan HPP nol.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Periode</span>
              <Select value={period} onValueChange={(v) => v && setPeriod(v as PnlPeriod)}>
                <SelectTrigger className="w-[160px] h-9 text-sm">
                  <SelectValue>
                    {PERIODS.find((p) => p.value === period)?.label ?? period}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERIODS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {period === "custom" && (
              <>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Dari</span>
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <span className="text-xs text-gray-500">Sampai</span>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
                  />
                </div>
              </>
            )}
            <div className="ml-auto flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => load()}
                disabled={isLoading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${isLoading ? "animate-spin" : ""}`}
                />
                Muat Ulang
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <ReportBranchFilter />
            {report && cogsBadge && (
              <span className="flex items-center gap-2 text-xs text-gray-500">
                Kelengkapan data HPP:
                <Badge className={cogsBadge.className}>{cogsBadge.label}</Badge>
                {report.refundState !== "NONE" && (
                  <Badge variant="secondary">Status pengembalian: {report.refundState === "PARTIAL" ? "Sebagian" : "Penuh"}</Badge>
                )}
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && !report ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <div className="flex flex-col items-center justify-center py-12 space-y-3">
          <AlertCircle className="h-9 w-9 text-red-500" />
          <p className="text-gray-600">{error}</p>
          <Button variant="outline" onClick={() => load()}>
            Coba Lagi
          </Button>
        </div>
      ) : report && s ? (
        <>
          {/* Summary cards */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              {
                label: "Total Penjualan Sebelum Pengembalian",
                value: rupiah(s.grossSales),
                hint: "Termasuk pajak dan biaya layanan",
                icon: TrendingUp,
              },
              {
                label: "Penjualan Setelah Pengembalian",
                value: rupiah(s.netSales),
                hint: "Setelah uang yang dikembalikan dikurangi",
                icon: TrendingUp,
              },
              {
                label: "Biaya Bahan yang Terpakai",
                value: rupiah(s.cogs),
                hint: "Biaya bahan setelah penyesuaian pengembalian uang",
                icon: Wallet,
              },
              {
                label: "Laba Kotor",
                value: rupiahOrUnknown(s.grossProfit),
                hint: s.grossProfit === null ? "Data biaya bahan belum lengkap" : "Penjualan setelah pengembalian dikurangi biaya bahan",
                icon: TrendingUp,
              },
              {
                label: "Biaya Operasional",
                value: rupiah(s.operatingExpenses),
                hint: `${report.opex.count} pengeluaran tercatat`,
                icon: Wallet,
              },
              {
                label: "Laba Bersih",
                value: rupiahOrUnknown(s.netProfit),
                hint: "Belum final karena sebagian biaya mungkin belum dicatat",
                icon: Scale,
              },
            ].map((c) => (
              <Card key={c.label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{c.label}</CardTitle>
                  <c.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">{c.value}</div>
                  <p className="text-xs text-gray-400">{c.hint}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Disclosures */}
          {(report.disclosure.expenseDataEmpty ||
            !report.coverageComplete ||
            report.unpaidCompleted.orders > 0) && (
            <div className="space-y-3">
              {report.disclosure.expenseDataEmpty && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Belum ada pengeluaran tercatat pada periode ini — laba bersih
                    saat ini sama dengan laba kotor dan belum mencerminkan
                    biaya operasional sebenarnya.
                  </span>
                </div>
              )}
              {report.coverage.totalOrderItems === 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Biaya bahan belum dapat dipastikan: tidak ada barang pesanan
                    untuk periode ini.{" "}
                    {report.disclosure.revenueWithoutItems.orders > 0 &&
                      `${report.disclosure.revenueWithoutItems.orders} pesanan dengan penjualan (${rupiah(
                        report.disclosure.revenueWithoutItems.headerValue
                      )}) tidak memiliki baris item.`}{" "}
                    Laba kotor dan laba bersih ditampilkan sebagai tidak
                    diketahui.
                  </span>
                </div>
              )}
              {!report.coverageComplete &&
                report.coverage.totalOrderItems > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    Data biaya bahan belum lengkap: {report.coverage.costedOrderItems}/
                    {report.coverage.totalOrderItems} barang pesanan sudah memiliki biaya. Biaya bahan{" "}
                    {report.coverage.legacyOrderItems > 0 &&
                      `(data lama ${report.coverage.legacyOrderItems}) `}
                    belum tersedia → nilai laba kotor dan laba bersih belum dapat ditampilkan.
                  </span>
                </div>
              )}
              {report.unpaidCompleted.orders > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                  <Info className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>
                    {report.unpaidCompleted.orders} pesanan selesai namun belum
                    dibayar — biaya bahan {rupiah(report.unpaidCompleted.cogs)} sudah
                    terpakai tanpa ada uang penjualan (belum masuk perhitungan laba).
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Detail breakdown */}
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Rincian Laba Rugi</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <Row label="Total Penjualan Sebelum Pengembalian" value={rupiah(s.grossSales)} />
                <Row label="Diskon" value={`− ${rupiah(s.totalDiscount)}`} />
                <Row label="Pajak" value={rupiah(s.totalTax)} />
                <Row label="Biaya Layanan" value={rupiah(s.totalServiceCharge)} />
                <Row label="Uang Dikembalikan" value={`− ${rupiah(s.totalRefund)}`} />
                <Row label="Penjualan Setelah Pengembalian" value={rupiah(s.netSales)} strong />
                <Row label="Biaya Bahan Saat Pesanan Selesai" value={rupiah(s.historicalCogs)} />
                <Row label="Penyesuaian Biaya Bahan karena Pengembalian" value={`− ${rupiah(s.cogsReversal)}`} />
                <Row label="Biaya Bahan yang Terpakai" value={rupiah(s.cogs)} strong />
                <Row
                  label="Laba Kotor"
                  value={rupiahOrUnknown(s.grossProfit)}
                  strong
                />
                <Row label="Biaya Operasional" value={`− ${rupiah(s.operatingExpenses)}`} />
                <Row label="Laba Bersih" value={rupiahOrUnknown(s.netProfit)} strong />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">
                  Pengeluaran per Kategori
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                {report.opex.byCategory.length === 0 ? (
                  <p className="py-4 text-center text-sm text-gray-400">
                    Belum ada pengeluaran pada periode ini.
                  </p>
                ) : (
                  report.opex.byCategory.map((c) => (
                    <div
                      key={c.categoryId}
                      className="flex justify-between tabular-nums"
                    >
                      <span>
                        {c.categoryName}{" "}
                        <span className="text-gray-400">({c.count})</span>
                      </span>
                      <span>{rupiah(c.total)}</span>
                    </div>
                  ))
                )}
                <div className="flex justify-between border-t pt-2 font-medium tabular-nums">
                  <span>Total</span>
                  <span>{rupiah(report.opex.total)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          <p className="text-xs text-gray-400">
            Tanggal yang dipakai — penjualan: {report.disclosure.dateBasis.revenue} ·
            pengembalian uang: {report.disclosure.dateBasis.refund} · biaya bahan:{" "}
            {report.disclosure.dateBasis.cogs} · pengeluaran:{" "}
            {report.disclosure.dateBasis.expense}.
          </p>
        </>
      ) : null}
    </div>
  );
}

function Row({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex justify-between tabular-nums ${
        strong ? "font-semibold border-t pt-1 mt-1" : ""
      }`}
    >
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
