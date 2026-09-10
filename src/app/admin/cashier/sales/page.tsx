"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUserRole } from "@/hooks/use-user-role";
import { useBranchContext } from "@/hooks/use-branch-context";
import {
  normalizeApiError,
  isUnauthorized,
  type NormalizedApiError,
} from "@/lib/api-error-handler";
import {
  cashierSalesService,
  type SalesTransaction,
  type SalesPageResult,
} from "@/services/cashier-sales.service";
import { userService } from "@/services/shift.service";
import { orderService, type Order } from "@/services/order.service";
import { PrintBillDialog } from "@/components/admin/orders/print-bill-dialog";
import { toast } from "sonner";
import {
  Loader2,
  RefreshCw,
  AlertCircle,
  Banknote,
  Smartphone,
  TrendingUp,
  FileText,
  Receipt,
  ChevronLeft,
  ChevronRight,
  Eye,
  Printer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

const rupiah = (n: number | string) =>
  `Rp${Number(n || 0).toLocaleString("id-ID")}`;

function fmtTime(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

const PAYMENT_STATUS_META: Record<string, { label: string; cls: string }> = {
  PAID: { label: "Lunas", cls: "bg-green-100 text-green-700" },
  PENDING: { label: "Menunggu", cls: "bg-yellow-100 text-yellow-700" },
  FAILED: { label: "Gagal", cls: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Kedaluwarsa", cls: "bg-orange-100 text-orange-700" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-gray-100 text-gray-600" },
};

const ORDER_TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine In",
  TAKEAWAY: "Takeaway",
  DELIVERY: "Delivery",
};

const PERIOD_PRESETS = [
  { label: "Hari Ini", value: "today" },
  { label: "Kemarin", value: "yesterday" },
  { label: "Minggu Ini", value: "week" },
  { label: "Bulan Ini", value: "month" },
  { label: "Custom", value: "custom" },
] as const;

function getPresetRange(preset: string): { startDate: string; endDate: string } {
  const now = new Date();
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  switch (preset) {
    case "today":
      return { startDate: fmt(now), endDate: fmt(now) };
    case "yesterday": {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      return { startDate: fmt(y), endDate: fmt(y) };
    }
    case "week": {
      const start = new Date(now);
      start.setDate(start.getDate() - start.getDay() + 1); // Monday
      return { startDate: fmt(start), endDate: fmt(now) };
    }
    case "month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: fmt(start), endDate: fmt(now) };
    }
    default:
      return { startDate: fmt(now), endDate: fmt(now) };
  }
}

export default function CashierSalesPage() {
  const { role, isLoading: roleLoading } = useUserRole();
  const { isLoading: branchCtxLoading, branches } = useBranchContext();
  const isAdmin = role === "ADMIN";

  // Data
  const [data, setData] = useState<SalesPageResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<NormalizedApiError | null>(null);

  // Filters
  const [period, setPeriod] = useState("today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [filterCashier, setFilterCashier] = useState("");
  const [filterBranch, setFilterBranch] = useState("");
  const [filterPaymentMethod, setFilterPaymentMethod] = useState("");
  const [filterPaymentStatus, setFilterPaymentStatus] = useState("");
  const [filterOrderType, setFilterOrderType] = useState("");
  const [cashiers, setCashiers] = useState<Array<{ id: string; name: string }>>([]);
  const [page, setPage] = useState(1);

  // Detail
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [printOrder, setPrintOrder] = useState<Order | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  // Load data
  const load = useCallback(async () => {
    if (roleLoading || !role || branchCtxLoading) return;
    setLoading(true);
    setError(null);
    try {
      const dateRange =
        period === "custom"
          ? { startDate: startDate || undefined, endDate: endDate || undefined }
          : getPresetRange(period);

      const result = await cashierSalesService.getSales({
        page,
        limit: 30,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        shiftId: undefined,
        paymentMethod: filterPaymentMethod || undefined,
        paymentStatus: filterPaymentStatus || undefined,
        orderType: filterOrderType || undefined,
        cashierId: isAdmin ? filterCashier || undefined : undefined,
        branchId: filterBranch || undefined,
      });
      setData(result);
    } catch (err) {
      if (isUnauthorized(err)) return;
      console.error("Failed to load cashier sales:", err);
      setError(normalizeApiError(err));
    } finally {
      setLoading(false);
    }
  }, [
    role,
    roleLoading,
    branchCtxLoading,
    period,
    startDate,
    endDate,
    page,
    filterCashier,
    filterBranch,
    filterPaymentMethod,
    filterPaymentStatus,
    filterOrderType,
    isAdmin,
  ]);

  useEffect(() => {
    load();
  }, [load]);

  // Load cashier list (admin only)
  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    userService
      .listUsers()
      .then((res) => {
        if (!alive) return;
        setCashiers(
          (res.items || [])
            .filter((u) => u.role === "CASHIER")
            .map((u) => ({ id: u.id, name: u.name }))
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  // Period change
  const handlePeriodChange = (p: string) => {
    setPeriod(p);
    setPage(1);
    if (p !== "custom") {
      setStartDate("");
      setEndDate("");
    }
  };

  // Open detail
  const openDetail = async (orderNumber: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const order = await orderService.getOrderByNumber(orderNumber);
      setDetailOrder(order);
    } catch {
      toast.error("Gagal memuat detail transaksi");
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
  };

  // Print bill
  const openPrint = async (orderNumber: string) => {
    try {
      const order = await orderService.getOrderByNumber(orderNumber);
      setPrintOrder(order);
      setPrintOpen(true);
    } catch {
      toast.error("Gagal memuat data untuk cetak");
    }
  };

  const summary = data?.summary;

  if (roleLoading || (loading && !data)) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">Riwayat Penjualan</h1>
        </div>
        <div className="flex flex-col items-center justify-center py-16 space-y-3 text-center">
          <AlertCircle className="h-10 w-10 text-red-500" />
          <p className="text-sm text-gray-600">{error.message}</p>
          {error.retryable && (
            <Button variant="outline" size="sm" onClick={() => load()}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Coba Lagi
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold">
          {isAdmin ? "Riwayat Penjualan" : "Riwayat Penjualan Saya"}
        </h1>
        <p className="text-muted-foreground">
          {isAdmin
            ? "Lihat semua transaksi kasir berdasarkan periode dan filter"
            : "Buku transaksi yang Anda proses"}
        </p>
      </div>

      {/* Summary Cards */}
      {summary && (
        <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Transaksi</p>
            <p className="text-2xl font-bold">{summary.totalTransactions}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Total Penjualan</p>
            <p className="text-2xl font-bold">{rupiah(summary.totalSales)}</p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Banknote className="h-3 w-3" /> CASH
            </div>
            <p className="text-xl font-bold text-green-700">
              {rupiah(summary.totalCash)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Smartphone className="h-3 w-3" /> QRIS
            </div>
            <p className="text-xl font-bold text-blue-700">
              {rupiah(summary.totalQris)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <p className="text-xs text-muted-foreground">Refund</p>
            <p className="text-xl font-bold text-red-600">
              {rupiah(summary.totalRefund)}
            </p>
          </div>
          <div className="rounded-xl border bg-card p-4">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Net Sales
            </div>
            <p className="text-xl font-bold">{rupiah(summary.netSales)}</p>
          </div>
        </div>
      )}

      {/* Filter Bar */}
      <div className="rounded-xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          {/* Period presets */}
          <div className="flex flex-wrap gap-1">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => handlePeriodChange(p.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
                  period === p.value
                    ? "bg-gray-900 text-white border-gray-900"
                    : "border-gray-300 text-gray-600 hover:bg-gray-100"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          {/* Custom date range */}
          {period === "custom" && (
            <>
              <input
                type="date"
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
              <span className="text-xs text-muted-foreground">s/d</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              />
            </>
          )}

          {/* Admin-only filters */}
          {isAdmin && (
            <>
              <select
                value={filterCashier}
                onChange={(e) => {
                  setFilterCashier(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Semua Kasir</option>
                {cashiers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>

              <select
                value={filterBranch}
                onChange={(e) => {
                  setFilterBranch(e.target.value);
                  setPage(1);
                }}
                className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
              >
                <option value="">Semua Cabang</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </>
          )}

          <select
            value={filterPaymentMethod}
            onChange={(e) => {
              setFilterPaymentMethod(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">Semua Pembayaran</option>
            <option value="KASIR">CASH</option>
            <option value="QRIS">QRIS</option>
          </select>

          <select
            value={filterPaymentStatus}
            onChange={(e) => {
              setFilterPaymentStatus(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">Semua Status</option>
            <option value="PAID">Lunas</option>
            <option value="FAILED">Gagal</option>
            <option value="EXPIRED">Kedaluwarsa</option>
            <option value="CANCELLED">Dibatalkan</option>
          </select>

          <select
            value={filterOrderType}
            onChange={(e) => {
              setFilterOrderType(e.target.value);
              setPage(1);
            }}
            className="border border-gray-300 rounded-lg px-3 py-1.5 text-sm"
          >
            <option value="">Semua Tipe</option>
            <option value="DINE_IN">Dine In</option>
            <option value="TAKEAWAY">Takeaway</option>
            <option value="DELIVERY">Delivery</option>
          </select>

          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFilterCashier("");
              setFilterBranch("");
              setFilterPaymentMethod("");
              setFilterPaymentStatus("");
              setFilterOrderType("");
              setPeriod("today");
              setStartDate("");
              setEndDate("");
              setPage(1);
            }}
          >
            Reset
          </Button>
        </div>
      </div>

      {/* Transaction Table */}
      <div className="rounded-xl border bg-card overflow-x-auto">
        <div className="p-4 border-b">
          <h2 className="font-semibold">Daftar Transaksi</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground border-b">
              <th className="px-3 py-2">Waktu</th>
              <th className="px-3 py-2">Order</th>
              {isAdmin && <th className="px-3 py-2">Kasir</th>}
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Tipe</th>
              <th className="px-3 py-2">Pembayaran</th>
              <th className="px-3 py-2 text-right">Total</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Shift</th>
              <th className="px-3 py-2 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {data?.items.map((t) => (
              <tr key={t.id} className="border-b last:border-0">
                <td className="px-3 py-2 text-xs whitespace-nowrap">
                  {fmtTime(t.paidAt || t.createdAt)}
                </td>
                <td className="px-3 py-2 font-mono text-xs">
                  <button
                    onClick={() => openDetail(t.orderNumber)}
                    className="text-blue-600 hover:underline"
                  >
                    {t.orderNumber}
                  </button>
                </td>
                {isAdmin && (
                  <td className="px-3 py-2 text-xs">
                    {t.cashierName ? t.cashierName : "—"}
                  </td>
                )}
                <td className="px-3 py-2 text-xs">{t.customerName}</td>
                <td className="px-3 py-2 text-xs">
                  {ORDER_TYPE_LABEL[t.orderType] || t.orderType}
                </td>
                <td className="px-3 py-2">
                  <Badge variant="outline" className="text-xs">
                    {t.paymentMethod === "KASIR"
                      ? "CASH"
                      : t.paymentMethod || "—"}
                  </Badge>
                </td>
                <td className="px-3 py-2 text-right tabular-nums font-medium">
                  {rupiah(t.amount)}
                </td>
                <td className="px-3 py-2">
                  <Badge
                    className={`text-xs ${
                      PAYMENT_STATUS_META[t.paymentStatus]?.cls || ""
                    }`}
                  >
                    {PAYMENT_STATUS_META[t.paymentStatus]?.label ||
                      t.paymentStatus}
                  </Badge>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                  {t.shiftNumber || "—"}
                  {t.branchCode ? (
                    <span className="ml-1 rounded bg-gray-100 px-1 py-0.5 text-[10px]">
                      {t.branchCode}
                    </span>
                  ) : null}
                </td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openDetail(t.orderNumber)}
                    >
                      <Eye className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openPrint(t.orderNumber)}
                    >
                      <Printer className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {data?.items.length === 0 && (
              <tr>
                <td
                  colSpan={isAdmin ? 10 : 9}
                  className="px-4 py-10 text-center text-muted-foreground"
                >
                  Belum ada transaksi untuk periode ini
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Halaman {data.page} dari {data.totalPages} ({data.total} transaksi)
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
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Detail Dialog */}
      {detailOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold">Detail Transaksi</h2>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setDetailOpen(false);
                    setDetailOrder(null);
                  }}
                >
                  ✕
                </Button>
              </div>
              {detailLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : detailOrder ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Order</p>
                      <p className="font-mono font-medium">
                        {detailOrder.orderNumber}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Waktu</p>
                      <p>{fmtTime(detailOrder.createdAt)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Customer</p>
                      <p>{detailOrder.customer?.name || "—"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Tipe</p>
                      <p>{ORDER_TYPE_LABEL[detailOrder.orderType] || detailOrder.orderType}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Status</p>
                      <Badge className={PAYMENT_STATUS_META[detailOrder.status]?.cls || ""}>
                        {detailOrder.status}
                      </Badge>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Pembayaran</p>
                      <Badge variant="outline">
                        {detailOrder.payments?.[0]?.method === "KASIR"
                          ? "CASH"
                          : detailOrder.payments?.[0]?.method || "—"}
                      </Badge>
                    </div>
                  </div>

                  {/* Items */}
                  {detailOrder.items && detailOrder.items.length > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground mb-2">Items</p>
                      <div className="border rounded-lg divide-y">
                        {detailOrder.items.map((item: any) => (
                          <div key={item.id} className="flex justify-between p-2 text-sm">
                            <div>
                              <span>{item.product?.name || "Item"}</span>
                              {item.quantity > 1 && (
                                <span className="text-muted-foreground ml-1">
                                  ×{item.quantity}
                                </span>
                              )}
                            </div>
                            <span className="tabular-nums">
                              {rupiah(item.totalPrice)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Totals */}
                  <div className="border-t pt-3 space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="tabular-nums">{rupiah(detailOrder.subtotal)}</span>
                    </div>
                    {Number(detailOrder.discount) > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>Diskon</span>
                        <span className="tabular-nums">-{rupiah(detailOrder.discount)}</span>
                      </div>
                    )}
                    {Number(detailOrder.tax) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Pajak</span>
                        <span className="tabular-nums">{rupiah(detailOrder.tax)}</span>
                      </div>
                    )}
                    {Number(detailOrder.serviceCharge) > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Service Charge</span>
                        <span className="tabular-nums">{rupiah(detailOrder.serviceCharge)}</span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold border-t pt-1">
                      <span>Grand Total</span>
                      <span className="tabular-nums">{rupiah(detailOrder.grandTotal)}</span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setDetailOpen(false);
                        setDetailOrder(null);
                        openPrint(detailOrder.orderNumber);
                      }}
                    >
                      <Printer className="h-4 w-4 mr-1" /> Cetak Bill
                    </Button>
                    <Link
                      href={`/admin/orders/${detailOrder.orderNumber}`}
                      target="_blank"
                    >
                      <Button variant="outline" size="sm">
                        <FileText className="h-4 w-4 mr-1" /> Buka di Orders
                      </Button>
                    </Link>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* Print Bill Dialog */}
      {printOrder && (
        <PrintBillDialog
          order={printOrder}
          open={printOpen}
          onOpenChange={setPrintOpen}
        />
      )}
    </div>
  );
}
