/**
 * STEP 2B.1 — CASHBOOK INTEGRATION TESTS (real MariaDB, isolated test DB)
 *
 * Scope (and nothing else): the Cashbook read-model
 * (`src/services/accounting/cashbook.service.ts`) exercised against the
 * ISOLATED test database with real Prisma/SQL — no mocked aggregation.
 *
 * The read-model unifies three EXISTING sources and writes nothing:
 *   * Payment — status PAID | REFUNDED, cash date = `paidAt`
 *   * Refund  — status APPROVED,           cash date = `approvedAt`
 *   * Expense — every row,                 cash date = `spentAt`
 * with two non-negotiable dedup rules:
 *   * ONE Payment row is counted ONCE (split tender is legitimate);
 *   * `PaymentTransaction` is NEVER added as another cash movement (it mirrors
 *     its Payment and carries the negative refund row).
 *
 * IMPORTANT — date semantics:
 *   Cashbook recognises money on its CASH MOVEMENT date, not the order date, so
 *   Cashbook and Revenue are NOT required to match for the same calendar period
 *   (e.g. order created Sep 30, collected Oct 1 → Cashbook sees Oct 1). The
 *   tests below assert that existing business rule instead of "fixing" it.
 *
 * Safety: `tests/setup.ts` is imported FIRST. It loads `.env.test`, runs the
 * fail-closed checks and PINS `DATABASE_URL` to `TEST_DATABASE_URL`, so the
 * application Prisma singleton can never open the application database.
 *
 * Run (from the project root):
 *   npx tsx --test tests/accounting/cashbook.integration.test.ts
 */

import { assertLiveTestTarget, EXPECTED_TEST_DB } from "../setup"; // MUST stay first (see header)

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/errors";
import { getCashbook } from "@/services/accounting/cashbook.service";
import { createExpense } from "@/services/accounting/expense.service";
import { PaymentService } from "@/services/payment/payment.service";
import {
  cleanupRun,
  createBranchFixture,
  createCustomerFixture,
  createExpenseCategoryFixture,
  createOrderFixture,
  createPaymentFixture,
  createPaymentTransactionFixture,
  createRefundFixture,
  createRestaurantFixture,
  createRunId,
  createUserFixture,
  findResiduals,
  snapshotCounts,
  type ScopedCounts,
} from "../fixtures/accounting";

// ============================================================
// Deterministic, unique identifiers (one prefix per run).
// ============================================================

const RUN = createRunId("cbt");
const REST_A = `${RUN}-rest-a`;
const REST_B = `${RUN}-rest-b`;
const BR_A1 = `${RUN}-br-a1`;
const BR_A2 = `${RUN}-br-a2`;
const BR_B1 = `${RUN}-br-b1`;
const USER_A = `${RUN}-user-a`;
const USER_B = `${RUN}-user-b`;
const CUST_A = `${RUN}-cust-a`;
const CUST_B = `${RUN}-cust-b`;

/** Local wall-clock dates (the service buckets by local calendar day). */
const at = (y: number, m: number, d: number, h = 10, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

const D = {
  oct1: "2026-10-01",
  oct2: "2026-10-02",
  oct3: "2026-10-03",
  oct4: "2026-10-04",
  oct5: "2026-10-05",
  oct6: "2026-10-06",
  oct7: "2026-10-07",
  oct8: "2026-10-08",
  oct9: "2026-10-09",
  oct10: "2026-10-10",
  oct11: "2026-10-11",
  oct12: "2026-10-12",
  oct13: "2026-10-13",
  oct15: "2026-10-15",
  sep28: "2026-09-28",
  sep29: "2026-09-29",
  sep30: "2026-09-30",
};

const T = {
  oct1: at(2026, 10, 1, 10, 0),
  oct2a: at(2026, 10, 2, 9, 0),
  oct2b: at(2026, 10, 2, 9, 5),
  oct3: at(2026, 10, 3, 10, 0),
  oct4: at(2026, 10, 4, 10, 0),
  oct5payment: at(2026, 10, 5, 10, 0),
  oct5refund: at(2026, 10, 5, 11, 0),
  oct6: at(2026, 10, 6, 10, 0),
  oct7: at(2026, 10, 7, 12, 0),
  oct9: at(2026, 10, 9, 10, 0),
  oct10: at(2026, 10, 10, 10, 0),
  oct11: at(2026, 10, 11, 10, 0),
  oct12: at(2026, 10, 12, 10, 0),
  oct13: at(2026, 10, 13, 12, 0),
  oct15: at(2026, 10, 15, 12, 0),
  sep28: at(2026, 9, 28, 10, 0),
  sep29: at(2026, 9, 29, 12, 0),
  sep30: at(2026, 9, 30, 22, 0),
};

/** Convenience wrapper: list query with paging defaults. */
function cb(
  restaurantId: string,
  q: Record<string, unknown> = {},
  branchFilters?: string[] | null
) {
  return getCashbook(restaurantId, { page: 1, limit: 100, ...q }, branchFilters);
}

function localDateOnly(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ------------------------------------------------------------
// Compact fixture shorthands (all ids inherit the run prefix).
// ------------------------------------------------------------

async function mkOrder(
  label: string,
  total: number,
  opts: {
    restaurantId?: string;
    branchId?: string | null;
    customerId?: string;
    createdAt?: Date;
    paymentStatus?: "UNPAID" | "PAID" | "REFUNDED";
  } = {}
): Promise<string> {
  const id = `${RUN}-${label}-order`;
  await createOrderFixture(prisma, {
    id,
    orderNumber: `${RUN}-ORD-${label}`,
    restaurantId: opts.restaurantId ?? REST_A,
    branchId: opts.branchId === undefined ? BR_A1 : opts.branchId,
    customerId: opts.customerId ?? CUST_A,
    grandTotal: total,
    createdAt: opts.createdAt,
    paymentStatus: opts.paymentStatus,
  });
  return id;
}

async function mkPayment(
  label: string,
  orderId: string,
  amount: number,
  opts: {
    restaurantId?: string;
    branchId?: string | null;
    method?: string | null;
    status?: "UNPAID" | "PAID" | "REFUNDED";
    paidAt?: Date | null;
    createdAt?: Date;
  } = {}
): Promise<string> {
  const id = `${RUN}-${label}-pay`;
  await createPaymentFixture(prisma, {
    id,
    restaurantId: opts.restaurantId ?? REST_A,
    orderId,
    branchId: opts.branchId === undefined ? BR_A1 : opts.branchId,
    amount,
    method: opts.method === undefined ? "KASIR" : opts.method,
    status: opts.status,
    paidAt: opts.paidAt === undefined ? null : opts.paidAt,
    createdAt: opts.createdAt,
  });
  return id;
}

async function mkRefund(
  label: string,
  orderId: string,
  amount: number,
  opts: {
    restaurantId?: string;
    branchId?: string | null;
    paymentId?: string | null;
    status?: "PENDING" | "APPROVED" | "REJECTED";
    approvedAt?: Date | null;
    createdAt?: Date;
    requestedBy?: string;
  } = {}
): Promise<string> {
  const id = `${RUN}-${label}-refund`;
  await createRefundFixture(prisma, {
    id,
    restaurantId: opts.restaurantId ?? REST_A,
    orderId,
    paymentId: opts.paymentId ?? null,
    branchId: opts.branchId === undefined ? BR_A1 : opts.branchId,
    amount,
    requestedByCashierId: opts.requestedBy ?? USER_A,
    status: opts.status,
    approvedAt: opts.approvedAt,
    createdAt: opts.createdAt,
  });
  return id;
}

// ============================================================
// SUITE
// ============================================================

describe("STEP 2B.1 — Cashbook integration (real MariaDB, isolated test DB)", () => {
  let baseline: ScopedCounts;

  before(async () => {
    // Counts before any mutation — cleanup must restore them exactly.
    baseline = await snapshotCounts(prisma);

    await createRestaurantFixture(prisma, { id: REST_A, name: `${RUN} Restaurant A` });
    await createRestaurantFixture(prisma, { id: REST_B, name: `${RUN} Restaurant B` });
    await createBranchFixture(prisma, {
      id: BR_A1,
      restaurantId: REST_A,
      code: `${RUN}-A1`,
      name: "Branch A1",
    });
    await createBranchFixture(prisma, {
      id: BR_A2,
      restaurantId: REST_A,
      code: `${RUN}-A2`,
      name: "Branch A2",
    });
    await createBranchFixture(prisma, {
      id: BR_B1,
      restaurantId: REST_B,
      code: `${RUN}-B1`,
      name: "Branch B1",
    });
    await createUserFixture(prisma, {
      id: USER_A,
      restaurantId: REST_A,
      email: `${RUN}-admin-a@test.local`,
      name: "Admin A",
    });
    await createUserFixture(prisma, {
      id: USER_B,
      restaurantId: REST_B,
      email: `${RUN}-admin-b@test.local`,
      name: "Admin B",
    });
    await createCustomerFixture(prisma, {
      id: CUST_A,
      restaurantId: REST_A,
      phone: `${RUN}-phone-a`,
    });
    await createCustomerFixture(prisma, {
      id: CUST_B,
      restaurantId: REST_B,
      phone: `${RUN}-phone-b`,
    });
  });

  after(async () => {
    const result = await cleanupRun(prisma, RUN);
    const after = await snapshotCounts(prisma);
    const residual = await findResiduals(prisma, RUN, result.scope);

    console.log("\n[STEP 2B.1 CLEANUP] rows deleted:", JSON.stringify(result.deleted));
    console.log("[STEP 2B.1 CLEANUP] residual (run-scoped):", JSON.stringify(residual));
    console.log(
      "[STEP 2B.1 CLEANUP] table counts (baseline → after):",
      JSON.stringify(
        Object.fromEntries(
          Object.keys(baseline).map((k) => [
            k,
            `${baseline[k as keyof ScopedCounts]} → ${after[k as keyof ScopedCounts]}`,
          ])
        )
      )
    );

    await prisma.$disconnect();

    assert.deepEqual(
      after,
      baseline,
      "cleanup must restore every touched table to its pre-run count"
    );
    assert.deepEqual(
      residual,
      Object.fromEntries(Object.keys(residual).map((k) => [k, 0])),
      "no run-scoped row may remain after cleanup"
    );
  });

  // ------------------------------------------------------------------
  // SAFETY — the runtime connection really is the isolated test database.
  // ------------------------------------------------------------------
  it("safety: the runtime connection targets the isolated test database", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ db: string; port: string; user: string }>
    >`SELECT CAST(DATABASE() AS CHAR) AS db, CAST(@@port AS CHAR) AS port, CAST(USER() AS CHAR) AS user`;

    const identity = rows[0];
    assert.ok(identity, "SELECT DATABASE() must return one row");
    // Centralised live guard (STEP 2C.2F): database name + dedicated user.
    await assertLiveTestTarget(prisma);
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(identity.db, EXPECTED_TEST_DB.name);
    assert.ok(identity.db.includes("_test"), `database '${identity.db}' must be a test database`);
    assert.notEqual(identity.db, "restaurant_app");
    assert.ok(
      ["127.0.0.1", "localhost"].includes(EXPECTED_TEST_DB.host),
      "test database must be reached over loopback"
    );
    // The isolated MariaDB test container is published on host port 3308
    // (overridable for other environments via TEST_DB_EXPECTED_PORT).
    assert.equal(EXPECTED_TEST_DB.port, process.env.TEST_DB_EXPECTED_PORT ?? "3308");
    // The pinned application connection string points at the same test DB.
    assert.ok(process.env.DATABASE_URL?.includes(`/${EXPECTED_TEST_DB.name}`));
  });

  // ------------------------------------------------------------------
  // 1. Single PAID payment
  // ------------------------------------------------------------------
  it("1. single PAID payment is one IN movement on its paidAt day", async () => {
    const orderId = await mkOrder("s1", 100000);
    const paymentId = await mkPayment("s1", orderId, 100000, {
      method: "KASIR",
      paidAt: T.oct1,
    });

    const res = await cb(REST_A, { dateFrom: D.oct1, dateTo: D.oct1 });

    assert.equal(res.total, 1);
    assert.equal(res.items.length, 1);
    const entry = res.items[0];
    assert.equal(entry.id, `payment:${paymentId}`);
    assert.equal(entry.source, "PAYMENT");
    assert.equal(entry.type, "IN");
    assert.equal(entry.method, "KASIR");
    assert.equal(entry.methodLabel, "Tunai (KASIR)");
    assert.equal(entry.status, "PAID");
    assert.equal(entry.amount, 100000);
    assert.equal(entry.signedAmount, 100000);
    assert.equal(entry.date, T.oct1.toISOString());
    assert.equal(entry.dateFallback, false);
    assert.equal(entry.orderId, orderId);
    assert.equal(entry.orderNumber, `${RUN}-ORD-s1`);
    assert.equal(entry.branchId, BR_A1);
    assert.equal(entry.isCash, true);
    assert.equal(entry.shiftAttributed, false); // no shiftId → kept, flagged
    assert.equal(entry.onCancelledOrder, false);

    assert.equal(res.summary.totalIn, 100000);
    assert.equal(res.summary.totalOut, 0);
    assert.equal(res.summary.netMovement, 100000);
    assert.deepEqual(res.summary.inflow, {
      kasir: 100000,
      qris: 0,
      other: 0,
      total: 100000,
    });
    assert.deepEqual(res.summary.attributableCash, {
      in: 100000,
      out: 0,
      net: 100000,
    });
    assert.deepEqual(res.summary.nonCash, { in: 0, out: 0, net: 0 });
    assert.deepEqual(res.summary.unattributedShift, {
      count: 1,
      inAmount: 100000,
      outAmount: 0,
    });
    assert.equal(res.summary.openingBalance, null); // never fabricated
    assert.equal(res.summary.qrisSettlementVerified, false);
    assert.equal(res.meta.truncated, false);
    assert.ok(res.meta.methods.includes("KASIR"));
    assert.ok(res.meta.types.includes("IN"));
    assert.equal(res.filters.dateFrom, D.oct1);
    assert.equal(res.filters.dateTo, D.oct1);
  });

  // ------------------------------------------------------------------
  // 2. Split tender / multiple collected payments
  // ------------------------------------------------------------------
  it("2. split tender counts each collected payment once (no per-order aggregation)", async () => {
    const orderId = await mkOrder("s2", 200000);
    const payKasir = await mkPayment("s2a", orderId, 120000, {
      method: "KASIR",
      paidAt: T.oct2a,
    });
    const payQris = await mkPayment("s2b", orderId, 80000, {
      method: "QRIS",
      paidAt: T.oct2b,
    });

    const res = await cb(REST_A, { dateFrom: D.oct2, dateTo: D.oct2 });

    assert.equal(res.total, 2);
    assert.deepEqual(
      res.items.map((i) => i.id).sort(),
      [`payment:${payKasir}`, `payment:${payQris}`].sort()
    );
    // Newest first (paidAt desc, stable id tiebreak).
    assert.equal(res.items[0].id, `payment:${payQris}`);
    assert.equal(res.items[1].id, `payment:${payKasir}`);
    // Sum of the collected payments equals the order total — exactly once.
    assert.equal(res.summary.totalIn, 200000);
    assert.equal(res.summary.inflow.kasir, 120000);
    assert.equal(res.summary.inflow.qris, 80000);
    assert.equal(res.summary.attributableCash.in, 120000);
    assert.equal(res.summary.nonCash.in, 80000);
    assert.equal(res.summary.netMovement, 200000);
    assert.equal(res.summary.unattributedShift.count, 2);
    // QRIS is kept in a separate bucket and never claimed as settled cash.
    const qrisEntry = res.items.find((i) => i.method === "QRIS");
    assert.equal(qrisEntry?.isCash, false);
    assert.equal(qrisEntry?.settlementVerified, false);

    // Pagination over the merged list is stable.
    const page1 = await cb(REST_A, { dateFrom: D.oct2, dateTo: D.oct2, limit: 1 });
    assert.equal(page1.total, 2);
    assert.equal(page1.totalPages, 2);
    assert.equal(page1.items.length, 1);
    assert.equal(page1.items[0].id, `payment:${payQris}`);
    const page2 = await cb(REST_A, {
      dateFrom: D.oct2,
      dateTo: D.oct2,
      limit: 1,
      page: 2,
    });
    assert.equal(page2.items[0].id, `payment:${payKasir}`);
  });

  // ------------------------------------------------------------------
  // 3. Duplicate payment callback must not double count
  // ------------------------------------------------------------------
  it("3. a duplicate collection callback does not double count", async () => {
    const orderId = await mkOrder("s3", 50000, { paymentStatus: "UNPAID" });
    const paymentId = await mkPayment("s3", orderId, 50000, {
      method: "KASIR",
      status: "UNPAID",
      paidAt: null,
    });

    const service = new PaymentService();
    const first = await service.markCashierPaymentPaid(paymentId, REST_A, USER_A);
    const second = await service.markCashierPaymentPaid(paymentId, REST_A, USER_A);

    assert.equal(first.alreadyPaid, false, "first collection must settle the row");
    assert.equal(second.alreadyPaid, true, "the repeat callback must be a no-op");

    // The idempotency guard left exactly ONE mirror transaction.
    const mirrorCount = await prisma.paymentTransaction.count({
      where: { paymentId },
    });
    assert.equal(mirrorCount, 1);

    // Cashbook recognises the money exactly once, on the stored cash date.
    const stored = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { paidAt: true, createdAt: true, status: true },
    });
    assert.equal(stored.status, "PAID");
    assert.ok(stored.paidAt instanceof Date, "the settlement stamped a cash date");

    // FIXTURE MANEUVER (documented, no production change): the settlement service
    // stamps `paidAt = now`, so this one cash movement would be dated on the RUN
    // date and leak into every window that happens to be that calendar day. The
    // timestamp is therefore RELOCATED onto this suite's dedicated day (the same
    // technique the P&L suite documents) which keeps the read window
    // deterministic and independent of when the suite is executed.
    await prisma.payment.update({
      where: { id: paymentId },
      data: { paidAt: T.oct3 },
    });
    const pinned = await prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
      select: { paidAt: true },
    });
    assert.equal(
      localDateOnly(pinned.paidAt as Date),
      D.oct3,
      "the pinned cash day is deterministic"
    );

    const res = await cb(REST_A, { dateFrom: D.oct3, dateTo: D.oct3 });
    assert.equal(res.total, 1, "exactly one movement on the pinned day");
    assert.equal(res.items[0].id, `payment:${paymentId}`);
    assert.equal(res.items[0].date, T.oct3.toISOString());
    assert.equal(res.summary.totalIn, 50000);
    assert.equal(res.summary.netMovement, 50000);
  });

  // ------------------------------------------------------------------
  // 4. PaymentTransaction is not an additional cash movement
  // ------------------------------------------------------------------
  it("4. PaymentTransaction rows are never counted as extra cash movement", async () => {
    const orderId = await mkOrder("s4", 75000);
    const paymentId = await mkPayment("s4", orderId, 75000, {
      method: "KASIR",
      paidAt: T.oct4,
    });

    // A cashier mirror, a duplicate callback the bridge ignored, and the
    // negative refund row the gateway mirror stores on the same payment.
    await createPaymentTransactionFixture(prisma, {
      paymentId,
      provider: "cashier",
      type: "cashier_payment",
      status: "PAID",
      amount: 75000,
    });
    await createPaymentTransactionFixture(prisma, {
      paymentId,
      provider: "ipaymu",
      type: "webhook",
      status: "IGNORED_STALE",
      amount: 75000,
    });
    await createPaymentTransactionFixture(prisma, {
      paymentId,
      provider: "ipaymu",
      type: "refund",
      status: "APPROVED",
      amount: -75000,
    });

    assert.equal(await prisma.paymentTransaction.count({ where: { paymentId } }), 3);

    const res = await cb(REST_A, { dateFrom: D.oct4, dateTo: D.oct4 });

    assert.equal(res.total, 1, "only the Payment row is a cash movement");
    assert.equal(res.items[0].id, `payment:${paymentId}`);
    assert.equal(res.summary.totalIn, 75000);
    assert.equal(res.summary.totalOut, 0, "the mirrored refund row is not an outflow");
    assert.equal(res.summary.netMovement, 75000);
    assert.equal(
      res.items.some((i) => i.source === "REFUND"),
      false
    );
  });

  // ------------------------------------------------------------------
  // 5. Partial approved refund
  // ------------------------------------------------------------------
  it("5. a partial approved refund is one OUT movement for its approvedAt day", async () => {
    const orderId = await mkOrder("s5", 100000);
    const paymentId = await mkPayment("s5", orderId, 100000, {
      method: "KASIR",
      paidAt: T.oct5payment,
    });
    const refundId = await mkRefund("s5", orderId, 40000, {
      paymentId,
      status: "APPROVED",
      approvedAt: T.oct5refund,
    });

    const res = await cb(REST_A, { dateFrom: D.oct5, dateTo: D.oct5 });

    assert.equal(res.total, 2);
    const refund = res.items.find((i) => i.id === `refund:${refundId}`);
    assert.ok(refund, "the approved refund must appear");
    assert.equal(refund.source, "REFUND");
    assert.equal(refund.type, "OUT");
    assert.equal(refund.amount, 40000);
    assert.equal(refund.signedAmount, -40000);
    assert.equal(refund.date, T.oct5refund.toISOString());
    assert.equal(refund.method, "KASIR", "method follows the parent payment");
    assert.equal(refund.isCash, true);
    assert.equal(refund.reference, `${RUN}-ORD-s5`);

    assert.equal(res.summary.totalIn, 100000);
    assert.equal(res.summary.totalOut, 40000);
    assert.equal(res.summary.netMovement, 60000);
    assert.equal(res.summary.outflow.refundKasir, 40000);
    assert.deepEqual(res.summary.attributableCash, {
      in: 100000,
      out: 40000,
      net: 60000,
    });
  });

  // ------------------------------------------------------------------
  // 6. Full approved refund
  // ------------------------------------------------------------------
  it("6. a full approved refund nets the collection to zero", async () => {
    const orderId = await mkOrder("s6", 150000, { paymentStatus: "REFUNDED" });
    const paymentId = await mkPayment("s6", orderId, 150000, {
      method: "KASIR",
      status: "REFUNDED",
      paidAt: T.oct6,
    });
    const refundId = await mkRefund("s6", orderId, 150000, {
      paymentId,
      status: "APPROVED",
      approvedAt: T.oct6,
    });

    const res = await cb(REST_A, { dateFrom: D.oct6, dateTo: D.oct6 });

    assert.equal(res.total, 2);
    assert.equal(
      res.items.some((i) => i.id === `payment:${paymentId}`),
      true,
      "a REFUNDED payment WAS collected and must stay in the inflow"
    );
    assert.equal(res.items.some((i) => i.id === `refund:${refundId}`), true);
    assert.equal(res.summary.totalIn, 150000);
    assert.equal(res.summary.totalOut, 150000);
    assert.equal(res.summary.netMovement, 0);
    assert.equal(res.summary.attributableCash.net, 0);
  });

  // ------------------------------------------------------------------
  // 7. Pending / rejected refunds
  // ------------------------------------------------------------------
  it("7. PENDING and REJECTED refunds never reduce the Cashbook", async () => {
    const orderId = await mkOrder("s7", 90000);
    const paymentId = await mkPayment("s7", orderId, 90000, {
      method: "KASIR",
      paidAt: T.oct7,
    });
    await mkRefund("s7-pending", orderId, 30000, {
      paymentId,
      status: "PENDING",
      approvedAt: null,
      createdAt: T.oct7,
    });
    await mkRefund("s7-rejected", orderId, 30000, {
      paymentId,
      status: "REJECTED",
      approvedAt: null,
      createdAt: T.oct7,
    });

    const res = await cb(REST_A, { dateFrom: D.oct7, dateTo: D.oct7 });

    assert.equal(res.total, 1);
    assert.equal(res.items[0].id, `payment:${paymentId}`);
    assert.equal(res.summary.totalOut, 0);
    assert.equal(res.summary.netMovement, 90000);
    assert.equal(
      res.items.some((i) => i.source === "REFUND"),
      false
    );

    // Their createdAt is "today" — a refund is dated by approvedAt only.
    const today = localDateOnly(new Date());
    if (today !== D.oct7) {
      const todayRes = await cb(REST_A, { dateFrom: today, dateTo: today });
      assert.equal(
        todayRes.items.some((i) => i.source === "REFUND" && i.status !== "APPROVED"),
        false
      );
    }
  });

  // ------------------------------------------------------------------
  // 8. Expense uses spentAt
  // ------------------------------------------------------------------
  it("8. an expense is dated by spentAt (not by when it was recorded)", async () => {
    const categoryId = `${RUN}-cat-s8`;
    await createExpenseCategoryFixture(prisma, {
      id: categoryId,
      restaurantId: REST_A,
      name: `${RUN} Operasional`,
    });

    // Created through the real expense service: createdAt = now, spentAt = Oct 8.
    const created = await createExpense(REST_A, USER_A, {
      branchId: BR_A1,
      categoryId,
      amount: 25000,
      spentAt: D.oct8,
      method: "CASH",
      note: `${RUN} gas & air`,
    });

    const res = await cb(REST_A, { dateFrom: D.oct8, dateTo: D.oct8 });

    assert.equal(res.total, 1);
    const entry = res.items[0];
    assert.equal(entry.id, `expense:${created.id}`);
    assert.equal(entry.source, "EXPENSE");
    assert.equal(entry.type, "OUT");
    assert.equal(entry.amount, 25000);
    assert.equal(entry.signedAmount, -25000);
    // The expense service stores `spentAt` as LOCAL midnight of the day-only
    // input, which is the same basis the cashbook query buckets by.
    assert.equal(entry.date, new Date("2026-10-08T00:00:00.000").toISOString());
    assert.equal(entry.method, "CASH");
    assert.equal(entry.isCash, true);
    assert.equal(entry.shiftAttributed, false); // expenses have no drawer shift
    assert.equal(entry.categoryName, `${RUN} Operasional`);
    assert.equal(entry.note, `${RUN} gas & air`);
    assert.equal(res.summary.totalOut, 25000);
    assert.equal(res.summary.outflow.expenseCash, 25000);
    assert.equal(res.summary.netMovement, -25000);

    // Its createdAt (today) must NOT pull it into today's range.
    const today = localDateOnly(new Date());
    if (today !== D.oct8) {
      const todayRes = await cb(REST_A, { dateFrom: today, dateTo: today });
      assert.equal(
        todayRes.items.some((i) => i.id === `expense:${created.id}`),
        false,
        "the expense must be bucketed by spentAt, not createdAt"
      );
    }
  });

  // ------------------------------------------------------------------
  // 9. Payment uses paidAt
  // ------------------------------------------------------------------
  it("9. a payment is dated by paidAt (not by createdAt)", async () => {
    const orderId = await mkOrder("s9", 60000, { createdAt: T.sep29 });
    const paymentId = await mkPayment("s9", orderId, 60000, {
      method: "KASIR",
      paidAt: T.oct9,
      createdAt: T.sep29,
    });

    const sep29 = await cb(REST_A, { dateFrom: D.sep29, dateTo: D.sep29 });
    assert.equal(sep29.total, 0, "createdAt must not drive a cash movement");

    const oct9 = await cb(REST_A, { dateFrom: D.oct9, dateTo: D.oct9 });
    assert.equal(oct9.total, 1);
    assert.equal(oct9.items[0].id, `payment:${paymentId}`);
    assert.equal(oct9.items[0].date, T.oct9.toISOString());
    assert.equal(oct9.items[0].dateFallback, false);
    assert.equal(oct9.summary.totalIn, 60000);
  });

  // ------------------------------------------------------------------
  // 10. Refund uses approvedAt
  // ------------------------------------------------------------------
  it("10. a refund is dated by approvedAt (not createdAt)", async () => {
    const orderId = await mkOrder("s10", 80000, { createdAt: T.sep28 });
    const paymentId = await mkPayment("s10", orderId, 80000, {
      method: "KASIR",
      paidAt: T.sep28,
    });
    const refundId = await mkRefund("s10", orderId, 80000, {
      paymentId,
      status: "APPROVED",
      approvedAt: T.oct10,
      createdAt: T.oct15, // recorded on a different day than the approval
    });

    const sep28 = await cb(REST_A, { dateFrom: D.sep28, dateTo: D.sep28 });
    assert.equal(sep28.total, 1);
    assert.equal(sep28.items[0].id, `payment:${paymentId}`);
    assert.equal(
      sep28.items.some((i) => i.id === `refund:${refundId}`),
      false,
      "the refund belongs to its approval period"
    );

    // createdAt is Oct 15 — still not a cash date.
    const oct15 = await cb(REST_A, { dateFrom: D.oct15, dateTo: D.oct15 });
    assert.equal(oct15.total, 0, "a refund's createdAt is not a cash movement");

    const oct10 = await cb(REST_A, { dateFrom: D.oct10, dateTo: D.oct10 });
    assert.equal(oct10.total, 1);
    assert.equal(oct10.items[0].id, `refund:${refundId}`);
    assert.equal(oct10.items[0].date, T.oct10.toISOString());
    assert.equal(oct10.summary.totalIn, 0);
    assert.equal(oct10.summary.totalOut, 80000);
  });

  // ------------------------------------------------------------------
  // 11. Tenant isolation
  // ------------------------------------------------------------------
  it("11. tenant isolation: a tenant never sees another tenant's movements", async () => {
    const orderA = await mkOrder("s11a", 50000);
    await mkPayment("s11a", orderA, 50000, { method: "KASIR", paidAt: T.oct11 });

    const orderB = await mkOrder("s11b", 40000, {
      restaurantId: REST_B,
      branchId: BR_B1,
      customerId: CUST_B,
    });
    await mkPayment("s11b", orderB, 40000, {
      restaurantId: REST_B,
      branchId: BR_B1,
      method: "KASIR",
      paidAt: T.oct11,
    });

    const resA = await cb(REST_A, { dateFrom: D.oct11, dateTo: D.oct11 });
    const resB = await cb(REST_B, { dateFrom: D.oct11, dateTo: D.oct11 });

    assert.equal(resA.total, 1);
    assert.equal(resA.items[0].id, `payment:${RUN}-s11a-pay`);
    assert.equal(resA.items[0].branchId, BR_A1);
    assert.equal(resA.summary.totalIn, 50000);

    assert.equal(resB.total, 1);
    assert.equal(resB.items[0].id, `payment:${RUN}-s11b-pay`);
    assert.equal(resB.items[0].branchId, BR_B1);
    assert.equal(resB.summary.totalIn, 40000);

    // Explicitly: no cross-tenant leakage in either direction.
    assert.equal(
      resA.items.some((i) => i.branchId === BR_B1),
      false
    );
    assert.equal(
      resB.items.some((i) => i.branchId === BR_A1),
      false
    );
  });

  // ------------------------------------------------------------------
  // 12. Branch isolation (authorizedBranches)
  // ------------------------------------------------------------------
  it("12. branch isolation follows the existing authorizedBranches rule", async () => {
    const orderA1 = await mkOrder("s12a", 30000, { branchId: BR_A1 });
    await mkPayment("s12a", orderA1, 30000, {
      branchId: BR_A1,
      method: "KASIR",
      paidAt: T.oct12,
    });
    const orderA2 = await mkOrder("s12b", 70000, { branchId: BR_A2 });
    await mkPayment("s12b", orderA2, 70000, {
      branchId: BR_A2,
      method: "KASIR",
      paidAt: T.oct12,
    });

    // Tenant-wide admin (no branch filters) sees both branches.
    const all = await cb(REST_A, { dateFrom: D.oct12, dateTo: D.oct12 });
    assert.equal(all.total, 2);
    assert.equal(all.summary.totalIn, 100000);

    // Branch-scoped admin sees only its own branch.
    const onlyA1 = await cb(REST_A, { dateFrom: D.oct12, dateTo: D.oct12 }, [BR_A1]);
    assert.equal(onlyA1.total, 1);
    assert.equal(onlyA1.items[0].id, `payment:${RUN}-s12a-pay`);
    assert.equal(onlyA1.items[0].branchId, BR_A1);
    assert.equal(onlyA1.summary.totalIn, 30000);

    const onlyA2 = await cb(REST_A, { dateFrom: D.oct12, dateTo: D.oct12 }, [BR_A2]);
    assert.equal(onlyA2.total, 1);
    assert.equal(onlyA2.items[0].id, `payment:${RUN}-s12b-pay`);
    assert.equal(onlyA2.summary.totalIn, 70000);

    // Requesting a branch outside the authorized set is rejected, not widened.
    await assert.rejects(
      () =>
        cb(
          REST_A,
          { dateFrom: D.oct12, dateTo: D.oct12, branchId: BR_A2 },
          [BR_A1]
        ),
      (err: unknown) => err instanceof ForbiddenError
    );

    // A branch hint from another tenant resolves to nothing (tenant scope wins).
    const foreignHint = await cb(
      REST_A,
      { dateFrom: D.oct12, dateTo: D.oct12, branchId: BR_B1 }
    );
    assert.equal(foreignHint.total, 0);
    assert.equal(foreignHint.summary.totalIn, 0);
  });

  // ------------------------------------------------------------------
  // 13. Empty date range
  // ------------------------------------------------------------------
  it("13. an empty date range returns an empty, all-zero result", async () => {
    const res = await cb(REST_A, { dateFrom: "2026-10-20", dateTo: "2026-10-21" });

    assert.equal(res.total, 0);
    assert.equal(res.items.length, 0);
    assert.equal(res.totalPages, 0);
    assert.equal(res.summary.totalIn, 0);
    assert.equal(res.summary.totalOut, 0);
    assert.equal(res.summary.netMovement, 0);
    assert.equal(res.summary.inflow.total, 0);
    assert.equal(res.summary.outflow.total, 0);
    assert.deepEqual(res.summary.attributableCash, { in: 0, out: 0, net: 0 });
    assert.deepEqual(res.summary.nonCash, { in: 0, out: 0, net: 0 });
    assert.deepEqual(res.summary.unattributedShift, {
      count: 0,
      inAmount: 0,
      outAmount: 0,
    });
    assert.equal(res.summary.openingBalance, null);
    assert.equal(res.meta.truncated, false);
    // Same local-day helper the service uses: `${date}T00:00:00.000`.
    assert.equal(res.range.start, new Date("2026-10-20T00:00:00.000").toISOString());
    assert.equal(res.range.end, new Date(2026, 9, 21, 23, 59, 59, 999).toISOString());
  });

  // ------------------------------------------------------------------
  // 14. Cross-period behaviour (cash movement dates, not order dates)
  // ------------------------------------------------------------------
  it("14. cross-period: collection is recognised in the period it was collected", async () => {
    const orderId = await mkOrder("s14", 55000, { createdAt: T.sep30 });
    const paymentId = await mkPayment("s14", orderId, 55000, {
      method: "KASIR",
      paidAt: T.oct13,
    });

    // The order was created Sep 30 — that is NOT a cash movement.
    const september = await cb(REST_A, { dateFrom: D.sep30, dateTo: D.sep30 });
    assert.equal(september.total, 0);
    assert.equal(september.summary.netMovement, 0);

    // The collection is recognised on Oct 13.
    const october = await cb(REST_A, { dateFrom: D.oct13, dateTo: D.oct13 });
    assert.equal(october.total, 1);
    assert.equal(october.items[0].id, `payment:${paymentId}`);
    assert.equal(october.items[0].date, T.oct13.toISOString());
    assert.equal(october.summary.totalIn, 55000);

    // Across both periods the money appears exactly once (no double period).
    // NOTE: Cashbook (cash movement dates) is intentionally NOT required to
    // equal Revenue for the same calendar period — that is the existing rule.
    // The span total covers every other scenario in this suite as well, so only
    // the occurrence of THIS payment is asserted here.
    const span = await cb(REST_A, { dateFrom: D.sep30, dateTo: D.oct13 });
    const occurrences = span.items.filter((i) => i.id === `payment:${paymentId}`);
    assert.equal(occurrences.length, 1);
    assert.equal(occurrences[0].date, T.oct13.toISOString());
  });
});
