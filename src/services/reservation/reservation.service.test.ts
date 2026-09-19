import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { reservationService } from "./reservation.service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  RESERVATION_SLOT_START_MINUTES,
  addDaysToDateOnly,
  holdsCapacity,
  type ReservationNow,
} from "./reservation.slots";

// ============================================================
// PHASE R2 — RESERVATION SERVICE INTEGRATION TESTS
//
// These run against the REAL local database (the same one the R1 migration
// was applied to) with fully isolated fixtures: every test creates its own
// restaurant/branch/tables and cleans up afterwards. "Now" is ALWAYS
// injected (the engine's determinism contract) — nothing here reads the
// system clock.
//
// Run with: npx tsx --test src/services/reservation/reservation.service.test.ts
// ============================================================

const NOW: ReservationNow = { today: "2026-09-15", nowMinutes: 9 * 60 };
const FUTURE_DATE = addDaysToDateOnly(NOW.today, 2); // 2026-09-17
const SLOT_18 = 18 * 60; // 18:00
const SLOT_19 = 19 * 60; // 19:00
const SLOT_20 = 20 * 60; // 20:00 (last on-grid 120-min start)
const DUR_120 = 120; // 18:00–20:00 / 19:00–21:00

let restAId = "";
let restBId = "";
let branchMain = "";
let branchAlt = "";
let branchList = "";
let branchR2 = "";

// B1 tables
let tMain = ""; // cap 4 — general create
let tCapacity = ""; // cap 6 — exact capacity example (4+2 ok, +3 rejected)
let tOverlap = ""; // cap 4 — overlap reject + control
let tPending = ""; // cap 4 — PENDING holds
let tConfirm = ""; // cap 4 — CONFIRMED holds
let tCancelBlock = ""; // cap 4 — CANCELLED releases
let tNoShow = ""; // cap 4 — NO_SHOW releases
let tDupA = ""; // cap 4 — duplicate guards (guest)
let tDupB = ""; // cap 4 — duplicate guards (guest, second table)
let tDupCap = ""; // cap 8 — concurrency duplicate race
let tConc = ""; // cap 4 — concurrency capacity race
let tState = ""; // cap 4 — status transitions / cancel
let tOccupied = ""; // cap 4 — status OCCUPIED but bookable
// special tables
let tInactive = ""; // isActive=false
let tLegacy = ""; // branchId=NULL (legacy)
let tOtherBranch = ""; // on B2
let tR2 = ""; // on R2
// B_LIST tables
let tList = ""; // cap 6

// Produces valid 12-digit local numbers (normalized → 628129000001) that
// never collide with the explicit `08120000XXXX` block used elsewhere.
function incrementingPhone(): string {
  const n = String(90000000 + reserveCounter).slice(-8);
  reserveCounter += 1;
  return `0812${n}`;
}
let reserveCounter = 1;

interface PublicOverrides {
  branchCode?: string;
  branchId?: string;
  reservationDate?: string;
  startMinutes?: number;
  durationMinutes?: number;
  partySize?: number;
  tableId?: string | null;
  guestName?: string;
  guestPhone?: string;
  notes?: string | null;
}

function publicInput(overrides: PublicOverrides = {}) {
  return {
    branchCode: "QA-MAIN",
    reservationDate: FUTURE_DATE,
    startMinutes: SLOT_18,
    durationMinutes: DUR_120,
    partySize: 2,
    guestName: "Tes Publik",
    guestPhone: incrementingPhone(),
    tableId: null as string | null,
    ...overrides,
  };
}

function adminInput(overrides: PublicOverrides = {}) {
  return {
    branchId: branchMain,
    reservationDate: FUTURE_DATE,
    startMinutes: SLOT_18,
    durationMinutes: DUR_120,
    partySize: 2,
    guestName: "Tes Admin",
    guestPhone: incrementingPhone(),
    tableId: null as string | null,
    ...overrides,
  };
}

async function table(number: number, cap: number, overrides: Record<string, unknown> = {}) {
  return prisma.table.create({
    data: {
      restaurantId: restAId,
      branchId: branchMain,
      number,
      name: `QA-${number}`,
      capacity: cap,
      isActive: true,
      status: "AVAILABLE",
      ...overrides,
    },
  });
}

before(async () => {
  const restA = await prisma.restaurant.create({
    data: { name: `QA Reservation A ${Date.now()}` },
  });
  const restB = await prisma.restaurant.create({
    data: { name: `QA Reservation B ${Date.now()}` },
  });
  restAId = restA.id;
  restBId = restB.id;

  const b1 = await prisma.branch.create({
    data: { restaurantId: restAId, code: "QA-MAIN", name: "QA Main" },
  });
  const b2 = await prisma.branch.create({
    data: { restaurantId: restAId, code: "QA-ALT", name: "QA Alt" },
  });
  const bl = await prisma.branch.create({
    data: { restaurantId: restAId, code: "QA-LIST", name: "QA List" },
  });
  const br2 = await prisma.branch.create({
    data: { restaurantId: restBId, code: "QA-R2", name: "QA R2" },
  });
  branchMain = b1.id;
  branchAlt = b2.id;
  branchList = bl.id;
  branchR2 = br2.id;

  tMain = (await table(9201, 4)).id;
  tCapacity = (await table(9202, 6)).id;
  tOverlap = (await table(9203, 4)).id;
  tPending = (await table(9204, 4)).id;
  tConfirm = (await table(9205, 4)).id;
  tCancelBlock = (await table(9206, 4)).id;
  tNoShow = (await table(9207, 4)).id;
  tDupA = (await table(9208, 4)).id;
  tDupB = (await table(9209, 4)).id;
  tDupCap = (await table(9210, 8)).id;
  tConc = (await table(9211, 4)).id;
  tState = (await table(9212, 4)).id;
  tOccupied = (
    await table(9213, 4, { status: "OCCUPIED", name: "QA-OCCUPIED" })
  ).id;
  tInactive = (await table(9214, 4, { isActive: false })).id;
  tLegacy = (
    await prisma.table.create({
      data: {
        restaurantId: restAId,
        branchId: null,
        number: 9215,
        name: "QA-LEGACY",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    })
  ).id;
  tOtherBranch = (
    await prisma.table.create({
      data: {
        restaurantId: restAId,
        branchId: b2.id,
        number: 9216,
        name: "QA-OTHER",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    })
  ).id;
  tR2 = (
    await prisma.table.create({
      data: {
        restaurantId: restBId,
        branchId: br2.id,
        number: 9217,
        name: "QA-R2",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    })
  ).id;
  tList = (
    await prisma.table.create({
      data: {
        restaurantId: restAId,
        branchId: bl.id,
        number: 9218,
        name: "QA-LIST",
        capacity: 6,
        isActive: true,
        status: "AVAILABLE",
      },
    })
  ).id;
});

after(async () => {
  await prisma.reservation.deleteMany({
    where: { restaurantId: { in: [restAId, restBId] } },
  });
  await prisma.table.deleteMany({
    where: { restaurantId: { in: [restAId, restBId] } },
  });
  await prisma.customer.deleteMany({
    where: { restaurantId: { in: [restAId, restBId] } },
  });
  await prisma.branch.deleteMany({
    where: { restaurantId: { in: [restAId, restBId] } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: [restAId, restBId] } },
  });
  await prisma.$disconnect();
});

describe("reservation.service — create", () => {
  it("1. creates a valid reservation (PENDING, non-sequential code, holds slot)", async () => {
    const res = await reservationService.createPublicReservation(
      restAId,
      publicInput({
        tableId: tMain,
        guestName: "R1 Create",
        guestPhone: "081234567890",
      }),
      { now: NOW }
    );

    assert.equal(res.status, "PENDING");
    assert.match(res.code, /^R-[0-9A-Z]{8}$/);
    assert.notEqual(res.code, "R-00000001");
    assert.equal(res.reservationDate, FUTURE_DATE);
    assert.equal(res.startMinutes, SLOT_18);
    assert.equal(res.durationMinutes, DUR_120);
    assert.equal(res.partySize, 2);
    assert.equal(res.source, "PUBLIC");
    assert.equal(res.guestName, "R1 Create");
    assert.equal(res.guestPhone, "6281234567890");
    assert.equal(res.branch?.code, "QA-MAIN");
    assert.equal(res.table?.number, 9201);
    assert.equal(holdsCapacity(res.status), true);
  });

  it("2. rejects a reservation with a branch from a different restaurant", async () => {
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({ branchId: branchR2 }),
        { now: NOW }
      ),
      NotFoundError
    );
  });

  it("2b. rejects a table from a different restaurant", async () => {
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({ branchId: branchMain, tableId: tR2 }),
        { now: NOW }
      ),
      NotFoundError
    );
  });

  it("3. rejects a table that belongs to another branch", async () => {
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({ branchId: branchMain, tableId: tOtherBranch }),
        { now: NOW }
      ),
      ForbiddenError
    );
  });

  it("4. rejects an inactive table", async () => {
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({ branchId: branchMain, tableId: tInactive }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("5. rejects a legacy table with branchId NULL", async () => {
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({ branchId: branchMain, tableId: tLegacy }),
        { now: NOW }
      ),
      ForbiddenError
    );
  });

  it("6. rejects a party larger than the table capacity", async () => {
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({ branchId: branchMain, tableId: tMain, partySize: 5 }),
        { now: NOW }
      ),
      ConflictError
    );
  });

  it("7. capacity: overlapping reservations are summed (4+2 ok, +3 rejected on cap 6)", async () => {
    const first = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tCapacity,
        startMinutes: SLOT_18,
        partySize: 4,
      }),
      { now: NOW }
    );
    assert.equal(first.status, "PENDING");

    // 18:00–20:00 (4) + 19:00–21:00 (2) = 6 → fits exactly.
    const second = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tCapacity,
        startMinutes: SLOT_19,
        partySize: 2,
      }),
      { now: NOW }
    );
    assert.equal(second.status, "PENDING");

    // 18:00–20:00 (4) + 19:00–21:00 (3) = 7 → rejected.
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({
          branchId: branchMain,
          tableId: tCapacity,
          startMinutes: SLOT_19,
          partySize: 3,
        }),
        { now: NOW }
      ),
      ConflictError
    );
  });

  it("7b. overlapping reservation on a shared interval is rejected on cap 4", async () => {
    await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tOverlap,
        startMinutes: SLOT_18,
        partySize: 3,
      }),
      { now: NOW }
    );

    // 3 (18:00–20:00) + 2 (19:00–21:00) = 5 > 4 → reject.
    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({
          branchId: branchMain,
          tableId: tOverlap,
          startMinutes: SLOT_19,
          partySize: 2,
        }),
        { now: NOW }
      ),
      ConflictError
    );

    // 3 + 1 = 4 → allowed (control).
    const ok = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tOverlap,
        startMinutes: SLOT_19,
        partySize: 1,
      }),
      { now: NOW }
    );
    assert.equal(ok.status, "PENDING");
  });
});

describe("reservation.service — statuses that hold/release the slot", () => {
  it("8. CANCELLED does not block a later booking for the same slot", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tCancelBlock,
        startMinutes: SLOT_18,
        partySize: 4,
        guestPhone: "081200000001",
      }),
      { now: NOW }
    );
    await reservationService.cancelReservation(res.id, restAId);

    const again = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tCancelBlock,
        startMinutes: SLOT_18,
        partySize: 4,
        guestPhone: "081200000002",
      }),
      { now: NOW }
    );
    assert.equal(again.status, "PENDING");
  });

  it("9. NO_SHOW does not block a later booking for the same slot", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tNoShow,
        startMinutes: SLOT_18,
        partySize: 4,
        guestPhone: "081200000003",
      }),
      { now: NOW }
    );
    // PENDING → CONFIRMED → NO_SHOW.
    await reservationService.updateStatus(res.id, restAId, { status: "CONFIRMED" });
    await reservationService.updateStatus(res.id, restAId, { status: "NO_SHOW" });
    const view = await reservationService.getReservationById(res.id, restAId);
    assert.equal(view.status, "NO_SHOW");

    const again = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tNoShow,
        startMinutes: SLOT_18,
        partySize: 4,
        guestPhone: "081200000004",
      }),
      { now: NOW }
    );
    assert.equal(again.status, "PENDING");
  });

  it("10. PENDING holds the slot (new booking for the same slot is rejected)", async () => {
    await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tPending,
        startMinutes: SLOT_18,
        partySize: 4,
        guestPhone: "081200000005",
      }),
      { now: NOW }
    );

    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({
          branchId: branchMain,
          tableId: tPending,
          startMinutes: SLOT_18,
          partySize: 1,
          guestPhone: "081200000006",
        }),
        { now: NOW }
      ),
      ConflictError
    );
  });

  it("11. CONFIRMED holds the slot (new booking for the same slot is rejected)", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tConfirm,
        startMinutes: SLOT_18,
        partySize: 4,
        guestPhone: "081200000007",
      }),
      { now: NOW }
    );
    await reservationService.updateStatus(res.id, restAId, { status: "CONFIRMED" });

    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({
          branchId: branchMain,
          tableId: tConfirm,
          startMinutes: SLOT_18,
          partySize: 1,
          guestPhone: "081200000008",
        }),
        { now: NOW }
      ),
      ConflictError
    );
  });

  it("12. duplicate guest reservation is rejected (across different tables)", async () => {
    const phone = "081200000009";
    await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tDupA,
        startMinutes: SLOT_18,
        partySize: 2,
        guestPhone: phone,
      }),
      { now: NOW }
    );

    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({
          branchId: branchMain,
          tableId: tDupB,
          startMinutes: SLOT_18,
          partySize: 2,
          guestPhone: phone,
        }),
        { now: NOW }
      ),
      ConflictError
    );
  });

  it("12b. duplicate applies to table-less bookings too", async () => {
    const phone = "081200000010";
    await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: null,
        startMinutes: SLOT_19,
        partySize: 2,
        guestPhone: phone,
      }),
      { now: NOW }
    );

    await assert.rejects(
      reservationService.createAdminReservation(
        restAId,
        adminInput({
          branchId: branchMain,
          tableId: null,
          startMinutes: SLOT_19,
          partySize: 2,
          guestPhone: phone,
        }),
        { now: NOW }
      ),
      ConflictError
    );
  });

  it("12c. a cancelled duplicate does NOT block a fresh booking", async () => {
    const phone = "081200000011";
    const first = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        startMinutes: SLOT_20,
        partySize: 2,
        guestPhone: phone,
      }),
      { now: NOW }
    );
    await reservationService.cancelReservation(first.id, restAId);

    const again = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        startMinutes: SLOT_20,
        partySize: 2,
        guestPhone: phone,
      }),
      { now: NOW }
    );
    assert.equal(again.status, "PENDING");
  });

  it("12d. duplicate for an authenticated customer uses customerId", async () => {
    const customer = await prisma.customer.create({
      data: { restaurantId: restAId, phone: "081200000012", name: "Dup" },
    });
    const input = {
      branchId: branchMain,
      reservationDate: addDaysToDateOnly(FUTURE_DATE, 2),
      startMinutes: SLOT_18,
      durationMinutes: DUR_120,
      partySize: 2,
      guestName: "Dup Customer",
      guestPhone: "081200000013",
      customerId: customer.id,
      tableId: null,
    };
    await reservationService.createAdminReservation(restAId, input, { now: NOW });
    await assert.rejects(
      reservationService.createAdminReservation(restAId, input, { now: NOW }),
      ConflictError
    );
  });
});

describe("reservation.service — status transitions", () => {
  it("13. valid full lifecycle PENDING→CONFIRMED→SEATED→COMPLETED sets timestamps once", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tState,
        startMinutes: SLOT_18,
        guestPhone: "081200000014",
      }),
      { now: NOW }
    );

    const confirmed = await reservationService.updateStatus(res.id, restAId, {
      status: "CONFIRMED",
    });
    assert.equal(confirmed.status, "CONFIRMED");
    assert.ok(confirmed.confirmedAt);

    const seated = await reservationService.updateStatus(res.id, restAId, {
      status: "SEATED",
    });
    assert.equal(seated.status, "SEATED");
    assert.ok(seated.seatedAt);
    assert.ok(seated.confirmedAt, "confirmedAt must never be reset");
    assert.equal(
      seated.confirmedAt.getTime(),
      confirmed.confirmedAt.getTime(),
      "confirmedAt must never be reset"
    );

    const completed = await reservationService.updateStatus(res.id, restAId, {
      status: "COMPLETED",
    });
    assert.equal(completed.status, "COMPLETED");
    assert.ok(completed.completedAt);
    assert.ok(completed.seatedAt, "seatedAt must never be reset");
    assert.ok(completed.confirmedAt, "confirmedAt must never be reset");
  });

  it("14. invalid status transitions are rejected", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        startMinutes: SLOT_19,
        guestPhone: "081200000015",
      }),
      { now: NOW }
    );

    // PENDING → NO_SHOW is not allowed in the existing architecture.
    await assert.rejects(
      reservationService.updateStatus(res.id, restAId, { status: "NO_SHOW" }),
      ConflictError
    );
    // PENDING → SEATED skips CONFIRMED.
    await assert.rejects(
      reservationService.updateStatus(res.id, restAId, { status: "SEATED" }),
      ConflictError
    );

    await reservationService.updateStatus(res.id, restAId, { status: "CONFIRMED" });
    await reservationService.updateStatus(res.id, restAId, { status: "SEATED" });
    await reservationService.updateStatus(res.id, restAId, { status: "COMPLETED" });

    // The row is now terminal.
    await assert.rejects(
      reservationService.updateStatus(res.id, restAId, { status: "CONFIRMED" }),
      ConflictError
    );
    await assert.rejects(
      reservationService.updateStatus(res.id, restAId, { status: "CANCELLED" }),
      ConflictError
    );
  });

  it("15. cancellation is transactional and records the reason", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        startMinutes: SLOT_20,
        guestPhone: "081200000016",
      }),
      { now: NOW }
    );
    await reservationService.updateStatus(res.id, restAId, { status: "CONFIRMED" });

    const cancelled = await reservationService.cancelReservation(
      res.id,
      restAId,
      { cancelReason: "Pelanggan berubah pikiran" }
    );
    assert.equal(cancelled.status, "CANCELLED");
    assert.ok(cancelled.cancelledAt);
    assert.equal(cancelled.cancelReason, "Pelanggan berubah pikiran");
  });

  it("16. terminal reservations cannot be cancelled", async () => {
    const completed = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        startMinutes: SLOT_18,
        guestPhone: "081200000017",
      }),
      { now: NOW }
    );
    await reservationService.updateStatus(completed.id, restAId, {
      status: "CONFIRMED",
    });
    await reservationService.updateStatus(completed.id, restAId, {
      status: "SEATED",
    });
    await reservationService.updateStatus(completed.id, restAId, {
      status: "COMPLETED",
    });
    await assert.rejects(
      reservationService.cancelReservation(completed.id, restAId),
      ConflictError
    );

    const noShow = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        startMinutes: SLOT_19,
        guestPhone: "081200000018",
      }),
      { now: NOW }
    );
    await reservationService.updateStatus(noShow.id, restAId, {
      status: "CONFIRMED",
    });
    await reservationService.updateStatus(noShow.id, restAId, {
      status: "NO_SHOW",
    });
    await assert.rejects(
      reservationService.cancelReservation(noShow.id, restAId),
      ConflictError
    );
  });

  it("17. terminal reservations cannot be reactivated", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        startMinutes: SLOT_20,
        guestPhone: "081200000019",
      }),
      { now: NOW }
    );
    await reservationService.cancelReservation(res.id, restAId);

    await assert.rejects(
      reservationService.updateStatus(res.id, restAId, { status: "PENDING" }),
      ConflictError
    );
    await assert.rejects(
      reservationService.updateStatus(res.id, restAId, { status: "CONFIRMED" }),
      ConflictError
    );
  });
});

describe("reservation.service — validation (window / horizon / grid)", () => {
  it("18. rejects a reservation date beyond the 60-day horizon", async () => {
    const beyond = addDaysToDateOnly(NOW.today, 61);
    await assert.rejects(
      reservationService.createPublicReservation(
        restAId,
        publicInput({ reservationDate: beyond }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("18b. accepts the last day inside the horizon", async () => {
    const lastDay = addDaysToDateOnly(NOW.today, 60);
    const res = await reservationService.createPublicReservation(
      restAId,
      publicInput({ reservationDate: lastDay }),
      { now: NOW }
    );
    assert.equal(res.status, "PENDING");
  });

  it("19. rejects a slot that already started (injected now)", async () => {
    const midday: ReservationNow = { today: NOW.today, nowMinutes: 12 * 60 };
    await assert.rejects(
      reservationService.createPublicReservation(
        restAId,
        publicInput({ reservationDate: NOW.today, startMinutes: 10 * 60 }),
        { now: midday }
      ),
      ValidationError
    );
  });

  it("20. rejects a duration outside the 15-minute grid", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restAId,
        publicInput({ durationMinutes: 95 }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("20b. rejects a slot that runs past closing", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restAId,
        publicInput({ startMinutes: SLOT_20, durationMinutes: 180 }),
        { now: NOW }
      ),
      ValidationError
    );
  });

  it("20c. rejects an off-grid start time", async () => {
    await assert.rejects(
      reservationService.createPublicReservation(
        restAId,
        publicInput({ startMinutes: SLOT_START + 15 }),
        { now: NOW }
      ),
      ValidationError
    );
  });
});

describe("reservation.service — availability", () => {
  it("uses only the table's live reservations with half-open intervals", async () => {
    // Fresh table (9302, cap 4) so the day's bookings are exactly known.
    const t = (
      await prisma.table.create({
        data: {
          restaurantId: restAId,
          branchId: branchMain,
          number: 9302,
          name: "QA-HALFOPEN",
          capacity: 4,
          isActive: true,
          status: "AVAILABLE",
        },
      })
    ).id;

    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: t,
        startMinutes: SLOT_18,
        partySize: 2,
        guestPhone: "081200000020",
      }),
      { now: NOW }
    );
    assert.equal(res.status, "PENDING");

    // 18:00–20:00 holds 2; 19:00–21:00 OVERLAPS → 2 remain, party of 2 fits.
    const during = await reservationService.checkAvailability(restAId, branchMain, {
      reservationDate: FUTURE_DATE,
      partySize: 2,
      startMinutes: SLOT_19,
      durationMinutes: DUR_120,
      tableId: t,
    });
    assert.equal(during.available, true);
    assert.equal(during.tables[0].remainingSeats, 2);

    // 20:00–22:00 only TOUCHES 18:00–20:00 (half-open) → free, capacity 4.
    const after = await reservationService.checkAvailability(restAId, branchMain, {
      reservationDate: FUTURE_DATE,
      partySize: 4,
      startMinutes: SLOT_20,
      durationMinutes: DUR_120,
      tableId: t,
    });
    assert.equal(after.available, true);
    assert.equal(after.tables[0].remainingSeats, 4);
  });

  it("CANCELLED / NO_SHOW release seats in availability; PENDING/CONFIRMED hold them", async () => {
    // New table + day to keep this assertion isolated.
    const t = (
      await prisma.table.create({
        data: {
          restaurantId: restAId,
          branchId: branchMain,
          number: 9301,
          name: "QA-AVAIL",
          capacity: 4,
          isActive: true,
          status: "AVAILABLE",
        },
      })
    ).id;
    const slot = NOW_RESERVED_DATE;
    const slotStart = RESERVATION_SLOT_START_MINUTES;

    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: t,
        reservationDate: slot,
        startMinutes: slotStart,
        partySize: 2,
        guestPhone: "081200000021",
      }),
      { now: NOW }
    );

    let avail = await reservationService.checkAvailability(restAId, branchMain, {
      reservationDate: slot,
      partySize: 4,
      startMinutes: slotStart,
      durationMinutes: DUR_120,
      tableId: t,
    });
    assert.equal(avail.available, false); // PENDING holds 2 → 2 remaining
    assert.equal(avail.tables[0].remainingSeats, 2);

    await reservationService.cancelReservation(res.id, restAId);

    avail = await reservationService.checkAvailability(restAId, branchMain, {
      reservationDate: slot,
      partySize: 4,
      startMinutes: slotStart,
      durationMinutes: DUR_120,
      tableId: t,
    });
    assert.equal(avail.available, true); // CANCELLED released
    assert.equal(avail.tables[0].remainingSeats, 4);
  });

  it("Table.status is NOT an availability source (OCCUPIED tables stay bookable)", async () => {
    const avail = await reservationService.checkAvailability(restAId, branchMain, {
      reservationDate: FUTURE_DATE,
      partySize: 4,
      startMinutes: SLOT_18,
      durationMinutes: DUR_120,
      tableId: tOccupied,
    });
    assert.equal(avail.available, true);

    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tOccupied,
        startMinutes: SLOT_18,
        partySize: 4,
        guestPhone: "081200000022",
      }),
      { now: NOW }
    );
    assert.equal(res.status, "PENDING");
  });

  it("never lists legacy branchId=NULL tables as available", async () => {
    const avail = await reservationService.checkAvailability(restAId, branchMain, {
      reservationDate: FUTURE_DATE,
      partySize: 4,
      startMinutes: SLOT_18,
      durationMinutes: DUR_120,
    });
    for (const tableRow of avail.tables) {
      assert.notEqual(tableRow.tableId, tLegacy);
    }
  });

  it("rejects an availability query for a table outside the branch", async () => {
    await assert.rejects(
      reservationService.checkAvailability(restAId, branchMain, {
        reservationDate: FUTURE_DATE,
        partySize: 2,
        startMinutes: SLOT_18,
        durationMinutes: DUR_120,
        tableId: tOtherBranch,
      }),
      ForbiddenError
    );
  });
});

describe("reservation.service — concurrency", () => {
  it("serializes two simultaneous bookings that together exceed capacity (exactly one wins)", async () => {
    const payload = (phone: string) =>
      adminInput({
        branchId: branchMain,
        tableId: tConc,
        startMinutes: SLOT_18,
        partySize: 3,
        guestPhone: phone,
      });

    const settled = await Promise.allSettled([
      reservationService.createAdminReservation(restAId, payload("081200000030"), {
        now: NOW,
      }),
      reservationService.createAdminReservation(restAId, payload("081200000031"), {
        now: NOW,
      }),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one concurrent booking must win");
    assert.equal(rejected.length, 1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      reason instanceof ConflictError,
      `expected ConflictError, got ${reason?.constructor?.name}: ${reason?.message}`
    );

    const bookable = await reservationService.checkAvailability(
      restAId,
      branchMain,
      {
        reservationDate: FUTURE_DATE,
        partySize: 2,
        startMinutes: SLOT_18,
        durationMinutes: DUR_120,
        tableId: tConc,
      }
    );
    // Capacity 4, one party of 3 already holds → exactly 1 seat remains.
    assert.equal(bookable.tables[0].remainingSeats, 1);
    assert.equal(bookable.available, false);
  });

  it("prevents a duplicate race on the same guest (exactly one wins)", async () => {
    const payload = () =>
      adminInput({
        branchId: branchMain,
        tableId: tDupCap,
        startMinutes: SLOT_19,
        partySize: 2,
        guestPhone: "081200000032",
      });

    const settled = await Promise.allSettled([
      reservationService.createAdminReservation(restAId, payload(), { now: NOW }),
      reservationService.createAdminReservation(restAId, payload(), { now: NOW }),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one duplicate booking must win");
    assert.equal(rejected.length, 1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      reason instanceof ConflictError,
      `expected ConflictError, got ${reason?.constructor?.name}: ${reason?.message}`
    );
  });

  it("prevents a duplicate race for table-less bookings (branch lock)", async () => {
    const payload = () =>
      adminInput({
        branchId: branchMain,
        tableId: null,
        startMinutes: SLOT_20,
        partySize: 2,
        guestPhone: "081200000033",
      });

    const settled = await Promise.allSettled([
      reservationService.createAdminReservation(restAId, payload(), { now: NOW }),
      reservationService.createAdminReservation(restAId, payload(), { now: NOW }),
    ]);

    const fulfilled = settled.filter((r) => r.status === "fulfilled");
    const rejected = settled.filter((r) => r.status === "rejected");
    assert.equal(fulfilled.length, 1, "exactly one table-less booking must win");
    assert.equal(rejected.length, 1);
    const reason = (rejected[0] as PromiseRejectedResult).reason;
    assert.ok(
      reason instanceof ConflictError,
      `expected ConflictError, got ${reason?.constructor?.name}: ${reason?.message}`
    );
  });
});

describe("reservation.service — admin list / reads / isolation", () => {
  it("paginates, filters and sorts the admin board server-side", async () => {
    // Isolated branch so totals are deterministic.
    const d1 = addDaysToDateOnly(FUTURE_DATE, 1);
    const d2 = addDaysToDateOnly(FUTURE_DATE, 2);

    const r1 = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchList,
        tableId: tList,
        reservationDate: d1,
        startMinutes: SLOT_18,
        guestName: "Alice Board",
        guestPhone: "081200000040",
      }),
      { now: NOW }
    );
    const r2 = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchList,
        tableId: tList,
        reservationDate: d1,
        startMinutes: SLOT_19,
        guestName: "Bob Board",
        guestPhone: "081200000041",
      }),
      { now: NOW }
    );
    await reservationService.updateStatus(r2.id, restAId, { status: "CONFIRMED" });
    const r3 = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchList,
        tableId: tList,
        reservationDate: d2,
        startMinutes: SLOT_18,
        guestName: "Carol Board",
        guestPhone: "081200000042",
      }),
      { now: NOW }
    );

    // Page 1 of 2 → board order (date asc, start asc).
    const page1 = await reservationService.listReservations(
      restAId,
      { branchId: branchList, page: 1, limit: 2 },
      [branchList]
    );
    assert.equal(page1.total, 3);
    assert.equal(page1.items.length, 2);
    assert.equal(page1.totalPages, 2);
    assert.equal(page1.items[0].id, r1.id);
    assert.equal(page1.items[1].id, r2.id);

    const page2 = await reservationService.listReservations(
      restAId,
      { branchId: branchList, page: 2, limit: 2 },
      [branchList]
    );
    assert.equal(page2.items.length, 1);
    assert.equal(page2.items[0].id, r3.id);

    // Status filter.
    const pending = await reservationService.listReservations(
      restAId,
      { branchId: branchList, status: "PENDING" },
      [branchList]
    );
    assert.equal(pending.total, 2);

    // Date filter.
    const onDay = await reservationService.listReservations(
      restAId,
      { branchId: branchList, date: d1 },
      [branchList]
    );
    assert.equal(onDay.total, 2);

    // Free-text search over guest name.
    const alice = await reservationService.listReservations(
      restAId,
      { branchId: branchList, search: "Alice" },
      [branchList]
    );
    assert.equal(alice.total, 1);
    assert.equal(alice.items[0].id, r1.id);

    // Newest-first for dashboards.
    const newest = await reservationService.listReservations(
      restAId,
      { branchId: branchList, sort: "newest" },
      [branchList]
    );
    assert.equal(newest.items[0].id, r3.id);
    assert.equal(newest.items[1].id, r2.id);
    assert.equal(newest.items[2].id, r1.id);
  });

  it("enforces tenant isolation (reservations never cross restaurants)", async () => {
    const inB = await reservationService.createAdminReservation(
      restBId,
      {
        branchId: branchR2,
        reservationDate: FUTURE_DATE,
        startMinutes: SLOT_18,
        durationMinutes: DUR_120,
        partySize: 2,
        guestName: "R2 Guest",
        guestPhone: "081200000050",
        tableId: tR2,
      },
      { now: NOW }
    );
    assert.equal(inB.status, "PENDING");

    // Same branch id, different restaurant → zero rows.
    const crossTenant = await reservationService.listReservations(
      restAId,
      { branchId: branchR2 },
      [branchR2]
    );
    assert.equal(crossTenant.total, 0);

    await assert.rejects(
      reservationService.getReservationById(inB.id, restAId),
      NotFoundError
    );
    await assert.rejects(
      reservationService.getReservationByCode(restAId, inB.code),
      NotFoundError
    );
  });

  it("enforces branch isolation (branch-scoped callers)", async () => {
    const inAlt = await reservationService.createAdminReservation(
      restAId,
      {
        branchId: branchAlt,
        reservationDate: FUTURE_DATE,
        startMinutes: SLOT_18,
        durationMinutes: DUR_120,
        partySize: 2,
        guestName: "Alt Guest",
        guestPhone: "081200000051",
        tableId: tOtherBranch,
      },
      { now: NOW }
    );

    // Reading a B2 row while scoped to [B1] → not found.
    await assert.rejects(
      reservationService.getReservationById(inAlt.id, restAId, [branchMain]),
      NotFoundError
    );
    // Requesting a branch outside the caller's scope → forbidden.
    await assert.rejects(
      reservationService.listReservations(
        restAId,
        { branchId: branchAlt },
        [branchMain]
      ),
      ForbiddenError
    );
    // Listing while scoped to [B1] excludes B2 rows.
    const scoped = await reservationService.listReservations(
      restAId,
      {},
      [branchMain]
    );
    assert.equal(
      scoped.items.some((r) => r.id === inAlt.id),
      false
    );
  });

  it("guest lookup requires a matching phone and returns a safe DTO", async () => {
    const res = await reservationService.createPublicReservation(
      restAId,
      publicInput({ guestPhone: "081200000052" }),
      { now: NOW }
    );

    const dto = await reservationService.getReservationByCodeForGuest(
      restAId,
      res.code,
      "081200000052"
    );
    assert.equal(dto.id, res.id);
    assert.equal(dto.code, res.code);
    assert.equal(dto.status, "PENDING");
    assert.equal(dto.reservationDate, FUTURE_DATE);
    assert.equal((dto as Record<string, unknown>).orderId, undefined);
    assert.equal((dto as Record<string, unknown>).customerId, undefined);
    assert.equal((dto as Record<string, unknown>).source, undefined);

    // Wrong phone → not found.
    await assert.rejects(
      reservationService.getReservationByCodeForGuest(
        restAId,
        res.code,
        "081200000099"
      ),
      NotFoundError
    );
    // Unknown code → not found.
    await assert.rejects(
      reservationService.getReservationByCodeForGuest(
        restAId,
        "R-DOESNOT01",
        "081200000052"
      ),
      NotFoundError
    );
  });

  it("get by id / by code resolve table and branch enrichment", async () => {
    const res = await reservationService.createAdminReservation(
      restAId,
      adminInput({
        branchId: branchMain,
        tableId: tMain,
        startMinutes: SLOT_20,
        guestName: "Enrich Me",
        guestPhone: "081200000053",
      }),
      { now: NOW }
    );

    const byId = await reservationService.getReservationById(res.id, restAId);
    assert.equal(byId.code, res.code);
    assert.equal(byId.reservationDate, FUTURE_DATE);
    assert.equal(byId.table?.number, 9201);
    assert.equal(byId.branch?.code, "QA-MAIN");

    const byCode = await reservationService.getReservationByCode(
      restAId,
      res.code
    );
    assert.equal(byCode.id, res.id);
  });
});

// Small module-local constants used by the availability block (kept at the
// bottom so the fixture declarations above stay readable).
const SLOT_START = RESERVATION_SLOT_START_MINUTES;
const NOW_RESERVED_DATE = addDaysToDateOnly(NOW.today, 4);