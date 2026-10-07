"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
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
import { toast } from "sonner";
import api from "@/lib/axios";
import { QrCodeDisplay } from "@/components/qr-code-display";
import { useCustomerAuth } from "@/hooks/use-customer-auth";
import {
  RESERVATION_STATUS_LABELS,
  formatReservationDate,
  formatRupiah,
  formatTimeSlot,
} from "../../reservation-flow";
import { readReservationPaymentContext, saveReservationPaymentContext } from "../../reservation-payment-storage";
import {
  effectivePaymentStatus,
  formatCountdown,
  shouldPoll,
} from "../../reservation-payment-state";

// ============================================================
// PHASE 3 — RESERVATION QRIS CUSTOMER PAYMENT PAGE.
//
// The customer pays inside the RESERVATION flow (never the Order payment
// page). Data flow:
//   GET /api/public/reservations/[code]?phone=  → reservation + order summary
//   GET /api/public/reservations/[code]/payment → payment state (source of truth)
//   POST /api/public/reservations/[code]/payment → create/reuse QRIS (existing engine)
//
// The frontend is a pure API consumer: it NEVER sends an amount/orderId/
// paymentId, never treats a client grand total as authoritative, and never
// decides PAID/CONFIRMED itself — the backend webhook is the authority.
// ============================================================

interface ReservationDetails {
  code: string;
  status: string;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  partySize: number;
  guestName: string;
  guestPhone: string;
  branch: { code: string; name: string } | null;
  table: { number: number; name: string | null } | null;
  order: {
    orderNumber: string;
    status: string;
    paymentStatus: string;
    paymentMethod: string | null;
    subtotal: number;
    discount: number;
    tax: number;
    serviceCharge: number;
    grandTotal: number;
    items: Array<{
      name: string;
      quantity: number;
      unitPrice: number;
      totalPrice: number;
    }>;
  } | null;
}

interface ReservationPaymentData {
  reservationCode: string;
  reservationStatus: string;
  orderNumber: string | null;
  orderStatus: string | null;
  paymentStatus: string;
  grandTotal: number | null;
  payment: {
    status: string;
    method: string | null;
    amount: number;
    provider: string | null;
    reference: string | null;
    qrImage: string | null;
    qrString: string | null;
    paymentUrl: string | null;
    paidAt: string | null;
    expiresAt: string | null;
  } | null;
}

type LoadState = "idle" | "loading" | "loaded" | "not_found" | "error";

const POLL_INTERVAL_MS = 4000;

function errStatus(error: unknown): number | null {
  const s = (error as { response?: { status?: number } })?.response?.status;
  return typeof s === "number" ? s : null;
}

function errMessage(error: unknown): string | null {
  const m = (error as { response?: { data?: { message?: string } } })?.response
    ?.data?.message;
  return typeof m === "string" && m ? m : null;
}

export default function ReservationPaymentPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [restaurantId, setRestaurantId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [needPhone, setNeedPhone] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const [details, setDetails] = useState<ReservationDetails | null>(null);
  const [data, setData] = useState<ReservationPaymentData | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [busy, setBusy] = useState<"idle" | "creating" | "refreshing">("idle");
  const [countdown, setCountdown] = useState<string | null>(null);

  const { customer, isHydrated: authHydrated } = useCustomerAuth();
  const mountedRef = useRef(true);
  const autoRefreshedRef = useRef(false);
  // True when a create-time snapshot was found in sessionStorage — then the
  // (thinner) public lookup is skipped and live state comes from the payment
  // endpoint only.
  const hasSnapshotRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Resolve the route param once (Next 16 params is a Promise).
  useEffect(() => {
    let cancelled = false;
    params.then(({ code: c }) => {
      if (!cancelled) setCode(c);
    });
    return () => {
      cancelled = true;
    };
  }, [params]);

  // Ownership: reuse the phone the wizard already collected (sessionStorage),
  // otherwise fall back to the authenticated customer session. Only when
  // neither exists do we ask for the phone once.
  useEffect(() => {
    if (!code || !authHydrated || ready) return;
    let cancelled = false;
    // Read the (external) context, then publish the ownership state in a
    // microtask so no setState happens synchronously inside the effect body.
    const ctx = readReservationPaymentContext(code);
    const phoneValue = ctx?.phone ?? null;
    const rid = ctx?.restaurantId ?? null;
    const snapshot = (ctx?.details as ReservationDetails | null) ?? null;
    const hasSession = Boolean(customer);
    hasSnapshotRef.current = Boolean(snapshot);
    void Promise.resolve().then(() => {
      if (cancelled) return;
      if (snapshot) setDetails(snapshot);
      if (phoneValue) {
        setPhone(phoneValue);
        setRestaurantId(rid);
        setReady(true);
      } else if (hasSession) {
        setReady(true);
      } else {
        setNeedPhone(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [code, authHydrated, ready, customer]);

  const fetchPayment = useCallback(async () => {
    if (!code) return;
    const qs = new URLSearchParams();
    if (phone) qs.set("phone", phone);
    if (restaurantId) qs.set("restaurantId", restaurantId);
    const res = await api.get(
      `/public/reservations/${encodeURIComponent(code)}/payment?${qs.toString()}`
    );
    if (mountedRef.current) setData(res.data.data as ReservationPaymentData);
  }, [code, phone, restaurantId]);

  const fetchDetails = useCallback(async () => {
    if (!code || !phone) return;
    const qs = new URLSearchParams();
    qs.set("phone", phone);
    if (restaurantId) qs.set("restaurantId", restaurantId);
    const res = await api.get(
      `/public/reservations/${encodeURIComponent(code)}?${qs.toString()}`
    );
    if (mountedRef.current) setDetails(res.data.data as ReservationDetails);
  }, [code, phone, restaurantId]);

  const loadAll = useCallback(async () => {
    if (!code) return;
    setLoadState("loading");
    try {
      await fetchPayment();
      // The create snapshot already carries the reservation + order summary;
      // only fall back to the public lookup (reservation fields only) when it
      // is absent (e.g. a deep link in a fresh tab).
      if (!hasSnapshotRef.current) {
        try {
          await fetchDetails();
        } catch {
          /* details unavailable — the page still shows the payment state */
        }
      }
      if (mountedRef.current) setLoadState("loaded");
    } catch (error) {
      if (!mountedRef.current) return;
      setLoadState(errStatus(error) === 404 ? "not_found" : "error");
    }
  }, [code, fetchPayment, fetchDetails]);

  useEffect(() => {
    if (!ready || !code) return;
    let cancelled = false;
    // Kick the first load off the effect body (no synchronous setState).
    void Promise.resolve().then(() => {
      if (!cancelled) void loadAll();
    });
    return () => {
      cancelled = true;
    };
  }, [ready, code, loadAll]);

  const status = effectivePaymentStatus(data);
  const reservationCancelled = data?.reservationStatus === "CANCELLED";

  // Poll ONLY while PENDING (never POSTs); stops on any terminal status.
  useEffect(() => {
    if (loadState !== "loaded") return;
    if (!shouldPoll(status)) return;
    const id = setInterval(() => {
      if (!mountedRef.current) return;
      fetchPayment().catch(() => {});
    }, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [loadState, status, fetchPayment]);

  // Countdown from the SERVER expiresAt only. At zero, refresh once (never
  // auto-create a new payment — the customer must press "Buat QRIS Baru").
  useEffect(() => {
    const expiresAt = data?.payment?.expiresAt ?? null;
    let cancelled = false;
    const tick = () => {
      if (cancelled || !mountedRef.current) return;
      setCountdown(formatCountdown(expiresAt));
      const t = expiresAt ? new Date(expiresAt).getTime() : NaN;
      if (!Number.isNaN(t) && Date.now() >= t && !autoRefreshedRef.current) {
        autoRefreshedRef.current = true;
        fetchPayment().catch(() => {});
      }
    };
    // Initial paint off the effect body, then tick every second.
    void Promise.resolve().then(tick);
    const id = setInterval(tick, 1000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [data?.payment?.expiresAt, fetchPayment]);

  const createPayment = useCallback(async () => {
    if (!code || busy !== "idle") return;
    setBusy("creating");
    try {
      const body: Record<string, unknown> = { method: "QRIS" };
      if (phone) body.phone = phone;
      if (restaurantId) body.restaurantId = restaurantId;
      await api.post(
        `/public/reservations/${encodeURIComponent(code)}/payment`,
        body
      );
      autoRefreshedRef.current = false;
      await fetchPayment();
      await loadAll();
      toast.success("QRIS berhasil dibuat.");
    } catch (error) {
      const s = errStatus(error);
      if (s === 429) toast.error("Terlalu banyak permintaan. Silakan coba lagi.");
      else if (s === 409) toast.error(errMessage(error) || "Pembayaran tidak dapat dibuat.");
      else if (s === 404) toast.error("Reservasi tidak ditemukan atau Anda tidak memiliki akses.");
      else toast.error("Tidak dapat memproses pembayaran saat ini.");
      fetchPayment().catch(() => {});
    } finally {
      if (mountedRef.current) setBusy("idle");
    }
  }, [code, busy, phone, restaurantId, fetchPayment, loadAll]);

  const refreshStatus = useCallback(async () => {
    if (busy !== "idle") return;
    setBusy("refreshing");
    try {
      await fetchPayment();
    } catch (error) {
      if (errStatus(error) === 404) setLoadState("not_found");
    } finally {
      if (mountedRef.current) {
        setBusy("idle");
        autoRefreshedRef.current = false;
      }
    }
  }, [busy, fetchPayment]);

  const submitPhone = useCallback(() => {
    const value = phoneInput.trim();
    if (!value) {
      setPhoneError("Nomor WhatsApp wajib diisi.");
      return;
    }
    setPhoneError(null);
    if (code) saveReservationPaymentContext(code, { phone: value, restaurantId: restaurantId ?? undefined });
    setPhone(value);
    setNeedPhone(false);
    setReady(true);
  }, [phoneInput, code, restaurantId]);

  const order = details?.order ?? null;
  const amount = useMemo(
    () => data?.payment?.amount ?? data?.grandTotal ?? order?.grandTotal ?? null,
    [data?.payment?.amount, data?.grandTotal, order?.grandTotal]
  );

  // ============================================================
  // Render
  // ============================================================

  return (
    <div className="min-h-[70vh] pb-10">
      {/* Ownership required — the existing public lookup verifies a guest by
          their WhatsApp phone. A logged-in customer skips this (session). */}
      {needPhone && (
        <div className="max-w-md mx-auto py-8 px-1">
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <div className="w-14 h-14 rounded-full bg-brand-secondary flex items-center justify-center">
              <ShieldCheck className="h-7 w-7 text-brand-primary" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-gray-900">Verifikasi Reservasi</h1>
              <p className="text-sm text-gray-500 mt-1">
                Masukkan nomor WhatsApp yang Anda gunakan saat membuat reservasi
                {code ? ` ${code}` : ""}.
              </p>
            </div>
            <input
              type="tel"
              inputMode="tel"
              value={phoneInput}
              onChange={(e) => setPhoneInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitPhone();
              }}
              placeholder="08xxxxxxxxxx"
              className="w-full rounded-xl border border-gray-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-primary/40"
            />
            {phoneError && (
              <p className="text-sm text-red-600">{phoneError}</p>
            )}
            <button
              type="button"
              onClick={submitPhone}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-semibold hover:bg-brand-primary/90 transition-colors"
            >
              Lanjutkan
            </button>
            <Link
              href="/menu"
              className="block text-center text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Kembali ke Menu
            </Link>
          </div>
        </div>
      )}

      {!needPhone && loadState === "loading" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
          <p className="text-gray-500 font-medium">Memuat pembayaran…</p>
        </div>
      )}

      {!needPhone && loadState === "not_found" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
          <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center">
            <XCircle className="h-8 w-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold">Reservasi Tidak Ditemukan</h1>
          <p className="text-gray-500 text-sm max-w-sm">
            Reservasi tidak ditemukan atau Anda tidak memiliki akses.
          </p>
          <Link
            href="/menu"
            className="bg-brand-primary text-brand-primary-foreground px-6 py-2.5 rounded-xl font-medium hover:bg-brand-primary/90 transition-colors"
          >
            Kembali ke Menu
          </Link>
        </div>
      )}

      {!needPhone && loadState === "error" && (
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-4 space-y-4">
          <p className="text-gray-500 text-sm">
            Tidak dapat memproses pembayaran saat ini.
          </p>
          <button
            type="button"
            onClick={loadAll}
            className="flex items-center gap-2 bg-brand-primary text-brand-primary-foreground px-6 py-2.5 rounded-xl font-medium hover:bg-brand-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            Coba Lagi
          </button>
        </div>
      )}
      {!needPhone && loadState === "loaded" && (
        <div className="max-w-md mx-auto space-y-4">
          {/* Reservation summary */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">
                  Kode Reservasi
                </p>
                <p className="text-xl font-bold text-brand-primary tracking-wide break-all">
                  {details?.code ?? code}
                </p>
              </div>
              <span className="shrink-0 rounded-full bg-brand-secondary text-brand-primary border border-brand-primary/20 text-[11px] font-bold px-2.5 py-1">
                {RESERVATION_STATUS_LABELS[details?.status ?? ""] ??
                  details?.status ??
                  "—"}
              </span>
            </div>
            <dl className="mt-4 border-t border-gray-100 pt-2">
              <DetailRow label="Cabang">
                {details?.branch ? details.branch.name : "—"}
              </DetailRow>
              <DetailRow label="Tanggal">
                {details ? formatReservationDate(details.reservationDate) : "—"}
              </DetailRow>
              <DetailRow label="Jam">
                {details
                  ? formatTimeSlot(details.startMinutes, details.durationMinutes)
                  : "—"}
              </DetailRow>
              <DetailRow label="Meja">
                {details?.table
                  ? details.table.name
                    ? `Meja ${details.table.number} · ${details.table.name}`
                    : `Meja ${details.table.number}`
                  : "Belum ditentukan"}
              </DetailRow>
              <DetailRow label="Jumlah orang">
                {details ? `${details.partySize} orang` : "—"}
              </DetailRow>
              {details?.guestName && (
                <DetailRow label="Nama">{details.guestName}</DetailRow>
              )}
            </dl>
          </div>

          {/* Order summary */}
          {order && (
            <div className="rounded-2xl border border-gray-200 bg-white p-5">
              <p className="text-xs font-bold uppercase tracking-wide text-gray-400 mb-2">
                Rincian Pesanan
              </p>
              <div className="space-y-2">
                {order.items.map((item, index) => (
                  <div
                    key={`${item.name}-${index}`}
                    className="flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 break-words">
                        {item.name}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatRupiah(item.unitPrice)} × {item.quantity}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-gray-900">
                      {formatRupiah(item.totalPrice)}
                    </span>
                  </div>
                ))}
              </div>
              <dl className="mt-3 border-t border-gray-100 pt-2">
                <DetailRow label="Subtotal">
                  {formatRupiah(order.subtotal)}
                </DetailRow>
                {order.discount > 0 && (
                  <DetailRow label="Diskon">
                    -{formatRupiah(order.discount)}
                  </DetailRow>
                )}
                {order.tax > 0 && (
                  <DetailRow label="Pajak">{formatRupiah(order.tax)}</DetailRow>
                )}
                {order.serviceCharge > 0 && (
                  <DetailRow label="Service Charge">
                    {formatRupiah(order.serviceCharge)}
                  </DetailRow>
                )}
                <DetailRow label="Grand Total">
                  <span className="font-bold text-brand-primary">
                    {formatRupiah(order.grandTotal)}
                  </span>
                </DetailRow>
              </dl>
            </div>
          )}

          {/* Payment */}
          <div className="rounded-2xl border border-gray-200 bg-white p-5 space-y-4">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-400">
              Pembayaran
            </p>

            {(reservationCancelled || status === "CANCELLED") && (
              <div className="text-center space-y-2 py-2">
                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-red-50">
                  <XCircle className="h-8 w-8 text-red-500" />
                </div>
                <h2 className="text-lg font-bold text-gray-900">
                  Reservasi Dibatalkan
                </h2>
                <p className="text-sm text-gray-500">
                  Reservasi ini telah dibatalkan. Pembayaran tidak diperlukan.
                </p>
              </div>
            )}

            {!reservationCancelled && status === "PAID" && (
              <div className="text-center space-y-3">
                <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-green-50">
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                </div>
                <div>
                  <h2 className="text-xl font-bold text-green-700">
                    Pembayaran Berhasil
                  </h2>
                  <p className="text-sm text-gray-500 mt-1">
                    {data?.reservationStatus === "CONFIRMED"
                      ? "Reservasi Dikonfirmasi"
                      : "Pembayaran diterima"}
                  </p>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-left space-y-0.5">
                  {amount != null && (
                    <p className="text-sm font-semibold text-green-800">
                      {formatRupiah(amount)} dibayar
                      {data?.payment?.method ? ` via ${data.payment.method}` : ""}
                    </p>
                  )}
                  {data?.payment?.paidAt && (
                    <p className="text-xs text-green-700">
                      {new Date(data.payment.paidAt).toLocaleString("id-ID")}
                    </p>
                  )}
                </div>
                <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-3 text-left space-y-1.5">
                  <p className="text-xs text-gray-500">Kode reservasi</p>
                  <p className="text-base font-bold text-brand-primary break-all">
                    {details?.code ?? code}
                  </p>
                  {details && (
                    <>
                      <p className="text-xs text-gray-500 pt-1">
                        {formatReservationDate(details.reservationDate)} ·{" "}
                        {formatTimeSlot(details.startMinutes, details.durationMinutes)}
                      </p>
                      <p className="text-xs text-gray-500">
                        {details.table
                          ? details.table.name
                            ? `Meja ${details.table.number} · ${details.table.name}`
                            : `Meja ${details.table.number}`
                          : "Meja belum ditentukan"}
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}

            {!reservationCancelled &&
              status !== "CANCELLED" &&
              status !== "PAID" && (
                <>
                  {/* UNPAID (or no intent yet) */}
                  {!["PENDING", "EXPIRED", "FAILED", "REFUNDED"].includes(
                    status
                  ) && (
                    <div className="text-center space-y-3">
                      <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-amber-50">
                        <CreditCard className="h-7 w-7 text-amber-500" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">
                          Pembayaran Belum Dibuat
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Tuntaskan pembayaran reservasi Anda dengan QRIS.
                        </p>
                      </div>
                      {amount != null && (
                        <p className="text-sm text-gray-700">
                          Total:{" "}
                          <span className="font-bold text-brand-primary">
                            {formatRupiah(amount)}
                          </span>
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={createPayment}
                        disabled={busy !== "idle"}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-semibold hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                      >
                        {busy === "creating" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <QrCode className="h-4 w-4" />
                        )}
                        Bayar dengan QRIS
                      </button>
                    </div>
                  )}

                  {/* PENDING */}
                  {status === "PENDING" && (
                    <div className="text-center space-y-3">
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">
                          Menunggu Pembayaran
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Pindai QRIS di bawah untuk menyelesaikan pembayaran.
                        </p>
                      </div>

                      <div className="flex justify-center">
                        {data?.payment?.qrImage ? (
                          <img
                            src={data.payment.qrImage}
                            alt="QRIS"
                            className="rounded-lg bg-white"
                            style={{
                              width: 220,
                              height: 220,
                              objectFit: "contain",
                            }}
                          />
                        ) : data?.payment?.qrString ? (
                          <QrCodeDisplay
                            value={data.payment.qrString}
                            size={220}
                            ariaLabel="QRIS"
                          />
                        ) : (
                          <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-gray-50 text-gray-300" style={{ width: 220, height: 220 }}>
                            <QrCode className="h-8 w-8" />
                          </div>
                        )}
                      </div>

                      {amount != null && (
                        <p className="text-sm text-gray-700">
                          Total:{" "}
                          <span className="font-bold text-brand-primary">
                            {formatRupiah(amount)}
                          </span>
                        </p>
                      )}

                      {countdown && (
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-3 py-1 text-sm font-medium text-amber-700">
                          <Clock className="h-4 w-4" />
                          {countdown}
                        </div>
                      )}

                      {data?.payment?.reference && (
                        <p className="text-xs text-gray-400 break-all">
                          Ref: {data.payment.reference}
                        </p>
                      )}

                      <button
                        type="button"
                        onClick={refreshStatus}
                        disabled={busy !== "idle"}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white text-gray-700 py-3 px-4 font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
                      >
                        {busy === "refreshing" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Refresh Status
                      </button>
                    </div>
                  )}

                  {/* EXPIRED */}
                  {status === "EXPIRED" && (
                    <div className="text-center space-y-3">
                      <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-orange-50">
                        <Clock className="h-8 w-8 text-orange-500" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">
                          QRIS Kedaluwarsa
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Waktu pembayaran telah habis. Buat QRIS baru untuk
                          melanjutkan.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={createPayment}
                        disabled={busy !== "idle"}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-semibold hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                      >
                        {busy === "creating" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Buat QRIS Baru
                      </button>
                    </div>
                  )}

                  {/* FAILED */}
                  {status === "FAILED" && (
                    <div className="text-center space-y-3">
                      <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-red-50">
                        <XCircle className="h-8 w-8 text-red-500" />
                      </div>
                      <div>
                        <h2 className="text-lg font-bold text-gray-900">
                          Pembayaran Gagal
                        </h2>
                        <p className="text-sm text-gray-500 mt-1">
                          Pembayaran tidak berhasil diproses. Silakan coba lagi.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={createPayment}
                        disabled={busy !== "idle"}
                        className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-brand-primary text-brand-primary-foreground py-3 px-4 font-semibold hover:bg-brand-primary/90 transition-colors disabled:opacity-50"
                      >
                        {busy === "creating" ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCw className="h-4 w-4" />
                        )}
                        Coba Lagi
                      </button>
                    </div>
                  )}

                  {/* REFUNDED */}
                  {status === "REFUNDED" && (
                    <div className="text-center space-y-2 py-2">
                      <div className="w-16 h-16 rounded-full mx-auto flex items-center justify-center bg-gray-100">
                        <CheckCircle2 className="h-8 w-8 text-gray-400" />
                      </div>
                      <h2 className="text-lg font-bold text-gray-900">
                        Pembayaran Dikembalikan
                      </h2>
                      <p className="text-sm text-gray-500">
                        Pembayaran untuk reservasi ini telah dikembalikan.
                      </p>
                    </div>
                  )}
                </>
              )}
          </div>

          <Link
            href="/menu"
            className="block text-center text-sm text-gray-400 hover:text-gray-600 transition-colors py-1"
          >
            Kembali ke Menu
          </Link>
        </div>
      )}
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2 last:border-0">
      <dt className="shrink-0 text-sm text-gray-500">{label}</dt>
      <dd className="min-w-0 text-right text-sm font-medium break-words">
        {children}
      </dd>
    </div>
  );
}
