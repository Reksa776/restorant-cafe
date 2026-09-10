"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Banknote,
  QrCode,
  Loader2,
  XCircle,
  CheckCircle2,
  ScanLine,
  Clock,
} from "lucide-react";
import { OrderScanner } from "@/components/admin/order-scanner";
import { paymentService, type Payment } from "@/services/payment.service";
import { orderService, type Order } from "@/services/order.service";
import { isShiftNotOpen } from "@/lib/api-error-handler";
import { notifyShiftNotOpen } from "@/lib/notify-shift";

// The barcode flow uses the exported domain types as the source of truth:
// - Order from the order service (its payments rows are the shared Payment
//   type from the payment service — a single representation of a payment).
// - Payment from the payment service, which now carries the QRIS display
//   fields the gateway fills (qrImage / qrString / providerRef) plus the
//   audit transactions. No parallel admin-local payment/order domain type is
//   maintained here.

const rupiah = (v: string | number) =>
  `Rp${Number(v).toLocaleString("id-ID")}`;

type PaymentMethod = "CASH" | "QRIS" | null;
type PayStatus =
  | "choose"
  | "cash-form"
  | "qris-loading"
  | "qris-ready"
  | "success"
  | "error"
  | "paid";
type ScanStatus =
  | "idle"
  | "opening"
  | "scanning"
  | "order-found"
  | "invalid";

interface BarcodePaymentFlowProps {
  onPaymentCompleted?: (orderId: string, orderNumber: string) => void;
  /** Optional controlled open state (e.g. an external "Bayar" button). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Order number already known at open time (e.g. the scan that landed on
   * the order detail page). When provided the flow loads THAT order directly
   * and skips the scanner — the cashier scans only once. The lookup still
   * goes through the restaurant/branch-scoped admin endpoint, so a known
   * number never bypasses authorization (foreign order → 404/403).
   */
  initialOrderNumber?: string | null;
}

// Polling cadence matches the customer payment page (4s). Same infrastructure
// (existing payment-status endpoint) — no new polling/webhook system.
const POLL_INTERVAL_MS = 4000;

export function BarcodePaymentFlow({
  onPaymentCompleted,
  open,
  onOpenChange,
  initialOrderNumber,
}: BarcodePaymentFlowProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const dialogOpen = open !== undefined ? open : internalOpen;
  const [scanStatus, setScanStatus] = useState<ScanStatus>("idle");
  const [order, setOrder] = useState<Order | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(null);
  const [payStatus, setPayStatus] = useState<PayStatus>("choose");
  const [pendingPayment, setPendingPayment] = useState<Payment | null>(null);
  const [receivedRaw, setReceivedRaw] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // QR rendering state. qrPayloadResult is only ever written from an async
  // callback (the qrcode render), so it never causes an effect-render cascade.
  const [qrPayloadResult, setQrPayloadResult] = useState<{
    value: string;
    ok: boolean;
    dataUrl?: string;
  } | null>(null);
  // Tracks a broken <img> for the exact src that failed, so a new QR source
  // renders again instead of staying stuck in the error state.
  const [qrBrokenSrc, setQrBrokenSrc] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState<string | null>(null);
  // Monotonic "now" refreshed every second while the dialog is open. The
  // effective-expiry check must be pure at render time (no Date.now() in the
  // render body), so the comparison uses this state instead.
  const [nowMs, setNowMs] = useState(0);

  // Prevent a fast double-click from creating two QRIS intents (the server
  // also serializes per-order, but the UI must not even attempt it).
  const qrisBusyRef = useRef(false);
  // Ensure the PAID → success transition fires exactly once per QRIS intent.
  const paidNotifiedRef = useRef(false);

  const loadOrder = useCallback(async (orderNumber: string) => {
    try {
      // Barcode lookup must be authoritative and restaurant-scoped. The
      // public getOrderByNumber is customer-facing and not tenant-guarded,
      // so the cashier flow uses the admin scoped endpoint instead.
      const data = await orderService.getOrderByNumberScoped(orderNumber);
      setOrder(data);
      setScanStatus("order-found");
      setPaymentMethod(null);
      setPayStatus("choose");
      setPendingPayment(null);
      setReceivedRaw("");
      setErrorMsg(null);
      setQrCountdown(null);
      paidNotifiedRef.current = false;
    } catch {
      setErrorMsg("Pesanan tidak ditemukan di restoran ini.");
      setScanStatus("invalid");
    }
  }, []);

  /**
   * Re-fetch the CURRENT order (payments included) without resetting the
   * dialog state. The in-memory order can go stale while the cashier sits on
   * a method screen (e.g. a QRIS intent was created, or the customer paid the
   * QR from their phone) — every decision below is made from this fresh
   * snapshot instead, never from the stale copy.
   */
  const refreshOrder = useCallback(async (
    orderNumber: string
  ): Promise<Order | null> => {
    try {
      const data = await orderService.getOrderByNumberScoped(orderNumber);
      setOrder(data);
      return data;
    } catch {
      // Transient refresh failure — fall back to the in-memory order.
      return null;
    }
  }, []);

  const onScan = useCallback(
    (orderNumber: string) => {
      setScanStatus("opening");
      loadOrder(orderNumber).then(() => {
        setScanStatus("order-found");
      });
    },
    [loadOrder]
  );

  // A known order number (came from a scan elsewhere, e.g. the orders list)
  // is loaded directly on open — NO second scan. Same scoped admin lookup as
  // the scanner path, so restaurant/branch authorization is unchanged.
  useEffect(() => {
    if (!dialogOpen || !initialOrderNumber) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve(); // defer setState past the effect body (React 19)
      if (cancelled) return;
      await loadOrder(initialOrderNumber);
    })();
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, initialOrderNumber, loadOrder]);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setOrder(null);
      setPaymentMethod(null);
      setPayStatus("choose");
      setPendingPayment(null);
      setReceivedRaw("");
      setErrorMsg(null);
      setScanStatus("idle");
      setQrCountdown(null);
      paidNotifiedRef.current = false;
    }
    if (onOpenChange) {
      onOpenChange(next);
    } else {
      setInternalOpen(next);
    }
  };

  // "Kembali" from any method screen. ALL method state is dropped here (the
  // QRIS intent object, the received-cash input, the error) so nothing leaks
  // into the next choice, and the order snapshot is refreshed in the
  // background so the next decision uses live payment state.
  const resetToChoose = () => {
    setPaymentMethod(null);
    setPayStatus("choose");
    setPendingPayment(null);
    setReceivedRaw("");
    setErrorMsg(null);
    setQrCountdown(null);
    paidNotifiedRef.current = false;
    if (order?.orderNumber) {
      void refreshOrder(order.orderNumber);
    }
  };

  const handleClose = () => {
    handleOpenChange(false);
  };

  const startScanner = () => {
    setScanStatus("scanning");
    setOrder(null);
    setPaymentMethod(null);
    setPayStatus("choose");
    setErrorMsg(null);
    setQrCountdown(null);
    paidNotifiedRef.current = false;
  };

  const cashAmountDue = order ? Number(order.grandTotal) : 0;
  const received = useMemo(() => {
    const digits = receivedRaw.replace(/[^\d]/g, "");
    return digits ? Number(digits) : 0;
  }, [receivedRaw]);

  const changeAmount = Math.max(0, received - cashAmountDue);
  const hasInput = receivedRaw.trim().length > 0;
  const insufficient = hasInput && received < cashAmountDue;
  const canSubmitCash =
    hasInput && !insufficient && received >= cashAmountDue && !isSubmitting;

  const handleCashSubmit = async () => {
    if (!canSubmitCash || !order) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      // Decide from a FRESH snapshot: the in-memory order can be stale while
      // the cashier sat on the cash form (e.g. the customer just scanned the
      // pending QRIS on their phone). This is the race guard for
      // "QRIS PENDING → kasir pilih CASH → customer membayar QR".
      const fresh =
        (await refreshOrder(order.orderNumber)) || order;
      if (fresh.paymentStatus === "PAID" || fresh.payments?.some((p) => p.status === "PAID")) {
        setPayStatus("paid");
        setErrorMsg(null);
        onPaymentCompleted?.(fresh.id, fresh.orderNumber);
        return;
      }

      const payments = (fresh.payments || [])
        .slice()
        .sort((a, b) => {
          const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });

      // Reuse only an UNPAID KASIR row (an UNPAID KASIR intent is the live
      // cash intent). CANCELLED/FAILED/EXPIRED rows are history — the server
      // creates a fresh UNPAID row for them.
      let cashierPayment =
        payments.find(
          (p) =>
            (p.method === "KASIR" || p.method === null) &&
            p.status === "UNPAID"
        ) ?? null;

      if (!cashierPayment) {
        // Admin route (POST /api/payments) derives restaurantId from the
        // session and forwards the KASIR method — the amount is always
        // recomputed server-side from the order row. The server supersedes
        // any live online intent (PENDING/FAILED/EXPIRED → CANCELLED, guarded)
        // inside the same transaction, so QRIS → CASH never 409s.
        const created = await paymentService.createPayment(fresh.id, {
          method: "KASIR",
        });
        cashierPayment = created ?? null;
      }

      if (!cashierPayment) {
        setErrorMsg("Pembayaran kasir tidak valid.");
        setPayStatus("error");
        return;
      }

      const result = await paymentService.markCashierPaymentPaid(
        cashierPayment.id,
        received
      );

      if (result.alreadyPaid) {
        // Someone else (a parallel tab, a double click, or a QRIS webhook
        // that won the race) already settled this order — surface "paid",
        // never a 409 error.
        setPayStatus("paid");
        setErrorMsg(null);
        onPaymentCompleted?.(fresh.id, fresh.orderNumber);
        return;
      }

      setPayStatus("success");
      onPaymentCompleted?.(fresh.id, fresh.orderNumber);

      return;
    } catch (error) {
      console.error("Cash payment failed:", error);
      // Race guard: between the fresh snapshot above and mark-paid, the order
      // may have been settled by another actor (parallel tab, QRIS webhook
      // that won the race). The server blocks the double pay.
      //
      // ONLY a genuinely ALREADY-SETTLED order/payment is surfaced as "paid".
      // Every other conflict — most importantly the cashier's missing open
      // shift (409 SHIFT_NOT_OPEN), but also a cancelled order or a duplicate
      // cash-intent guard — is an honest error that MUST NOT flip the UI to
      // "Order sudah dibayar" while the database still says UNPAID. The server
      // message is authoritative.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const resp = (error as any)?.response;
      const code = resp?.data?.error;
      const message =
        typeof resp?.data?.message === "string" && resp.data.message
          ? resp.data.message
          : error instanceof Error
            ? error.message
            : "Gagal memproses pembayaran cash.";
      if (isShiftNotOpen(error)) {
        // No open shift for this branch — clear, actionable notification on a
        // stable server code (never a generic 409). The cash form stays so the
        // cashier can retry once a shift is opened.
        setErrorMsg(null);
        notifyShiftNotOpen(message);
        return;
      }
      if (
        code === "ALREADY_PAID" ||
        /already paid|already completed|sudah dibayar|sudah lunas/i.test(
          message
        )
      ) {
        setPayStatus("paid");
        setErrorMsg(null);
        onPaymentCompleted?.(order.id, order.orderNumber);
        return;
      }
      setErrorMsg(message);
      setPayStatus("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleQrisSelect = async () => {
    if (!order || qrisBusyRef.current) return;
    qrisBusyRef.current = true;
    paidNotifiedRef.current = false;
    setPayStatus("qris-loading");
    setErrorMsg(null);
    try {
      // Decide from a FRESH snapshot: a previous CASH intent or a customer
      // payment that happened while the cashier sat on another screen must
      // never be missed (CASH UNPAID in the snapshot is normal — the server
      // supersedes it; CASH PAID must abort here).
      const fresh = (await refreshOrder(order.orderNumber)) || order;
      if (
        fresh.paymentStatus === "PAID" ||
        fresh.payments?.some((p) => p.status === "PAID")
      ) {
        setPendingPayment(null);
        setErrorMsg("Pesanan sudah dibayar.");
        setPayStatus("error");
        return;
      }

      const result = await paymentService.createKasirQrisPayment(
        fresh.orderNumber
      );
      // The kasir QRIS engine now supersedes any stale UNPAID KASIR row and
      // always returns a QRIS intent (pending_existing / qris_created). A
      // QRIS selection must NEVER open the cash form — even defensively, a
      // kasir_existing result is surfaced as an error, not as "collect cash".
      if (result.kind === "kasir_existing") {
        setPendingPayment(null);
        setErrorMsg(
          "Pembayaran kasir sudah tercatat — silakan pilih Cash atau muat ulang."
        );
        setPayStatus("error");
        return;
      }
      // Single authoritative state update — both a freshly created QRIS and a
      // reused PENDING QRIS land here (no redundant assignment path).
      setPendingPayment(result.payment);
      setPayStatus("qris-ready");
    } catch (error) {
      console.error("QRIS creation failed:", error);
      // Race guard: the order may have been settled (CASH collected in a
      // parallel tab, or a webhook) between the fresh snapshot and the intent
      // creation — the server rejects with "Order already paid". Surface the
      // paid state, never a new intent and never an error screen. Only the
      // already-settled signals qualify — any other server error (e.g. a
      // cancelled order) is shown honestly with its real message.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const qrisResp = (error as any)?.response;
      const rawMessage =
        typeof qrisResp?.data?.message === "string" && qrisResp.data.message
          ? qrisResp.data.message
          : error instanceof Error
            ? error.message
            : "Gagal membuat pembayaran QRIS.";
      if (isShiftNotOpen(error)) {
        // No open shift for this branch — actionable shift notification
        // instead of a generic 409. Stay on the QRIS choice so the cashier can
        // retry after opening a shift.
        setErrorMsg(null);
        notifyShiftNotOpen(rawMessage);
        return;
      }
      if (
        qrisResp?.data?.error === "ALREADY_PAID" ||
        /already paid|sudah dibayar|sudah lunas/i.test(rawMessage)
      ) {
        setPendingPayment(null);
        setPayStatus("paid");
        setErrorMsg(null);
        onPaymentCompleted?.(order.id, order.orderNumber);
        return;
      }
      const message = rawMessage;
      setErrorMsg(message);
      setPayStatus("error");
    } finally {
      qrisBusyRef.current = false;
    }
  };

  // Pure render dependencies derived from pendingPayment so the effects and
  // memo below only depend on the fields they actually read.
  const pendingId = pendingPayment?.id;
  const pendingStatus = pendingPayment?.status;
  const pendingExpiresAt = pendingPayment?.expiresAt;

  // Fresh "now" every second while the flow is open — powers the pure
  // effective-expiry check below.
  useEffect(() => {
    if (!dialogOpen) return;
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [dialogOpen]);

  // Effective QRIS status — a PENDING payment past its expiry counts as
  // EXPIRED locally (mirrors the customer payment page: the gateway may never
  // deliver an EXPIRED webhook, so the UI must not keep waiting past it).
  const qrisEffectiveStatus = (() => {
    if (!pendingPayment) return null;
    if (pendingPayment.status === "PENDING" && pendingExpiresAt) {
      const exp = new Date(pendingExpiresAt).getTime();
      if (!Number.isNaN(exp) && nowMs > exp) return "EXPIRED";
    }
    return pendingPayment.status;
  })();

  const isQrisPayment =
    pendingPayment?.method === "QRIS" || pendingPayment?.method === null;
  const isQrisPending = qrisEffectiveStatus === "PENDING";
  const isQrisFailedOrExpired =
    !!pendingPayment &&
    (qrisEffectiveStatus === "FAILED" || qrisEffectiveStatus === "EXPIRED");
  const isQrisMaybePaid = qrisEffectiveStatus === "PAID";

  // Poll the admin payment endpoint (tenant-scoped) while a QRIS intent is
  // pending. Reuses the existing payment-status infrastructure. The PAID
  // transition happens inside the async callback (never synchronously in an
  // effect body), so it fires at most once per QRIS intent.
  const handleQrisPaid = useCallback(
    (paid: Payment) => {
      if (paidNotifiedRef.current) return;
      paidNotifiedRef.current = true;
      setPendingPayment(paid);
      setPayStatus("success");
      // Authoritative ids come from the POLLED payment itself (getPayment
      // always includes the order) — never from the possibly-stale internal
      // order closure, which could be null after a scanner reset. Depending
      // only on the (now stable) onPaymentCompleted also keeps the polling
      // interval from tearing down/restarting on every parent render.
      onPaymentCompleted?.(paid.orderId, paid.order.orderNumber);
    },
    [onPaymentCompleted]
  );

  useEffect(() => {
    if (!dialogOpen || payStatus !== "qris-ready" || !pendingId) return;
    if (pendingStatus !== "PENDING") return;
    const interval = setInterval(async () => {
      try {
        const fresh = await paymentService.getPayment(pendingId);
        if (fresh.status === "PAID") {
          handleQrisPaid(fresh);
        } else {
          setPendingPayment(fresh);
        }
      } catch {
        // Transient failure — the next tick retries; the flow never treats a
        // failed refresh as authoritative.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [dialogOpen, payStatus, pendingId, pendingStatus, handleQrisPaid]);

  // Deterministic QR display source for the current pending payment: prefer
  // the gateway's resolved qrImage; otherwise the raw qrString payload (which
  // is rendered to a data URL by the effect below). Never a fake QR.
  const pendingQrImage = pendingPayment?.qrImage;
  const pendingQrString = pendingPayment?.qrString;
  const qrSource = useMemo(() => {
    if (pendingQrImage) return { kind: "image" as const, src: pendingQrImage };
    if (pendingQrString)
      return { kind: "payload" as const, value: pendingQrString };
    return { kind: "none" } as const;
  }, [pendingQrImage, pendingQrString]);

  // Render the raw qrString payload with the existing qrcode library. All
  // setState happens inside the async callback (allowed) — nothing is set
  // synchronously in the effect body.
  useEffect(() => {
    if (qrSource.kind !== "payload") return;
    const value = qrSource.value;
    let cancelled = false;
    (async () => {
      try {
        const QRCode = (await import("qrcode")).default;
        const url = await QRCode.toDataURL(value, { width: 300, margin: 1 });
        if (!cancelled) setQrPayloadResult({ value, ok: true, dataUrl: url });
      } catch {
        if (!cancelled) setQrPayloadResult({ value, ok: false });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [qrSource]);

  const qrImgSrc =
    qrSource.kind === "image"
      ? qrSource.src
      : qrSource.kind === "payload" &&
        qrPayloadResult &&
        qrPayloadResult.value === qrSource.value &&
        qrPayloadResult.ok
      ? qrPayloadResult.dataUrl
      : null;
  const qrBroken = qrImgSrc !== null && qrImgSrc === qrBrokenSrc;
  const qrPreparing =
    qrSource.kind === "payload" && !qrImgSrc && !qrBroken;
  const qrUnavailable =
    qrSource.kind === "none" ||
    (qrSource.kind === "payload" &&
      !!qrPayloadResult &&
      qrPayloadResult.value === qrSource.value &&
      !qrPayloadResult.ok);

  // Expiry countdown while a QRIS intent is active (ticks every second).
  useEffect(() => {
    const expiresAt = pendingExpiresAt
      ? new Date(pendingExpiresAt).getTime()
      : Number.NaN;
    const active =
      dialogOpen && payStatus === "qris-ready" && !Number.isNaN(expiresAt);
    if (!active) return;
    const tick = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      const totalSec = Math.floor(remaining / 1000);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      setQrCountdown(
        [m, s].map((n) => n.toString().padStart(2, "0")).join(":")
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [dialogOpen, payStatus, pendingExpiresAt]);

  return (
    <Dialog open={dialogOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-4 w-4" />
            Pembayaran dari Scan Barcode
          </DialogTitle>
          <DialogDescription>
            Scan QR pesanan, lalu pilih metode pembayaran.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {scanStatus === "scanning" && (
            <div className="text-center py-4">
              <p className="text-sm text-muted-foreground flex items-center justify-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                Memindai QR pesanan...
              </p>
              <OrderScanner
                onScan={onScan}
                triggerLabel="Mulai Scan"
                triggerVariant="default"
              />
            </div>
          )}

          {scanStatus === "order-found" && order && (
            <>
              <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Nomor Pesanan</span>
                  <span className="font-mono font-semibold">
                    {order.orderNumber}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Pelanggan</span>
                  <span className="font-medium">
                    {order.customer?.name || "Guest"}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Total</span>
                  <span className="font-bold text-base tabular-nums">
                    {rupiah(order.grandTotal)}
                  </span>
                </div>
              </div>

              {payStatus === "choose" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">
                      Proses Pembayaran
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetToChoose}
                    >
                      Kembali
                    </Button>
                  </div>

                  <div className="grid gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMethod("CASH");
                        setPayStatus("cash-form");
                      }}
                      className={`flex items-center gap-3 rounded-xl border-2 p-4 transition-colors ${
                        paymentMethod === "CASH"
                          ? "border-green-500 bg-green-50"
                          : "border-gray-200 hover:border-green-300"
                      }`}
                    >
                      <Banknote
                        className={`h-8 w-8 flex-shrink-0 ${
                          paymentMethod === "CASH"
                            ? "text-green-600"
                            : "text-gray-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">
                          Cash / Tunai
                        </p>
                        <p className="text-xs text-muted-foreground font-mono tabular-nums">
                          {rupiah(order.grandTotal)}
                        </p>
                      </div>
                      {paymentMethod === "CASH" && (
                        <span className="ml-auto text-xs text-green-600 font-medium">
                          Dipilih
                        </span>
                      )}
                    </button>

                    {/* QRIS stays available for every order type — the kasir
                        QRIS backend (createKasirQrisPayment) supports
                        DINE_IN, TAKEAWAY and DELIVERY. */}
                    <button
                      type="button"
                      onClick={() => {
                        setPaymentMethod("QRIS");
                        handleQrisSelect();
                      }}
                      disabled={isSubmitting}
                      className={`flex items-center gap-3 rounded-xl border-2 p-4 transition-colors ${
                        paymentMethod === "QRIS"
                          ? "border-brand-primary bg-brand-secondary"
                          : "border-gray-200 hover:border-brand-primary/40"
                      }`}
                    >
                      <QrCode
                        className={`h-8 w-8 flex-shrink-0 ${
                          paymentMethod === "QRIS"
                            ? "text-brand-primary"
                            : "text-gray-500"
                        }`}
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-sm">QRIS</p>
                        <p className="text-xs text-muted-foreground">
                          Scan oleh customer
                        </p>
                      </div>
                      {paymentMethod === "QRIS" && (
                        <span className="ml-auto text-xs text-brand-primary font-medium">
                          Dipilih
                        </span>
                      )}
                    </button>
                  </div>
                </div>
              )}

              {payStatus === "cash-form" && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      Pembayaran Cash
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetToChoose}
                      disabled={isSubmitting}
                    >
                      Kembali
                    </Button>
                  </div>

                  <div className="rounded-xl border bg-muted/30 p-2.5 space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total Tagihan</span>
                      <span className="font-bold tabular-nums">
                        {rupiah(order.grandTotal)}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label htmlFor="cash-received">Uang Diterima (Rp)</Label>
                      <Input
                        id="cash-received"
                        inputMode="numeric"
                        autoFocus
                        placeholder="0"
                        value={receivedRaw}
                        onChange={(e) => setReceivedRaw(e.target.value)}
                        className={insufficient ? "border-red-400" : ""}
                      />
                      {insufficient && (
                        <p className="text-xs font-medium text-red-600">
                          Uang yang diterima kurang dari total tagihan
                        </p>
                      )}
                    </div>

                    <div className="flex gap-2 pt-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setReceivedRaw(String(cashAmountDue))}
                      >
                        Uang Pas
                      </Button>
                    </div>
                  </div>

                  <div className="rounded-xl bg-gray-100 p-3 flex items-center justify-between">
                    <span className="text-sm text-muted-foreground flex items-center gap-1.5">
                      <Banknote className="h-4 w-4" />
                      Kembalian
                    </span>
                    <span
                      className={`text-xl font-bold tabular-nums ${
                        insufficient ? "text-red-600" : "text-green-700"
                      }`}
                    >
                      {hasInput ? rupiah(changeAmount) : "Rp0"}
                    </span>
                  </div>

                  <Button
                    className="w-full bg-green-600 hover:bg-green-700"
                    disabled={!canSubmitCash}
                    onClick={handleCashSubmit}
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    ) : null}
                    Konfirmasi Pembayaran
                  </Button>

                  {errorMsg && (
                    <p className="text-xs text-red-600 text-center">{errorMsg}</p>
                  )}
                </div>
              )}

              {payStatus === "qris-loading" && (
                <div className="text-center py-4">
                  <Loader2 className="h-8 w-8 mx-auto animate-spin text-brand-primary" />
                  <p className="text-sm text-muted-foreground mt-2">
                    Membuat QRIS...
                  </p>
                </div>
              )}

              {payStatus === "qris-ready" && pendingPayment && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium">
                      Pembayaran QRIS
                    </p>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={resetToChoose}
                    >
                      Kembali
                    </Button>
                  </div>

                  {isQrisPayment && (
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      {isQrisPending ? (
                        <div className="flex flex-col items-center gap-3 py-2">
                          <div className="w-48 h-48 flex items-center justify-center">
                            {qrImgSrc && !qrBroken ? (
                              <img
                                src={qrImgSrc}
                                alt="QRIS"
                                className="w-full h-auto object-contain"
                                onError={() => setQrBrokenSrc(qrImgSrc)}
                              />
                            ) : qrPreparing ? (
                              <Loader2 className="h-8 w-8 text-gray-400 animate-spin" />
                            ) : (
                              <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
                                {qrUnavailable ? (
                                  <XCircle className="h-8 w-8 text-red-400" />
                                ) : (
                                  <QrCode className="h-8 w-8 text-gray-400" />
                                )}
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-2 text-sm text-amber-600">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Menunggu pembayaran...
                          </div>
                          {qrCountdown && pendingPayment.expiresAt && (
                            <p className="text-xs text-gray-500 flex items-center gap-1">
                              <Clock className="h-3 w-3" />
                              Berlaku hingga: {qrCountdown}
                            </p>
                          )}
                          <p className="text-xs text-gray-500 text-center">
                            Scan QRIS dengan aplikasi mobile banking atau e-wallet
                          </p>
                        </div>
                      ) : isQrisFailedOrExpired ? (
                        <div className="text-center py-2">
                          <XCircle className="h-8 w-8 mx-auto text-red-500" />
                          <p className="text-sm text-red-600 mt-2">
                            QRIS{" "}
                            {qrisEffectiveStatus === "FAILED"
                              ? "gagal"
                              : "kedaluwarsa"}
                          </p>
                          <Button
                            variant="outline"
                            size="sm"
                            className="mt-3"
                            onClick={() => handleQrisSelect()}
                          >
                            Buat QRIS Baru
                          </Button>
                        </div>
                      ) : isQrisMaybePaid ? (
                        <div className="text-center py-2">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
                          <p className="text-sm text-green-600 mt-2">
                            Pembayaran QRIS berhasil
                          </p>
                        </div>
                      ) : (
                        <div className="text-center py-2">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
                          <p className="text-sm text-green-600 mt-2">
                            QRIS berhasil dibuat
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {payStatus === "success" && (
                <div className="text-center space-y-4 py-4">
                  <div className="w-16 h-16 rounded-full bg-green-50 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="h-9 w-9 text-green-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-green-700">
                      Pembayaran Berhasil
                    </h3>
                    <p className="text-sm text-muted-foreground font-mono mt-1">
                      {order.orderNumber}
                    </p>
                  </div>

                  <div className="rounded-xl border bg-muted/40 p-3 text-left">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Total</span>
                      <span className="font-semibold tabular-nums">
                        {rupiah(order.grandTotal)}
                      </span>
                    </div>
                    {receivedRaw && (
                      <>
                        <div className="flex justify-between text-sm mt-1.5 pt-1.5 border-t">
                          <span className="text-muted-foreground">Diterima</span>
                          <span className="font-semibold tabular-nums">
                            {rupiah(received)}
                          </span>
                        </div>
                        <div className="flex justify-between text-sm mt-1.5">
                          <span className="text-muted-foreground">Kembalian</span>
                          <span
                            className={`font-bold tabular-nums ${
                              changeAmount > 0 ? "text-green-700" : "text-muted-foreground"
                            }`}
                          >
                            {rupiah(changeAmount)}
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {payStatus === "error" && (
                <div className="text-center py-4">
                  <XCircle className="h-8 w-8 mx-auto text-red-500" />
                  <p className="text-sm text-red-600 mt-2">{errorMsg}</p>
                  <Button
                    variant="outline"
                    className="mt-3"
                    onClick={resetToChoose}
                  >
                    Coba Lagi
                  </Button>
                </div>
              )}

              {payStatus === "paid" && (
                <div className="text-center py-4">
                  <CheckCircle2 className="h-8 w-8 mx-auto text-green-500" />
                  <p className="text-sm text-green-600 mt-2 font-medium">
                    Order sudah dibayar
                  </p>
                </div>
              )}
            </>
          )}

          {scanStatus === "invalid" && (
            <div className="text-center py-4">
              <XCircle className="h-8 w-8 mx-auto text-red-500" />
              <p className="text-sm text-red-600 mt-2">{errorMsg}</p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setScanStatus("scanning");
                  setOrder(null);
                  setErrorMsg(null);
                }}
              >
                Scan Lagi
              </Button>
            </div>
          )}

          {scanStatus === "idle" && !initialOrderNumber && (
            <div className="space-y-2">
              <Button onClick={startScanner} className="w-full">
                <ScanLine className="h-4 w-4 mr-2" />
                Scan QR Pesanan
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Arahkan kamera ke QR pesanan pelanggan
              </p>
            </div>
          )}

          {/* Order number already known → the order is being loaded directly;
              no scanner flash between opening the flow and the detail view. */}
          {scanStatus === "idle" && initialOrderNumber && (
            <div className="text-center py-4">
              <Loader2 className="h-8 w-8 mx-auto animate-spin text-brand-primary" />
              <p className="text-sm text-muted-foreground mt-2">
                Memuat pesanan...
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Tutup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}