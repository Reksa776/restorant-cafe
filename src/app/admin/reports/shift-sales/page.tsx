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
  Banknote,
  TrendingUp,
  Users,
  Undo2,
} from "lucide-react";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type ShiftSalesReport,
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

export default function ShiftSalesReportPage() {
  const { isLoading: branchCtxLoading } = useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [shiftStatus, setShiftStatus] = useState("all");
  const [report, setReport] = useState<ShiftSalesReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getShiftSalesReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
          status: shiftStatus === "all" ? undefined : shiftStatus,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load shift sales report:", err);
        setError("Gagal memuat laporan penjualan per shift");
      } finally {
        setIsLoading(false);
      }
    },
    [period, startDate, endDate, shiftStatus]
  );

  useEffect(() => {
    if (branchCtxLoading) return;
    loadReport(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, branchCtxLoading, shiftStatus]);

  const differenceBadge = (d: number | null) => {
    if (d === null || d === undefined) return <Badge variant="outline">—</Badge>;
    if (d === 0) return <Badge className="bg-green-100 text-green-800">± Rp0</Badge>;
    if (d > 0) return <Badge className="bg-blue-100 text-blue-800">+{rupiah(d)}</Badge>;
    return <Badge className="bg-red-100 text-red-800">−{rupiah(Math.abs(d))}</Badge>;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Penjualan per Shift</h1>
          <p className="text-gray-500">Rekap kasir per sesi buka/tutup shift</p>
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
              <span className="text-xs text-gray-500">Status</span>
              <Select value={shiftStatus} onValueChange={(v) => v !== null && setShiftStatus(v)}>
                <SelectTrigger className="w-[130px] text-sm h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Status</SelectItem>
                  <SelectItem value="OPEN">Buka</SelectItem>
                  <SelectItem value="CLOSED">Tutup</SelectItem>
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
              { label: "Total Sales", value: rupiah(report.summary.totalSales), icon: TrendingUp },
              { label: "Cash (Kasir)", value: rupiah(report.summary.cash), icon: Banknote },
              { label: "QRIS", value: rupiah(report.summary.qris), icon: Banknote },
              { label: "Total Refund", value: rupiah(report.summary.refund), icon: Undo2 },
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

          {/* Shifts table */}
          <Card>
            <CardHeader>
              <CardTitle>
                Daftar Shift ({report.items.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {report.items.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Tidak ada data shift pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-gray-500">
                        <th className="pb-2 font-medium">Shift</th>
                        <th className="pb-2 font-medium">Kasir</th>
                        <th className="pb-2 font-medium">Status</th>
                        <th className="pb-2 font-medium">Waktu</th>
                        <th className="pb-2 font-medium text-right">Opening</th>
                        <th className="pb-2 font-medium text-right">Cash</th>
                        <th className="pb-2 font-medium text-right">QRIS</th>
                        <th className="pb-2 font-medium text-right">Refund</th>
                        <th className="pb-2 font-medium text-right">Expected</th>
                        <th className="pb-2 font-medium text-right">Actual</th>
                        <th className="pb-2 font-medium text-right">Difference</th>
                        <th className="pb-2 font-medium text-right">Tx</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.items.map((s) => (
                        <tr key={s.shiftId} className="border-b last:border-0">
                          <td className="py-2 font-medium">{s.shiftNumber}</td>
                          <td className="py-2">{s.cashierName ?? "—"}</td>
                          <td className="py-2">
                            <Badge
                              className={
                                s.status === "OPEN"
                                  ? "bg-green-100 text-green-800"
                                  : "bg-gray-100 text-gray-600"
                              }
                            >
                              {s.status === "OPEN" ? "Buka" : "Tutup"}
                            </Badge>
                          </td>
                          <td className="py-2 text-xs text-gray-500">
                            {new Date(s.openedAt).toLocaleString("id-ID", {
                              day: "2-digit",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {s.closedAt &&
                              ` → ${new Date(s.closedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}`}
                          </td>
                          <td className="py-2 text-right tabular-nums">{rupiah(s.openingCash)}</td>
                          <td className="py-2 text-right tabular-nums">{rupiah(s.cashSales)}</td>
                          <td className="py-2 text-right tabular-nums">{rupiah(s.qrisSales)}</td>
                          <td className="py-2 text-right tabular-nums text-red-600">
                            {s.refund > 0 ? `−${rupiah(s.refund)}` : "—"}
                          </td>
                          <td className="py-2 text-right tabular-nums">{rupiah(s.expectedCash)}</td>
                          <td className="py-2 text-right tabular-nums">
                            {s.actualCash !== null ? rupiah(s.actualCash) : "—"}
                          </td>
                          <td className="py-2 text-right">{differenceBadge(s.difference)}</td>
                          <td className="py-2 text-right tabular-nums">{s.transactionCount}</td>
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