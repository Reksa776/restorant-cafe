import type { ReservationView } from "@/services/reservation/reservation.service";

// ============================================================
// R6 — Customer reservation DTO.
//
// Safe projection of a ReservationView for the logged-in customer's own
// reservation screens. Note what is NOT projected: the primary `id`,
// `restaurantId`, `branchId`, `customerId`, `orderId`, `source` (internal
// stamps) — and never any other customer's rows (the query already scopes
// server-side). Payment / provider / WhatsApp-wiring fields never enter the
// Reservation model in the first place, so they can't leak here.
// ============================================================

function toBranch(view: ReservationView["branch"]) {
  return view ? { code: view.code, name: view.name } : null;
}

function toTable(view: ReservationView["table"]) {
  return view ? { number: view.number, name: view.name } : null;
}

/** List card projection. */
export function toCustomerReservationListItemDto(view: ReservationView) {
  return {
    code: view.code,
    status: view.status,
    reservationDate: view.reservationDate,
    startMinutes: view.startMinutes,
    durationMinutes: view.durationMinutes,
    partySize: view.partySize,
    guestName: view.guestName,
    branch: toBranch(view.branch),
    table: toTable(view.table),
    createdAt: view.createdAt,
  };
}

/** Detail projection (list fields + the owner's own contact/notes/timeline). */
export function toCustomerReservationDetailDto(view: ReservationView) {
  return {
    ...toCustomerReservationListItemDto(view),
    guestPhone: view.guestPhone,
    notes: view.notes,
    confirmedAt: view.confirmedAt,
    seatedAt: view.seatedAt,
    completedAt: view.completedAt,
    cancelledAt: view.cancelledAt,
    cancelReason: view.cancelReason,
  };
}