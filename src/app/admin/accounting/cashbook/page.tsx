"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  cashbookService,
  cashbookExportUrl,
  type CashbookEntry,
  type CashbookMethod,
  type CashbookSummary,
  type CashbookType,
} from "@/services/cashbook.service";
import { normalizeApiError } from "@/lib/api-error-handler";
import { useBranchContext } from "@/hooks/use-branch-context";
import { useUserRole } from "@/hooks/use-user-role";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportBranchFilter } from "@/components/admin/reports/report-branch-filter";
import {
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Download,
  Loader2,
  QrCode,
  RefreshCw,
  Scale,
} from "lucide-react";
import { toast } from "sonner";

const METHOD_OPTIONS: Array<{ value: CashbookMethod; label: string }> = [
  { value: "KASIR", label: "Tunai (KASIR)" },
  { value: "QRIS", label: "QRIS" },
  { value: "CASH", label: "Tunai (Expense)" },
  { value: "TRANSFER", label: "Transfer" },
  { value: "CARD", label: "Kartu" },
  { value: "OTHER", label: "Lainnya" },
];

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const monthStartStr = () => {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
};
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

const SOURCE_LABEL: Record<string, string> = {
  PAYMENT: "Pembayaran",
  REFUND: "Refund",
  EXPENSE: "Pengeluaran",
};

export default function CashbookPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const isAdmin = role === "ADMIN";
  const { branchId: currentBranchId, isLoading: branchCtxLoading } =
    useBranchContext();

  const [entries, setEntries] = useState<CashbookEntry[]>([]);
  const [summary, setSummary] = useState<CashbookSummary | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [dateFrom, setDateFrom] = useState(monthStartStr());
  const [dateTo, setDateTo] = useState(todayStr());
  const [typeFilter, setTypeFilter] = useState("all");
  const [methodFilter, setMethodFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await cashbookService.get({
          page,
          limit: 50,
          dateFrom,
          dateTo,
          type: typeFilter === "all" ? undefined : (typeFilter as CashbookType),
          method:
            methodFilter === "all" ? undefined : (methodFilter as CashbookMethod),
          search: search || undefined,
        });
        setEntries(res.items);
        setSummary(res.summary);
        setTotal(res.total);
        setTotalPages(res.totalPages);
        setTruncated(res.meta.truncated);
      } catch (err) {
        console.error("Failed to load cashbook:", err);
        setError(normalizeApiError(err).message);
      } finally {
        setLoading(false);
      }
    },
    [page, dateFrom, dateTo, typeFilter, methodFilter, search]
  );

  useEffect(() => {
    if (branchCtxLoading || roleLoading) return;
    if (!isAdmin) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchCtxLoading, roleLoading, isAdmin]);

  useEffect(() => {
    if (branchCtxLoading || roleLoading) return;
    if (!isAdmin) return;
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, dateFrom, dateTo, typeFilter, methodFilter, search]);

  const applySearch = () => {
    setSearch(searchInput.trim());
    setPage(1);
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const url = cashbookExportUrl({
        dateFrom,
        dateTo,
        type: typeFilter === "all" ? undefined : (typeFilter as CashbookType),
        method: methodFilter === "all" ? undefined : (methodFilter as CashbookMethod),
        search: search || undefined,
      });
      const res = await fetch(url, {
        credentials: "same-origin",
        headers: currentBranchId ? { "x-branch-id": currentBranchId } : undefined,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || "Gagal mengekspor buku kas");
      }
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = `cashbook-${todayStr()}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      console.error("Failed to export cashbook:", err);
      toast.error(err instanceof Error ? err.message : "Gagal mengekspor buku kas");
    } finally {
      setIsExporting(false);
    }
  };

  const cards = useMemo(() => {
    if (!summary) return [];
    return [
      {
        label: "Total Kas Masuk",
        value: rupiah(summary.totalIn),
        icon: ArrowDownLeft,
        hint: "KASIR + QRIS",
      },
      {
        label: "Total Kas Keluar",
        value: rupiah(summary.totalOut),
        icon: ArrowUpRight,
        hint: "Refund + Pengeluaran",
      },
      {
        label: "Net Movement (periode)",
        value: rupiah(summary.netMovement),
        icon: Scale,
        hint: "Bukan saldo absolut",
      },
      {
        label: "Kas Fisik Teratribusi",
        value: rupiah(summary.attributableCash.net),
        icon: Scale,
        hint: "Tunai (KASIR) − refund/expense tunai",
      },
    ];
  }, [summary]);

  if (!roleLoading && !isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-3">
        <AlertCircle className="h-10 w-10 text-red-500" />
        <p className="text-gray-600">Halaman ini hanya untuk admin.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Buku Kas</h1>
          <p className="text-gray-500">
            Pergerakan kas dari pembayaran, refund, dan pengeluaran
          </p>
        </div>
        <Button size="sm" onClick={handleExport} disabled={isExporting}>
          {isExporting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Download CSV
        </Button>
      </div>

      {/* Explicit, non-negotiable warnings */}
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
        <p>• Kas berbeda dari omzet/revenue.</p>
        <p>• Saldo awal tidak tersedia; saldo absolut tidak ditampilkan.</p>
        <p>• Settlement QRIS belum terverifikasi.</p>
        <p>• Transaksi tanpa shift tidak dapat diatribusikan ke laci kasir.</p>
        <p>
          • Tanggal bertanda (fallback) memakai waktu pembuatan (createdAt),
          bukan waktu penerimaan uang yang terverifikasi.
        </p>
        <p>
          • Transaksi legacy tanpa cabang (branchId kosong) tidak ditampilkan
          bagi admin yang dibatasi ke cabang tertentu.
        </p>
      </div>

      {truncated && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          Data melebihi batas tampilan — sebagian baris mungkin tidak
          ditampilkan. Persempit rentang tanggal.
        </div>
      )}

      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Dari</span>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Sampai</span>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </div>
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Tipe</span>
              <Select
                value={typeFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setTypeFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[140px] h-9 text-sm">
                  <SelectValue>
                    {typeFilter === "all"
                      ? "Semua"
                      : typeFilter === "IN"
                        ? "Masuk"
                        : "Keluar"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua</SelectItem>
                  <SelectItem value="IN">Masuk</SelectItem>
                  <SelectItem value="OUT">Keluar</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Metode</span>
              <Select
                value={methodFilter}
                onValueChange={(v) => {
                  if (v !== null) {
                    setMethodFilter(v);
                    setPage(1);
                  }
                }}
              >
                <SelectTrigger className="w-[170px] h-9 text-sm">
                  <SelectValue>
                    {methodFilter === "all"
                      ? "Semua Metode"
                      : METHOD_OPTIONS.find((m) => m.value === methodFilter)
                          ?.label ?? "Semua Metode"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Semua Metode</SelectItem>
                  {METHOD_OPTIONS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <span className="text-xs text-gray-500">Cari (order/catatan)</span>
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") applySearch();
                }}
                placeholder="Cari..."
                className="h-9 w-[180px] text-sm"
              />
            </div>
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={applySearch}>
                Cari
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => load()}
                disabled={loading}
              >
                <RefreshCw
                  className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                />
                Refresh
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-1 border-t border-gray-100">
            <ReportBranchFilter />
          </div>
        </CardContent>
      </Card>

      {summary && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {cards.map((c) => (
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
      )}

      {summary && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Rincian Masuk</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Tunai (KASIR)</span>
                <span className="tabular-nums">{rupiah(summary.inflow.kasir)}</span>
              </div>
              <div className="flex justify-between">
                <span className="flex items-center gap-1">
                  <QrCode className="h-3.5 w-3.5" /> QRIS (belum settled)
                </span>
                <span className="tabular-nums">{rupiah(summary.inflow.qris)}</span>
              </div>
              {summary.inflow.other > 0 && (
                <div className="flex justify-between">
                  <span>Instrumen lain</span>
                  <span className="tabular-nums">{rupiah(summary.inflow.other)}</span>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Rincian Keluar</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Refund tunai</span>
                <span className="tabular-nums">{rupiah(summary.outflow.refundKasir)}</span>
              </div>
              <div className="flex justify-between">
                <span>Refund non-tunai</span>
                <span className="tabular-nums">{rupiah(summary.outflow.refundQris)}</span>
              </div>
              {summary.outflow.refundUnknown > 0 && (
                <div className="flex justify-between">
                  <span>Refund (instrumen tidak pasti)</span>
                  <span className="tabular-nums">
                    {rupiah(summary.outflow.refundUnknown)}
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span>Pengeluaran tunai</span>
                <span className="tabular-nums">{rupiah(summary.outflow.expenseCash)}</span>
              </div>
              <div className="flex justify-between">
                <span>Pengeluaran non-tunai</span>
                <span className="tabular-nums">
                  {rupiah(
                    summary.outflow.expenseTransfer +
                      summary.outflow.expenseQris +
                      summary.outflow.expenseCard +
                      summary.outflow.expenseOther
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Indikator</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span>Non-tunai (masuk)</span>
                <span className="tabular-nums">{rupiah(summary.nonCash.in)}</span>
              </div>
              <div className="flex justify-between">
                <span>Pembayaran pada order CANCELLED</span>
                <span className="tabular-nums">
                  {summary.collectedOnCancelledOrders.count} ·{" "}
                  {rupiah(summary.collectedOnCancelledOrders.amount)}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Tanpa shift</span>
                <span className="tabular-nums">
                  {summary.unattributedShift.count} ·{" "}
                  {rupiah(summary.unattributedShift.inAmount + summary.unattributedShift.outAmount)}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Mutasi Kas ({total})
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          {loading ? (
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
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-sm text-gray-400">
              Belum ada mutasi kas pada filter ini.
            </p>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tanggal</TableHead>
                      <TableHead>Sumber</TableHead>
                      <TableHead>Tipe</TableHead>
                      <TableHead>Metode</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Cabang</TableHead>
                      <TableHead>Order / Shift</TableHead>
                      <TableHead className="text-right">Nominal</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {entries.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="whitespace-nowrap text-xs text-gray-500">
                          {fmtDate(e.date)}
                          {e.dateFallback && (
                            <span className="ml-1 text-amber-600">(fallback)</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">
                          {SOURCE_LABEL[e.source] ?? e.source}
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={
                              e.type === "IN"
                                ? "bg-green-100 text-green-700 border border-green-200"
                                : "bg-red-50 text-red-700 border border-red-200"
                            }
                          >
                            {e.type === "IN" ? "Masuk" : "Keluar"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{e.methodLabel}</TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {e.status ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-gray-500">
                          {e.branchCode ? `${e.branchCode}` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {e.orderNumber ?? "—"}
                          {e.shiftNumber ? ` / ${e.shiftNumber}` : ""}
                          {!e.shiftAttributed && e.source !== "EXPENSE" && (
                            <span className="ml-1 text-amber-600" title="Tidak teratribusi ke shift">
                              !
                            </span>
                          )}
                          {e.onCancelledOrder && (
                            <Badge variant="secondary" className="ml-1 text-[10px]">
                              order cancelled
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell
                          className={`text-right tabular-nums font-medium ${
                            e.type === "IN" ? "text-green-700" : "text-red-700"
                          }`}
                        >
                          {e.type === "IN" ? "+" : "−"}
                          {rupiah(e.amount)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 mt-4 border-t">
                  <p className="text-xs text-gray-500">
                    Halaman {page} dari {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                    >
                      Sebelumnya
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Berikutnya
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
