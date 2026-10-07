import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { reservationService } from "./reservation.service";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { addDaysToDateOnly, type ReservationNow } from "./reservation.slots";
import {
  cleanupPurchases,
  seedReservationProduct,
  type ReservationProductFixture,
} from "./reservation.purchase.fixtures";

// ============================================================
// RESERVATION PURCHASE FLOW — reservation = booking + order + payment.
//
// The R6 rule ("the guest must already own a historical PAID order") is
// RETIRED. A public reservation now CARRIES its own purchase: `items` is
// REQUIRED, and the reservation, its Order (OrderItems) and its Payment are
// created as ONE atomic unit through the EXISTING order/payment engines.
//
// This suite proves the NEW contract end-to-end against the real local DB:
//   - a first-time guest (no history at all) can reserve AND buy in one flow;
//   - every price/total is recomputed server-side from the database;
//   - product / variant / addon / required-option / stock rules still apply;
//   - a reservation-originated order never flips `Table.status` to OCCUPIED;
//   - a failed reservation never leaves an orphan order behind;
//   - admin/kasir bookings stay purchase-free (unchanged);
//   - cancelling a reservation handles its UNPAID order but leaves a PAID one
//     to the existing refund/cancellation workflow.
//
// "now" is always injected (the engine's determinism contract).
//
// Run with: npx tsx --test --test-force-exit src/services/reservation/reservation.purchase.test.ts
// ============================================================

const NOW: ReservationNow = { today: "2026-09-15", nowMinutes: 9 * 60 };
const SLOT_18 = 18 * 60;
const SLOT_20 = 20 * 60;
const DUR = 120;

let restA = "";
let restB = "";
let branchA1 = "";
let branchA2 = "";
let branchB = "";
let tA = "";
let tConflict = "";

/** Plain product (no variants/addons) available at branchA1. */
let plain: ReservationProductFixture;
/** Product with a REQUIRED single-select group + an addon. */
let variant: ReservationProductFixture;
/** Available product whose branch stock is 0 → sold out. */
let soldOut: ReservationProductFixture;
/** Product with NO BranchProduct row for the branch → sold out. */
let notStocked: ReservationProductFixture;
/** Product owned by the OTHER tenant. */
let foreign: ReservationProductFixture;

let dateCounter = 0;
function nextDate(): string {
  dateCounter += 1;
  return addDaysToDateOnly(NOW.today, 2 + dateCounter);
}

let phoneCounter = 0;
function newPhone(): string {
  phoneCounter += 1;
  const n = String(30000000 + phoneCounter).slice(-8);
  return `0813${n}`;
}

/** Normalized canonical phone (matches what the Zod schema stores). */
function canon(raw: string): string {
  return normalizePhone(raw) as string;
}

function publicInput(overrides: Record<string, unknown> = {}) {
  return {
    branchCode: "QA-PUR-MAIN",
    reservationDate: nextDate(),
    startMinutes: SLOT_18,
    durationMinutes: DUR,
    partySize: 2,
    guestName: "Tes Beli",
    guestPhone: newPhone(),
    tableId: tA,
    items: [{ productId: plain.productId, quantity: 1 }],
    ...overrides,
  };
}

/** The reservation's linked Order row (scalar link — no Prisma relation). */
async function linkedOrder(reservationId: string) {
  const reservation = await prisma.reservation.findUniqueOrThrow({
    where: { id: reservationId },
    select: { orderId: true, guestPhone: true },
  });
  const order = reservation.orderId
    ? await prisma.order.findUnique({
        where: { id: reservation.orderId },
        include: {
          customer: true,
          items: { include: { product: true } },
          payments: true,
        },
      })
    : null;
  return { reservation, order };
}

before(async () => {
  const tag = `QAPUR${Date.now()}`;
  const ra = await prisma.restaurant.create({ data: { name: `${tag} A` } });
  const rb = await prisma.restaurant.create({ data: { name: `${tag} B` } });
  restA = ra.id;
  restB = rb.id;

  const b1 = await prisma.branch.create({
    data: { restaurantId: restA, code: "QA-PUR-MAIN", name: "Pur Main" },
  });
  const b2 = await prisma.branch.create({
    data: { restaurantId: restA, code: "QA-PUR-ALT", name: "Pur Alt" },
  });
  const b3 = await prisma.branch.create({
    data: { restaurantId: restB, code: "QA-PUR-B", name: "Pur B" },
  });
  branchA1 = b1.id;
  branchA2 = b2.id;
  branchB = b3.id;

  const ta = await prisma.table.create({
    data: {
      restaurantId: restA,
      branchId: branchA1,
      number: 7301,
      name: "PUR-A",
      capacity: 4,
      isActive: true,
      status: "AVAILABLE",
    },
  });
  const tc = await prisma.table.create({
    data: {
      restaurantId: restA,
      branchId: branchA1,
      number: 7302,
      name: "PUR-CONFLICT",
      capacity: 4,
      isActive: true,
      status: "AVAILABLE",
    },
  });
  tA = ta.id;
  tConflict = tc.id;

  plain = await seedReservationProduct(restA, {
    branchId: branchA1,
    branchIds: [branchA2],
    price: 25000,
    stock: 50,
  });
  variant = await seedReservationProduct(restA, {
    branchId: branchA1,
    price: 30000,
    stock: 50,
    requiredOption: { name: "Level", priceAdjustment: 5000 },
    addon: { name: "Extra", price: 7000 },
  });
  soldOut = await seedReservationProduct(restA, {
    branchId: branchA1,
    price: 12000,
    stock: 0,
  });
  notStocked = await seedReservationProduct(restA, { price: 9000 });
  foreign = await seedReservationProduct(restB, {
    branchId: branchB,
    price: 11000,
    stock: 50,
  });
});

after(async () => {
  await prisma.reservation.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
  await cleanupPurchases([restA, restB]);
  await prisma.table.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
  await prisma.customer.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
  await prisma.branch.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: [restA, restB] } },
  });
  await prisma.$disconnect();
});

describe("reservation = booking + order + payment (historical gate retired)", () => {
  it("1. a guest with NO purchase history can reserve AND buy in one flow", async () => {
    const input = publicInput();
    const res = await reservationService.createPublicReservation(restA, input, {
      now: NOW,
    });

    assert.equal(res.status, "PENDING");
    assert.match(res.code, /^R-[0-9A-Z]{8}$/);

    // The reservation carries its purchase in the response summary...
    assert.ok(res.order, "reservation view must carry its order summary");
    assert.equal(res.order?.status, "PENDING");
    assert.equal(res.order?.paymentStatus, "UNPAID");
    assert.equal(res.order?.orderType, "DINE_IN");
    assert.equal(res.order?.subtotal, 25000);
    assert.equal(res.order?.grandTotal, 25000);
    assert.equal(res.order?.items.length, 1);
    assert.equal(res.order?.items[0].quantity, 1);
    assert.equal(res.order?.items[0].unitPrice, 25000);

    // ...and in the database, linked through the existing scalar `orderId`.
    const { reservation, order } = await linkedOrder(res.id);
    assert.ok(reservation.orderId, "Reservation.orderId must be set");
    assert.ok(order, "linked order must exist");
    assert.equal(order.id, reservation.orderId);
    assert.equal(Number(order.subtotal), 25000);
    assert.equal(Number(order.grandTotal), 25000);
    assert.equal(Number(order.tax), 0);
    assert.equal(Number(order.serviceCharge), 0);
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].quantity, 1);
    assert.equal(Number(order.items[0].unitPrice), 25000);
    assert.equal(order.tableId, tA);
  });

  it("2. the follow-up phone is stored AND used as the order/customer phone", async () => {
    const raw = newPhone();
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({ guestPhone: raw }),
      { now: NOW }
    );

    const { reservation, order } = await linkedOrder(res.id);
    // ONE input: the follow-up number is the reservation's canonical phone...
    assert.equal(reservation.guestPhone, canon(raw));
    assert.equal(res.guestPhone, canon(raw));
    // ...and it doubles as the order/customer phone (no new field, no migration).
    assert.equal(order?.customer.phone, canon(raw));
    assert.equal(order?.customer.name, "Tes Beli");
  });

  it("3. prices/totals are recomputed server-side (client values are ignored)", async () => {
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({
        // Every one of these is untrusted and must be ignored/stripped.
        restaurantId: restB,
        branchId: branchA2,
        subtotal: 1,
        discount: 999999,
        tax: 5,
        serviceCharge: 5,
        grandTotal: 1,
        paymentStatus: "PAID",
        items: [
          {
            productId: plain.productId,
            quantity: 2,
            price: 1,
            unitPrice: 1,
            totalPrice: 1,
          },
        ],
      }),
      { now: NOW }
    );

    const { order } = await linkedOrder(res.id);
    assert.ok(order);
    assert.equal(Number(order.subtotal), 50000);
    assert.equal(Number(order.discount), 0);
    assert.equal(Number(order.tax), 0);
    assert.equal(Number(order.serviceCharge), 0);
    assert.equal(Number(order.grandTotal), 50000);
    assert.equal(order.paymentStatus, "UNPAID");
    assert.equal(order.restaurantId, restA);
    assert.equal(order.branchId, branchA1);
    assert.equal(order.items[0].quantity, 2);
    assert.equal(Number(order.items[0].unitPrice), 25000);
    assert.equal(Number(order.items[0].totalPrice), 50000);
  });

  it("4. variant + addon pricing comes from the DATABASE, not the client", async () => {
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({
        items: [
          {
            productId: variant.productId,
            quantity: 2,
            selections: [
              {
                groupId: variant.optionGroupId,
                groupName: "spoofed",
                optionId: variant.optionId,
                optionName: "spoofed",
                priceAdjustment: 999999,
              },
            ],
            addons: [
              {
                addonId: variant.addonId,
                name: "spoofed",
                price: 999999,
                quantity: 2,
              },
            ],
          },
        ],
      }),
      { now: NOW }
    );

    // 30000 base + 5000 option + (2 × 7000) addons = 49000 per unit.
    const { order } = await linkedOrder(res.id);
    assert.ok(order);
    assert.equal(Number(order.items[0].unitPrice), 49000);
    assert.equal(Number(order.items[0].totalPrice), 98000);
    assert.equal(Number(order.grandTotal), 98000);

    // The stored customization JSON reflects the DB names/prices.
    const rawCustomizations = order.items[0].customizations;
    const customizations = (
      typeof rawCustomizations === "string"
        ? JSON.parse(rawCustomizations)
        : rawCustomizations
    ) as Record<string, unknown>;
    const selections = customizations.selections as Array<{
      optionName: string;
      priceAdjustment: number;
    }>;
    const addons = customizations.addons as Array<{
      name: string;
      price: number;
    }>;
    assert.equal(selections[0].optionName, "Level A");
    assert.equal(selections[0].priceAdjustment, 5000);
    assert.equal(addons[0].name, "Extra");
    assert.equal(addons[0].price, 7000);
  });

  it("5. a missing REQUIRED option group → 400, nothing is created", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({
          items: [{ productId: variant.productId, quantity: 1 }],
        }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("6. an option that does not belong to the product → 400", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({
          items: [
            {
              productId: variant.productId,
              quantity: 1,
              selections: [
                {
                  groupId: "not-a-group",
                  groupName: "x",
                  optionId: "not-an-option",
                  optionName: "x",
                  priceAdjustment: 0,
                },
              ],
            },
          ],
        }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("7. a product with zero branch stock → 400 (sold out)", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({
          items: [{ productId: soldOut.productId, quantity: 1 }],
        }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("8. a product with no BranchProduct row at the branch → 400 (sold out)", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({
          items: [{ productId: notStocked.productId, quantity: 1 }],
        }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("9. quantity above branch stock → 400", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({
          items: [{ productId: plain.productId, quantity: 51 }],
        }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("10. a product owned by ANOTHER tenant → 400 (never trusted)", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({
          items: [{ productId: foreign.productId, quantity: 1 }],
        }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("11. items is REQUIRED — missing or empty → 400", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({ items: undefined }),
        { now: NOW }
      ),
      ValidationError
    );
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({ items: [] }),
        { now: NOW }
      ),
      ValidationError
    );
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({ items: [{ productId: plain.productId, quantity: 0 }] }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("12. a LOGGED-IN customer with no history is allowed and keeps the link", async () => {
    const customer = await prisma.customer.create({
      data: { restaurantId: restA, phone: canon(newPhone()), name: "No Buy" },
    });
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput(),
      { now: NOW, customerId: customer.id }
    );

    assert.equal(res.status, "PENDING");
    assert.equal(res.customerId, customer.id);
    assert.ok(res.order, "logged-in bookings also carry their purchase");
  });

  it("13. KASIR intent creates its UNPAID Payment atomically", async () => {
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({ paymentMethod: "KASIR" }),
      { now: NOW }
    );

    const { order } = await linkedOrder(res.id);
    assert.ok(order);
    assert.equal(order.paymentStatus, "UNPAID");
    assert.equal(order.payments.length, 1);
    assert.equal(order.payments[0].method, "KASIR");
    assert.equal(order.payments[0].status, "UNPAID");
    assert.equal(Number(order.payments[0].amount), Number(order.grandTotal));
    assert.equal(order.payments[0].restaurantId, restA);
    assert.equal(order.payments[0].branchId, branchA1);
    assert.equal(res.order?.paymentMethod, "KASIR");
  });

  it("14. QRIS intent leaves an UNPAID order with no gateway call yet", async () => {
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({ paymentMethod: "QRIS" }),
      { now: NOW }
    );

    const { order } = await linkedOrder(res.id);
    assert.ok(order);
    assert.equal(order.paymentStatus, "UNPAID");
    assert.equal(order.payments.length, 0);
    assert.equal(res.order?.paymentMethod, null);
  });

  it("15. a reservation-originated order NEVER flips Table.status to OCCUPIED", async () => {
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({ tableId: tConflict }),
      { now: NOW }
    );
    assert.ok(res.order);

    const table = await prisma.table.findUniqueOrThrow({
      where: { id: tConflict },
      select: { status: true },
    });
    assert.equal(table.status, "AVAILABLE");
  });

  it("16. a FAILED reservation leaves NO orphan order behind", async () => {
    const date = nextDate();
    const first = await reservationService.createPublicReservation(
      restA,
      publicInput({ tableId: tConflict, reservationDate: date }),
      { now: NOW }
    );
    assert.ok(first.order);

    const before = await prisma.order.count({ where: { restaurantId: restA } });

    // Same table/day/slot → the table gate rejects the booking; the order
    // created inside that transaction must roll back with it.
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        publicInput({ tableId: tConflict, reservationDate: date }),
        { now: NOW }
      ),
      (error: unknown) => {
        assert.ok(error instanceof ConflictError);
        assert.equal((error as ConflictError).code, "TABLE_NOT_AVAILABLE");
        return true;
      }
    );

    const afterCount = await prisma.order.count({
      where: { restaurantId: restA },
    });
    assert.equal(afterCount, before, "no orphan order may survive the rollback");
  });

  it("17. ADMIN reservations stay purchase-free (unchanged)", async () => {
    const res = await reservationService.createAdminReservation(
      restA,
      {
        branchId: branchA1,
        reservationDate: nextDate(),
        startMinutes: SLOT_20,
        durationMinutes: DUR,
        partySize: 2,
        guestName: "Walk-in",
        guestPhone: newPhone(),
        tableId: tA,
      },
      { now: NOW }
    );

    assert.equal(res.status, "PENDING");
    assert.equal(res.order, null);
    assert.equal(res.orderId, null);
  });

  it("18. cancelling an UNPAID reservation cancels its linked order (no orphan)", async () => {
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({ paymentMethod: "KASIR", tableId: tConflict }),
      { now: NOW }
    );
    const { order } = await linkedOrder(res.id);
    assert.equal(order?.status, "PENDING");
    assert.equal(order?.paymentStatus, "UNPAID");

    const cancelled = await reservationService.cancelReservation(
      res.id,
      restA,
      { cancelReason: "Tamu membatalkan" }
    );
    assert.equal(cancelled.status, "CANCELLED");

    const after = await linkedOrder(res.id);
    assert.equal(after.order?.status, "CANCELLED");
    const history = await prisma.orderStatusHistory.findMany({
      where: { orderId: after.order!.id, status: "CANCELLED" },
    });
    assert.equal(history.length, 1);
    assert.equal(history[0].notes, "Tamu membatalkan");
  });

  it("19. a PAID linked order is left to the EXISTING refund workflow", async () => {
    const res = await reservationService.createPublicReservation(
      restA,
      publicInput({ paymentMethod: "KASIR", tableId: tConflict }),
      { now: NOW }
    );
    const { order } = await linkedOrder(res.id);
    assert.ok(order);

    // Simulate the existing payment engine marking the order paid.
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: "PAID" },
    });
    await prisma.payment.updateMany({
      where: { orderId: order.id },
      data: { status: "PAID", paidAt: new Date() },
    });

    await reservationService.cancelReservation(res.id, restA);

    const after = await linkedOrder(res.id);
    assert.equal(
      after.order?.status,
      "PENDING",
      "a PAID order must not be auto-cancelled by the reservation"
    );
    assert.equal(after.order?.paymentStatus, "PAID");
  });

  it("20. tenant isolation — restB can buy its OWN product but never restA's", async () => {
    const tableB = await prisma.table.create({
      data: {
        restaurantId: restB,
        branchId: branchB,
        number: 7399,
        name: "PUR-B",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    });

    // restB cannot resolve restA's branch code at all.
    await assert.rejects(
      reservationService.createPublicReservation(
        restB,
        publicInput({ branchCode: "QA-PUR-MAIN", tableId: tableB.id }),
        { now: NOW }
      ),
      NotFoundError
    );

    // Even on its OWN branch, restB can never order restA's product.
    await assert.rejects(
      reservationService.createPublicReservation(
        restB,
        publicInput({
          branchCode: "QA-PUR-B",
          tableId: tableB.id,
          items: [{ productId: plain.productId, quantity: 1 }],
        }),
        { now: NOW }
      ),
      ValidationError
    );

    // ...but its own product works (control).
    const ok = await reservationService.createPublicReservation(
      restB,
      publicInput({
        branchCode: "QA-PUR-B",
        tableId: tableB.id,
        items: [{ productId: foreign.productId, quantity: 1 }],
      }),
      { now: NOW }
    );
    assert.ok(ok.order);
    assert.equal(ok.order?.grandTotal, 11000);
  });

  it("21. R5.1 regression — availability stays reservation-only", async () => {
    const avail = await reservationService.checkAvailability(
      restA,
      branchA1,
      {
        reservationDate: nextDate(),
        partySize: 2,
        startMinutes: SLOT_18,
        durationMinutes: DUR,
      }
    );
    const view = avail.tables.find((t) => t.tableId === tA);
    assert.ok(view);
    assert.equal(view?.available, true);
    assert.equal(view?.status, "AVAILABLE");
  });
});
