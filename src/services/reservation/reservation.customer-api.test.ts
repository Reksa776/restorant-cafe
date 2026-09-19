import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { reservationService } from "./reservation.service";
import { createCustomerSessionToken } from "@/lib/customer-session.server";
import { CUSTOMER_SESSION_COOKIE } from "@/lib/customer-session";
import { addDaysToDateOnly, type ReservationNow } from "./reservation.slots";
import { GET as listGet } from "@/app/api/public/customer/account/reservations/route";
import { GET as detailGet } from "@/app/api/public/customer/account/reservations/[code]/route";
import { POST as cancelPost } from "@/app/api/public/customer/account/reservations/[code]/cancel/route";

// ============================================================
// PHASE R6 — CUSTOMER RESERVATION ENDPOINTS (route handlers invoked
// directly against the real local DB — no dev-server boot required,
// because the session is verified with pure node crypto).
//
// Run with: npx tsx --test src/services/reservation/reservation.customer-api.test.ts
// ============================================================

const NOW: ReservationNow = { today: "2026-09-15", nowMinutes: 9 * 60 };
const BASE = "http://test.local/api/public/customer/account/reservations";

let restA = "";
let restB = "";
let branchA = "";
let branchB = "";
let tA1 = "";
let tB1 = "";

let customerA = "";
let customerB = "";
let customerForeign = "";

let phoneCounter = 1;
function incrementingPhone(): string {
  const n = String(20000000 + phoneCounter).slice(-8);
  phoneCounter += 1;
  return `0811${n}`;
}

const bookingDates: string[] = [];
function uniqueBookingDate(): string {
  const d = addDaysToDateOnly(NOW.today, 3 + bookingDates.length);
  bookingDates.push(d);
  return d;
}

async function booking(
  restaurantId: string,
  branchCode: string,
  customerId: string,
  tableId: string,
  guestName: string
) {
  return reservationService.createPublicReservation(
    restaurantId,
    {
      branchCode,
      reservationDate: uniqueBookingDate(),
      startMinutes: 18 * 60,
      durationMinutes: 90,
      partySize: 2,
      guestName,
      guestPhone: incrementingPhone(),
      tableId,
    },
    { now: NOW, customerId }
  );
}

function assertStatus(res: Response, want: number) {
  assert.equal(res.status, want, `expected ${want}, got ${res.status}`);
}

function authedRequest(path = BASE, token: string): NextRequest {
  return new NextRequest(`${path}?page=1&limit=10`, {
    headers: {
      cookie: `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    },
  });
}

function authedParams(code: string) {
  return { params: Promise.resolve({ code }) };
}

before(async () => {
  const rA = await prisma.restaurant.create({
    data: { name: `QA R6 Customer API A ${Date.now()}` },
  });
  const rB = await prisma.restaurant.create({
    data: { name: `QA R6 Customer API B ${Date.now()}` },
  });
  restA = rA.id;
  restB = rB.id;

  const bA = await prisma.branch.create({
    data: { restaurantId: restA, code: "R6-API", name: "R6 API Branch" },
  });
  const bB = await prisma.branch.create({
    data: { restaurantId: restB, code: "R6-API-B", name: "R6 API Branch B" },
  });
  branchA = bA.id;
  branchB = bB.id;

  tA1 = (
    await prisma.table.create({
      data: {
        restaurantId: restA,
        branchId: branchA,
        number: 9401,
        name: "R6-API-1",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    })
  ).id;
  tB1 = (
    await prisma.table.create({
      data: {
        restaurantId: restB,
        branchId: branchB,
        number: 9451,
        name: "R6-API-B1",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    })
  ).id;

  const cA = await prisma.customer.create({
    data: {
      restaurantId: restA,
      name: "API Customer A",
      email: `api-a-${Date.now()}@test.local`,
      phone: incrementingPhone(),
    },
  });
  const cB = await prisma.customer.create({
    data: {
      restaurantId: restA,
      name: "API Customer B",
      email: `api-b-${Date.now()}@test.local`,
      phone: incrementingPhone(),
    },
  });
  const cF = await prisma.customer.create({
    data: {
      restaurantId: restB,
      name: "API Customer Foreign",
      email: `api-f-${Date.now()}@test.local`,
      phone: incrementingPhone(),
    },
  });
  customerA = cA.id;
  customerB = cB.id;
  customerForeign = cF.id;
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

describe("customer reservation endpoints — auth boundary", () => {
  it("1. GET list without a session cookie → 401", async () => {
    const res = await listGet(
      new NextRequest(`${BASE}?page=1&limit=10`)
    );
    assertStatus(res, 401);
  });

  it("2. GET detail without a session cookie → 401", async () => {
    const res = await detailGet(
      new NextRequest(`${BASE}/XYZ123`),
      authedParams("XYZ123")
    );
    assertStatus(res, 401);
  });

  it("3. POST cancel without a session cookie → 401", async () => {
    const res = await cancelPost(
      new NextRequest(`${BASE}/XYZ123/cancel`, {
        method: "POST",
        body: JSON.stringify({ cancelReason: "w" }),
      }),
      authedParams("XYZ123")
    );
    assertStatus(res, 401);
  });

  it("4. GET list with a tampered signature → 401", async () => {
    // Split on the separator (a HMAC signature may end in '-'/'_', which a
    // regex word-class trim would fail to strip, making the test flaky).
    const [encoded] = createCustomerSessionToken(customerA, restA).split(".");
    const token = `${encoded}.forged`;
    const res = await listGet(authedRequest(BASE, token));
    assertStatus(res, 401);
  });
});

describe("customer reservation endpoints — list & detail", () => {
  let ownCode = "";
  let otherCode = "";
  let foreignCode = "";

  before(async () => {
    const a = await booking(restA, "R6-API", customerA, tA1, "Milik A");
    const b = await booking(restA, "R6-API", customerB, tA1, "Milik B");
    const f = await booking(restB, "R6-API-B", customerForeign, tB1, "Milik F");
    ownCode = a.code;
    otherCode = b.code;
    foreignCode = f.code;
  });

  it("5. returns ONLY the session customer's reservations", async () => {
    const res = await listGet(
      authedRequest(BASE, createCustomerSessionToken(customerA, restA))
    );
    assertStatus(res, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    const codes = json.data.items.map((r: { code: string }) => r.code);
    assert.ok(codes.includes(ownCode));
    assert.ok(!codes.includes(otherCode));
    assert.ok(!codes.includes(foreignCode));
    // Safe projection — no internal ids leak.
    const sample = json.data.items[0];
    assert.equal(sample.id, undefined);
    assert.equal(sample.restaurantId, undefined);
    assert.equal(sample.customerId, undefined);
    assert.equal(sample.orderId, undefined);
  });

  it("6. detail returns the customer's own reservation", async () => {
    const res = await detailGet(
      authedRequest(`${BASE}/${ownCode}`, createCustomerSessionToken(customerA, restA)),
      authedParams(ownCode)
    );
    assertStatus(res, 200);
    const json = await res.json();
    assert.equal(json.data.code, ownCode);
    assert.equal(json.data.guestName, "Milik A");
  });

  it("7. detail of ANOTHER customer's code → 404", async () => {
    const res = await detailGet(
      authedRequest(`${BASE}/${otherCode}`, createCustomerSessionToken(customerA, restA)),
      authedParams(otherCode)
    );
    assertStatus(res, 404);
  });

  it("8. detail of a code in ANOTHER restaurant → 404", async () => {
    const res = await detailGet(
      authedRequest(`${BASE}/${foreignCode}`, createCustomerSessionToken(customerA, restA)),
      authedParams(foreignCode)
    );
    assertStatus(res, 404);
  });
});

describe("customer reservation endpoints — self-cancel", () => {
  it("9. cancels the customer's own PENDING reservation", async () => {
    const a = await booking(restA, "R6-API", customerA, tA1, "Batal A");
    const res = await cancelPost(
      authedRequest(
        `${BASE}/${a.code}/cancel`,
        createCustomerSessionToken(customerA, restA)
      ),
      authedParams(a.code)
    );
    assertStatus(res, 200);
    const json = await res.json();
    assert.equal(json.data.code, a.code);
    assert.equal(json.data.status, "CANCELLED");
  });

  it("10. cancelling ANOTHER customer's reservation → 404", async () => {
    const b = await booking(restA, "R6-API", customerB, tA1, "Batal B");
    const res = await cancelPost(
      authedRequest(
        `${BASE}/${b.code}/cancel`,
        createCustomerSessionToken(customerA, restA)
      ),
      authedParams(b.code)
    );
    assertStatus(res, 404);
  });

  it("11. a duplicate cancellation → 409", async () => {
    const a = await booking(restA, "R6-API", customerA, tA1, "Duplikat A");
    const token = createCustomerSessionToken(customerA, restA);
    const first = await cancelPost(
      authedRequest(`${BASE}/${a.code}/cancel`, token),
      authedParams(a.code)
    );
    assertStatus(first, 200);
    const second = await cancelPost(
      authedRequest(`${BASE}/${a.code}/cancel`, token),
      authedParams(a.code)
    );
    assertStatus(second, 409);
  });

  it("12. a malformed cancel body → 400", async () => {
    const a = await booking(restA, "R6-API", customerA, tA1, "Malformed A");
    const res = await cancelPost(
      new NextRequest(`${BASE}/${a.code}/cancel`, {
        method: "POST",
        headers: {
          cookie: `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(
            createCustomerSessionToken(customerA, restA)
          )}`,
        },
        body: JSON.stringify({ cancelReason: 12345 }),
      }),
      authedParams(a.code)
    );
    assertStatus(res, 400);
  });
});