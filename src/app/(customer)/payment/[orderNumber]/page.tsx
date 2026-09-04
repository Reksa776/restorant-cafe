"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  QrCode,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import api from "@/lib/axios";

// ============================================================
// Types
// ============================================================

interface PaymentPageData {
  orderNumber: string;
  orderType: string;
  paymentStatus: string;
  grandTotal: string;
  payment: {
    id: string;
    status: string;
    amount: string;
    method: string | null;
    provider: string | null;
    reference: string | null;
    qrImage: string | null;
    qrString: string | null;
    paidAt: string | null;
    expiresAt: string | null;
    createdAt: string;
  } | null;
}

type LoadState = "loading" | "loaded" | "not_found" | "error";

const POLL_INTERVAL_MS = 4000;

const formatRupiah = (value: string | number) =>
  `Rp${Number(value).toLocaleString("id-ID")}`;

// ============================================================
// Component
// ============================================================

export default function PaymentPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const [orderNumber, setOrderNumber] = useState<string | null>(null);
  const [data, setData] = useState<PaymentPageData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const [qrFailed, setQrFailed] = useState(false);
  const [countdown, setCountdown] = useState<string | null>(null);
  const mountedRef = useRef(true);

  // Resolve params once (Next 16 params is a Promise).
  useEffect(() => {
    let cancelled = false;
    params.then(({ orderNumber: num }) => {
      if (!cancelled) setOrderNumber(num);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  const loadPayment = useCallback(async () => {
    if (!orderNumber) return;
    try {
      const res = await api.get(`/public/payments/${orderNumber}`);
      setData(res.data.data);
      setLoadState("loaded");
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const status = (error as any)?.response?.status;
      if (status === 404) {
        setLoadState("not_found");
      } else if (mountedRef.current) {
        setLoadState("error");
      }
    }
  }, [orderNumber]);

  // Initial load + poll every 4s. Polling stops on terminal states
  // (PAID/EXPIRED/FAILED); interval is always cleaned up on unmount.
  useEffect(() => {
    mountedRef.current = true;
    if (!orderNumber) return;
    loadPayment();
    const interval = setInterval(() => {
      if (!mountedRef.current) return;
      const status = data?.payment?.status;
      if (status === "PAID" || status === "EXPIRED" || status === "FAILED") {
        clearInterval(interval);
        return;
      }
      loadPayment();
    }, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(interval);
    };
  }, [orderNumber, loadPayment, data?.payment?.status]);

  // QR source: prefer the gateway's QrImage; fall back to rendering QrString
  // with the project's existing qrcode library (never a fake/custom QR when
  // the gateway provided one).
  useEffect(() => {
    if (!data?.payment) return;
    const { qrImage, qrString } = data.payment;
    if (qrImage) {
      setQrSrc(qrImage);
      setQrFailed(false);
      return;
    }
    if (qrString) {
      let cancelled = false;
      setQrFailed(false);
      (async () => {
        try {
          const QRCode = (await import("qrcode")).default;
          const url = await QRCode.toDataURL(qrString, {
            width: 300,
            margin: 1,
          });
          if (!cancelled) setQrSrc(url);
        } catch {
          if (!cancelled) setQrFailed(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }
    setQrSrc(null);
    setQrFailed(true);
  }, [data?.payment]);

  // Countdown from expiresAt (tick every second). Never shows "Menunggu
  // pembayaran" past the expiry: the effective status flips to EXPIRED.
  useEffect(() => {
    if (!data?.payment?.expiresAt) return;
    const expiresAt = new Date(data.payment.expiresAt).getTime();
    if (Number.isNaN(expiresAt)) return;

    const tick = () => {
      const remaining = Math.max(0, expiresAt - Date.now());
      const totalSec = Math.floor(remaining / 1000);
      const h = Math.floor(totalSec / 3600);
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      setCountdown(
        [h, m, s].map((n) => n.toString().padStart(2, "0")).join(":")
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [data?.payment?.expiresAt]);

  const effectiveStatus: string = (() => {
    const status = data?.payment?.status || data?.paymentStatus || "UNPAID";
    if (status === "PENDING" && data?.payment?.expiresAt) {
      const expiresAt = new Date(data.payment.expiresAt).getTime();
      if (!Number.isNaN(expiresAt) && Date.now() > expiresAt) {
        return "EXPIRED";
      }
    }
    return status;
  })();

  const isTerminal = ["PAID", "EXPIRED", "FAILED"].includes(effectiveStatus);

  // ============================================================
  // Loading / not-found / error states
  // ============================================================

  if (loadState === "loading") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
        <p className="text-gray-500 font-medium">Memuat pembayaran...</p>
      </div>
    );
  }

  if (loadState === "not_found") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
        <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
          <XCircle className="h-8 w-8 text-red-500" />
        </div>
        <h1 className="text-xl font-bold">Pesanan Tidak Ditemukan</h1>
        <p className="text-gray-500 text-sm">
          Pesanan dengan nomor tersebut tidak ditemukan.
        </p>
        <Link
          href="/menu"
          className="bg-black text-white px-6 py-2.5 rounded-xl font-medium hover:bg-gray-800 transition-colors"
        >
          Kembali ke Menu
        </Link>
      </div>
    );
  }

  if (loadState === "error") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
        <p className="text-gray-500 text-sm">
          Gagal memuat status pembayaran. Silakan coba lagi.
        </p>
        <button
          onClick={loadPayment}
          className="flex items-center gap-2 bg-black text-white px-6 py-2.5 rounded-xl font-medium hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Coba Lagi
        </button>
      </div>
    );
  }

  // ============================================================
  // No payment created yet
  // ============================================================

  const displayOrderNumber = data?.orderNumber ?? "";
  const payment = data?.payment ?? null;

  if (!payment) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
        <div className="w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
          <CreditCard className="h-8 w-8 text-amber-500" />
        </div>
        <h1 className="text-xl font-bold">Pembayaran Belum Dibuat</h1>
        <p className="text-gray-500 text-sm max-w-sm">
          Pembayaran belum dibuat untuk pesanan ini. Silakan kembali ke
          halaman pesanan untuk memilih metode pembayaran.
        </p>
        <Link
          href={`/order/${displayOrderNumber}`}
          className="bg-black text-white px-6 py-2.5 rounded-xl font-medium hover:bg-gray-800 transition-colors"
        >
          Lihat Pesanan
        </Link>
      </div>
    );
  }

  const isQris = payment.method === "QRIS";
  const hasQr = !!(qrSrc && !qrFailed);

  // ============================================================
  // PAID / EXPIRED / FAILED terminal views
  // ============================================================

  if (isTerminal) {
    return (
      <div className="max-w-md mx-auto py-6">
        <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center space-y-4">
          <div
            className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center ${
              effectiveStatus === "PAID"
                ? "bg-green-50"
                : "bg-red-50"
            }`}
          >
            {effectiveStatus === "PAID" ? (
              <CheckCircle2 className="h-10 w-10 text-green-500" />
            ) : (
              <XCircle className="h-10 w-10 text-red-500" />
            )}
          </div>

          <div>
            <h1
              className={`text-2xl font-bold ${
                effectiveStatus === "PAID" ? "text-green-700" : "text-red-700"
              }`}
            >
              {effectiveStatus === "PAID"
                ? "Pembayaran Berhasil"
                : effectiveStatus === "EXPIRED"
                  ? "Pembayaran Kedaluwarsa"
                  : "Pembayaran Gagal"}
            </h1>
            <p className="text-gray-500 text-sm mt-1">
              Pesanan #{displayOrderNumber}
            </p>
          </div>

          {effectiveStatus === "PAID" ? (
            <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <p className="text-sm font-medium text-green-800">
                {formatRupiah(payment.amount)} telah dibayar
                {payment.method ? ` via ${payment.method}` : ""}
              </p>
              {payment.paidAt && (
                <p className="text-xs text-green-700 mt-0.5">
                  {new Date(payment.paidAt).toLocaleString("id-ID")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-gray-500">
              {effectiveStatus === "EXPIRED"
                ? "Waktu pembayaran telah habis. Silakan buat pembayaran baru dari halaman pesanan."
                : "Pembayaran tidak berhasil diproses. Silakan coba lagi dari halaman pesanan."}
            </p>
          )}

          <div className="flex flex-col gap-2.5 pt-1">
            <Link
              href={`/order/${displayOrderNumber}`}
              className="flex items-center justify-center gap-2 bg-black text-white py-3 rounded-xl font-medium hover:bg-gray-800 transition-colors"
            >
              Lihat Status Pesanan
            </Link>
            <Link
              href="/menu"
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors py-1"
            >
              Kembali ke Menu
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // ============================================================
  // PENDING — QRIS payment view
  // ============================================================

  return (
    <div className="max-w-md mx-auto py-6 space-y-4">
      {/* Header */}
      <div className="text-center">
        <h1 className="text-2xl font-bold">Pembayaran Pesanan</h1>
        <p className="text-gray-500 text-sm mt-1">
          Pesanan #{displayOrderNumber}
        </p>
      </div>

      {/* Amount */}
      <div className="bg-white rounded-2xl border border-gray-200 p-4 flex items-center justify-between">
        <span className="text-sm text-gray-500">Total Pembayaran</span>
        <span className="text-xl font-bold">
          {formatRupiah(payment.amount)}
        </span>
      </div>

      {/* QR Code */}
      <div className="bg-white rounded-2xl border border-gray-200 p-6">
        {hasQr ? (
          <div className="flex flex-col items-center gap-3">
            <img
              src={qrSrc!}
              alt="QRIS"
              className="w-full max-w-[280px] h-auto mx-auto object-contain rounded-lg"
              onError={() => setQrFailed(true)}
            />
            <div className="flex items-center gap-1.5 text-gray-400 text-xs">
              <QrCode className="h-3.5 w-3.5" />
              <span>QRIS — iPaymu</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <QrCode className="h-8 w-8 text-gray-400" />
            </div>
            {payment.qrString && !qrFailed ? (
              <p className="text-sm text-gray-500">Menyiapkan QR...</p>
            ) : isQris ? (
              <p className="text-sm text-gray-500 max-w-xs">
                Kode QR tidak tersedia saat ini. Silakan muat ulang halaman
                atau hubungi kasir.
              </p>
            ) : (
              <>
                <p className="text-sm text-gray-500 max-w-xs">
                  Pembayaran ini diproses melalui iPaymu.
                </p>
                {payment.reference && (
                  <p className="text-xs text-gray-400 font-mono">
                    Ref: {payment.reference}
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <p className="text-center text-sm text-gray-600 mt-4 px-2">
          Scan QRIS menggunakan aplikasi mobile banking atau e-wallet yang
          mendukung QRIS.
        </p>
      </div>

      {/* Status */}
      <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3">
        <Loader2 className="h-5 w-5 text-amber-500 animate-spin flex-shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-amber-800">
            Menunggu pembayaran...
          </p>
          {countdown && (
            <p className="text-xs text-amber-700 mt-0.5 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Pembayaran berlaku hingga: {countdown}
            </p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2.5 pt-1">
        <Link
          href={`/order/${displayOrderNumber}`}
          className="flex items-center justify-center gap-2 border border-gray-300 bg-white text-gray-700 py-3 rounded-xl font-medium hover:bg-gray-50 transition-colors"
        >
          Lihat Status Pesanan
        </Link>
        <Link
          href="/menu"
          className="text-sm text-gray-400 hover:text-gray-600 transition-colors text-center py-1"
        >
          Kembali ke Menu
        </Link>
      </div>

      {/* Security note */}
      <div className="flex items-center justify-center gap-1.5 text-[11px] text-gray-400 pt-1">
        <ShieldCheck className="h-3 w-3" />
        <span>Status pembayaran diperbarui otomatis dari server</span>
      </div>
    </div>
  );
}