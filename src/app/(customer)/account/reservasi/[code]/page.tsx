"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertCircle,
  ArrowLeft,
  CalendarDays,
  Check,
  Copy,
  Loader2,
  LogIn,
  User,
} from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/axios";
import { getErrorStatus, normalizeApiError } from "@/lib/api-error-handler";
import { formatPhoneDisplay } from "@/lib/phone";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCustomerAuth } from "@/hooks/use-customer-auth";
import { useCart } from "@/hooks/use-cart";
import { useBranding } from "@/hooks/use-branding";
import { CustomerAuthDialog } from "@/components/customer/auth-dialog";
import { ReservationStatusBadge } from "@/components/customer/reservation-status-badge";
import {
  formatReservationDate,
  formatReservationDateTime,
  formatTimeSlot,
} from "@/app/(customer)/reservasi/reservation-flow";

// ============================================================
// /account/reservasi/[code] — ONE of the customer's own reservations.
//
// The page never sends (or trusts) an identity; the list/detail/cancel
// endpoints derive customerId + restaurantId from the session cookie and are
// ownership + tenant scoped server-side. Cancellation keeps a single in-flight
// guard and is NEVER optimistic — the server response is the only source of
// truth, and a failed/conflicting request leaves the displayed state intact.
// ============================================================

interface ReservationDetail {
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
  notes: string | null;
  createdAt: string;
  confirmedAt: string | null;
  seatedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
}

const CANCELABLE_STATUSES = new Set(["PENDING", "CONFIRMED"]);

/** Copy text to clipboard with a fallback for non-secure contexts. */
async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
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

export default function AccountReservationDetailPage() {
  const { code } = useParams<{ code: string }>();
  const { customer, isHydrated } = useCustomerAuth();
  const { restaurantId } = useCart();
  const { branding } = useBranding();
  const customerId = customer?.id ?? null;

  const [authOpen, setAuthOpen] = useState(false);
  const [reservation, setReservation] = useState<ReservationDetail | null>(
    null
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [copied, setCopied] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");

  useEffect(() => {
    if (!isHydrated || !customerId) return;

    let cancelled = false;
    api
      .get(
        `/public/customer/account/reservations/${encodeURIComponent(code)}`
      )
      .then((res) => {
        if (cancelled) return;
        setReservation(res.data?.data ?? null);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        const normalized = normalizeApiError(err);
        setReservation(null);
        setError(normalized.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isHydrated, customerId, code, reloadKey]);

  const handleCopyCode = async () => {
    if (copied) return;
    const ok = await copyToClipboard(reservation?.code ?? "");
    if (ok) {
      setCopied(true);
      toast.success("Kode reservasi disalin");
      setTimeout(() => setCopied(false), 1600);
    } else {
      toast.error("Gagal menyalin kode");
    }
  };

  const handleCancelConfirm = async (reason: string) => {
    if (cancelPending) return; // single in-flight guard — no duplicate requests
    setCancelPending(true);
    setCancelError(null);
    try {
      await api.post(
        `/public/customer/account/reservations/${encodeURIComponent(code)}/cancel`,
        { cancelReason: reason.trim() || undefined }
      );
      setCancelReason("");
      setCancelOpen(false);
      // Always refresh from the server — never optimistic-update the status.
      setReloadKey((k) => k + 1);
    } catch (err) {
      // The reservation is NOT treated as cancelled. The server message is
      // shown (e.g. a 409 when the slot/status changed) and the detail is
      // refreshed so the UI reflects the real state.
      const normalized = normalizeApiError(err);
      setCancelError(
        getErrorStatus(err) === 409
          ? "Reservasi ini sudah tidak bisa dibatalkan (status berubah)."
          : normalized.message
      );
      setReloadKey((k) => k + 1);
    } finally {
      setCancelPending(false);
    }
  };

  // ----------------------------------------------------------
  // Loading (session restoration)
  // ----------------------------------------------------------
  if (!isHydrated) {
    return (
      <div className="space-y-4 pb-8">
        <Skeleton className="h-5 w-24" />
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------
  // Guest — reuse the EXISTING login/register dialog, show no data.
  // ----------------------------------------------------------
  if (!customer) {
    return (
      <div className="space-y-4 pb-8">
        <h1 className="text-xl font-bold text-gray-900">Detail Reservasi</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          Masuk untuk melihat detail reservasi Anda
        </p>

        <div className="bg-white rounded-xl border border-gray-200 p-6 text-center">
          <User className="h-8 w-8 mx-auto text-gray-300" />
          <p className="mt-2 font-semibold text-sm">Belum masuk</p>
          <p className="text-xs text-gray-500 mt-1">
            Masuk atau daftar untuk melihat detail reservasi Anda.
          </p>
          <button
            type="button"
            onClick={() => setAuthOpen(true)}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium bg-brand-primary text-brand-primary-foreground rounded-full px-4 py-2 hover:bg-brand-primary/90 transition-colors"
          >
            <LogIn className="h-3.5 w-3.5" />
            Masuk / Daftar
          </button>
        </div>

        <CustomerAuthDialog
          restaurantId={restaurantId}
          open={authOpen}
          onOpenChange={setAuthOpen}
        />
      </div>
    );
  }

  // ----------------------------------------------------------
  // Fetch states
  // ----------------------------------------------------------
  if (loading) {
    return (
      <div className="space-y-4 pb-8">
        <Skeleton className="h-5 w-24" />
        <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-3 w-48" />
          <Skeleton className="h-3 w-32" />
        </div>
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="space-y-4 pb-8">
        <div className="flex flex-col items-center justify-center py-14 text-center px-4">
          <AlertCircle className="h-8 w-8 text-red-400 mb-2" />
          <p className="text-sm text-gray-600">{error || "Reservasi tidak ditemukan."}</p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setError(null);
                setReloadKey((k) => k + 1);
              }}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              Coba Lagi
            </button>
            <Link
              href="/account"
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 transition-colors"
            >
              Kembali
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const canCancel = CANCELABLE_STATUSES.has(reservation.status);
  const hasTimeline =
    Boolean(reservation.confirmedAt) ||
    Boolean(reservation.seatedAt) ||
    Boolean(reservation.completedAt) ||
    Boolean(reservation.cancelledAt);

  return (
    <div className="space-y-4 pb-16">
      <div className="flex items-center justify-between">
        <h1 className="text-lg sm:text-xl font-bold text-gray-900 flex items-center gap-2">
          <CalendarDays className="h-5 w-5 text-brand-primary" />
          Detail Reservasi
        </h1>
        <Link
          href="/account"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-brand-primary transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Kembali
        </Link>
      </div>

      {/* Header — code (copyable) + status */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-gray-400 mb-1">Kode Reservasi</p>
            <button
              type="button"
              onClick={handleCopyCode}
              className="inline-flex items-center gap-1.5 font-mono text-base font-bold tracking-wide text-gray-900 hover:text-brand-primary transition-colors"
              aria-label="Salin kode reservasi"
            >
              {reservation.code}
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4 text-gray-400" />
              )}
            </button>
          </div>
          <ReservationStatusBadge status={reservation.status} />
        </div>
        <p className="mt-2 text-xs text-gray-500">
          {branding.siteName || "Restoran"} · {reservation.guestName}
        </p>
      </div>

      {/* Reservation info */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <dl>
          <DetailRow label="Restoran">
            {branding.siteName || "Restoran"}
          </DetailRow>
          <DetailRow label="Cabang">
            {reservation.branch
              ? `${reservation.branch.name} (${reservation.branch.code})`
              : "-"}
          </DetailRow>
          <DetailRow label="Tanggal">
            {formatReservationDate(reservation.reservationDate)}
          </DetailRow>
          <DetailRow label="Jam">
            {formatTimeSlot(
              reservation.startMinutes,
              reservation.durationMinutes
            )}
          </DetailRow>
          <DetailRow label="Durasi">
            {reservation.durationMinutes} menit
          </DetailRow>
          <DetailRow label="Meja">
            {reservation.table
              ? `Meja ${reservation.table.number}${
                  reservation.table.name ? ` · ${reservation.table.name}` : ""
                }`
              : "Belum ditentukan"}
          </DetailRow>
          <DetailRow label="Nama">{reservation.guestName}</DetailRow>
          <DetailRow label="WhatsApp">
            {formatPhoneDisplay(reservation.guestPhone)}
          </DetailRow>
          <DetailRow label="Jumlah Orang">
            {reservation.partySize} orang
          </DetailRow>
          {reservation.notes && (
            <DetailRow label="Catatan">{reservation.notes}</DetailRow>
          )}
          <DetailRow label="Dibuat">
            {formatReservationDateTime(reservation.createdAt)}
          </DetailRow>
        </dl>

        {hasTimeline && (
          <div className="mt-4 border-t border-gray-100 pt-1">
            <p className="my-1 text-sm font-semibold">Riwayat Status</p>
            <dl>
              {reservation.confirmedAt && (
                <DetailRow label="Dikonfirmasi">
                  {formatReservationDateTime(reservation.confirmedAt)}
                </DetailRow>
              )}
              {reservation.seatedAt && (
                <DetailRow label="Sudah Duduk">
                  {formatReservationDateTime(reservation.seatedAt)}
                </DetailRow>
              )}
              {reservation.completedAt && (
                <DetailRow label="Selesai">
                  {formatReservationDateTime(reservation.completedAt)}
                </DetailRow>
              )}
              {reservation.cancelledAt && (
                <DetailRow label="Dibatalkan">
                  {formatReservationDateTime(reservation.cancelledAt)}
                </DetailRow>
              )}
            </dl>
            {reservation.cancelReason && (
              <div className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                <span className="font-medium">Alasan: </span>
                {reservation.cancelReason}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Actions — cancel ONLY when the server permits the transition. */}
      {canCancel && (
        <Button
          variant="destructive"
          onClick={() => {
            setCancelError(null);
            setCancelOpen(true);
          }}
          className="w-full"
        >
          Batalkan Reservasi
        </Button>
      )}

      <Dialog
        open={cancelOpen}
        onOpenChange={(next) => {
          setCancelOpen(next);
          if (!next) {
            setCancelReason("");
            setCancelError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Batalkan Reservasi</DialogTitle>
            <DialogDescription>
              Batalkan reservasi{" "}
              <span className="font-medium text-foreground">
                {reservation.code}
              </span>{" "}
              ({reservation.guestName})? Reservasi hanya bisa dibatalkan
              sebelum dimulai.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="cancel-reason">Alasan pembatalan (opsional)</Label>
              <Textarea
                id="cancel-reason"
                value={cancelReason}
                onChange={(e) => setCancelReason(e.target.value)}
                placeholder="Contoh: jadwal berubah, tidak jadi datang, dsb."
                maxLength={200}
                rows={3}
                disabled={cancelPending}
                className="mt-1"
              />
            </div>
            {cancelError && (
              <div className="flex items-start gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{cancelError}</span>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={cancelPending}
              onClick={() => setCancelOpen(false)}
            >
              Batal
            </Button>
            <Button
              variant="destructive"
              disabled={cancelPending}
              onClick={() => handleCancelConfirm(cancelReason)}
            >
              {cancelPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : null}
              Konfirmasi Pembatalan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}