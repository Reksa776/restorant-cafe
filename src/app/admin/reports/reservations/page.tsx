"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  CalendarCheck,
  Users,
  XCircle,
  UserX,
  TrendingUp,
  Undo2,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  reportService,
  type ReportPeriod,
  type ReservationReport,
} from "@/services/report.service";
import { ReportSubNav } from "@/components/admin/reports/report-nav";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";

// ============================================================
// Reservation Report / Laporan Reservasi (PHASE 9B — C8..C12)
// ADMIN only. Scoped by Reservation.reservationDate. Revenue reuses the
// canonical engine (reservation-linked orders). No client totals are trusted.
// ============================================================

const PERIODS: Array<{ value: ReportPeriod; label: string }> = [
  { value: "today", label: "Hari Ini" },
  { value: "yesterday", label: "Kemarin" },
  { value: "week", label: "Minggu Ini" },
  { value: "month", label: "Bulan Ini" },
  { value: "custom", label: "Custom" },
];

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Menunggu",
  CONFIRMED: "Dikonfirmasi",
  SEATED: "Duduk",
  COMPLETED: "Selesai",
  CANCELLED: "Dibatalkan",
  NO_SHOW: "Tidak Hadir",
};

const STATUS_COLOR: Record<string, string> = {
  PENDING: "bg-yellow-100 text-yellow-800",
  CONFIRMED: "bg-blue-100 text-blue-800",
  SEATED: "bg-purple-100 text-purple-800",
  COMPLETED: "bg-green-100 text-green-800",
  CANCELLED: "bg-red-100 text-red-800",
  NO_SHOW: "bg-gray-200 text-gray-700",
};

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export default function ReservationReportPage() {
  const { role } = useUserRole();
  const { isLoading: branchCtxLoading, branchId: currentBranchId } =
    useBranchContext();
  const [period, setPeriod] = useState<ReportPeriod>("today");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [report, setReport] = useState<ReservationReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const loadReport = useCallback(
    async (silent = false) => {
      if (!silent) setIsLoading(true);
      setError(null);
      try {
        const data = await reportService.getReservationReport({
          period,
          startDate: period === "custom" ? startDate : undefined,
          endDate: period === "custom" ? endDate : undefined,
        });
        setReport(data);
      } catch (err) {
        console.error("Failed to load reservation report:", err);
        setError("Gagal memuat laporan reservasi");
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

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params = new URLSearchParams({ period });
      if (period === "custom") {
        params.set("startDate", startDate);
        params.set("endDate", endDate);
      }
      const res = await fetch(
        `/api/reports/reservations/export?${params.toString()}`,
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
      a.download = `reservation-report-${period}-${todayStr()}.csv`;
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
      { label: "Total Reservasi", value: `${s.totalReservations}`, icon: CalendarCheck },
      { label: "Dikonfirmasi", value: `${s.confirmed}`, icon: CalendarCheck },
      { label: "Selesai", value: `${s.completed}`, icon: CalendarCheck },
      { label: "Dibatalkan", value: `${s.cancelled}`, icon: XCircle, hint: `${s.cancellationRate}% dari total` },
      { label: "Tidak Hadir", value: `${s.noShow}`, icon: UserX, hint: `${s.noShowRate}% dari total` },
      { label: "Rata-rata Tamu", value: `${s.averagePartySize}`, icon: Users },
      { label: "Total Tamu", value: `${s.totalGuests}`, icon: Users },
      { label: "Revenue Reservasi", value: rupiah(s.reservationRevenue), icon: TrendingUp },
      { label: "Refund Reservasi", value: rupiah(s.reservationRefund), icon: Undo2 },
      { label: "Net Revenue", value: rupiah(s.reservationNetRevenue), icon: TrendingUp, hint: "Setelah dampak refund" },
    ];
  }, [report]);

  const funnelStages = useMemo(() => {
    if (!report) return [];
    const f = report.funnel;
    return [
      { label: "Dibuat", value: f.created },
      { label: "Dikonfirmasi", value: f.confirmed },
      { label: "Dibayar", value: f.paid },
      { label: "Duduk", value: f.seated },
      { label: "Selesai", value: f.completed },
    ];
  }, [report]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Laporan Reservasi</h1>
          <p className="text-gray-500">Statistik reservasi, funnel & revenue</p>
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
          </div>

          {report && (
            <p className="text-xs text-gray-500">
              Tanggal reservasi: {new Date(report.range.start).toLocaleDateString("id-ID")} —{" "}
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

          <p className="text-xs text-gray-500">
            Catatan: Revenue dan refund diatribusikan berdasarkan tanggal order dan tanggal persetujuan refund, bukan tanggal reservasi.
          </p>

          {/* Static funnel */}
          <Card>
            <CardHeader>
              <CardTitle>Funnel Reservasi</CardTitle>
            </CardHeader>
            <CardContent>
              {report.summary.totalReservations === 0 ? (
                <p className="text-sm text-gray-500 py-4 text-center">
                  Belum ada reservasi pada periode ini
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    {funnelStages.map((stage, i) => (
                      <div key={stage.label} className="flex items-center gap-3">
                        <div className="rounded-lg border border-gray-200 px-4 py-2 text-center">
                          <p className="text-xs text-gray-500">{stage.label}</p>
                          <p className="text-lg font-bold tabular-nums">{stage.value}</p>
                        </div>
                        {i < funnelStages.length - 1 && (
                          <ArrowRight className="h-4 w-4 text-gray-300" />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 mt-4 pt-3 border-t border-gray-100">
                    <span className="text-sm text-gray-500">
                      Dibatalkan:{" "}
                      <span className="font-medium text-red-600 tabular-nums">
                        {report.funnel.cancelled}
                      </span>
                    </span>
                    <span className="text-sm text-gray-500">
                      Tidak Hadir:{" "}
                      <span className="font-medium text-gray-700 tabular-nums">
                        {report.funnel.noShow}
                      </span>
                    </span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.byStatus.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">
                    Belum ada data pada periode ini
                  </p>
                ) : (
                  report.byStatus.map((s) => (
                    <div key={s.status} className="flex items-center justify-between gap-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <Badge className={STATUS_COLOR[s.status] || ""}>
                          {STATUS_LABEL[s.status] || s.status}
                        </Badge>
                        <span className="text-xs text-gray-500">{s.guests} tamu</span>
                      </div>
                      <span className="text-sm font-medium tabular-nums">{s.count}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Cabang</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.byBranch.map((b) => (
                  <div
                    key={b.branchId ?? "none"}
                    className="flex items-center justify-between gap-3 py-1.5"
                  >
                    <span className="text-sm">{b.name || b.code || "Tanpa Cabang"}</span>
                    <span className="text-sm font-medium tabular-nums">
                      {b.count} · {b.guests} tamu
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Sumber</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {report.bySource.map((s) => (
                  <div key={s.source} className="flex items-center justify-between gap-3 py-1.5">
                    <span className="text-sm">{s.source}</span>
                    <span className="text-sm font-medium tabular-nums">
                      {s.count} · {s.guests} tamu
                    </span>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Status Pembayaran</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {Object.entries(report.paymentStatus).length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">
                    Tidak ada order terkait reservasi
                  </p>
                ) : (
                  Object.entries(report.paymentStatus).map(([k, v]) => (
                    <div key={k} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-sm">{k === "NO_ORDER" ? "Tanpa Order" : k}</span>
                      <span className="text-sm font-medium tabular-nums">{v}</span>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Per Tanggal</CardTitle>
            </CardHeader>
            <CardContent>
              {report.byDate.length === 0 ? (
                <p className="text-sm text-gray-500 py-8 text-center">
                  Belum ada data pada periode ini
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tanggal</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                        <TableHead className="text-right">Dikonfirmasi</TableHead>
                        <TableHead className="text-right">Selesai</TableHead>
                        <TableHead className="text-right">Dibatalkan</TableHead>
                        <TableHead className="text-right">Tidak Hadir</TableHead>
                        <TableHead className="text-right">Tamu</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.byDate.map((d) => (
                        <TableRow key={d.date}>
                          <TableCell className="text-sm">
                            {new Date(`${d.date}T00:00:00`).toLocaleDateString("id-ID")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{d.total}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.confirmed}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.completed}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.cancelled}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.noShow}</TableCell>
                          <TableCell className="text-right tabular-nums">{d.guests}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
