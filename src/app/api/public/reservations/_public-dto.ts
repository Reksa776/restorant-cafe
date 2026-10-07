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
    // The reservation's OWN purchase, shaped for the existing payment flow.
    // Deliberately excludes the internal `orderId` (the public contract only
    // ever exposes the non-sequential `orderNumber`) and never exposes
    // customer/internal payment rows.
    order: view.order
      ? {
          orderNumber: view.order.orderNumber,
          status: view.order.status,
          paymentStatus: view.order.paymentStatus,
          paymentMethod: view.order.paymentMethod,
          subtotal: view.order.subtotal,
          discount: view.order.discount,
          tax: view.order.tax,
          serviceCharge: view.order.serviceCharge,
          grandTotal: view.order.grandTotal,
          items: view.order.items.map((item) => ({
            name: item.name,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice,
          })),
        }
      : null,
  };
}