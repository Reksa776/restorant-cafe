import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { paymentService } from "@/services/payment/payment.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import {
  AppError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/phone";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";
import { resolvePublicReservationRestaurant } from "../../_resolve-public-context";

// ============================================================
// PUBLIC RESERVATION PAYMENT — Phase 2 (payment ownership redesign).
//
// The customer pays in the RESERVATION flow (not the Order payment page). This
// endpoint is a thin, reservation-scoped adapter over the EXISTING payment
// engine: it resolves the reservation's OWN Order (Reservation.orderId →
// Order.id) and delegates to `paymentService.createPayment` for QRIS. There is
// NO new payment engine, NO new QRIS engine, NO new auth system, and NO schema
// change. The amount is ALWAYS `Order.grandTotal` from the database — the
// client never sends an amount, restaurantId, orderId, paymentId, providerRef
// or payment status.
//
// Ownership (existing mechanism): an authenticated customer session whose
// customerId matches the reservation, OR the reservation's own guestPhone
// (normalized). Everything else resolves to 404 so a reservation code cannot be
// enumerated across tenants.
// ============================================================

type OwnedReservation = {
  id: string;
  code: string;
  status: string;
  restaurantId: string;
  orderId: string | null;
  customerId: string | null;
  guestPhone: string;
};

/**
 * Resolve the reservation by CODE within a server-resolved tenant, then verify
 * ownership. `restaurantId` is only ever a HINT for tenant resolution (mirrors
 * the existing public reservation create/lookup routes); it can never point at
 * a reservation the caller does not own, because the code must match. A missing
 * or foreign reservation is indistinguishable (404) from a not-owned one.
 */
async function resolveOwnedReservation(
  request: NextRequest,
  code: string,
  hints: { phone?: string | null; restaurantId?: string | null }
): Promise<OwnedReservation> {
  const restaurantId = await resolvePublicReservationRestaurant(request, {
    restaurantId: hints.restaurantId ?? null,
  });

  const reservation = await prisma.reservation.findFirst({
    where: { restaurantId, code },
    select: {
      id: true,
      code: true,
      status: true,
      restaurantId: true,
      orderId: true,
      customerId: true,
      guestPhone: true,
    },
  });
  if (!reservation) {
    throw new NotFoundError("Reservasi tidak ditemukan");
  }

  const session = tryGetCustomerSessionFromRequest(request);
  const sessionOwns = Boolean(
    session?.customerId &&
      reservation.customerId &&
      session.customerId === reservation.customerId
  );
  const normalized = hints.phone ? normalizePhone(hints.phone) : null;
  const phoneOwns = Boolean(normalized && normalized === reservation.guestPhone);

  if (!sessionOwns && !phoneOwns) {
    throw new NotFoundError("Reservasi tidak ditemukan");
  }

  return reservation;
}

/**
 * Public-safe payment DTO. `paymentStatus` is DERIVED from `Order.paymentStatus`
 * (the single source of truth). No provider credentials, API key, VA number or
 * internal database ids are exposed; `reference` is the non-secret gateway
 * correlation id.
 */
function toReservationPaymentDto(input: {
  reservation: Pick<OwnedReservation, "code" | "status">;
  order: {
    orderNumber: string;
    status: string;
    paymentStatus: string;
    grandTotal: unknown;
  } | null;
  payment: {
    status: string;
    method: string | null;
    amount: unknown;
    provider: string | null;
    providerRef: string | null;
    qrImage: string | null;
    qrString: string | null;
    paymentUrl: string | null;
    paidAt: Date | null;
    expiresAt: Date | null;
  } | null;
}) {
  return {
    reservationCode: input.reservation.code,
    reservationStatus: input.reservation.status,
    orderNumber: input.order?.orderNumber ?? null,
    orderStatus: input.order?.status ?? null,
    // Derived from the order (source of truth); UNPAID when no payment intent
    // exists yet but a payable order does.
    paymentStatus: input.order?.paymentStatus ?? "UNPAID",
    grandTotal: input.order ? Number(input.order.grandTotal) : null,
    payment: input.payment
      ? {
          status: input.payment.status,
          method: input.payment.method ?? null,
          amount: Number(input.payment.amount),
          provider: input.payment.provider ?? null,
          reference: input.payment.providerRef ?? null,
          qrImage: input.payment.qrImage ?? null,
          qrString: input.payment.qrString ?? null,
          paymentUrl: input.payment.paymentUrl ?? null,
          paidAt: input.payment.paidAt ?? null,
          expiresAt: input.payment.expiresAt ?? null,
        }
      : null,
  };
}

/**
 * POST /api/public/reservations/[code]/payment
 * Create — or reuse — the QRIS payment for the reservation's own Order, through
 * the EXISTING payment engine. Body: `{ method?: "QRIS", phone?: string }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    // Anti-abuse: bound payment-intent creation per client (mirrors the
    // existing public payment-create route).
    assertRateLimit(
      rateLimitKey("public-reservation-payment-create", request),
      30,
      60_000
    );

    const { code } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      method?: unknown;
      phone?: unknown;
      restaurantId?: unknown;
    };

    // This endpoint is QRIS-only (the reservation's cashier intent is handled
    // by the order/cashier flow). Any other explicit method is rejected; an
    // absent method defaults to QRIS.
    if (body.method !== undefined && body.method !== "QRIS") {
      throw new ValidationError("Metode pembayaran tidak valid");
    }

    const reservation = await resolveOwnedReservation(request, code, {
      phone: typeof body.phone === "string" ? body.phone : null,
      restaurantId:
        typeof body.restaurantId === "string" ? body.restaurantId : null,
    });

    if (reservation.status === "CANCELLED") {
      throw new ConflictError(
        "Reservasi sudah dibatalkan — pembayaran tidak dapat dibuat"
      );
    }
    if (!reservation.orderId) {
      throw new ConflictError(
        "Reservasi ini tidak memiliki pesanan yang dapat dibayar"
      );
    }

    // Load the order SERVER-SIDE and re-scope it to the reservation tenant.
    const order = await prisma.order.findFirst({
      where: { id: reservation.orderId, restaurantId: reservation.restaurantId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        paymentStatus: true,
        grandTotal: true,
        branchId: true,
      },
    });
    if (!order) {
      throw new NotFoundError("Pesanan reservasi tidak ditemukan");
    }
    if (order.status === "CANCELLED") {
      throw new ConflictError(
        "Pesanan sudah dibatalkan — pembayaran tidak dapat dibuat"
      );
    }
    if (order.paymentStatus === "PAID") {
      throw new ConflictError("Pesanan sudah dibayar");
    }

    // Delegate to the EXISTING engine. Amount, idempotency, live-PENDING reuse,
    // expiration, providerRef and the gateway interaction are ALL handled there.
    const payment = await paymentService.createPayment(
      order.id,
      reservation.restaurantId,
      { method: "QRIS" },
      order.branchId ? [order.branchId] : undefined
    );

    // Re-read the order so `paymentStatus` reflects the engine's mirror.
    const freshOrder = await prisma.order.findFirst({
      where: { id: order.id },
      select: {
        orderNumber: true,
        status: true,
        paymentStatus: true,
        grandTotal: true,
      },
    });

    return successResponse(
      toReservationPaymentDto({
        reservation,
        order: freshOrder,
        payment: {
          status: payment.status,
          method: payment.method,
          amount: payment.amount,
          provider: payment.provider,
          providerRef: payment.providerRef,
          qrImage: payment.qrImage,
          qrString: payment.qrString,
          paymentUrl: payment.paymentUrl,
          paidAt: payment.paidAt,
          expiresAt: payment.expiresAt,
        },
      }),
      "Pembayaran reservasi dibuat"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating reservation payment:", error);
    return errorResponse(
      "Gagal membuat pembayaran reservasi",
      "INTERNAL_ERROR",
      500
    );
  }
}

/**
 * GET /api/public/reservations/[code]/payment
 * Read-only status poll. NEVER creates a payment (no side effects). Returns the
 * derived payment state, or a safe "UNPAID / not created yet" state.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
) {
  try {
    // The customer polls every ~4s — a generous window leaves headroom while
    // still bounding abuse (mirrors the existing payment-status poll route).
    assertRateLimit(
      rateLimitKey("public-reservation-payment-status", request),
      120,
      60_000
    );

    const { code } = await params;
    const searchParams = request.nextUrl.searchParams;

    const reservation = await resolveOwnedReservation(request, code, {
      phone: searchParams.get("phone"),
      restaurantId: searchParams.get("restaurantId"),
    });

    if (!reservation.orderId) {
      return successResponse(
        toReservationPaymentDto({ reservation, order: null, payment: null })
      );
    }

    const order = await prisma.order.findFirst({
      where: { id: reservation.orderId, restaurantId: reservation.restaurantId },
      select: {
        orderNumber: true,
        status: true,
        paymentStatus: true,
        grandTotal: true,
      },
    });
    if (!order) {
      return successResponse(
        toReservationPaymentDto({ reservation, order: null, payment: null })
      );
    }

    const payment = await prisma.payment.findFirst({
      where: { orderId: reservation.orderId },
      orderBy: { createdAt: "desc" },
      select: {
        status: true,
        method: true,
        amount: true,
        provider: true,
        providerRef: true,
        qrImage: true,
        qrString: true,
        paymentUrl: true,
        paidAt: true,
        expiresAt: true,
      },
    });

    return successResponse(
      toReservationPaymentDto({ reservation, order, payment })
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching reservation payment:", error);
    return errorResponse(
      "Gagal memuat pembayaran reservasi",
      "INTERNAL_ERROR",
      500
    );
  }
}
