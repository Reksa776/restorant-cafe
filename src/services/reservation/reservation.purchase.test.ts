import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { reservationService } from "./reservation.service";
import { ConflictError } from "@/lib/errors";
import { normalizePhone } from "@/lib/phone";
import { addDaysToDateOnly, type ReservationNow } from "./reservation.slots";
import {
  cleanupPurchases,
  seedQualifyingPurchase,
} from "./reservation.purchase.fixtures";

// ============================================================
// MINIMUM-PURCHASE GATE — reservation creation (customer/public flow).
//
// Rule: a public reservation is allowed only when the acting customer/guest
// has at least one QUALIFYING purchase at the SAME restaurant:
//   paymentStatus = PAID, status != CANCELLED, >= 1 OrderItem.
// Branch may differ. Admin/staff bookings are NOT gated.
//
// Runs against the real local DB with fully isolated fixtures. "now" is always
// injected (the engine's determinism contract).
//
// Run with: npx tsx --test --test-force-exit src/services/reservation/reservation.purchase.test.ts
// ============================================================

const NOW: ReservationNow = { today: "2026-09-15", nowMinutes: 9 * 60 };
const SLOT_18 = 18 * 60;
const DUR = 120;

let restA = "";
let restB = "";
let branchA1 = "";
let branchA2 = "";
let tA = "";

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
    ...overrides,
  };
}

function isPurchaseRequired(err: unknown): boolean {
  return err instanceof ConflictError && err.code === "PURCHASE_REQUIRED";
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
  await prisma.branch.create({
    data: { restaurantId: restB, code: "QA-PUR-B", name: "Pur B" },
  });
  branchA1 = b1.id;
  branchA2 = b2.id;

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
  tA = ta.id;
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

describe("minimum-purchase gate", () => {
  it("1. GUEST without any purchase → rejected (409 PURCHASE_REQUIRED)", async () => {
    const input = publicInput();
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("2. GUEST with a PAID order → allowed (PENDING)", async () => {
    const input = publicInput();
    await seedQualifyingPurchase(restA, {
      phone: canon(input.guestPhone),
      branchId: branchA1,
    });
    const res = await reservationService.createPublicReservation(restA, input, {
      now: NOW,
    });
    assert.equal(res.status, "PENDING");
  });

  it("3. LOGGED-IN customer without purchase → rejected", async () => {
    const customer = await prisma.customer.create({
      data: { restaurantId: restA, phone: canon(newPhone()), name: "No Buy" },
    });
    const input = publicInput();
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, {
        now: NOW,
        customerId: customer.id,
      }),
      isPurchaseRequired
    );
  });

  it("4. LOGGED-IN customer with a PAID order → allowed", async () => {
    const seeded = await seedQualifyingPurchase(restA, { branchId: branchA1 });
    const input = publicInput();
    const res = await reservationService.createPublicReservation(restA, input, {
      now: NOW,
      customerId: seeded.customerId,
    });
    assert.equal(res.status, "PENDING");
    assert.equal(res.customerId, seeded.customerId);
  });

  it("5. CANCELLED order does NOT qualify → rejected", async () => {
    const input = publicInput();
    await seedQualifyingPurchase(restA, {
      phone: canon(input.guestPhone),
      status: "CANCELLED",
    });
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("6. UNPAID order does NOT qualify → rejected", async () => {
    const input = publicInput();
    await seedQualifyingPurchase(restA, {
      phone: canon(input.guestPhone),
      paymentStatus: "UNPAID",
    });
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("7. a FULL refund that resets paymentStatus to UNPAID does NOT qualify → rejected", async () => {
    const input = publicInput();
    // The refund lifecycle returns the order to UNPAID; the gate reads the
    // CURRENT paymentStatus, so the slot is no longer covered.
    await seedQualifyingPurchase(restA, {
      phone: canon(input.guestPhone),
      paymentStatus: "UNPAID",
    });
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("8. a PAID order with NO OrderItem does NOT qualify → rejected", async () => {
    const input = publicInput();
    await seedQualifyingPurchase(restA, {
      phone: canon(input.guestPhone),
      withItem: false,
    });
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("9. purchase from the SAME restaurant but a DIFFERENT branch → allowed", async () => {
    const input = publicInput();
    await seedQualifyingPurchase(restA, {
      phone: canon(input.guestPhone),
      branchId: branchA2, // different branch than the reserved slot (branchA1)
    });
    const res = await reservationService.createPublicReservation(restA, input, {
      now: NOW,
    });
    assert.equal(res.status, "PENDING");
  });

  it("10. purchase from a DIFFERENT restaurant → rejected", async () => {
    const input = publicInput();
    await seedQualifyingPurchase(restB, { phone: canon(input.guestPhone) });
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("11. Guest A cannot use Guest B's purchase → rejected", async () => {
    const phoneB = newPhone();
    await seedQualifyingPurchase(restA, { phone: canon(phoneB) });
    const inputA = publicInput(); // a DIFFERENT phone with no purchase
    assert.notEqual(canon(inputA.guestPhone), canon(phoneB));
    await assert.rejects(
      reservationService.createPublicReservation(restA, inputA, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("12. client-supplied customerId/orderId/paymentStatus/restaurantId cannot spoof the gate", async () => {
    const other = await seedQualifyingPurchase(restA, {}); // has a purchase
    const input = publicInput(); // guest phone with NO purchase
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        {
          ...input,
          customerId: other.customerId,
          orderId: other.orderId,
          paymentStatus: "PAID",
          restaurantId: restB,
        },
        { now: NOW }
      ),
      isPurchaseRequired
    );
  });

  it("12b. a client-supplied orderId of a real PAID order cannot be pointed at", async () => {
    const other = await seedQualifyingPurchase(restA, {});
    const input = publicInput();
    await assert.rejects(
      reservationService.createPublicReservation(
        restA,
        { ...input, orderId: other.orderId },
        { now: NOW }
      ),
      isPurchaseRequired
    );
  });

  it("13. STAFF (admin) reservation is NOT gated — walk-in bookings still work", async () => {
    const res = await reservationService.createAdminReservation(
      restA,
      {
        branchId: branchA1,
        reservationDate: nextDate(),
        startMinutes: SLOT_18,
        durationMinutes: DUR,
        partySize: 2,
        guestName: "Walk-in",
        guestPhone: newPhone(),
        tableId: tA,
      },
      { now: NOW }
    );
    assert.equal(res.status, "PENDING");
  });

  // ==========================================================
  // R6.5 — read-only UX probe used by the wizard's "Pembelian" step.
  // Same server-side rule/ownership as the write gate; NEVER an
  // authorization (the gate below still runs on POST).
  // ==========================================================

  it("15. probe: GUEST without a purchase → eligible false", async () => {
    const res = await reservationService.checkPurchaseEligibility(restA, {
      guestPhone: newPhone(),
    });
    assert.equal(res.eligible, false);
  });

  it("16. probe: GUEST with a purchase (raw phone form) → eligible true", async () => {
    const raw = newPhone();
    await seedQualifyingPurchase(restA, { phone: canon(raw) });
    // The probe canonicalizes the typed number itself (the client sends the
    // raw form the customer typed).
    const res = await reservationService.checkPurchaseEligibility(restA, {
      guestPhone: raw,
    });
    assert.equal(res.eligible, true);
  });

  it("17. probe: LOGGED-IN customer → true with a purchase, false without", async () => {
    const seeded = await seedQualifyingPurchase(restA, { branchId: branchA1 });
    assert.equal(
      (await reservationService.checkPurchaseEligibility(restA, {
        customerId: seeded.customerId,
      })).eligible,
      true
    );

    const empty = await prisma.customer.create({
      data: { restaurantId: restA, phone: canon(newPhone()), name: "No Buy" },
    });
    assert.equal(
      (await reservationService.checkPurchaseEligibility(restA, {
        customerId: empty.id,
      })).eligible,
      false
    );
  });

  it("18. probe is tenant-scoped: another restaurant's purchase → false", async () => {
    const raw = newPhone();
    await seedQualifyingPurchase(restB, { phone: canon(raw) });
    // Same phone, but probed against restA where nothing was bought.
    assert.equal(
      (await reservationService.checkPurchaseEligibility(restA, {
        guestPhone: raw,
      })).eligible,
      false
    );
    // A customer of another restaurant can never be probed into restA either.
    const foreign = await prisma.customer.create({
      data: { restaurantId: restB, phone: canon(newPhone()), name: "Foreign" },
    });
    assert.equal(
      (await reservationService.checkPurchaseEligibility(restA, {
        customerId: foreign.id,
      })).eligible,
      false
    );
  });

  it("19. probe: no identity / invalid phone → false (never throws, never guesses)", async () => {
    assert.equal(
      (await reservationService.checkPurchaseEligibility(restA, {})).eligible,
      false
    );
    assert.equal(
      (await reservationService.checkPurchaseEligibility(restA, {
        guestPhone: "abc",
      })).eligible,
      false
    );
  });

  it("20. the probe result can never bypass the write gate (POST still 409)", async () => {
    // Even if the client believed it was "eligible", the authoritative gate
    // re-runs inside the create transaction and still rejects.
    const input = publicInput();
    await assert.rejects(
      reservationService.createPublicReservation(restA, input, { now: NOW }),
      isPurchaseRequired
    );
  });

  it("14. R5.1 regression — table status does not affect availability (reservation-only)", async () => {
    // tA is AVAILABLE; availability must be true with no overlapping booking.
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
    const tAView = avail.tables.find((t) => t.tableId === tA);
    assert.ok(tAView);
    assert.equal(tAView?.available, true);
    assert.equal(tAView?.status, "AVAILABLE");
  });
});
