import type { ReservationView } from "@/services/reservation/reservation.service";

/**
 * Public-safe reservation DTO. Mirrors the projection the guest-lookup
 * service returns (see `getReservationByCodeForGuest`): branch/table display
 * names only, never orderId/customerId/source/notes or full row columns.
 */
export function toPublicReservationDto(view: ReservationView) {
  return {
    id: view.id,
    code: view.code,
    status: view.status,
    reservationDate: view.reservationDate,
    startMinutes: view.startMinutes,
    durationMinutes: view.durationMinutes,
    partySize: view.partySize,
    guestName: view.guestName,
    guestPhone: view.guestPhone,
    branch: view.branch
      ? { code: view.branch.code, name: view.branch.name }
      : null,
    table: view.table
      ? { number: view.table.number, name: view.table.name }
      : null,
    createdAt: view.createdAt,
  };
}