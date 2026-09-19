import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { reservationService } from "./reservation.service";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
} from "@/lib/errors";
import { addDaysToDateOnly, type ReservationNow } from "./reservation.slots";

// ============================================================
// PHASE R6 — CUSTOMER RESERVATION SERVICE TESTS (real local DB)
//
// Focused security coverage for the session-scoped customer reads and the
// self-cancel path (list / detail / cancel customer methods). Ownership and
// tenant isolation are verified end-to-end against isolated fixtures; "now"
// is ALWAYS injected (the engine's determinism contract).
//
// Run with: npx tsx --test src/services/reservation/reservation.customer.test.ts
// ============================================================

const NOW: ReservationNow = { today: "2026-09-15", nowMinutes: 9 * 60 };
const FUTURE_DATE = addDaysToDateOnly(NOW.today, 2); // 2026-09-17
const SLOT_18 = 18 * 60;
const SLOT_19 = 19 * 60;
const SLOT_20 = 20 * 60;

let restA = "";
let restB = "";
let branchA = "";
let branchB = "";
let tA1 = "";
let tA2 = "";
let tA3 = "";
let tA4 = "";
let tB1 = "";

let customerA = "";
let customerB = "";
let customerForeign = "";
let customerInactive = "";

let phoneCounter = 1;
function incrementingPhone(): string {
  // 0811 20000xxx — a dedicated range that cannot collide with the 0812 block
  // used by the other reservation suites.
  const n = String(20000000 + phoneCounter).slice(-8);
  phoneCounter += 1;
  return `0811${n}`;
}

// Each booking gets its own date: the duplicate-booking key is
// (branch, date, start, customerId), so sharing a date/slot would collide.
const bookingDates: string[] = [];
function uniqueBookingDate(): string {
  const d = addDaysToDateOnly(FUTURE_DATE, bookingDates.length);
  bookingDates.push(d);
  return d;
}

interface LinkOpts {
  customerId?: string | null;
  tableId?: string | null;
  startMinutes?: number;
  guestName?: string;
  reservationDate?: string;
}

async function futureBooking(
  restaurantId: string,
  branchCode: string,
  opts: LinkOpts = {}
) {
  return reservationService.createPublicReservation(
    restaurantId,
    {
      branchCode,
      reservationDate: opts.reservationDate ?? uniqueBookingDate(),
      startMinutes: opts.startMinutes ?? SLOT_18,
      durationMinutes: 90,
      partySize: 2,
      guestName: opts.guestName ?? "Tamu R6",
      guestPhone: incrementingPhone(),
      tableId: opts.tableId ?? null,
    },
    { now: NOW, customerId: opts.customerId ?? null }
  );
}

async function transitionTo(
  id: string,
  restaurantId: string,
  status: "CONFIRMED" | "SEATED" | "COMPLETED" | "NO_SHOW"
) {
  await reservationService.updateStatus(id, restaurantId, { status });
}

before(async () => {
  const rA = await prisma.restaurant.create({
    data: { name: `QA R6 Customer A ${Date.now()}` },
  });
  const rB = await prisma.restaurant.create({
    data: { name: `QA R6 Customer B ${Date.now()}` },
  });
  restA = rA.id;
  restB = rB.id;

  const bA = await prisma.branch.create({
    data: { restaurantId: restA, code: "R6-MAIN", name: "R6 Main" },
  });
  const bB = await prisma.branch.create({
    data: { restaurantId: restB, code: "R6-ALT", name: "R6 Alt" },
  });
  branchA = bA.id;
  branchB = bB.id;

  async function table(
    restaurantId: string,
    branchId: string,
    number: number
  ) {
    return (
      await prisma.table.create({
        data: {
          restaurantId,
          branchId,
          number,
          name: `R6-${number}`,
          capacity: 4,
          isActive: true,
          status: "AVAILABLE",
        },
      })
    ).id;
  }

  tA1 = await table(restA, branchA, 9301);
  tA2 = await table(restA, branchA, 9302);
  tA3 = await table(restA, branchA, 9303);
  tA4 = await table(restA, branchA, 9304);
  tB1 = await table(restB, branchB, 9351);

  const cA = await prisma.customer.create({
    data: {
      restaurantId: restA,
      name: "Customer A R6",
      email: `r6-a-${Date.now()}@test.local`,
      phone: incrementingPhone(),
    },
  });
  const cB = await prisma.customer.create({
    data: {
      restaurantId: restA,
      name: "Customer B R6",
      email: `r6-b-${Date.now()}@test.local`,
      phone: incrementingPhone(),
    },
  });
  const cF = await prisma.customer.create({
    data: {
      restaurantId: restB,
      name: "Customer Foreign R6",
      email: `r6-f-${Date.now()}@test.local`,
      phone: incrementingPhone(),
    },
  });
  const cZ = await prisma.customer.create({
    data: {
      restaurantId: restA,
      name: "Customer Inactive R6",
      email: `r6-z-${Date.now()}@test.local`,
      phone: incrementingPhone(),
      isActive: false,
    },
  });
  customerA = cA.id;
  customerB = cB.id;
  customerForeign = cF.id;
  customerInactive = cZ.id;
});

after(async () => {
  await prisma.reservation.deleteMany({
    where: { restaurantId: { in: [restA, restB] } },
  });
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

describe("reservationService.customer — scoped reads (list/detail)", () => {
  let own1Code = "";
  let own2Code = "";
  let otherCode = "";
  let foreignCode = "";

  let createdA1 = 0;
  let createdA2 = 0;
  let createdB1 = 0;
  let createdF1 = 0;

  before(async () => {
    const [a1, a2, b1, f1] = await Promise.all([
      futureBooking(restA, "R6-MAIN", {
        customerId: customerA,
        tableId: tA1,
        startMinutes: SLOT_18,
        guestName: "A1",
      }),
      futureBooking(restA, "R6-MAIN", {
        customerId: customerA,
        tableId: tA1,
        startMinutes: SLOT_20,
        guestName: "A2",
      }),
      futureBooking(restA, "R6-MAIN", {
        customerId: customerB,
        tableId: tA2,
        startMinutes: SLOT_18,
        guestName: "B1",
      }),
      futureBooking(restB, "R6-ALT", {
        customerId: customerForeign,
        tableId: tB1,
        startMinutes: SLOT_18,
        guestName: "F1",
      }),
    ]);
    own1Code = a1.code;
    own2Code = a2.code;
    otherCode = b1.code;
    foreignCode = f1.code;
    createdA1 = 1;
    createdA2 = 1;
    createdB1 = 1;
    createdF1 = 1;
  });

  it("1. customer sees ONLY their own reservations in the list", async () => {
    assert.equal(createdA1, 1);
    assert.equal(createdA2, 1);
    assert.equal(createdB1, 1);
    assert.equal(createdF1, 1);

    const listA = await reservationService.listCustomerReservations(
      customerA,
      restA,
      { page: 1, limit: 10 }
    );
    const codesA = listA.items.map((r) => r.code);
    assert.ok(codesA.includes(own1Code));
    assert.ok(codesA.includes(own2Code));
    assert.ok(!codesA.includes(otherCode));
    assert.ok(!codesA.includes(foreignCode));
    assert.equal(listA.items.length, 2);
  });

  it("2. another customer does not appear in the list", async () => {
    const listB = await reservationService.listCustomerReservations(
      customerB,
      restA,
      { page: 1, limit: 10 }
    );
    const codesB = listB.items.map((r) => r.code);
    assert.ok(codesB.includes(otherCode));
    assert.ok(!codesB.includes(own1Code));
    assert.equal(listB.items.length, 1);
  });

  it("3. cross-restaurant rows never leak into the list", async () => {
    const listForeign = await reservationService.listCustomerReservations(
      customerForeign,
      restB,
      { page: 1, limit: 10 }
    );
    assert.deepEqual(
      listForeign.items.map((r) => r.code),
      [foreignCode]
    );
  });

  it("4. detail returns the customer's OWN reservation by code", async () => {
    const view = await reservationService.getCustomerReservation(
      customerA,
      restA,
      own1Code
    );
    assert.equal(view.code, own1Code);
    assert.equal(view.guestName, "A1");
    assert.equal(view.customerId, customerA);
  });

  it("5. detail is NotFound for ANOTHER customer's code", async () => {
    await assert.rejects(
      reservationService.getCustomerReservation(customerA, restA, otherCode),
      NotFoundError
    );
  });

  it("6. detail is NotFound for a code in ANOTHER restaurant", async () => {
    await assert.rejects(
      reservationService.getCustomerReservation(customerA, restA, foreignCode),
      NotFoundError
    );
  });

  it("7. a mismatched session tenant is Unauthorized", async () => {
    await assert.rejects(
      reservationService.listCustomerReservations(customerForeign, restA),
      UnauthorizedError
    );
  });

  it("8. an inactive customer is Unauthorized for reads and cancel", async () => {
    await assert.rejects(
      reservationService.listCustomerReservations(customerInactive, restA),
      UnauthorizedError
    );
    await assert.rejects(
      reservationService.getCustomerReservation(
        customerInactive,
        restA,
        own1Code
      ),
      UnauthorizedError
    );
    await assert.rejects(
      reservationService.cancelCustomerReservation(
        customerInactive,
        restA,
        own1Code
      ),
      UnauthorizedError
    );
  });
});

describe("reservationService.customer — self-cancel", () => {
  async function buildInState(
    target:
      | "PENDING"
      | "CONFIRMED"
      | "SEATED"
      | "COMPLETED"
      | "NO_SHOW"
      | "CANCELLED"
  ) {
    // uniqueBookingDate() guarantees no duplicate key with other bookings.
    const created = await futureBooking(restA, "R6-MAIN", {
      customerId: customerA,
      tableId: tA3,
      startMinutes: SLOT_18,
    });

    if (target === "CONFIRMED") {
      await transitionTo(created.id, restA, "CONFIRMED");
    } else if (target === "SEATED") {
      await transitionTo(created.id, restA, "CONFIRMED");
      await transitionTo(created.id, restA, "SEATED");
    } else if (target === "COMPLETED") {
      await transitionTo(created.id, restA, "CONFIRMED");
      await transitionTo(created.id, restA, "SEATED");
      await transitionTo(created.id, restA, "COMPLETED");
    } else if (target === "NO_SHOW") {
      await transitionTo(created.id, restA, "CONFIRMED");
      await transitionTo(created.id, restA, "NO_SHOW");
    } else if (target === "CANCELLED") {
      await reservationService.cancelCustomerReservation(
        customerA,
        restA,
        created.code,
        { cancelReason: "uji awal" }
      );
    }
    return created;
  }

  it("9. cancels a PENDING reservation", async () => {
    const booking = await buildInState("PENDING");
    const view = await reservationService.cancelCustomerReservation(
      customerA,
      restA,
      booking.code,
      { cancelReason: "Kepadatan" }
    );
    assert.equal(view.status, "CANCELLED");
    assert.equal(view.cancelReason, "Kepadatan");
    assert.ok(view.cancelledAt);
  });

  it("10. cancels a CONFIRMED reservation", async () => {
    const booking = await buildInState("CONFIRMED");
    const view = await reservationService.cancelCustomerReservation(
      customerA,
      restA,
      booking.code,
      { cancelReason: "Jadwal berubah" }
    );
    assert.equal(view.status, "CANCELLED");
    assert.equal(view.cancelReason, "Jadwal berubah");
  });

  it("11. cannot cancel a SEATED reservation", async () => {
    const booking = await buildInState("SEATED");
    await assert.rejects(
      reservationService.cancelCustomerReservation(customerA, restA, booking.code),
      ConflictError
    );
  });

  it("12. cannot cancel a COMPLETED reservation", async () => {
    const booking = await buildInState("COMPLETED");
    await assert.rejects(
      reservationService.cancelCustomerReservation(customerA, restA, booking.code),
      ConflictError
    );
  });

  it("13. cannot cancel a CANCELLED reservation", async () => {
    const booking = await buildInState("CANCELLED");
    await assert.rejects(
      reservationService.cancelCustomerReservation(customerA, restA, booking.code),
      ConflictError
    );
  });

  it("14. cannot cancel a NO_SHOW reservation", async () => {
    const booking = await buildInState("NO_SHOW");
    await assert.rejects(
      reservationService.cancelCustomerReservation(customerA, restA, booking.code),
      ConflictError
    );
  });

  it("15. rejects a CROSS-CUSTOMER cancellation (NotFound)", async () => {
    const others = await futureBooking(restA, "R6-MAIN", {
      customerId: customerB,
      tableId: tA4,
      startMinutes: SLOT_18,
    });
    await assert.rejects(
      reservationService.cancelCustomerReservation(
        customerA,
        restA,
        others.code
      ),
      NotFoundError
    );
  });

  it("16. rejects a CROSS-RESTAURANT cancellation (NotFound)", async () => {
    const foreign = await futureBooking(restB, "R6-ALT", {
      customerId: customerForeign,
      tableId: tB1,
      startMinutes: SLOT_19,
    });
    await assert.rejects(
      reservationService.cancelCustomerReservation(
        customerA,
        restA,
        foreign.code
      ),
      NotFoundError
    );
    // ...while the SAME code remains cancellable by its real owner in restB.
    const view = await reservationService.cancelCustomerReservation(
      customerForeign,
      restB,
      foreign.code
    );
    assert.equal(view.status, "CANCELLED");
  });

  it("17. a duplicate cancellation is handled safely (ConflictError)", async () => {
    const booking = await buildInState("PENDING");
    const first = await reservationService.cancelCustomerReservation(
      customerA,
      restA,
      booking.code
    );
    assert.equal(first.status, "CANCELLED");
    await assert.rejects(
      reservationService.cancelCustomerReservation(customerA, restA, booking.code),
      ConflictError
    );
  });
});