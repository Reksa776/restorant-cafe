"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft,
  Banknote,
  CheckCircle2,
  Clock,
  Loader2,
  QrCode,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { paymentService, type Payment } from "@/services/payment.service";

// Polling cadence matches the customer payment page + barcode flow (4s).
// Same existing payment-status infrastructure — no new polling engine.
const POLL_INTERVAL_MS = 4000;

type QrisStatus =
  | "creating" // create/reuse intent in flight
  | "ready" // QR shown, polling for status
  | "paid" // PAID (detected via polling or already-paid conflict)
  | "kasir_existing" // an UNPAID KASIR row already exists — collect cash
  | "error"; // hard failure (unexpected server error)

const rupiah = (v: string | number) =>
  `Rp${Number(v).toLocaleString("id-ID")}`;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const msg = (error as any)?.response?.data?.message;
  return typeof msg === "string" && msg ? msg : "Gagal memproses pembayaran QRIS";
}

/**
 * Shared kasir QRIS screen — used by the kasir manual order flow (after the
 * order is created) and the /admin/payments/[orderNumber]/qris repayment page.
 *
 * It ONLY drives the existing createKasirQrisPayment() engine:
 *  - PENDING still valid → reused (never a duplicate gateway call)
 *  - FAILED / EXPIRED / stale-PENDING → expired then a fresh intent
 *  - PAID (order or payment) → server Conflict "Order already paid" → this
 *    screen shows the paid state and never creates a new payment
 *  - an existing UNPAID KASIR row → surfaced so cash can be collected
 *
 * QR rendering prefers the gateway qrImage and falls back to rendering the
 * qrString payload with the project's existing qrcode lib. 4s polling via the
 * existing admin payment-status endpoint; PAID fires exactly once.
 */
export function KasirQrisScreen({
  orderNumber,
  amount,
  backHref,
  backLabel,
  onPaid,
}: {
  orderNumber: string;
  amount: string | number;
  /** Where the "Kembali" action navigates (payment dashboard / orders). */
  backHref: string;
  backLabel: string;
  onPaid?: (payment: Payment) => void;
}) {
  const [status, setStatus] = useState<QrisStatus>("creating");
  const [payment, setPayment] = useState<Payment | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(0);
  const [qrPayloadResult, setQrPayloadResult] = useState<{
    value: string;
    ok: boolean;
    dataUrl?: string;
  } | null>(null);
  const [qrBrokenSrc, setQrBrokenSrc] = useState<string | null>(null);
  const [qrCountdown, setQrCountdown] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const paidNotifiedRef = useRef(false);

  const createIntent = useCallback(async () => {
    setBusy(true);
    paidNotifiedRef.current = false;
    setStatus("creating");
    setErrorMsg(null);
    try {
      const result = await paymentService.createKasirQrisPayment(orderNumber);
      setPayment(result.payment);
      if (result.kind === "kasir_existing") {
        setStatus("kasir_existing");
      } else {
        setStatus("ready");
      }
    } catch (error) {
      const msg = errorMessage(error);
      // An already-PAID order must never produce a new payment — the server
      // rejects it with "Order already paid". Surface it as the paid state.
      if (/already paid|sudah dibayar|sudah lunas/i.test(msg)) {
        setStatus("paid");
      } else {
        setErrorMsg(msg);
        setStatus("error");
      }
    } finally {
      setBusy(false);
    }
  }, [orderNumber]);

  // Create (or reuse) the QRIS intent on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.resolve(); // defer past the effect body (React 19)
      if (cancelled) return;
      await createIntent();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderNumber]);

  // Monotonic "now" every second — powers the pure effective-expiry check.
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const pendingId = payment?.id;
  const pendingStatus = payment?.status;
  const pendingExpiresAt = payment?.expiresAt;

  // A PENDING payment past its expiry counts as EXPIRED locally (the gateway
  // may never deliver an EXPIRED webhook — the UI must not wait forever).
  const effectiveStatus = useMemo(() => {
    if (!payment) return null;
    if (payment.status === "PENDING" && pendingExpiresAt) {
      const exp = new Date(pendingExpiresAt).getTime();
      if (!Number.isNaN(exp) && nowMs > exp) return "EXPIRED";
    }
    return payment.status;
  }, [payment, pendingExpiresAt, nowMs]);

  // Terminal states are DERIVED at render time (never setState in an effect):
  // a PENDING payment that is PAID or FAILED/EXPIRED while the QR is shown.
  // The PAID transition that polling detects runs inside the async interval
  // callback (handlePaid) — single-fire via paidNotifiedRef.
  const isPaidView =
    status === "paid" ||
    (status === "ready" && effectiveStatus === "PAID");
  const isFailedExpiredView =
    status === "ready" &&
    (effectiveStatus === "FAILED" || effectiveStatus === "EXPIRED");

  const handlePaid = useCallback(
    (paid: Payment) => {
      if (paidNotifiedRef.current) return;
      paidNotifiedRef.current = true;
      setPayment(paid);
      setStatus("paid");
      onPaid?.(paid);
    },
    [onPaid]
  );

  // Poll the existing admin payment-status endpoint while the intent is live.
  useEffect(() => {
    if (status !== "ready" || !pendingId || pendingStatus !== "PENDING") return;
    const interval = setInterval(async () => {
      try {
        const fresh = await paymentService.getPayment(pendingId);
        if (fresh.status === "PAID") {
          handlePaid(fresh);
        } else {
          setPayment(fresh);
        }
      } catch {
        // Transient failure — next tick retries; never authoritative.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [status, pendingId, pendingStatus, handlePaid]);

  // QR source: prefer the gateway image, else render the raw payload.
  const pendingQrImage = payment?.qrImage;
  const pendingQrString = payment?.qrString;
  const qrSource = useMemo(() => {
    if (pendingQrImage) return { kind: "image" as const, src: pendingQrImage };
    if (pendingQrString)
      return { kind: "payload" as const, value: pendingQrString };
    return { kind: "none" } as const;
  }, [pendingQrImage, pendingQrString]);

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
  const qrPreparing = qrSource.kind === "payload" && !qrImgSrc && !qrBroken;
  const qrUnavailable =
    qrSource.kind === "none" ||
    (qrSource.kind === "payload" &&
      !!qrPayloadResult &&
      qrPayloadResult.value === qrSource.value &&
      !qrPayloadResult.ok);

  // Expiry countdown (tick every second).
  useEffect(() => {
    const expiresAt = pendingExpiresAt
      ? new Date(pendingExpiresAt).getTime()
      : Number.NaN;
    const active = status === "ready" && !Number.isNaN(expiresAt);
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
  }, [status, pendingExpiresAt]);

  const displayAmount = payment ? payment.amount : amount;

  const backLink = (
    <Link
      href={backHref}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="h-4 w-4" />
      {backLabel}
    </Link>
  );

  if (status === "creating") {
    return (
      <div className="text-center py-10">
        <Loader2 className="h-8 w-8 mx-auto animate-spin text-brand-primary" />
        <p className="text-sm text-muted-foreground mt-3">
          Membuat / memeriksa pembayaran QRIS...
        </p>
      </div>
    );
  }

  if (status === "kasir_existing") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center">
          <Banknote className="h-8 w-8 mx-auto text-amber-500" />
          <p className="text-sm font-semibold text-amber-900 mt-2">
            Pembayaran kasir sudah tercatat untuk pesanan ini
          </p>
          <p className="text-xs text-amber-700 mt-1">
            Tidak ada QRIS baru yang dibuat — proses pembayaran kasir untuk
            melanjutkan.
          </p>
          <Link
            href={`/admin/orders/${orderNumber}`}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700"
          >
            <Banknote className="h-4 w-4" />
            Proses Pembayaran Kasir
          </Link>
        </div>
        <div className="text-center">{backLink}</div>
      </div>
    );
  }

  if (isPaidView) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-green-200 bg-green-50 p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-green-100 mx-auto flex items-center justify-center">
            <CheckCircle2 className="h-9 w-9 text-green-600" />
          </div>
          <h3 className="text-xl font-bold text-green-700 mt-3">
            Pembayaran Berhasil
          </h3>
          <p className="text-sm text-muted-foreground font-mono mt-1">
            {orderNumber}
          </p>
          <div className="mt-3 rounded-lg bg-white border border-green-200 px-4 py-3">
            <p className="text-sm font-semibold text-green-800">
              {rupiah(displayAmount)} telah dibayar
            </p>
          </div>
        </div>
        <div className="text-center">{backLink}</div>
      </div>
    );
  }

  if (isFailedExpiredView) {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
          <XCircle className="h-8 w-8 mx-auto text-red-500" />
          <p className="text-sm font-semibold text-red-700 mt-2">
            QRIS{" "}
            {effectiveStatus === "FAILED" ? "gagal" : "kedaluwarsa"}
          </p>
          <p className="text-xs text-red-600 mt-1">
            Buat QRIS baru untuk melanjutkan pembayaran.
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-3 border-red-300 text-red-600 hover:bg-red-100"
            onClick={createIntent}
            disabled={busy}
          >
            <RefreshCw className="h-4 w-4 mr-1" />
            Buat QRIS Baru
          </Button>
        </div>
        <div className="text-center">{backLink}</div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="space-y-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 text-center">
          <XCircle className="h-8 w-8 mx-auto text-red-500" />
          <p className="text-sm font-semibold text-red-700 mt-2">
            Gagal membuat pembayaran QRIS
          </p>
          {errorMsg && (
            <p className="text-xs text-red-600 mt-1">{errorMsg}</p>
          )}
          <div className="mt-3 flex flex-col gap-2">
            <Button
              variant="outline"
              size="sm"
              className="border-red-300 text-red-600 hover:bg-red-100"
              onClick={createIntent}
              disabled={busy}
            >
              <RefreshCw className="h-4 w-4 mr-1" />
              Coba Lagi
            </Button>
          </div>
        </div>
        <div className="text-center">{backLink}</div>
      </div>
    );
  }

  // status === "ready"
  return (
    <div className="space-y-4">
      {/* Amount + order number */}
      <div className="rounded-xl border bg-muted/30 p-3 space-y-1.5 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Nomor Pesanan</span>
          <span className="font-mono font-semibold">{orderNumber}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Total Pembayaran</span>
          <span className="font-bold text-base tabular-nums">
            {rupiah(displayAmount)}
          </span>
        </div>
      </div>

      {/* QR */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        {qrImgSrc && !qrBroken ? (
          <div className="flex flex-col items-center gap-3 py-2">
            <div className="w-52 h-52 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={qrImgSrc}
                alt="QRIS"
                className="w-full h-auto object-contain"
                onError={() => setQrBrokenSrc(qrImgSrc)}
              />
            </div>
            <div className="flex items-center gap-2 text-sm text-amber-600">
              <Loader2 className="h-4 w-4 animate-spin" />
              Menunggu pembayaran...
            </div>
            {qrCountdown && pendingExpiresAt && (
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                Berlaku hingga: {qrCountdown}
              </p>
            )}
            <p className="text-xs text-gray-500 text-center">
              Scan QRIS dengan aplikasi mobile banking atau e-wallet
            </p>
          </div>
        ) : qrPreparing ? (
          <div className="py-10 text-center">
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-gray-400" />
            <p className="text-sm text-gray-500 mt-2">Menyiapkan QR...</p>
          </div>
        ) : (
          <div className="py-10 text-center">
            <QrCode className="h-10 w-10 mx-auto text-gray-300" />
            <p className="text-sm text-gray-500 mt-2">
              {qrUnavailable
                ? "Kode QR tidak tersedia saat ini."
                : "Menyiapkan QR..."}
            </p>
          </div>
        )}
      </div>

      <div className="text-center">{backLink}</div>
    </div>
  );
}