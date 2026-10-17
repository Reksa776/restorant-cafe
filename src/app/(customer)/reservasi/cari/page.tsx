"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CalendarDays, Search } from "lucide-react";
import api from "@/lib/axios";
import { useCart } from "@/hooks/use-cart";
import { useBranding } from "@/hooks/use-branding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ReservationInvoice, type ReservationInvoiceData } from "@/components/customer/reservation-invoice";
import { QrCodeDisplay } from "@/components/qr-code-display";
import {
  formatReservationDate,
  formatTimeSlot,
  reservationQrPayload,
} from "../reservation-flow";
import { ReservationStatusBadge } from "@/components/customer/reservation-status-badge";
import { formatPhoneDisplay } from "@/lib/phone";
import { normalizeApiError } from "@/lib/api-error-handler";

export default function FindReservationPage() {
  const { restaurantId } = useCart();
  const { branding } = useBranding();
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState("");
  const [reservation, setReservation] = useState<ReservationInvoiceData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (loading) return;
    const normalizedCode = code.trim().toUpperCase();
    if (!/^R-[A-Z0-9]{8}$/.test(normalizedCode) || !phone.trim()) {
      setError("Masukkan kode reservasi dan nomor WhatsApp yang digunakan saat booking.");
      return;
    }
    setLoading(true);
    setError(null);
    setReservation(null);
    try {
      const response = await api.get(
        `/public/reservations/${encodeURIComponent(normalizedCode)}`,
        { params: { phone: phone.trim(), ...(restaurantId ? { restaurantId } : {}) } }
      );
      setReservation(response.data?.data as ReservationInvoiceData);
      setCode(normalizedCode);
    } catch (lookupError) {
      setError(normalizeApiError(lookupError).message || "Reservasi tidak ditemukan. Periksa kode dan nomor WhatsApp.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-10">
      <div className="flex items-center justify-between">
        <h1 className="flex items-center gap-2 text-xl font-bold text-gray-900">
          <Search className="h-5 w-5 text-brand-primary" /> Cari Reservasi
        </h1>
        <Link href="/reservasi" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-brand-primary">
          <ArrowLeft className="h-4 w-4" /> Reservasi
        </Link>
      </div>

      <form onSubmit={submit} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-600">
          Masukkan kode reservasi dan nomor WhatsApp untuk membuka kembali QR dan invoice.
        </p>
        <label className="block text-sm font-medium text-gray-700">
          Kode reservasi
          <Input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="R-AB12CD34" autoComplete="off" className="mt-1 font-mono uppercase" required />
        </label>
        <label className="block text-sm font-medium text-gray-700">
          Nomor WhatsApp
          <Input type="tel" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="08xxxxxxxxxx" autoComplete="tel" className="mt-1" required />
        </label>
        {error && (
          <div className="flex items-start gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        <Button type="submit" disabled={loading} className="w-full">
          <Search className="mr-2 h-4 w-4" />
          {loading ? "Mencari…" : "Cari Reservasi"}
        </Button>
      </form>

      {reservation && (
        <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs text-gray-500">Kode Reservasi</p>
              <p className="font-mono text-lg font-bold">{reservation.code}</p>
            </div>
            <ReservationStatusBadge status={reservation.status} />
          </div>
          <div className="rounded-xl border border-gray-100 p-4 text-center">
            <p className="text-sm font-semibold">QR Reservasi</p>
            <div className="mt-2 flex justify-center">
              <QrCodeDisplay value={reservationQrPayload(reservation.code)} size={190} ariaLabel={`QR reservasi ${reservation.code}`} />
            </div>
            <p className="mt-2 text-xs text-gray-500">Tunjukkan QR ini kepada kasir saat datang.</p>
          </div>
          <dl className="divide-y divide-gray-100 text-sm">
            <div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Nama</dt><dd className="text-right font-medium">{reservation.guestName}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">WhatsApp</dt><dd className="text-right font-medium">{formatPhoneDisplay(reservation.guestPhone ?? phone)}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Cabang</dt><dd className="text-right font-medium">{reservation.branch?.name ?? "-"}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Tanggal / Jam</dt><dd className="text-right font-medium">{formatReservationDate(reservation.reservationDate)} · {formatTimeSlot(reservation.startMinutes, reservation.durationMinutes)}</dd></div>
            <div className="flex justify-between gap-3 py-2"><dt className="text-gray-500">Tamu</dt><dd className="text-right font-medium">{reservation.partySize} orang</dd></div>
          </dl>
          <div className="flex justify-center border-t border-gray-100 pt-4">
            <ReservationInvoice reservation={reservation} siteName={branding.siteName || "Restoran"} />
          </div>
        </section>
      )}
      <p className="flex items-start gap-2 text-xs text-gray-500">
        <CalendarDays className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        Untuk keamanan, data reservasi hanya tampil jika nomor WhatsApp cocok dengan reservasi.
      </p>
    </div>
  );
}
