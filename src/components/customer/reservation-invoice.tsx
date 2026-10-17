"use client";

import { createPortal } from "react-dom";
import { Download } from "lucide-react";
import { QrCodeDisplay } from "@/components/qr-code-display";
import { formatPhoneDisplay } from "@/lib/phone";
import {
  formatReservationDate,
  formatRupiah,
  formatTimeSlot,
  RESERVATION_STATUS_LABELS,
  reservationQrPayload,
} from "@/app/(customer)/reservasi/reservation-flow";

export interface ReservationInvoiceData {
  code: string;
  status: string;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  partySize: number;
  guestName: string;
  guestPhone?: string | null;
  branch?: { code?: string; name: string } | null;
  table?: { number: number; name?: string | null } | null;
  order?: {
    orderNumber: string;
    paymentStatus: string;
    paymentMethod?: string | null;
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
  payment?: {
    method?: string | null;
    status: string;
    paidAt?: string | null;
  } | null;
}

const PAYMENT_LABELS: Record<string, string> = {
  UNPAID: "BELUM DIBAYAR",
  PENDING: "MENUNGGU PEMBAYARAN",
  PAID: "LUNAS",
  FAILED: "PEMBAYARAN GAGAL",
  EXPIRED: "PEMBAYARAN KEDALUWARSA",
  REFUNDED: "DANA DIKEMBALIKAN",
  CANCELLED: "PEMBAYARAN DIBATALKAN",
};

function displayPaymentMethod(method?: string | null) {
  if (!method) return "-";
  if (method === "KASIR") return "Kasir / Tunai";
  if (method === "QRIS") return "QRIS";
  return method;
}

function formatDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "-"
    : date.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function printInvoice(code: string) {
  const previousTitle = document.title;
  document.title = `Invoice-Reservasi-${code}`;
  window.addEventListener(
    "afterprint",
    () => {
      document.title = previousTitle;
    },
    { once: true }
  );
  window.print();
}

function InvoiceRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-dashed border-gray-300 py-1.5">
      <span className="text-gray-600">{label}</span>
      <span className="text-right font-medium text-gray-900">{value}</span>
    </div>
  );
}

/** Reservation invoice that can be reopened and printed/saved as PDF. */
export function ReservationInvoice({
  reservation,
  siteName,
}: {
  reservation: ReservationInvoiceData;
  siteName: string;
}) {
  const order = reservation.order;
  const paymentStatus = order?.paymentStatus ?? reservation.payment?.status;
  const paid = paymentStatus === "PAID";
  const printCopy = (
    <div className="bill-inner mx-auto w-[72mm] max-w-[72mm] bg-white px-2 py-3 font-sans text-[11px] leading-relaxed text-gray-900">
      <header className="text-center">
        <p className="text-[15px] font-bold">{siteName || "Restoran"}</p>
        <p className="mt-1 text-[13px] font-bold tracking-wide">INVOICE RESERVASI</p>
        <p className="mt-1 text-[12px] font-bold">{reservation.code}</p>
        <div className="my-2 flex justify-center">
          <QrCodeDisplay
            value={reservationQrPayload(reservation.code)}
            size={120}
            ariaLabel={`QR reservasi ${reservation.code}`}
          />
        </div>
      </header>

      <div className="border-y border-dashed border-gray-500 py-1">
        <InvoiceRow label="Nama" value={reservation.guestName} />
        {reservation.guestPhone && (
          <InvoiceRow label="WhatsApp" value={formatPhoneDisplay(reservation.guestPhone)} />
        )}
        <InvoiceRow label="Cabang" value={reservation.branch?.name ?? "-"} />
        <InvoiceRow label="Tanggal" value={formatReservationDate(reservation.reservationDate)} />
        <InvoiceRow
          label="Jam"
          value={formatTimeSlot(reservation.startMinutes, reservation.durationMinutes)}
        />
        <InvoiceRow label="Jumlah tamu" value={`${reservation.partySize} orang`} />
        <InvoiceRow
          label="Meja"
          value={reservation.table ? `Meja ${reservation.table.number}${reservation.table.name ? ` · ${reservation.table.name}` : ""}` : "Belum ditentukan"}
        />
        <InvoiceRow label="Status reservasi" value={RESERVATION_STATUS_LABELS[reservation.status] ?? reservation.status} />
      </div>

      {order && (
        <section className="mt-2">
          <p className="mb-1 font-bold">PESANAN · {order.orderNumber}</p>
          {order.items.map((item, index) => (
            <div key={`${item.name}-${index}`} className="py-1">
              <p className="font-medium">{item.name}</p>
              <div className="flex justify-between gap-2 text-gray-600">
                <span>{item.quantity} × {formatRupiah(item.unitPrice)}</span>
                <span>{formatRupiah(item.totalPrice)}</span>
              </div>
            </div>
          ))}
          <div className="mt-1 border-t border-dashed border-gray-400 pt-1">
            <InvoiceRow label="Subtotal" value={formatRupiah(order.subtotal)} />
            {order.discount > 0 && <InvoiceRow label="Diskon" value={`-${formatRupiah(order.discount)}`} />}
            {order.tax > 0 && <InvoiceRow label="Pajak" value={formatRupiah(order.tax)} />}
            {order.serviceCharge > 0 && <InvoiceRow label="Service charge" value={formatRupiah(order.serviceCharge)} />}
            <div className="flex justify-between gap-3 border-t border-gray-500 py-1.5 text-[13px] font-bold">
              <span>TOTAL</span><span>{formatRupiah(order.grandTotal)}</span>
            </div>
          </div>
          <div className={`mt-2 border-2 p-2 text-center font-bold ${paid ? "border-green-700 text-green-800" : "border-amber-700 text-amber-900"}`}>
            {PAYMENT_LABELS[paymentStatus ?? "UNPAID"] ?? paymentStatus ?? "BELUM DIBAYAR"}
            <p className="mt-0.5 text-[10px] font-normal">Metode: {displayPaymentMethod(reservation.payment?.method ?? order.paymentMethod)}</p>
            {paid && reservation.payment?.paidAt && (
              <p className="text-[10px] font-normal">Dibayar: {formatDateTime(reservation.payment.paidAt)}</p>
            )}
          </div>
          {!paid && (
            <p className="mt-1 text-center text-[9px] font-bold">
              INI TAGIHAN, BUKAN BUKTI PEMBAYARAN.
            </p>
          )}
        </section>
      )}

      <footer className="mt-3 border-t border-dashed border-gray-400 pt-2 text-center text-[9px] text-gray-600">
        Tunjukkan QR atau kode reservasi ini kepada kasir.
        <p className="mt-1">Simpan invoice ini untuk referensi Anda.</p>
      </footer>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => printInvoice(reservation.code)}
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-brand-primary/30 px-4 py-2 text-sm font-medium text-brand-primary hover:bg-brand-secondary"
      >
        <Download className="h-4 w-4" />
        Cetak / Simpan Invoice PDF
      </button>
      <span className="sr-only">Di dialog cetak, pilih Simpan sebagai PDF untuk mengunduh invoice.</span>
      {typeof document !== "undefined" && createPortal(
        <div id="print-root" className="hidden">{printCopy}</div>,
        document.body
      )}
    </>
  );
}
