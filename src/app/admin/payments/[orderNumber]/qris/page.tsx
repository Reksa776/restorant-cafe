"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CreditCard,
  Loader2,
  RefreshCw,
  UtensilsCrossed,
  ShoppingBag,
  Truck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { orderService, type Order } from "@/services/order.service";
import { KasirQrisScreen } from "@/components/admin/orders/kasir-qris-screen";

const TYPE_META: Record<string, { label: string; Icon: typeof UtensilsCrossed }> = {
  DINE_IN: { label: "Dine In", Icon: UtensilsCrossed },
  TAKEAWAY: { label: "Takeaway", Icon: ShoppingBag },
  DELIVERY: { label: "Delivery", Icon: Truck },
};

/**
 * /admin/payments/[orderNumber]/qris — dedicated QRIS repayment page opened
 * from the Payment Dashboard ("Bayar" / "Repayment").
 *
 * It reuses the kasir QRIS engine end-to-end (createKasirQrisPayment):
 *  - PENDING still valid → the existing QR is reused (no duplicate gateway call)
 *  - FAILED / EXPIRED / stale-PENDING → retried with a fresh QRIS intent
 *  - PAID → the server rejects a new payment; this page shows the paid state
 *  - UNPAID KASIR row → routed to the cash collection flow
 *
 * The order lookup and every payment write are restaurant- and branch-scoped
 * (session restaurantId + authorized branches), so a foreign order number can
 * never create a payment here (404/403 server-side).
 */
export default function AdminPaymentQrisPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const [loadState, setLoadState] = useState<
    "loading" | "loaded" | "not_found" | "error"
  >("loading");

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
      const status = (error as any)?.response?.status;
      if (status === 404 || status === 403) {
        setLoadState("not_found");
      } else {
        setLoadState("error");
      }
    }
  }, [orderNumber]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve(); // defer past the effect body (React 19)
      if (cancelled) return;
      setLoadState("loading");
      setOrder(null);
      void loadOrder();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadOrder]);

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
          Tidak ada pesanan {orderNumber} pada cabang/restoran Anda.
        </p>
        <Link href="/admin/payments">
          <Button variant="outline">Kembali ke Payment Dashboard</Button>
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

  const typeMeta = TYPE_META[order.orderType] || TYPE_META.DINE_IN;
  const TypeIcon = typeMeta.Icon;

  return (
    <div className="space-y-6 max-w-xl">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link
            href="/admin/payments"
            className="text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-2xl font-bold">Pembayaran QRIS</h1>
        </div>
      </div>

      {/* Order summary */}
      <Card>
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="font-mono font-semibold">{order.orderNumber}</p>
              <p className="text-sm text-muted-foreground">
                {order.customer?.name || "Guest"}
                {order.table ? ` • Meja ${order.table.number}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600">
                <TypeIcon className="h-3.5 w-3.5" />
                {typeMeta.label}
              </span>
              <CreditCard className="h-4 w-4 text-muted-foreground" />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* QRIS screen — create/reuse, QR + countdown + polling + retry */}
      <Card>
        <CardContent className="p-4">
          <KasirQrisScreen
            orderNumber={order.orderNumber}
            amount={order.grandTotal}
            backHref="/admin/payments"
            backLabel="Kembali ke Payment Dashboard"
          />
        </CardContent>
      </Card>
    </div>
  );
}