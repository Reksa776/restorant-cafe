"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  CreditCard,
  Loader2,
  RefreshCw,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { orderService, type Order } from "@/services/order.service";
import { useRealtimeListener } from "@/components/admin/realtime-provider";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { OrderScanner } from "@/components/admin/order-scanner";
import { CashierPayDialog } from "@/components/admin/orders/cashier-pay-dialog";
import { ApprovalActions } from "@/components/admin/orders/approval-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

const rupiah = (v: string | number) =>
  `Rp${Number(v).toLocaleString("id-ID")}`;

const ORDER_STATUS_META: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Menunggu", cls: "bg-yellow-100 text-yellow-800 border-yellow-200" },
  CONFIRMED: { label: "Dikonfirmasi", cls: "bg-blue-100 text-blue-800 border-blue-200" },
  PROCESSING: { label: "Diproses", cls: "bg-purple-100 text-purple-800 border-purple-200" },
  READY: { label: "Siap", cls: "bg-orange-100 text-orange-800 border-orange-200" },
  COMPLETED: { label: "Selesai", cls: "bg-green-100 text-green-800 border-green-200" },
  CANCELLED: { label: "Dibatalkan", cls: "bg-red-100 text-red-800 border-red-200" },
};

const PAYMENT_STATUS_META: Record<string, { label: string; cls: string }> = {
  UNPAID: { label: "Belum Bayar", cls: "bg-gray-100 text-gray-600" },
  PENDING: { label: "Menunggu Pembayaran", cls: "bg-yellow-100 text-yellow-700" },
  PAID: { label: "Lunas", cls: "bg-green-100 text-green-700" },
  FAILED: { label: "Pembayaran Gagal", cls: "bg-red-100 text-red-700" },
  EXPIRED: { label: "Kedaluwarsa", cls: "bg-orange-100 text-orange-700" },
};

const TYPE_META: Record<string, { label: string; Icon: typeof UtensilsCrossed }> = {
  DINE_IN: { label: "Dine In", Icon: UtensilsCrossed },
  TAKEAWAY: { label: "Takeaway", Icon: ShoppingBag },
  DELIVERY: { label: "Delivery", Icon: Truck },
};

/**
 * /admin/orders/[orderNumber] — opened automatically after "Scan QR Pesanan".
 * Full order view for the cashier: status, items, totals, payment history
 * with cashier audit, and the "Proses Pembayaran Kasir" form.
 */
export default function AdminOrderByNumberPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "not_found" | "error">("loading");
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    params.then(({ orderNumber: num }) => {
      if (!cancelled) setOrderNumber(num);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const loadOrder = useCallback(async () => {
    if (!orderNumber) return;
    try {
      const data = await orderService.getOrderByNumber(orderNumber);
      setOrder(data);
      setLoadState("loaded");
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((error as any)?.response?.status === 404) {
        setLoadState("not_found");
      } else {
        setLoadState("error");
      }
    }
  }, [orderNumber]);

  useEffect(() => {
    setLoadState("loading");
    setOrder(null);
    loadOrder();
  }, [loadOrder]);

  // Keep this page live: cashier actions + order workflow arrive via SSE.
  useRealtimeListener(
    [
      REALTIME_EVENT_TYPES.ORDER_STATUS_CHANGED,
      REALTIME_EVENT_TYPES.ORDER_UPDATED,
      REALTIME_EVENT_TYPES.PAYMENT_CREATED,
      REALTIME_EVENT_TYPES.PAYMENT_UPDATED,
      REALTIME_EVENT_TYPES.PAYMENT_STATUS_CHANGED,
      REALTIME_EVENT_TYPES.OFFLINE_POLL,
    ],
    (evt) => {
      if (!order) return;
      if (String(evt.data?.orderId) === order.id) loadOrder();
    }
  );

  if (loadState === "loading") {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
        Memuat pesanan...
      </div>
    );
  }

  if (loadState === "not_found") {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4 text-center">
        <XCircle className="h-10 w-10 text-red-500" />
        <p className="text-lg font-medium">Pesanan tidak ditemukan</p>
        <p className="text-sm text-muted-foreground">
          Tidak ada pesanan {orderNumber} pada restoran ini.
        </p>
        <Link href="/admin/orders">
          <Button variant="outline">Kembali ke Pesanan</Button>
        </Link>
      </div>
    );
  }

  if (loadState === "error" || !order) {
    return (
      <div className="flex flex-col items-center justify-center h-64 space-y-4 text-center">
        <p className="text-muted-foreground">Gagal memuat pesanan.</p>
        <Button variant="outline" onClick={loadOrder}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Coba Lagi
        </Button>
      </div>
    );
  }

  const statusMeta = ORDER_STATUS_META[order.status] || ORDER_STATUS_META.PENDING;
  const payMeta = PAYMENT_STATUS_META[order.paymentStatus];
  const typeMeta = TYPE_META[order.orderType] || TYPE_META.DINE_IN;
  const TypeIcon = typeMeta.Icon;

  const payments = (order.payments || [])
    .slice()
    .sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return tb - ta;
    });
  const cashierUnpaid = payments.find(
    (p) => p.method === "KASIR" && p.status === "UNPAID"
  );
  const isPaid = order.paymentStatus === "PAID";

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/admin/orders" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold font-mono">#{order.orderNumber}</h1>
        </div>
        <div className="flex gap-2">
          <OrderScanner
            onScan={(num) => router.push(`/admin/orders/${num}`)}
            triggerLabel="Pindai Pesanan Lain"
          />
          <Button variant="outline" size="sm" onClick={loadOrder}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Status badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <Badge className={`${statusMeta.cls} border`}>
          {statusMeta.label}
        </Badge>
        {payMeta && (
          <Badge className={`${payMeta.cls} border`}>
            <CreditCard className="h-3 w-3 mr-1" />
            {payMeta.label}
          </Badge>
        )}
        <Badge variant="outline">
          <TypeIcon className="h-3 w-3 mr-1" />
          {typeMeta.label}
        </Badge>
        {order.table && (
          <Badge variant="outline">Meja {order.table.number}</Badge>
        )}
        {order.visitorCount ? (
          <Badge variant="outline">{order.visitorCount} orang</Badge>
        ) : null}
      </div>

      {/* Payment / cashier actions */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {order.customer?.name || "Guest"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {new Date(order.createdAt).toLocaleString("id-ID")}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Grand Total</p>
              <p className="text-2xl font-bold tabular-nums">
                {rupiah(order.grandTotal)}
              </p>
            </div>
          </div>

          {isPaid ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-green-50 border border-green-200 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm text-green-800">
                <CheckCircle2 className="h-4 w-4" />
                Pesanan sudah lunas
              </div>
              {/* Refund / cancel with admin password — also here for direct
                  actions without opening the orders list. */}
              {!["COMPLETED", "CANCELLED"].includes(order.status) && (
                <ApprovalActions order={order} compact onDone={loadOrder} />
              )}
            </div>
          ) : cashierUnpaid ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <Banknote className="h-5 w-5 text-amber-700 flex-shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-900">
                    Pembayaran kasir belum diterima
                  </p>
                  <p className="text-xs text-amber-700">
                    Total tagihan {rupiah(cashierUnpaid.amount)} — hitung uang
                    diterima & kembalian.
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                className="bg-green-600 hover:bg-green-700 flex-shrink-0"
                onClick={() => setDialogOpen(true)}
              >
                <Banknote className="h-4 w-4 mr-1" />
                Proses Pembayaran Kasir
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Tidak ada pembayaran kasir yang menunggu.
            </p>
          )}
        </CardContent>
      </Card>

      <CashierPayDialog
        order={order}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onCompleted={() => loadOrder()}
      />

      {/* Payment history + audit */}
      {payments.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <h2 className="font-medium">Riwayat Pembayaran</h2>
            <div className="space-y-1.5">
              {payments
                .slice()
                .reverse()
                .map((p, idx) => {
                  const methodLabel =
                    p.method === "KASIR"
                      ? "Kasir"
                      : p.method === "QRIS"
                        ? "QRIS"
                        : p.provider === "ipaymu" && !p.method
                          ? "VA iPaymu"
                          : p.method || "Pembayaran";
                  const pMeta = PAYMENT_STATUS_META[p.status];
                  const cashierTxn = (p.transactions || []).find(
                    (t) => t.type === "cashier_payment" && t.status === "PAID"
                  );
                  let audit: {
                    amountReceived: number;
                    changeAmount: number;
                    processedAt?: string;
                  } | null = null;
                  if (cashierTxn) {
                    let rd = cashierTxn.rawData;
                    if (typeof rd === "string") {
                      try {
                        rd = JSON.parse(rd);
                      } catch {
                        rd = null;
                      }
                    }
                    if (rd && rd.amountReceived !== undefined) {
                      audit = {
                        amountReceived: Number(rd.amountReceived),
                        changeAmount: Number(rd.changeAmount || 0),
                        processedAt: rd.processedAt || cashierTxn.createdAt,
                      };
                    }
                  }
                  return (
                    <div
                      key={p.id}
                      className="rounded-lg bg-muted/40 border border-border px-3 py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-muted-foreground">
                            {idx + 1}. {methodLabel} ·{" "}
                            {p.createdAt
                              ? new Date(p.createdAt).toLocaleString("id-ID")
                              : ""}
                          </p>
                          <p className="text-sm font-semibold tabular-nums">
                            {rupiah(p.amount)}
                          </p>
                        </div>
                        {pMeta && (
                          <span
                            className={`shrink-0 text-[10px] font-medium px-2 py-0.5 rounded-full ${pMeta.cls}`}
                          >
                            {pMeta.label}
                          </span>
                        )}
                      </div>
                      {audit && (
                        <div className="mt-1.5 pt-1.5 border-t border-border/70 text-xs text-muted-foreground space-y-0.5">
                          <p>
                            Diterima{" "}
                            <span className="font-medium text-foreground">
                              {rupiah(audit.amountReceived)}
                            </span>{" "}
                            · Kembalian{" "}
                            <span
                              className={`font-medium ${
                                audit.changeAmount > 0
                                  ? "text-green-700"
                                  : "text-foreground"
                              }`}
                            >
                              {rupiah(audit.changeAmount)}
                            </span>
                          </p>
                          {audit.processedAt && (
                            <p>
                              Diproses{" "}
                              {new Date(audit.processedAt).toLocaleString(
                                "id-ID"
                              )}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Items + totals */}
      <Card>
        <CardContent className="p-4 space-y-3">
          <h2 className="font-medium">Item Pesanan</h2>
          <div className="space-y-1.5">
            {(order.items || []).map((item) => (
              <div key={item.id} className="flex justify-between text-sm">
                <span>
                  <span className="font-medium">{item.quantity}x</span>{" "}
                  {item.product.name}
                </span>
                <span className="tabular-nums">
                  {rupiah(item.totalPrice)}
                </span>
              </div>
            ))}
          </div>
          <div className="border-t pt-2 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{rupiah(order.subtotal)}</span>
            </div>
            {Number(order.tax) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Pajak (10%)</span>
                <span className="tabular-nums">{rupiah(order.tax)}</span>
              </div>
            )}
            {Number(order.serviceCharge) > 0 && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Service Charge</span>
                <span className="tabular-nums">
                  {rupiah(order.serviceCharge)}
                </span>
              </div>
            )}
            <div className="border-t pt-1.5 flex justify-between font-bold">
              <span>Total</span>
              <span className="tabular-nums">{rupiah(order.grandTotal)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Status timeline */}
      {order.statusHistory && order.statusHistory.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <h2 className="font-medium">Status Timeline</h2>
            <div className="space-y-1">
              {order.statusHistory.map((h, i) => {
                const m = ORDER_STATUS_META[h.status];
                return (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-muted-foreground">•</span>
                    <div>
                      <span className="font-medium">
                        {m?.label || h.status}
                      </span>
                      <span className="text-muted-foreground">
                        {" "}
                        — {new Date(h.createdAt).toLocaleString("id-ID")}
                      </span>
                      {h.notes && (
                        <p className="text-xs text-muted-foreground">
                          {h.notes}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
