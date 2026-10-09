"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Download,
  Users,
  UserPlus,
  Repeat,
  ShoppingCart,
  Package,
  TrendingUp,
  CalendarClock,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type CustomerReport,
} from "@/services/report.service";
import { ReportSubNav } from "@/components/admin/reports/report-nav";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";

// ============================================================
// Customer Report / Laporan Pelanggan (PHASE 9B — C4/C5/C6)
// ADMIN only. Spending follows the canonical Sales Report semantics
// (revenue set, refund-aware net). The password hash never reaches the client.
// ============================================================

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleDateString("id-ID") : "—";

export default function CustomerReportPage() {
  const { role } = useUserRole();
  const { isLoading: branchCtxLoading, branchId: currentBranchId } =
    useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [search, setSearch] = useState("");
  const [report, setReport] = useState<CustomerReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getCustomerReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          search: search || undefined,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load customer report:", err);
        setError("Gagal memuat laporan pelanggan");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, search]
  );

  useEffect(() => {
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
      if (search) params.set("search", search);

      const res = await fetch(`/api/reports/customers/export?${params.toString()}`, {
        credentials: "same-origin",
        headers: currentBranchId ? { "x-branch-id": currentBranchId } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Gagal mengekspor laporan");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `customer-report-${period}-${todayStr()}.csv`;
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

  const summaryCards = useMemo<
    Array<{ label: string; value: string; icon: LucideIcon; hint?: string }>
  >(() => {
    if (!report) return [];
    const s = report.summary;
    return [
      { label: "Total Pelanggan", value: `${s.totalCustomers}`, icon: Users },
      { label: "Pelanggan Baru", value: `${s.newCustomers}`, icon: UserPlus },
      { label: "Pelanggan Kembali", value: `${s.returningCustomers}`, icon: Repeat },
      { label: "Aktif", value: `${s.activeCustomers}`, icon: ShoppingCart, hint: "Ada order pada periode" },
      { label: "Tidak Aktif", value: `${s.inactiveCustomers}`, icon: CalendarClock, hint: "Punya riwayat, tanpa order pada periode" },
      { label: "Total Order", value: `${s.totalOrders}`, icon: ShoppingCart },
      { label: "Item Terjual", value: `${s.totalItemsSold}`, icon: Package },
      { label: "Rata-rata Order", value: rupiah(s.averageOrderValue), icon: TrendingUp },
      { label: "Total Penjualan", value: rupiah(s.totalSales), icon: TrendingUp },
      { label: "Total Refund", value: rupiah(s.totalRefund), icon: Download },
      { label: "Net Sales", value: rupiah(s.netSales), icon: TrendingUp, hint: "Penjualan bersih setelah dampak refund" },
    ];
  }, [report]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Pelanggan</h1>
          <p className="text-gray-500">Statistik belanja & reservasi pelanggan</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => loadReport()} disabled={isLoading}>
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
            <input
              type="text"
              value={search}
              placeholder="Cari nama / telepon"
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") loadReport();
              }}
              className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
            />
            <Button variant="secondary" size="sm" onClick={() => loadReport()}>
              Cari
            </Button>
          </div>

          {report && (
            <p className="text-xs text-gray-500">
              Periode: {new Date(report.range.start).toLocaleDateString("id-ID")} —{" "}
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
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {summaryCards.map((card) => (
              <Card key={card.label}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">{card.label}</CardTitle>
                  <card.icon className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="text-xl font-bold">{card.value}</div>
                  {card.hint && (
                    <p className="text-xs text-muted-foreground mt-1">{card.hint}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Pelanggan</CardTitle>
            </CardHeader>
            <CardContent>
              {report.customers.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada data pelanggan pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Pelanggan</TableHead>
                        <TableHead className="text-right">Order</TableHead>
                        <TableHead className="text-right">Reservasi</TableHead>
                        <TableHead className="text-right">Item</TableHead>
                        <TableHead className="text-right">Total Penjualan</TableHead>
                        <TableHead className="text-right">Refund</TableHead>
                        <TableHead className="text-right">Net Sales</TableHead>
                        <TableHead className="text-right">AOV</TableHead>
                        <TableHead>Order Terakhir</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.customers.map((c) => (
                        <TableRow key={c.customerId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <div>
                                <p className="font-medium">{c.name || "—"}</p>
                                <p className="text-xs text-gray-500">{c.phone || "—"}</p>
                              </div>
                              {c.isNewCustomer && (
                                <Badge className="bg-green-100 text-green-800">Baru</Badge>
                              )}
                              {c.isReturning && (
                                <Badge className="bg-blue-100 text-blue-800">Kembali</Badge>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{c.orders}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {c.reservations.total}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{c.items}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rupiah(c.totalSales)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rupiah(c.refund)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rupiah(c.netSales)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {rupiah(c.aov)}
                          </TableCell>
                          <TableCell className="text-sm text-gray-500">
                            {fmtDate(c.lastOrderAt)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <p className="text-xs text-gray-400">
            Lihat juga{" "}
            <Link href="/admin/reports/reservations" className="underline">
              Laporan Reservasi
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
