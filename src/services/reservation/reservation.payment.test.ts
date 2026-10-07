import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/phone";
import { reservationService } from "./reservation.service";
import { GET, POST } from "@/app/api/public/reservations/[code]/payment/route";

// ============================================================
// PHASE 2 — RESERVATION PAYMENT BACKEND (focused tests).
//
// Ownership model OPTION B: Reservation.orderId → Order.id → Payment.orderId.
// No schema change. Reservation payment state is DERIVED from
// Order.paymentStatus. These tests exercise the parts of the new backend that
// do NOT require the iPaymu gateway:
//   - reservationViews derives `payment` from Order.paymentStatus;
//   - confirmFromPaidOrderInTransaction (the webhook seam) is CAS + idempotent
//     and never resurrects a CANCELLED reservation;
//   - cancelling a reservation cancels a live PENDING payment but never a PAID
//     one;
//   - the public GET/POST routes enforce tenant + ownership + pre-gateway state
//     validation.
//
// Gateway-dependent behaviour (POST actually creating a QRIS through iPaymu,
// and the ordinary Order QRIS flow) is covered by the existing payment-engine
// tests and the Phase 5 E2E — see the Phase 2 report, "Known limitations".
//
// Run: npx tsx --test --test-force-exit src/services/reservation/reservation.payment.test.ts
// ============================================================

type RStatus = "PENDING" | "CONFIRMED" | "SEATED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
type OStatus = "PENDING" | "CONFIRMED" | "PROCESSING" | "READY" | "COMPLETED" | "CANCELLED";
type PStatus = "UNPAID" | "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUNDED" | "CANCELLED";

let restA = "";
let restB = "";
let branchA = "";
let seq = 0;

async function newCustomer(restaurantId: string, phone: string) {
  seq += 1;
  return prisma.customer.create({
    data: { restaurantId, name: `QA P2 ${seq}`, phone },
  });
}

interface SeedOptions {
  restaurantId: string;
  branchId: string;
  status?: RStatus;
  order?: null | {
    status?: OStatus;
    paymentStatus?: PStatus;
    grandTotal?: number;
    payment?: null | {
      status: PStatus;
      method?: string | null;
      amount?: number;
      provider?: string | null;
      providerRef?: string | null;
      qrString?: string | null;
      paidAt?: Date | null;
      expiresAt?: Date | null;
    };
  };
}

async function seedReservation(opts: SeedOptions) {
  seq += 1;
  const phone = `0812${String(70000000 + seq).slice(-8)}`;
  const code = `QP2-${seq}`;

  const reservation = await prisma.reservation.create({
    data: {
      restaurantId: opts.restaurantId,
      branchId: opts.branchId,
      code,
      guestName: "QA P2",
      guestPhone: normalizePhone(phone) as string,
      partySize: 2,
      reservationDate: new Date("2026-11-01"),
      startMinutes: 18 * 60,
      status: opts.status ?? "PENDING",
      source: "ADMIN",
    },
  });

  if (!opts.order) {
    return { reservationId: reservation.id, orderId: null, code, phone };
  }

  const customer = await newCustomer(opts.restaurantId, `0899${seq}${Date.now()}`);
  const grandTotal = opts.order.grandTotal ?? 50000;
  const order = await prisma.order.create({
    data: {
      restaurantId: opts.restaurantId,
      branchId: opts.branchId,
      orderNumber: `QP2-${seq}-${Date.now()}`,
      customerId: customer.id,
      status: opts.order.status ?? "PENDING",
      paymentStatus: opts.order.paymentStatus ?? "UNPAID",
      subtotal: grandTotal,
      grandTotal,
    },
  });
  await prisma.reservation.update({
    where: { id: reservation.id },
    data: { orderId: order.id },
  });

  if (opts.order.payment) {
    await prisma.payment.create({
      data: {
        restaurantId: opts.restaurantId,
        branchId: opts.branchId,
        orderId: order.id,
        status: opts.order.payment.status,
        amount: opts.order.payment.amount ?? grandTotal,
        method: opts.order.payment.method ?? "QRIS",
        provider: opts.order.payment.provider ?? "ipaymu",
        providerRef: opts.order.payment.providerRef ?? `REF-${seq}`,
        qrString: opts.order.payment.qrString ?? null,
        paidAt: opts.order.payment.paidAt ?? null,
        expiresAt: opts.order.payment.expiresAt ?? null,
      },
    });
  }

  return { reservationId: reservation.id, orderId: order.id, code, phone };
}

function baseUrl(code: string, restaurantId: string, phone: string) {
  const qs = new URLSearchParams({ restaurantId, phone }).toString();
  return `http://localhost/api/public/reservations/${code}/payment?${qs}`;
}

async function callGet(code: string, restaurantId: string, phone: string) {
  const request = new NextRequest(baseUrl(code, restaurantId, phone));
  const res = await GET(request, { params: Promise.resolve({ code }) });
  return { status: res.status, body: await res.json() };
}

async function callPost(
  code: string,
  body: Record<string, unknown>
) {
  const request = new NextRequest(
    `http://localhost/api/public/reservations/${code}/payment`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  const res = await POST(request, { params: Promise.resolve({ code }) });
  return { status: res.status, body: await res.json() };
}

before(async () => {
  const tag = `QAP2${Date.now()}`;
  const a = await prisma.restaurant.create({ data: { name: `${tag} A` } });
  const b = await prisma.restaurant.create({ data: { name: `${tag} B` } });
  restA = a.id;
  restB = b.id;
  const br = await prisma.branch.create({
    data: { restaurantId: restA, code: `QA-P2-${tag}`, name: "P2 Branch" },
  });
  branchA = br.id;
});

after(async () => {
  const ids = [restA, restB].filter(Boolean);
  await prisma.payment.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.order.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.reservation.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.customer.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.branch.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: ids } } });
});

// ------------------------------------------------------------
describe("reservationViews — payment state derived from Order.paymentStatus", () => {
  it("no payment intent → UNPAID, amount falls back to grand total", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: { paymentStatus: "UNPAID", grandTotal: 77000 },
    });
    const view = await reservationService.getReservationById(s.reservationId, restA);
    assert.ok(view.payment, "payment summary present");
    assert.equal(view.payment!.status, "UNPAID");
    assert.equal(view.payment!.amount, 77000);
    assert.equal(view.payment!.method, null);
  });

  it("PENDING QRIS → PENDING with method/amount/reference", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: {
        paymentStatus: "PENDING",
        grandTotal: 50000,
        payment: { status: "PENDING", method: "QRIS", amount: 50000, providerRef: "ORD-REF-1" },
      },
    });
    const view = await reservationService.getReservationById(s.reservationId, restA);
    assert.equal(view.payment!.status, "PENDING");
    assert.equal(view.payment!.method, "QRIS");
    assert.equal(view.payment!.amount, 50000);
    assert.equal(view.payment!.reference, "ORD-REF-1");
    assert.equal(view.payment!.provider, "ipaymu");
  });

  it("PAID → PAID with paidAt", async () => {
    const paidAt = new Date("2026-11-01T10:00:00.000Z");
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
        grandTotal: 30000,
        payment: { status: "PAID", method: "QRIS", amount: 30000, paidAt },
      },
    });
    const view = await reservationService.getReservationById(s.reservationId, restA);
    assert.equal(view.payment!.status, "PAID");
    assert.equal(view.payment!.paidAt?.toISOString(), paidAt.toISOString());
  });

  it("reservation without an order → payment summary null", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, order: null });
    const view = await reservationService.getReservationById(s.reservationId, restA);
    assert.equal(view.payment, null);
  });
});

// ------------------------------------------------------------
describe("confirmFromPaidOrderInTransaction — webhook seam (CAS + no resurrect)", () => {
  it("F: PENDING → CONFIRMED and returns the id (sets confirmedAt)", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, status: "PENDING", order: {} });
    const confirmedId = await prisma.$transaction((tx) =>
      reservationService.confirmFromPaidOrderInTransaction(tx, s.orderId!, restA)
    );
    assert.equal(confirmedId, s.reservationId);
    const fresh = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    assert.equal(fresh.status, "CONFIRMED");
    assert.ok(fresh.confirmedAt, "confirmedAt set");
  });

  it("G: duplicate confirm is a no-op (stays CONFIRMED, returns null)", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, status: "CONFIRMED", order: {} });
    const again = await prisma.$transaction((tx) =>
      reservationService.confirmFromPaidOrderInTransaction(tx, s.orderId!, restA)
    );
    assert.equal(again, null);
    const fresh = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    assert.equal(fresh.status, "CONFIRMED");
  });

  it("H: CANCELLED is never resurrected", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      status: "CANCELLED",
      order: { status: "CANCELLED" },
    });
    const id = await prisma.$transaction((tx) =>
      reservationService.confirmFromPaidOrderInTransaction(tx, s.orderId!, restA)
    );
    assert.equal(id, null);
    const fresh = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    assert.equal(fresh.status, "CANCELLED");
  });

  it("D-case: SEATED is left untouched", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, status: "SEATED", order: {} });
    const id = await prisma.$transaction((tx) =>
      reservationService.confirmFromPaidOrderInTransaction(tx, s.orderId!, restA)
    );
    assert.equal(id, null);
    const fresh = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    assert.equal(fresh.status, "SEATED");
  });

  it("cross-restaurant order resolves nothing", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, status: "PENDING", order: {} });
    const id = await prisma.$transaction((tx) =>
      reservationService.confirmFromPaidOrderInTransaction(tx, s.orderId!, restB)
    );
    assert.equal(id, null);
    const fresh = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    assert.equal(fresh.status, "PENDING");
  });

  it("ordinary order (no reservation) resolves nothing", async () => {
    const customer = await newCustomer(restA, `0877${Date.now()}${seq}`);
    const order = await prisma.order.create({
      data: {
        restaurantId: restA,
        branchId: branchA,
        orderNumber: `QP2-ORD-${Date.now()}`,
        customerId: customer.id,
        subtotal: 10000,
        grandTotal: 10000,
      },
    });
    const id = await prisma.$transaction((tx) =>
      reservationService.confirmFromPaidOrderInTransaction(tx, order.id, restA)
    );
    assert.equal(id, null);
  });
});

// ------------------------------------------------------------
describe("reservation cancellation vs live payment", () => {
  it("I: cancel with a PENDING payment cancels the payment (order stays safe)", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      status: "CONFIRMED",
      order: { paymentStatus: "PENDING", payment: { status: "PENDING", method: "QRIS" } },
    });
    await reservationService.cancelReservation(s.reservationId, restA, { cancelReason: "qa" });

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: s.orderId! } });
    assert.equal(payment.status, "CANCELLED");
    const fresh = await prisma.reservation.findUniqueOrThrow({ where: { id: s.reservationId } });
    assert.equal(fresh.status, "CANCELLED");
  });

  it("J: cancel with a PAID payment leaves the payment PAID", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      status: "CONFIRMED",
      order: {
        status: "CONFIRMED",
        paymentStatus: "PAID",
        payment: { status: "PAID", method: "QRIS", paidAt: new Date() },
      },
    });
    await reservationService.cancelReservation(s.reservationId, restA, { cancelReason: "qa" });

    const payment = await prisma.payment.findFirstOrThrow({ where: { orderId: s.orderId! } });
    assert.equal(payment.status, "PAID");
    const order = await prisma.order.findUniqueOrThrow({ where: { id: s.orderId! } });
    assert.equal(order.paymentStatus, "PAID");
    assert.equal(order.status, "CONFIRMED"); // PAID order left to the refund workflow
  });
});

// ------------------------------------------------------------
describe("GET /api/public/reservations/[code]/payment (read-only)", () => {
  it("C: before any payment → UNPAID / payment null", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: { paymentStatus: "UNPAID", grandTotal: 42000 },
    });
    const { status, body } = await callGet(s.code, restA, s.phone);
    assert.equal(status, 200);
    assert.equal(body.data.paymentStatus, "UNPAID");
    assert.equal(body.data.payment, null);
    assert.equal(body.data.grandTotal, 42000);
  });

  it("D: pending → PENDING with QR data", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: {
        paymentStatus: "PENDING",
        payment: { status: "PENDING", qrString: "QR-PAYLOAD", expiresAt: new Date(Date.now() + 3600_000) },
      },
    });
    const { status, body } = await callGet(s.code, restA, s.phone);
    assert.equal(status, 200);
    assert.equal(body.data.payment.status, "PENDING");
    assert.equal(body.data.payment.qrString, "QR-PAYLOAD");
    assert.ok(body.data.payment.expiresAt);
  });

  it("E: paid → PAID with paidAt", async () => {
    const paidAt = new Date();
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: { paymentStatus: "PAID", payment: { status: "PAID", paidAt } },
    });
    const { status, body } = await callGet(s.code, restA, s.phone);
    assert.equal(status, 200);
    assert.equal(body.data.paymentStatus, "PAID");
    assert.equal(body.data.payment.status, "PAID");
    assert.ok(body.data.payment.paidAt);
  });

  it("K: cross-restaurant access is rejected (404)", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, order: {} });
    const { status } = await callGet(s.code, restB, s.phone);
    assert.equal(status, 404);
  });

  it("wrong owner phone is rejected (404)", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, order: {} });
    const { status } = await callGet(s.code, restA, "081200000000");
    assert.equal(status, 404);
  });
});

// ------------------------------------------------------------
describe("POST /api/public/reservations/[code]/payment (pre-gateway validation)", () => {
  it("cancelled reservation → 409", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      status: "CANCELLED",
      order: { status: "CANCELLED" },
    });
    const { status } = await callPost(s.code, { restaurantId: restA, phone: s.phone });
    assert.equal(status, 409);
  });

  it("reservation without an order → 409", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, order: null });
    const { status } = await callPost(s.code, { restaurantId: restA, phone: s.phone });
    assert.equal(status, 409);
  });

  it("already-paid order → 409", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: { paymentStatus: "PAID", payment: { status: "PAID" } },
    });
    const { status } = await callPost(s.code, { restaurantId: restA, phone: s.phone });
    assert.equal(status, 409);
  });

  it("cancelled order → 409", async () => {
    const s = await seedReservation({
      restaurantId: restA,
      branchId: branchA,
      order: { status: "CANCELLED", paymentStatus: "UNPAID" },
    });
    const { status } = await callPost(s.code, { restaurantId: restA, phone: s.phone });
    assert.equal(status, 409);
  });

  it("cross-restaurant access is rejected (404)", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, order: {} });
    const { status } = await callPost(s.code, { restaurantId: restB, phone: s.phone });
    assert.equal(status, 404);
  });

  it("non-QRIS method is rejected (400)", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, order: {} });
    const { status } = await callPost(s.code, { restaurantId: restA, phone: s.phone, method: "KASIR" });
    assert.equal(status, 400);
  });

  it("M: client-forged restaurantId cannot reach another tenant (404)", async () => {
    const s = await seedReservation({ restaurantId: restA, branchId: branchA, order: {} });
    const { status } = await callPost(s.code, { restaurantId: restB });
    assert.equal(status, 404);
  });
});
