import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import {
  formatReservationDate,
  formatTimeSlot,
  RESERVATION_STATUS_LABELS,
} from "@/components/admin/reservations/reservation-format";
import type { ReservationStatusValue } from "@/services/reservation/reservation.types";
import { queueWhatsAppReservation } from "@/services/whatsapp/whatsapp.queue";

// ============================================================
// PHASE R7 — RESERVATION → WHATSAPP notification (best-effort).
//
// This is the ONLY reservation→WhatsApp seam. It reuses the EXISTING
// BullMQ/Baileys pipeline (queueWhatsAppReservation → whatsapp queue →
// whatsapp worker → session-manager → Baileys provider) — no engine is
// duplicated. dispatchReservationWhatsApp is called by the reservation
// service AFTER a successful server-side create/transition, so the
// reservation itself is ALWAYS authoritative: a WhatsApp failure can never
// fail, roll back, or alter a reservation.
//
// Security: every piece of data (target phone, restaurant, dates, status,
// cancellation reason) comes from the SERVER-side view; nothing from the
// browser. Message text exposes no internal ids, payment/gateway data,
// credentials, Redis or WhatsApp session information.
// ============================================================

/**
 * The slice of a ReservationView the notifier is allowed to read. The full
 * view satisfies this structurally; keeping it narrow makes the builder pure
 * and unit-testable without a database.
 */
export interface ReservationWhatsAppView {
  id: string;
  restaurantId: string;
  code: string;
  guestName: string;
  guestPhone: string;
  partySize: number;
  reservationDate: string;
  startMinutes: number;
  durationMinutes: number;
  status: string;
  cancelReason: string | null;
  branch: { code: string; name: string } | null;
  table: { number: number; name: string | null } | null;
  customer: { phone: string | null } | null;
}

/**
 * Test seam (failure-isolation tests only). Production never overrides it;
 * swap it in tests to force an enqueue failure without touching the engine.
 */
export const reservationWhatsAppGateway = {
  enqueue: queueWhatsAppReservation,
};

function detailLine(lines: string, label: string, value: string): string {
  return lines + `- ${label}: ${value}\n`;
}

/**
 * Build the WhatsApp message body for one lifecycle event. Pure — no I/O.
 *
 * Uses the shared pure R4 display helpers (formatReservationDate,
 * formatTimeSlot) and the canonical status labels, and only server-side
 * reservation data (restaurant name is passed in from the server lookup).
 */
export function buildReservationWhatsAppMessage(
  view: ReservationWhatsAppView,
  status: ReservationStatusValue,
  restaurantName: string
): string {
  const statusLabel = RESERVATION_STATUS_LABELS[status] ?? status;
  const slot = formatTimeSlot(view.startMinutes, view.durationMinutes);
  const branch = view.branch ? `${view.branch.name} (${view.branch.code})` : "-";
  const table = view.table
    ? view.table.name
      ? `Meja ${view.table.number} (${view.table.name})`
      : `Meja ${view.table.number}`
    : null;

  // Common detail block shared by every status template.
  let detail = "";
  detail = detailLine(detail, "Restoran", restaurantName);
  detail = detailLine(detail, "Cabang", branch);
  detail = detailLine(detail, "Kode reservasi", view.code);
  detail = detailLine(detail, "Tanggal", formatReservationDate(view.reservationDate));
  detail = detailLine(detail, "Waktu", `${slot} (${view.durationMinutes} menit)`);
  detail = detailLine(detail, "Nama", view.guestName);
  detail = detailLine(detail, "Jumlah orang", `${view.partySize} orang`);
  if (table) {
    detail = detailLine(detail, "Meja", table);
  }
  detail = detailLine(detail, "Status", statusLabel);

  const header = `Halo ${view.guestName},\n\n`;
  const footer = `Terima kasih.\n\n${restaurantName}`;

  switch (status) {
    case "PENDING":
      return (
        `${header}Reservasi Anda telah kami terima dengan kode ${view.code}. ` +
        "Kami akan mengonfirmasi segera setelah tersedia.\n\n" +
        detail +
        `\n${footer}`
      );
    case "CONFIRMED":
      return (
        `${header}Reservasi Anda dengan kode ${view.code} telah dikonfirmasi. ` +
        "Sampai jumpa!\n\n" +
        detail +
        `\n${footer}`
      );
    case "CANCELLED":
      return (
        `${header}Reservasi Anda dengan kode ${view.code} telah dibatalkan.\n\n` +
        (view.cancelReason
          ? `- Alasan pembatalan: ${view.cancelReason}\n`
          : "") +
        detail +
        `\nJika Anda ingin reservasi ulang, silakan hubungi kami.`
      );
    case "SEATED":
      return (
        `${header}Reservasi Anda dengan kode ${view.code} telah mendapat meja. ` +
        "Silakan menuju meja Anda.\n\n" +
        detail +
        `\n${footer}`
      );
    case "COMPLETED":
      return (
        `${header}Reservasi Anda dengan kode ${view.code} telah selesai. ` +
        "Terima kasih telah berkunjung.\n\n" +
        detail +
        `\n${footer}`
      );
    case "NO_SHOW":
      return (
        `${header}Reservasi Anda dengan kode ${view.code} telah ditutup karena ` +
        "Anda tidak hadir pada jadwal yang ditentukan.\n\n" +
        detail +
        `\nJika Anda masih ingin berkunjung, silakan hubungi kami untuk reservasi baru.`
      );
    default:
      return `${header}Berikut detail reservasi Anda:\n\n${detail}\n${footer}`;
  }
}

/**
 * Resolve the message target phone, server-side only.
 *
 * Primary: the reservation's canonical guestPhone. Fallback: the linked
 * customer's phone. Both go through the existing normalizePhone helper.
 * Returns null when there is no usable number (empty, malformed, or a
 * "guest-*" placeholder) — callers skip the message entirely.
 */
export function resolveReservationWhatsAppTarget(
  view: ReservationWhatsAppView
): string | null {
  const primary = view.guestPhone;
  if (primary && !primary.startsWith("guest-")) {
    const normalized = normalizePhone(primary);
    if (normalized) return normalized;
  }

  const fallback = view.customer?.phone ?? null;
  if (fallback && !fallback.startsWith("guest-")) {
    const normalized = normalizePhone(fallback);
    if (normalized) return normalized;
  }

  return null;
}

/**
 * Best-effort dispatch for one reservation lifecycle event. Never throws.
 * Order of work: resolve the restaurant name (server lookup) → resolve the
 * target phone → build the message → enqueue onto the existing WhatsApp
 * queue. Any failure is logged and reported as `false` so the caller can
 * continue treating the reservation as authoritative.
 */
export async function dispatchReservationWhatsApp(
  view: ReservationWhatsAppView,
  status: ReservationStatusValue
): Promise<boolean> {
  try {
    const target = resolveReservationWhatsAppTarget(view);
    if (!target) {
      return false;
    }

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: view.restaurantId },
      select: { name: true },
    });
    const restaurantName = restaurant?.name || "Restoran";

    const message = buildReservationWhatsAppMessage(
      view,
      status,
      restaurantName
    );

    await reservationWhatsAppGateway.enqueue(
      view.restaurantId,
      view.id,
      status,
      target,
      message
    );

    return true;
  } catch (error) {
    console.error(
      `[Reservation] Failed to queue WhatsApp notification for reservation ${view.id} (${status}):`,
      error
    );
    return false;
  }
}