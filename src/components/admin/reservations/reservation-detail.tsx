"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatPhoneDisplay } from "@/lib/phone";
import type { ReservationTableView } from "@/services/reservation.service";
import { reservationService } from "@/services/reservation.service";
import { ReservationStatusBadge } from "./reservation-status-badge";
import {
  formatReservationDate,
  formatReservationDateTime,
  formatTimeSlot,
  RESERVATION_SOURCE_LABELS,
} from "./reservation-format";

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

interface ReservationDetailProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Row data from the board — detail re-fetches the freshest view on open. */
  initial: ReservationTableView | null;
}

/**
 * Admin reservation detail. Renders the reservation + branch/table/customer
 * refs — never internal ids, never auth/payment/WhatsApp secrets (the R3
 * ReservationView carries none). On open it refreshes via GET /[id] so the
 * status timestamps reflect the latest server state.
 */
export function ReservationDetail({
  open,
  onOpenChange,
  initial,
}: ReservationDetailProps) {
  // `live` holds the freshest server view after the background GET /[id]
  // refetch; until it resolves the board's row data (`initial`) is shown, so
  // there is never a blank window.
  const [live, setLive] = useState<ReservationTableView | null>(null);
  const reservation =
    live && live.id === initial?.id ? live : initial;

  // Best-effort refresh on open (only async setState inside the effect).
  useEffect(() => {
    if (!open || !initial) return;
    let alive = true;
    reservationService
      .getById(initial.id)
      .then((fresh) => {
        if (alive) setLive(fresh);
      })
      .catch(() => {
        // Board data is already valid — refetch is best-effort.
      });
    return () => {
      alive = false;
    };
  }, [open, initial]);

  // Clear the fetched copy when closing so a stale row never leaks into the
  // next open (reset happens in the handler, not an effect).
  const handleOpenChange = (next: boolean) => {
    if (!next) setLive(null);
    onOpenChange(next);
  };

  const hasTimeline =
    Boolean(reservation?.confirmedAt) ||
    Boolean(reservation?.seatedAt) ||
    Boolean(reservation?.completedAt) ||
    Boolean(reservation?.cancelledAt);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Detail Reservasi</DialogTitle>
          <DialogDescription>
            {reservation?.code ?? "Memuat data..."}
          </DialogDescription>
        </DialogHeader>

        {reservation ? (
          <div className="max-h-[60vh] overflow-y-auto pr-1">
            <dl>
              <DetailRow label="Cabang">
                {reservation.branch
                  ? `${reservation.branch.name} (${reservation.branch.code})`
                  : "-"}
              </DetailRow>
              <div className="flex items-start justify-between gap-4 border-b border-gray-100 py-2">
                <dt className="shrink-0 text-sm text-gray-500">Status</dt>
                <dd>
                  <ReservationStatusBadge status={reservation.status} />
                </dd>
              </div>
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
              <DetailRow label="Jumlah Orang">
                {reservation.partySize} orang
              </DetailRow>
              <DetailRow label="Meja">
                {reservation.table
                  ? `Meja ${reservation.table.number}${
                      reservation.table.name ? ` · ${reservation.table.name}` : ""
                    }`
                  : "Belum ditentukan"}
              </DetailRow>
              <DetailRow label="Nama Tamu">
                {reservation.guestName}
              </DetailRow>
              <DetailRow label="No. WhatsApp">
                {formatPhoneDisplay(reservation.guestPhone)}
              </DetailRow>
              <DetailRow label="Pelanggan">
                {reservation.customer?.name ?? "-"}
              </DetailRow>
              <DetailRow label="Sumber">
                {RESERVATION_SOURCE_LABELS[reservation.source] ??
                  reservation.source}
              </DetailRow>
              <DetailRow label="Catatan">
                {reservation.notes || "-"}
              </DetailRow>
              <DetailRow label="Dibuat">
                {formatReservationDateTime(reservation.createdAt)}
              </DetailRow>
            </dl>

            {hasTimeline && (
              <div className="mt-4">
                <p className="mb-1 text-sm font-semibold">Riwayat Status</p>
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
        ) : null}
      </DialogContent>
    </Dialog>
  );
}