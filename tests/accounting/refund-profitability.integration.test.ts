/**
 * STEP 2B.3 — REFUND & PROFITABILITY INTEGRATION TESTS (real MariaDB, isolated test DB)
 *
 * Scope (and nothing else): the refund state machine
 * (`src/services/approval/approval.service.ts`) and the profitability read-model
 * (`src/services/profitability/profitability.service.ts` + `coverage.ts`), driven
 * through real Prisma/MariaDB queries and the real production services. P&L and
 * M2 SQL integration tests are NOT part of this phase.
 *
 * AUDITED RULES (see ACCOUNTING-INTEGRATION-TEST-PLAN.md §18.2):
 *   requestRefund : reason ≥ 5 chars; order in tenant (+ branch scope); not
 *                   CANCELLED; ≥ 1 collected payment (PAID | REFUNDED);
 *                   refundable = Σ collected − Σ APPROVED; only ONE PENDING
 *                   refund per order (atomic under an order-row FOR UPDATE);
 *                   quantity-based amounts are DERIVED server-side
 *                   (Σ round2(OrderItem.totalPrice / quantity × qty)).
 *   decideRefund  : guarded PENDING → APPROVED/REJECTED transition (a duplicate
 *                   or racing approval loses with ConflictError and applies
 *                   NOTHING twice); on approval: RefundItem.reversedCogs =
 *                   round2(snapshot.hppUnit × qty) when the snapshot is
 *                   SNAPSHOTTED (else NULL), netPaid = Σcollected − Σapproved,
 *                   fully-refunded payments → REFUNDED, order mirror → PAID
 *                   when netPaid > ε else UNPAID, ONE PaymentTransaction
 *                   mirror (negative), stock restored for COMPLETED orders.
 *   profitability : COGS comes ONLY from SNAPSHOTTED OrderItemCostSnapshot
 *                   rows; coverage decides whether profit exists (an empty
 *                   scope is NO_ITEMS, never COVERED); refund-aware COGS release
 *                   happens ONLY for PARTIAL refunds — a FULL refund keeps all
 *                   incurred COGS (netSales 0 with retainedCogs > 0);
 *                   quantity-based refunds release the frozen exact
 *                   reversedCogs, legacy amount-only refunds fall back to the
 *                   documented pro-rata approximation.
 *
 * Safety: `tests/setup.ts` is imported FIRST — it loads `.env.test`, runs the
 * fail-closed checks and pins `DATABASE_URL` to `TEST_DATABASE_URL` before any
 * service/prisma module is evaluated.
 *
 * Run (from the project root, ONE FILE AT A TIME — the suites assert whole-table
 * baselines):
 *   npx tsx --test tests/accounting/refund-profitability.integration.test.ts
 */

import { assertLiveTestTarget, EXPECTED_TEST_DB } from "../setup"; // MUST stay first (see header)

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { approvalService } from "@/services/approval/approval.service";
import { profitabilityService } from "@/services/profitability/profitability.service";
import type { ProfitabilityProductRow } from "@/services/profitability/profitability.types";
import {
  cleanupRun,
  createBranchFixture,
  createBranchProductFixture,
  createCategoryFixture,
  createCustomerFixture,
  createOrderFixture,
  createOrderItemCostSnapshotFixture,
  createOrderItemFixture,
  createPaymentFixture,
  createPaymentTransactionFixture,
  createProductFixture,
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

const RUN = createRunId("cbrf");
const REST_A = `${RUN}-rest-a`;
const REST_B = `${RUN}-rest-b`;
const BR_A1 = `${RUN}-br-a1`;
const BR_A2 = `${RUN}-br-a2`;
const BR_B1 = `${RUN}-br-b1`;
const USER_A = `${RUN}-user-a`;
const USER_B = `${RUN}-user-b`;
const CUST_A = `${RUN}-cust-a`;
const CUST_B = `${RUN}-cust-b`;
const CATEGORY_A = `${RUN}-cat-a`;

const at = (y: number, m: number, d: number, h = 10, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

function localDateOnly(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Profitability report for restaurant A over an explicit (deterministic) range. */
function profit(
  dateFrom: string,
  dateTo: string = dateFrom,
  branchFilters?: string[] | null,
  productId?: string
) {
  return profitabilityService.getProfitabilityReport(REST_A, "custom", {
    startDate: dateFrom,
    endDate: dateTo,
    branchFilters,
    filters: {
      branchId: null,
      productId: productId ?? null,
      categoryId: null,
      orderType: null,
      paymentMethod: null,
    },
  });
}

function profitFor(restaurantId: string, dateFrom: string, dateTo: string = dateFrom) {
  return profitabilityService.getProfitabilityReport(restaurantId, "custom", {
    startDate: dateFrom,
    endDate: dateTo,
  });
}

function row(report: { products: ProfitabilityProductRow[] }, productId: string) {
  const found = report.products.find((p) => p.productId === productId);
  assert.ok(found, `product row for ${productId} must be present`);
  return found;
}

// ------------------------------------------------------------
// Fixture shorthands (all ids inherit the run prefix).
// ------------------------------------------------------------

interface SoldItem {
  id: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
}

interface SoldOrder {
  orderId: string;
  paymentId: string;
  items: SoldItem[];
}

/**
 * A complete sold order: Order (+items, +frozen COGS snapshots) and one
 * collected KASIR payment. `items[].snapshot` controls the historical cost
 * state (omit it to model a LEGACY item with no snapshot row).
 */
async function mkSoldOrder(
  label: string,
  opts: {
    grandTotal: number;
    createdAt: Date;
    restaurantId?: string;
    branchId?: string;
    customerId?: string;
    subtotal?: number;
    tax?: number;
    orderStatus?: "COMPLETED" | "READY";
    paymentAmount?: number;
    paymentStatus?: "PAID" | "REFUNDED" | "UNPAID";
    items?: Array<{
      productId: string;
      quantity: number;
      unitPrice: number;
      snapshot?: {
        status: "SNAPSHOTTED" | "NO_RECIPE";
        hppUnit?: number | null;
        hppTotal?: number | null;
      };
    }>;
  }
): Promise<SoldOrder> {
  const restaurantId = opts.restaurantId ?? REST_A;
  const customerId = opts.customerId ?? (restaurantId === REST_B ? CUST_B : CUST_A);
  const branchId = opts.branchId ?? (restaurantId === REST_B ? BR_B1 : BR_A1);
  const orderId = `${RUN}-${label}-order`;

  await createOrderFixture(prisma, {
    id: orderId,
    orderNumber: `${RUN}-ORD-${label}`,
    restaurantId,
    branchId,
    customerId,
    grandTotal: opts.grandTotal,
    subtotal: opts.subtotal ?? opts.grandTotal,
    tax: opts.tax ?? 0,
    createdAt: opts.createdAt,
    status: opts.orderStatus ?? "COMPLETED",
    paymentStatus: opts.paymentStatus ?? "PAID",
  });

  const items: SoldItem[] = [];
  let index = 0;
  for (const spec of opts.items ?? []) {
    index += 1;
    const itemId = `${RUN}-${label}-item-${index}`;
    const totalPrice = spec.quantity * spec.unitPrice;
    await createOrderItemFixture(prisma, {
      id: itemId,
      orderId,
      productId: spec.productId,
      quantity: spec.quantity,
      unitPrice: spec.unitPrice,
      totalPrice,
    });
    if (spec.snapshot) {
      await createOrderItemCostSnapshotFixture(prisma, {
        id: `${RUN}-${label}-snap-${index}`,
        restaurantId,
        orderId,
        orderItemId: itemId,
        productId: spec.productId,
        branchId,
        quantity: spec.quantity,
        status: spec.snapshot.status,
        hppUnit: spec.snapshot.hppUnit ?? null,
        hppTotal: spec.snapshot.hppTotal ?? null,
      });
    }
    items.push({ id: itemId, quantity: spec.quantity, unitPrice: spec.unitPrice, totalPrice });
  }

  const paymentStatus = opts.paymentStatus ?? "PAID";
  const paymentId = `${RUN}-${label}-pay`;
  await createPaymentFixture(prisma, {
    id: paymentId,
    restaurantId,
    orderId,
    branchId,
    amount: opts.paymentAmount ?? opts.grandTotal,
    method: "KASIR",
    status: paymentStatus,
    paidAt: paymentStatus === "UNPAID" ? null : opts.createdAt,
    createdAt: opts.createdAt,
  });

  return { orderId, paymentId, items };
}

let productSeq = 0;
async function mkProduct(label: string, price = 25000): Promise<string> {
  productSeq += 1;
  const id = `${RUN}-prod-${label}`;
  await createProductFixture(prisma, {
    id,
    restaurantId: label.startsWith("b-") ? REST_B : REST_A,
    categoryId: CATEGORY_A,
    name: `${RUN} Product ${label}`,
    price,
  });
  void productSeq;
  return id;
}

/**
 * FIXTURE MANEUVER (documented, no production change) — the same technique the
 * P&L suite already uses. `decideRefund` stamps `approvedAt = now` and a refund's
 * `createdAt` defaults to the insert time, so a refund that must be visible in a
 * specific calendar window has its timestamps RELOCATED onto the test's dedicated
 * day. Every read window stays deterministic and independent of the run date, and
 * no assertion is weakened: the write-side effects were already produced by the
 * real services before the relocation.
 */
async function pinRefundDay(refundId: string, day: Date): Promise<void> {
  await prisma.refund.update({
    where: { id: refundId },
    data: {
      createdAt: day,
      approvedAt: new Date(day.getTime() + 60 * 60 * 1000),
    },
  });
}

async function mkApprovedRefundViaService(
  orderId: string,
  amount: number,
  opts: {
    items?: Array<{ orderItemId: string; quantity: number }>;
    restaurantId?: string;
    /** Dedicated calendar day for the approval — see `pinRefundDay`. */
    pinTo?: Date;
  } = {}
) {
  const restaurantId = opts.restaurantId ?? REST_A;
  const refund = await approvalService.requestRefund({
    restaurantId,
    userId: USER_A,
    orderId,
    amount,
    reason: `${RUN} refund request`,
    items: opts.items,
  });
  const decided = await approvalService.decideRefund({
    restaurantId,
    adminId: USER_A,
    refundId: refund.id,
    approve: true,
  });
  if (opts.pinTo) {
    await pinRefundDay(refund.id, opts.pinTo);
  }
  return { refund, decided };
}

// ============================================================
// SUITE
// ============================================================

describe("STEP 2B.3 — Refund & Profitability integration (real MariaDB, isolated test DB)", () => {
  let baseline: ScopedCounts;

  before(async () => {
    baseline = await snapshotCounts(prisma);

    await createRestaurantFixture(prisma, { id: REST_A, name: `${RUN} Restaurant A` });
    await createRestaurantFixture(prisma, { id: REST_B, name: `${RUN} Restaurant B` });
    for (const [id, restaurantId, code, name] of [
      [BR_A1, REST_A, `${RUN}-A1`, "Branch A1"],
      [BR_A2, REST_A, `${RUN}-A2`, "Branch A2"],
      [BR_B1, REST_B, `${RUN}-B1`, "Branch B1"],
    ] as const) {
      await createBranchFixture(prisma, { id, restaurantId, code, name });
    }
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
    await createCategoryFixture(prisma, {
      id: CATEGORY_A,
      restaurantId: REST_A,
      name: `${RUN} Makanan`,
    });
  });

  after(async () => {
    const result = await cleanupRun(prisma, RUN);
    const afterCounts = await snapshotCounts(prisma);
    const residual = await findResiduals(prisma, RUN, result.scope);

    console.log("\n[STEP 2B.3 CLEANUP] rows deleted:", JSON.stringify(result.deleted));
    console.log("[STEP 2B.3 CLEANUP] residual (run-scoped):", JSON.stringify(residual));
    console.log(
      "[STEP 2B.3 CLEANUP] table counts (baseline → after):",
      JSON.stringify(
        Object.fromEntries(
          Object.keys(baseline).map((k) => [
            k,
            `${baseline[k as keyof ScopedCounts]} → ${afterCounts[k as keyof ScopedCounts]}`,
          ])
        )
      )
    );

    await prisma.$disconnect();

    assert.deepEqual(
      afterCounts,
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
  // 1. Runtime test DB identity
  // ------------------------------------------------------------------
  it("1. the runtime connection targets the isolated test database", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ db: string; user: string }>
    >`SELECT CAST(DATABASE() AS CHAR) AS db, CAST(USER() AS CHAR) AS user`;

    const identity = rows[0];
    assert.ok(identity);
    // Centralised live guard (STEP 2C.2F): database name + dedicated user.
    await assertLiveTestTarget(prisma);
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(identity.db, EXPECTED_TEST_DB.name);
    assert.ok(identity.db.includes("_test"));
    assert.notEqual(identity.db, "restaurant_app");
    assert.ok(["127.0.0.1", "localhost"].includes(EXPECTED_TEST_DB.host));
    assert.equal(EXPECTED_TEST_DB.port, process.env.TEST_DB_EXPECTED_PORT ?? "3308");
    assert.ok(process.env.DATABASE_URL?.includes(`/${EXPECTED_TEST_DB.name}`));
    assert.ok(identity.user.startsWith(EXPECTED_TEST_DB.user));
  });

  // ------------------------------------------------------------------
  // 2. Valid partial refund request + approval
  // ------------------------------------------------------------------
  it("2. a valid partial refund can be requested and approved", async () => {
    // Dedicated, explicit calendar day: no fixture in this suite may be dated on
    // the RUN date, otherwise it leaks into another test's window (see
    // `pinRefundDay`).
    const createdAt = at(2026, 10, 1, 10);
    const product = await mkProduct("s2", 50000);
    const sold = await mkSoldOrder("s2", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 2,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 15000, hppTotal: 30000 },
        },
      ],
    });

    const pending = await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: sold.orderId,
      amount: 40000,
      reason: `${RUN} partial refund`,
    });

    assert.equal(pending.status, "PENDING");
    assert.equal(Number(pending.amount), 40000);
    assert.equal(pending.orderId, sold.orderId);
    assert.equal(pending.branchId, BR_A1, "the refund belongs to the order's branch");
    assert.equal(pending.paymentId, sold.paymentId, "linked to the collected cash payment");
    assert.equal(pending.requestedByCashierId, USER_A);
    assert.equal(pending.approvedAt, null);

    const decided = await approvalService.decideRefund({
      restaurantId: REST_A,
      adminId: USER_A,
      refundId: pending.id,
      approve: true,
    });

    assert.equal(decided.status, "APPROVED");
    assert.ok(decided.approvedAt instanceof Date);
    assert.ok(decided.decidedAt instanceof Date);
    assert.equal(decided.approvedByAdminId, USER_A);
    assert.equal(decided.rejectedByAdminId, null);

    // The live stamps above were produced by the real service; pin the approval
    // onto this test's dedicated day so the read window below is deterministic.
    await pinRefundDay(decided.id, createdAt);

    // Half the money is still held → the payment and the order mirror stay PAID.
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: sold.orderId } });
    assert.equal(payment.status, "PAID");
    assert.equal(order.paymentStatus, "PAID");

    // Exactly ONE negative mirror row, sized to the refund.
    const mirrors = await prisma.paymentTransaction.findMany({
      where: { paymentId: sold.paymentId, type: "refund" },
    });
    assert.equal(mirrors.length, 1);
    assert.equal(Number(mirrors[0].amount), -40000);
    assert.equal(mirrors[0].status, "REFUNDED");
    assert.equal(mirrors[0].provider, "cashier");

    // Read-side: a legacy (amount-only) partial refund releases a PRO-RATA share
    // of the covered COGS: 30000 × 40000/100000 = 12000.
    const report = await profit(localDateOnly(createdAt), localDateOnly(createdAt), null, product);
    const productRow = row(report, product);
    assert.equal(productRow.cogs, 30000);
    assert.equal(productRow.cogsReversal, 12000);
    assert.equal(productRow.retainedCogs, 18000);
    assert.equal(productRow.coverageComplete, true);
    assert.equal(productRow.cogsState, "COVERED");
  });

  // ------------------------------------------------------------------
  // 3. Full refund request + approval
  // ------------------------------------------------------------------
  it("3. a full refund returns all money and flips the mirrors", async () => {
    const createdAt = at(2026, 10, 3, 10);
    const product = await mkProduct("s3", 50000);
    const sold = await mkSoldOrder("s3", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 2,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 15000, hppTotal: 30000 },
        },
      ],
    });

    const { decided } = await mkApprovedRefundViaService(sold.orderId, 100000, {
      pinTo: createdAt,
    });

    assert.equal(decided.status, "APPROVED");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: sold.orderId } });
    assert.equal(payment.status, "REFUNDED", "netPaid = 0 → collected payment is REFUNDED");
    assert.equal(order.paymentStatus, "UNPAID", "the order mirror reflects the net balance");

    const mirrors = await prisma.paymentTransaction.findMany({
      where: { paymentId: sold.paymentId, type: "refund" },
    });
    assert.equal(mirrors.length, 1);
    assert.equal(Number(mirrors[0].amount), -100000);

    // Read-side: a FULL refund keeps ALL incurred COGS (no release).
    const report = await profit(localDateOnly(createdAt), localDateOnly(createdAt), null, product);
    const productRow = row(report, product);
    assert.equal(productRow.cogs, 30000);
    assert.equal(productRow.cogsReversal, 0, "a fully refunded order releases NO cost");
    assert.equal(productRow.retainedCogs, 30000);
  });

  // ------------------------------------------------------------------
  // 4. Over-refund / eligibility rejections
  // ------------------------------------------------------------------
  it("4. a request exceeding the refundable amount is rejected", async () => {
    const createdAt = at(2026, 10, 4, 10);
    const product = await mkProduct("s4", 100000);
    const sold = await mkSoldOrder("s4", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });

    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 100001,
          reason: `${RUN} over refund`,
        }),
      (err: unknown) => err instanceof ConflictError
    );
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 0,
          reason: `${RUN} zero refund`,
        }),
      (err: unknown) => err instanceof ValidationError
    );
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 10000,
          reason: "abc",
        }),
      (err: unknown) => err instanceof ValidationError
    );

    // An order with no collected money is not refundable at all.
    const unpaid = await mkSoldOrder("s4-unpaid", {
      grandTotal: 50000,
      createdAt,
      paymentStatus: "UNPAID",
      paymentAmount: 0,
      items: [{ productId: product, quantity: 1, unitPrice: 50000 }],
    });
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: unpaid.orderId,
          amount: 10000,
          reason: `${RUN} unpaid refund`,
        }),
      (err: unknown) => err instanceof ConflictError
    );

    // A CANCELLED order can never be refunded.
    const cancelled = await mkSoldOrder("s4-cancelled", {
      grandTotal: 50000,
      createdAt,
      orderStatus: "COMPLETED",
      items: [{ productId: product, quantity: 1, unitPrice: 50000 }],
    });
    await prisma.order.update({
      where: { id: cancelled.orderId },
      data: { status: "CANCELLED" },
    });
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: cancelled.orderId,
          amount: 10000,
          reason: `${RUN} cancelled refund`,
        }),
      (err: unknown) => err instanceof ConflictError
    );

    // No financial rows were created by any rejected request.
    assert.equal(await prisma.refund.count({ where: { orderId: sold.orderId } }), 0);
    assert.equal(await prisma.refund.count({ where: { orderId: unpaid.orderId } }), 0);
    assert.equal(await prisma.refund.count({ where: { orderId: cancelled.orderId } }), 0);
  });

  // ------------------------------------------------------------------
  // 5. Approved refunds can never exceed the collected amount
  // ------------------------------------------------------------------
  it("5. the sum of approved refunds can never exceed the collected amount", async () => {
    const createdAt = at(2026, 10, 5, 10);
    const product = await mkProduct("s5", 100000);
    const sold = await mkSoldOrder("s5", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });

    await mkApprovedRefundViaService(sold.orderId, 60000, { pinTo: createdAt });

    // 40000 remains refundable — 40001 must be refused.
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 40001,
          reason: `${RUN} exceeds remaining`,
        }),
      (err: unknown) => err instanceof ConflictError
    );
    const approvedAfterReject = await prisma.refund.aggregate({
      where: { orderId: sold.orderId, status: "APPROVED" },
      _sum: { amount: true },
    });
    assert.equal(Number(approvedAfterReject._sum.amount), 60000);

    // The exact remainder is allowed and completes the refund.
    const { decided } = await mkApprovedRefundViaService(sold.orderId, 40000, {
      pinTo: createdAt,
    });
    assert.equal(decided.status, "APPROVED");

    const approved = await prisma.refund.aggregate({
      where: { orderId: sold.orderId, status: "APPROVED" },
      _sum: { amount: true },
    });
    assert.equal(Number(approved._sum.amount), 100000, "never more than collected");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: sold.orderId } });
    assert.equal(payment.status, "REFUNDED");
    assert.equal(order.paymentStatus, "UNPAID");

    // Read-side: the order is FULLY refunded → no COGS release at all.
    const report = await profit(localDateOnly(createdAt), localDateOnly(createdAt), null, product);
    const productRow = row(report, product);
    assert.equal(productRow.cogsReversal, 0);
    assert.equal(productRow.retainedCogs, 60000);
  });

  // ------------------------------------------------------------------
  // 6. Duplicate approval does not duplicate financial impact
  // ------------------------------------------------------------------
  it("6. a duplicate approval is rejected and applies nothing twice", async () => {
    const createdAt = at(2026, 10, 6, 10);
    const product = await mkProduct("s6", 100000);
    const sold = await mkSoldOrder("s6", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });

    const { decided } = await mkApprovedRefundViaService(sold.orderId, 30000);
    const firstApprovedAt = decided.approvedAt;

    // A SEQUENTIAL repeat decision is refused by the PENDING pre-read (the
    // request is no longer PENDING → not found), while a CONCURRENT repeat is
    // refused by the guarded transition (ConflictError, see scenario 7).
    // Either way NOTHING is applied twice.
    await assert.rejects(
      () =>
        approvalService.decideRefund({
          restaurantId: REST_A,
          adminId: USER_A,
          refundId: decided.id,
          approve: true,
        }),
      (err: unknown) => err instanceof NotFoundError
    );
    await assert.rejects(
      () =>
        approvalService.decideRefund({
          restaurantId: REST_A,
          adminId: USER_A,
          refundId: decided.id,
          approve: false,
        }),
      (err: unknown) => err instanceof NotFoundError,
      "a decided refund can never be re-decided (not even to REJECTED)"
    );

    const reloaded = await prisma.refund.findUniqueOrThrow({ where: { id: decided.id } });
    assert.equal(reloaded.status, "APPROVED");
    assert.equal(reloaded.approvedAt?.toISOString(), firstApprovedAt?.toISOString());
    assert.equal(
      await prisma.paymentTransaction.count({
        where: { paymentId: sold.paymentId, type: "refund" },
      }),
      1
    );
    const approved = await prisma.refund.aggregate({
      where: { orderId: sold.orderId, status: "APPROVED" },
      _sum: { amount: true },
    });
    assert.equal(Number(approved._sum.amount), 30000, "the impact is applied exactly once");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId } });
    assert.equal(payment.status, "PAID");

    // Pinned LAST on purpose: the duplicate-decision checks above compare the live
    // `approvedAt` with the reloaded row, which must still be the service stamp.
    await pinRefundDay(decided.id, createdAt);
  });

  // ------------------------------------------------------------------
  // 7. Concurrent approval cannot over-refund
  // ------------------------------------------------------------------
  it("7. concurrent approvals cannot over-refund", async () => {
    const createdAt = at(2026, 10, 7, 10);
    const product = await mkProduct("s7", 100000);
    const sold = await mkSoldOrder("s7", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });

    const pending = await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: sold.orderId,
      amount: 40000,
      reason: `${RUN} concurrent approval`,
    });

    // Two racing approvals of the SAME request (separate transactions).
    const results = await Promise.allSettled([
      approvalService.decideRefund({
        restaurantId: REST_A,
        adminId: USER_A,
        refundId: pending.id,
        approve: true,
      }),
      approvalService.decideRefund({
        restaurantId: REST_A,
        adminId: USER_A,
        refundId: pending.id,
        approve: true,
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    assert.equal(fulfilled.length, 1, "exactly one approval may win");
    assert.equal(rejected.length, 1);
    assert.ok(
      rejected[0].reason instanceof ConflictError,
      `loser must fail with ConflictError (got ${String(rejected[0].reason)})`
    );

    const approved = await prisma.refund.aggregate({
      where: { orderId: sold.orderId, status: "APPROVED" },
      _sum: { amount: true },
    });
    assert.equal(Number(approved._sum.amount), 40000, "the refund is applied once, never twice");
    assert.equal(
      await prisma.paymentTransaction.count({
        where: { paymentId: sold.paymentId, type: "refund" },
      }),
      1
    );

    // Exactly one racing approval won; pin its day (see `pinRefundDay`).
    await pinRefundDay(pending.id, createdAt);

    // Two racing REQUESTS cannot both become PENDING either.
    const product2 = await mkProduct("s7b", 50000);
    const sold2 = await mkSoldOrder("s7b", {
      grandTotal: 50000,
      createdAt,
      items: [
        {
          productId: product2,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 30000, hppTotal: 30000 },
        },
      ],
    });
    const requestResults = await Promise.allSettled([
      approvalService.requestRefund({
        restaurantId: REST_A,
        userId: USER_A,
        orderId: sold2.orderId,
        amount: 20000,
        reason: `${RUN} concurrent request A`,
      }),
      approvalService.requestRefund({
        restaurantId: REST_A,
        userId: USER_A,
        orderId: sold2.orderId,
        amount: 20000,
        reason: `${RUN} concurrent request B`,
      }),
    ]);
    assert.equal(requestResults.filter((r) => r.status === "fulfilled").length, 1);
    assert.equal(
      await prisma.refund.count({ where: { orderId: sold2.orderId, status: "PENDING" } }),
      1,
      "only one PENDING refund per order"
    );
    const requested = await prisma.refund.aggregate({
      where: { orderId: sold2.orderId },
      _sum: { amount: true },
    });
    assert.equal(Number(requested._sum.amount), 20000, "no duplicate refund request landed");
  });

  // ------------------------------------------------------------------
  // 8. PENDING / REJECTED refunds do not reduce recognized totals
  // ------------------------------------------------------------------
  it("8. PENDING and REJECTED refunds never reduce recognized refund totals", async () => {
    // (a) Service path: rejected then still-pending.
    const createdAt = at(2026, 10, 8, 10);
    const product = await mkProduct("s8", 100000);
    const sold = await mkSoldOrder("s8", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });

    const rejectedRequest = await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: sold.orderId,
      amount: 20000,
      reason: `${RUN} rejected refund`,
    });
    const rejected = await approvalService.decideRefund({
      restaurantId: REST_A,
      adminId: USER_A,
      refundId: rejectedRequest.id,
      approve: false,
      decisionNote: `${RUN} declined`,
    });
    assert.equal(rejected.status, "REJECTED");
    assert.equal(rejected.approvedAt, null);

    await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: sold.orderId,
      amount: 30000,
      reason: `${RUN} pending refund`,
    });
    assert.equal(await prisma.refund.count({ where: { orderId: sold.orderId, status: "PENDING" } }), 1);

    // Nothing approved → no refund impact, no mirror row.
    assert.equal(
      await prisma.paymentTransaction.count({
        where: { paymentId: sold.paymentId, type: "refund" },
      }),
      0
    );
    const report = await profit(localDateOnly(createdAt), localDateOnly(createdAt), null, product);
    const productRow = row(report, product);
    assert.equal(productRow.cogs, 60000);
    assert.equal(productRow.cogsReversal, 0);
    assert.equal(productRow.retainedCogs, 60000);

    // (b) Read-side only window: a PENDING and a REJECTED row are invisible.
    const productB = await mkProduct("s8b", 100000);

    const soldB = await mkSoldOrder("s8b", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 2, 10),
      items: [
        {
          productId: productB,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-s8b-pending-ref`,
      restaurantId: REST_A,
      orderId: soldB.orderId,
      paymentId: soldB.paymentId,
      branchId: BR_A1,
      amount: 30000,
      requestedByCashierId: USER_A,
      status: "PENDING",
      approvedAt: null,
      createdAt: at(2026, 10, 2, 11),
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-s8b-rejected-ref`,
      restaurantId: REST_A,
      orderId: soldB.orderId,
      paymentId: soldB.paymentId,
      branchId: BR_A1,
      amount: 20000,
      requestedByCashierId: USER_A,
      status: "REJECTED",
      approvedAt: null,
      createdAt: at(2026, 10, 2, 12),
    });

    const oct2 = await profit("2026-10-02");
    assert.equal(oct2.summary.totalRefund, 0);
    assert.equal(oct2.summary.refundReversal, 0);
    assert.equal(oct2.summary.refundState, "NONE");
    assert.equal(oct2.summary.netSales, 100000);
    assert.equal(oct2.summary.cogs, 60000);
    assert.equal(oct2.summary.cogsReversal, 0);
    assert.equal(oct2.summary.retainedCogs, 60000);
    assert.equal(oct2.summary.grossProfit, 40000);
    assert.equal(oct2.summary.coverageComplete, true);
  });

  // ------------------------------------------------------------------
  // 9. Refund approval date attribution
  // ------------------------------------------------------------------
  it("9. refund impact is attributed to the approval date, not the order date", async () => {
    const product = await mkProduct("s9", 100000);
    const sold = await mkSoldOrder("s9", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 12, 10),
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-s9-ref`,
      restaurantId: REST_A,
      orderId: sold.orderId,
      paymentId: sold.paymentId,
      branchId: BR_A1,
      amount: 40000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 13, 11),
      createdAt: at(2026, 10, 12, 12),
    });

    // Order-date period: the order's revenue and COGS, no refund impact yet.
    const orderPeriod = await profit("2026-10-12");
    assert.equal(orderPeriod.summary.totalRefund, 0);
    assert.equal(orderPeriod.summary.refundState, "NONE");
    assert.equal(orderPeriod.summary.netSales, 100000);
    assert.equal(orderPeriod.summary.cogs, 60000);
    assert.equal(orderPeriod.summary.cogsReversal, 0);
    assert.equal(orderPeriod.summary.retainedCogs, 60000);
    assert.equal(orderPeriod.summary.grossProfit, 40000);

    // Approval-date period: the refund lands here even though the order is older.
    const approvalPeriod = await profit("2026-10-13");
    assert.equal(approvalPeriod.summary.totalRefund, 40000);
    assert.equal(approvalPeriod.summary.refundState, "PARTIAL");
    assert.equal(approvalPeriod.summary.netSales, -40000);
    assert.equal(approvalPeriod.summary.cogs, 0);
    assert.equal(approvalPeriod.summary.cogsReversal, 24000, "60000 × 40000/100000");
    assert.equal(approvalPeriod.summary.retainedCogs, -24000);
    assert.equal(approvalPeriod.summary.coverageComplete, false);
    assert.equal(approvalPeriod.summary.cogsState, "NO_ITEMS");
    assert.equal(approvalPeriod.summary.grossProfit, null);

    // Cross-period invariant: the two periods together retain exactly
    // historical COGS − released share.
    assert.equal(
      orderPeriod.summary.retainedCogs + approvalPeriod.summary.retainedCogs,
      60000 - 24000
    );
  });

  // ------------------------------------------------------------------
  // 10. PaymentTransaction mirror does not double-count refunds
  // ------------------------------------------------------------------
  it("10. the PaymentTransaction mirror is not counted again as refund impact", async () => {
    const product = await mkProduct("s10", 100000);
    const sold = await mkSoldOrder("s10", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 15, 10),
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    const refund = await createRefundFixture(prisma, {
      id: `${RUN}-s10-ref`,
      restaurantId: REST_A,
      orderId: sold.orderId,
      paymentId: sold.paymentId,
      branchId: BR_A1,
      amount: 40000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 15, 11),
      createdAt: at(2026, 10, 15, 10, 30),
    });
    void refund;

    // The gateway/cashier mirror rows the write path produces (duplicated on
    // purpose) — they must never add a second refund impact.
    for (const label of ["a", "b"]) {
      await createPaymentTransactionFixture(prisma, {
        paymentId: sold.paymentId,
        provider: "cashier",
        type: "refund",
        status: "REFUNDED",
        amount: -40000,
      });
      void label;
    }
    assert.equal(
      await prisma.paymentTransaction.count({
        where: { paymentId: sold.paymentId, type: "refund" },
      }),
      2
    );

    const report = await profit("2026-10-15");
    assert.equal(report.summary.totalRefund, 40000, "the Refund row is counted once");
    assert.equal(report.summary.refundReversal, 40000);
    assert.equal(report.summary.netSales, 60000);
    assert.equal(report.summary.cogsReversal, 24000, "mirror rows add no COGS reversal");
    assert.equal(report.summary.retainedCogs, 36000);
    assert.equal(report.summary.grossProfit, 24000);
    assert.equal(report.summary.refundState, "PARTIAL");
  });

  // ------------------------------------------------------------------
  // 11. Item-based partial refund with quantity
  // ------------------------------------------------------------------
  it("11. a quantity-based partial refund derives the amount and freezes exact COGS", async () => {
    const createdAt = at(2026, 10, 9, 10);
    const productA = await mkProduct("s11a", 25000);
    const productB = await mkProduct("s11b", 50000);
    const sold = await mkSoldOrder("s11", {
      grandTotal: 125000,
      createdAt,
      items: [
        {
          productId: productA,
          quantity: 3,
          unitPrice: 25000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 15000, hppTotal: 45000 },
        },
        {
          productId: productB,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 20000, hppTotal: 20000 },
        },
      ],
    });
    const itemA = sold.items[0];

    // The client sends a decoy amount; the service derives it from quantities.
    const { refund, decided } = await mkApprovedRefundViaService(sold.orderId, 1, {
      items: [{ orderItemId: itemA.id, quantity: 2 }],
      pinTo: createdAt,
    });

    assert.equal(Number(refund.amount), 50000, "2/3 of 75000, derived server-side");
    assert.equal(Number(decided.amount), 50000);

    const refundItems = await prisma.refundItem.findMany({ where: { refundId: refund.id } });
    assert.equal(refundItems.length, 1);
    assert.equal(refundItems[0].orderItemId, itemA.id);
    assert.equal(refundItems[0].quantity, 2);
    assert.equal(Number(refundItems[0].amount), 50000);
    assert.equal(
      Number(refundItems[0].reversedCogs),
      30000,
      "frozen from the snapshot: hppUnit 15000 × 2"
    );

    // Read-side uses the frozen exact value for the refunded product only.
    const day = localDateOnly(createdAt);
    const reportA = await profit(day, day, null, productA);
    const rowA = row(reportA, productA);
    assert.equal(rowA.cogs, 45000);
    assert.equal(rowA.cogsReversal, 30000);
    assert.equal(rowA.retainedCogs, 15000);
    const reportB = await profit(day, day, null, productB);
    const rowB = row(reportB, productB);
    assert.equal(rowB.cogs, 20000);
    assert.equal(rowB.cogsReversal, 0, "the untouched product keeps its cost");

    // Allocation guards.
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 1,
          reason: `${RUN} over quantity`,
          items: [{ orderItemId: itemA.id, quantity: 2 }],
        }),
      (err: unknown) => err instanceof ConflictError,
      "only 1 unit of item A remains refundable"
    );
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 1,
          reason: `${RUN} beyond purchased`,
          items: [{ orderItemId: sold.items[1].id, quantity: 2 }],
        }),
      (err: unknown) => err instanceof ValidationError
    );
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 1,
          reason: `${RUN} duplicate allocation`,
          items: [
            { orderItemId: itemA.id, quantity: 1 },
            { orderItemId: itemA.id, quantity: 1 },
          ],
        }),
      (err: unknown) => err instanceof ValidationError
    );

    // An item from ANOTHER order is never refundable here.
    const foreign = await mkSoldOrder("s11-foreign", {
      grandTotal: 10000,
      createdAt,
      items: [{ productId: productA, quantity: 1, unitPrice: 10000 }],
    });
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold.orderId,
          amount: 1,
          reason: `${RUN} foreign item`,
          items: [{ orderItemId: foreign.items[0].id, quantity: 1 }],
        }),
      (err: unknown) => err instanceof ValidationError
    );
  });

  // ------------------------------------------------------------------
  // 12. Full item refund with historical COGS snapshot
  // ------------------------------------------------------------------
  it("12. a full item refund freezes exact COGS but releases none (full-refund rule)", async () => {
    const createdAt = at(2026, 10, 11, 10);
    const product = await mkProduct("s12", 25000);
    const sold = await mkSoldOrder("s12", {
      grandTotal: 50000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 2,
          unitPrice: 25000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 15000, hppTotal: 30000 },
        },
      ],
    });

    const { refund, decided } = await mkApprovedRefundViaService(sold.orderId, 1, {
      items: [{ orderItemId: sold.items[0].id, quantity: 2 }],
      pinTo: createdAt,
    });
    assert.equal(Number(refund.amount), 50000);
    assert.equal(decided.status, "APPROVED");

    const refundItem = await prisma.refundItem.findFirstOrThrow({ where: { refundId: refund.id } });
    assert.equal(Number(refundItem.reversedCogs), 30000, "write-side freezes the exact value");

    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: sold.paymentId } });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: sold.orderId } });
    assert.equal(payment.status, "REFUNDED");
    assert.equal(order.paymentStatus, "UNPAID");
    assert.equal(
      await prisma.paymentTransaction.count({
        where: { paymentId: sold.paymentId, type: "refund" },
      }),
      1
    );

    // Read-side: the order is FULLY refunded → the frozen reversal is NOT applied.
    const day = localDateOnly(createdAt);
    const report = await profit(day, day, null, product);
    const productRow = row(report, product);
    assert.equal(productRow.cogs, 30000);
    assert.equal(productRow.cogsReversal, 0);
    assert.equal(productRow.retainedCogs, 30000);
  });

  // ------------------------------------------------------------------
  // 13. Legacy refund without RefundItem (audited divergence, §6)
  // ------------------------------------------------------------------
  it("13. a legacy amount-only refund projects pro-rata COGS (no write-side record)", async () => {
    const productA = await mkProduct("s13a", 25000);
    const productB = await mkProduct("s13b", 50000);

    // Legacy order: two items, covered COGS 30000 + 20000 = 50000.
    const legacy = await mkSoldOrder("s13-legacy", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 17, 10),
      items: [
        {
          productId: productA,
          quantity: 2,
          unitPrice: 25000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 15000, hppTotal: 30000 },
        },
        {
          productId: productB,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 20000, hppTotal: 20000 },
        },
      ],
    });
    const legacyRefundId = `${RUN}-s13-legacy-ref`;
    await createRefundFixture(prisma, {
      id: legacyRefundId,
      restaurantId: REST_A,
      orderId: legacy.orderId,
      paymentId: legacy.paymentId,
      branchId: BR_A1,
      amount: 40000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 17, 12),
      createdAt: at(2026, 10, 17, 11),
    });
    assert.equal(
      await prisma.refundItem.count({ where: { refundId: legacyRefundId } }),
      0,
      "the legacy path writes NO RefundItem rows (so no frozen reversal)"
    );

    const legacyReport = await profit("2026-10-17");
    assert.equal(legacyReport.summary.totalSales, 100000);
    assert.equal(legacyReport.summary.totalRefund, 40000);
    assert.equal(legacyReport.summary.netSales, 60000);
    assert.equal(legacyReport.summary.historicalCogs, 50000);
    assert.equal(
      legacyReport.summary.cogsReversal,
      20000,
      "read-side pro-rata: 50000 × 40000/100000"
    );
    assert.equal(legacyReport.summary.retainedCogs, 30000);
    assert.equal(legacyReport.summary.grossProfit, 30000);
    assert.equal(legacyReport.summary.refundState, "PARTIAL");
    // Product split follows each product's covered-cost share.
    const legacyA = await profit("2026-10-17", "2026-10-17", null, productA);
    const legacyB = await profit("2026-10-17", "2026-10-17", null, productB);
    assert.equal(row(legacyA, productA).cogsReversal, 12000);
    assert.equal(row(legacyB, productB).cogsReversal, 8000);

    // Structurally identical order, but the refund carries an EXACT allocation
    // (the state T11/T12 prove the service writes): rev A qty 2 for 50000.
    const allocated = await mkSoldOrder("s13-allocated", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 18, 10),
      items: [
        {
          productId: productA,
          quantity: 2,
          unitPrice: 25000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 15000, hppTotal: 30000 },
        },
        {
          productId: productB,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 20000, hppTotal: 20000 },
        },
      ],
    });
    const allocatedRefundId = `${RUN}-s13-allocated-ref`;
    await createRefundFixture(prisma, {
      id: allocatedRefundId,
      restaurantId: REST_A,
      orderId: allocated.orderId,
      paymentId: allocated.paymentId,
      branchId: BR_A1,
      amount: 50000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 18, 12),
      createdAt: at(2026, 10, 18, 11),
    });
    await prisma.refundItem.create({
      data: {
        id: `${RUN}-s13-allocated-refitem`,
        refundId: allocatedRefundId,
        orderItemId: allocated.items[0].id,
        quantity: 2,
        amount: 50000,
        reversedCogs: 30000,
      },
    });

    const allocatedReport = await profit("2026-10-18");
    assert.equal(allocatedReport.summary.totalRefund, 50000);
    assert.equal(allocatedReport.summary.netSales, 50000);
    assert.equal(allocatedReport.summary.cogsReversal, 30000, "exact frozen COGS, not pro-rata");
    assert.equal(allocatedReport.summary.retainedCogs, 20000);
    assert.equal(allocatedReport.summary.grossProfit, 30000);

    // §6 comparison: for the SAME refund amount the two bases disagree when the
    // refunded item's cost ratio differs from the order average.
    const proRataForAllocated = Math.round((50000 * (50000 / 100000)) * 100) / 100;
    assert.equal(proRataForAllocated, 25000);
    assert.notEqual(
      proRataForAllocated,
      30000,
      "pro-rata (uniform-cost assumption) ≠ exact allocation for a costlier item"
    );
    // Both refunds are single-basis: no double counting anywhere.
    assert.equal(await prisma.refundItem.count({ where: { refundId: legacyRefundId } }), 0);
    assert.equal(await prisma.refundItem.count({ where: { refundId: allocatedRefundId } }), 1);
  });

  // ------------------------------------------------------------------
  // 14. Write-side vs read-side COGS reversal consistency
  // ------------------------------------------------------------------
  it("14. write-side frozen COGS equals the read-side reversal for item-based refunds", async () => {
    // (a) Item-based: Σ RefundItem.reversedCogs === reported cogsReversal.
    // The item-based refunds are unique per product, so scope the lookup to the
    // product created for scenario 11 to keep it deterministic.
    const s11ProductId = `${RUN}-prod-s11a`;
    const s11Refund = await prisma.refundItem.findFirstOrThrow({
      where: { orderItem: { productId: s11ProductId } },
      select: { refundId: true },
    });
    const itemBasedRefund = await prisma.refund.findUniqueOrThrow({
      where: { id: s11Refund.refundId },
      include: { items: { include: { orderItem: { select: { productId: true } } } } },
    });
    const frozenTotal = itemBasedRefund.items.reduce(
      (sum, i) => sum + Number(i.reversedCogs ?? 0),
      0
    );
    assert.ok(frozenTotal > 0, "an item-based refund must have frozen a reversal");
    const productId = itemBasedRefund.items[0].orderItem.productId;
    const approvedDay = localDateOnly(itemBasedRefund.approvedAt as Date);
    const readSide = await profit(approvedDay, approvedDay, null, productId);
    const readSideRow = row(readSide, productId);
    assert.equal(
      readSideRow.cogsReversal,
      Math.round(frozenTotal * 100) / 100,
      "write-side frozen value and read-side reversal must agree exactly"
    );

    // The frozen value is exactly snapshot.hppUnit × refunded quantity.
    const firstItem = itemBasedRefund.items[0];
    const snapshot = await prisma.orderItemCostSnapshot.findFirstOrThrow({
      where: { orderItemId: firstItem.orderItemId, status: "SNAPSHOTTED" },
    });
    assert.equal(
      Number(firstItem.reversedCogs),
      Math.round(Number(snapshot.hppUnit) * firstItem.quantity * 100) / 100
    );

    // (b) Legacy: the write side recorded nothing, yet the read side projects
    //     the documented pro-rata share — a deliberate, documented projection.
    const legacyRefund = await prisma.refund.findUniqueOrThrow({
      where: { id: `${RUN}-s13-legacy-ref` },
      include: { order: { select: { grandTotal: true } } },
    });
    assert.equal(await prisma.refundItem.count({ where: { refundId: legacyRefund.id } }), 0);
    const legacySnapshots = await prisma.orderItemCostSnapshot.aggregate({
      where: { orderId: legacyRefund.orderId, status: "SNAPSHOTTED" },
      _sum: { hppTotal: true },
    });
    const covered = Number(legacySnapshots._sum.hppTotal ?? 0);
    const legacyDay = localDateOnly(legacyRefund.approvedAt as Date);
    const legacyRead = await profit(legacyDay, legacyDay, null, undefined);
    const expectedProRata =
      Math.round(
        covered * Math.min(1, Number(legacyRefund.amount) / Number(legacyRefund.order.grandTotal)) * 100
      ) / 100;
    assert.equal(
      legacyRead.summary.cogsReversal,
      expectedProRata,
      "the read-side legacy fallback is exactly the documented pro-rata formula"
    );
    assert.equal(
      covered > 0 && legacyRead.summary.cogsReversal > 0,
      true,
      "legacy: write-side 0 vs read-side pro-rata > 0 (distinct projections)"
    );
  });

  // ------------------------------------------------------------------
  // 15. Historical snapshot, not current HPP
  // ------------------------------------------------------------------
  it("15. product profitability uses the historical snapshot, not the current HPP", async () => {
    const product = await mkProduct("s15", 100000);
    // Plant a very different CURRENT cost for this branch+product.
    await createBranchProductFixture(prisma, {
      id: `${RUN}-s15-branchproduct`,
      branchId: BR_A1,
      productId: product,
      costingMode: "MANUAL",
      manualHpp: 99000,
    });
    const sold = await mkSoldOrder("s15", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 19, 10),
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    void sold;

    const branchProduct = await prisma.branchProduct.findFirstOrThrow({
      where: { productId: product },
      select: { manualHpp: true, costingMode: true },
    });
    assert.equal(Number(branchProduct.manualHpp), 99000);
    assert.equal(branchProduct.costingMode, "MANUAL");

    const report = await profit("2026-10-19", "2026-10-19", null, product);
    const productRow = row(report, product);
    assert.equal(productRow.cogs, 60000, "historical snapshot wins");
    assert.notEqual(productRow.cogs, 99000, "the current manual HPP is never used here");
    assert.equal(productRow.coverageComplete, true);
    assert.equal(productRow.netSales, 100000);
    assert.equal(productRow.grossProfit, 40000);
    assert.equal(productRow.grossMarginPct, 40);
    assert.equal(productRow.foodCostPct, 60);
  });

  // ------------------------------------------------------------------
  // 16. Missing snapshot coverage → INCOMPLETE / null profit
  // ------------------------------------------------------------------
  it("16. missing snapshot coverage yields INCOMPLETE coverage and null profit", async () => {
    const product = await mkProduct("s16", 100000);
    const sold = await mkSoldOrder("s16", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 20, 10),
      items: [{ productId: product, quantity: 1, unitPrice: 100000 }], // no snapshot row
    });
    void sold;
    // Revenue without items (D1 disclosure), in the same window.
    const headless = await mkSoldOrder("s16-headless", {
      grandTotal: 70000,
      createdAt: at(2026, 10, 20, 11),
      items: [],
    });
    assert.equal(await prisma.orderItem.count({ where: { orderId: headless.orderId } }), 0);

    const legacyWindow = await profit("2026-10-20");
    assert.deepEqual(legacyWindow.summary.coverage, {
      totalOrderItems: 1,
      costedOrderItems: 0,
      uncostedOrderItems: 0,
      legacyOrderItems: 1,
      pendingOrderItems: 0,
    });
    assert.equal(legacyWindow.summary.coverageComplete, false);
    assert.equal(legacyWindow.summary.cogsState, "LEGACY");
    assert.equal(legacyWindow.summary.cogs, 0, "missing COGS is never fabricated as 0");
    assert.equal(legacyWindow.summary.netSales, 170000);
    assert.equal(legacyWindow.summary.grossProfit, null, "profit is UNKNOWN, not revenue − 0");
    assert.equal(legacyWindow.summary.grossMarginPct, null);
    assert.equal(legacyWindow.summary.foodCostPct, null);
    assert.deepEqual(legacyWindow.summary.revenueWithoutItems, {
      orders: 1,
      headerValue: 70000,
    });
    const productRow = row(legacyWindow, product);
    assert.equal(productRow.cogsState, "LEGACY");
    assert.equal(productRow.coverageComplete, false);
    assert.equal(productRow.grossProfit, null);

    // PARTIAL coverage: one covered item + one snapshot whose status is not
    // SNAPSHOTTED (NO_RECIPE) → COGS known only for part of the order.
    const productP = await mkProduct("s16p", 50000);
    const productQ = await mkProduct("s16q", 30000);
    await mkSoldOrder("s16-partial", {
      grandTotal: 80000,
      createdAt: at(2026, 10, 21, 10),
      items: [
        {
          productId: productP,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 20000, hppTotal: 20000 },
        },
        {
          productId: productQ,
          quantity: 1,
          unitPrice: 30000,
          snapshot: { status: "NO_RECIPE", hppUnit: null, hppTotal: null },
        },
      ],
    });

    const partial = await profit("2026-10-21");
    assert.deepEqual(partial.summary.coverage, {
      totalOrderItems: 2,
      costedOrderItems: 1,
      uncostedOrderItems: 1,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.equal(partial.summary.coverageComplete, false);
    assert.equal(partial.summary.cogsState, "PARTIAL");
    assert.equal(partial.summary.cogs, 20000);
    assert.equal(partial.summary.netSales, 80000);
    assert.equal(partial.summary.grossProfit, null);
  });

  // ------------------------------------------------------------------
  // 17. Explicit zero HPP ≠ missing HPP
  // ------------------------------------------------------------------
  it("17. an explicit zero historical HPP is a real cost, missing HPP is not", async () => {
    const product = await mkProduct("s17", 50000);
    await mkSoldOrder("s17", {
      grandTotal: 50000,
      createdAt: at(2026, 10, 22, 10),
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 0, hppTotal: 0 },
        },
      ],
    });

    const zeroCost = await profit("2026-10-22");
    assert.deepEqual(zeroCost.summary.coverage, {
      totalOrderItems: 1,
      costedOrderItems: 1,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.equal(zeroCost.summary.coverageComplete, true, "a valid zero cost IS covered");
    assert.equal(zeroCost.summary.cogsState, "COVERED");
    assert.equal(zeroCost.summary.cogs, 0);
    assert.equal(zeroCost.summary.grossProfit, 50000);
    const productRow = row(zeroCost, product);
    assert.equal(productRow.foodCostPct, 0);
    assert.equal(productRow.grossMarginPct, 100);

    // Contrast: the LEGACY window (missing snapshot) reports null, never 0-margin profit.
    const missing = await profit("2026-10-20");
    assert.equal(missing.summary.cogsState, "LEGACY");
    assert.equal(missing.summary.grossProfit, null);
  });

  // ------------------------------------------------------------------
  // 18. Rounding and fractional refund allocation
  // ------------------------------------------------------------------
  it("18. fractional refund amounts and pro-rata COGS round deterministically", async () => {
    // (a) Service path: a 3-unit line whose unit share is non-terminating.
    const createdAt = at(2026, 10, 14, 10);
    const product = await mkProduct("s18", 33333.33);
    const sold = await mkSoldOrder("s18", {
      grandTotal: 100000,
      createdAt,
      items: [
        {
          productId: product,
          quantity: 3,
          unitPrice: 33333.33,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 12000.11, hppTotal: 36000.33 },
        },
      ],
    });
    // totalPrice is 99999.99; the service prices per unit as totalPrice/quantity.
    const { refund } = await mkApprovedRefundViaService(sold.orderId, 1, {
      items: [{ orderItemId: sold.items[0].id, quantity: 2 }],
      pinTo: createdAt,
    });
    assert.equal(Number(refund.amount), 66666.66, "round2(99999.99/3 × 2)");
    const refundItem = await prisma.refundItem.findFirstOrThrow({ where: { refundId: refund.id } });
    assert.equal(Number(refundItem.amount), 66666.66);
    assert.equal(Number(refundItem.reversedCogs), 24000.22, "round2(12000.11 × 2)");

    const day = localDateOnly(createdAt);
    const report = await profit(day, day, null, product);
    const productRow = row(report, product);
    assert.equal(productRow.cogsReversal, 24000.22);
    assert.equal(productRow.retainedCogs, 12000.11);

    // (b) Legacy pro-rata on a 1/3 refund → round2 of a repeating fraction.
    const productL = await mkProduct("s18l", 10000);
    const legacy = await mkSoldOrder("s18l", {
      grandTotal: 30000,
      createdAt: at(2026, 10, 24, 10),
      items: [
        {
          productId: productL,
          quantity: 3,
          unitPrice: 10000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 3333.33, hppTotal: 10000 },
        },
      ],
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-s18l-ref`,
      restaurantId: REST_A,
      orderId: legacy.orderId,
      paymentId: legacy.paymentId,
      branchId: BR_A1,
      amount: 10000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 24, 12),
      createdAt: at(2026, 10, 24, 11),
    });

    const legacyReport = await profit("2026-10-24");
    assert.equal(legacyReport.summary.totalRefund, 10000);
    assert.equal(legacyReport.summary.netSales, 20000);
    assert.equal(legacyReport.summary.cogs, 10000);
    assert.equal(legacyReport.summary.cogsReversal, 3333.33, "round2(10000 × 1/3)");
    assert.equal(legacyReport.summary.retainedCogs, 6666.67);
    assert.equal(legacyReport.summary.grossProfit, 13333.33);
    assert.equal(legacyReport.summary.coverageComplete, true);
  });

  // ------------------------------------------------------------------
  // 19. Tenant isolation
  // ------------------------------------------------------------------
  it("19. refunds and profitability never cross tenants", async () => {
    const productB = await mkProduct("b-s19", 200000);
    const soldB = await mkSoldOrder("b-s19", {
      grandTotal: 200000,
      createdAt: at(2026, 10, 25, 10),
      restaurantId: REST_B,
      items: [
        {
          productId: productB,
          quantity: 1,
          unitPrice: 200000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 120000, hppTotal: 120000 },
        },
      ],
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-b-s19-ref`,
      restaurantId: REST_B,
      orderId: soldB.orderId,
      paymentId: soldB.paymentId,
      branchId: BR_B1,
      amount: 50000,
      requestedByCashierId: USER_B,
      status: "APPROVED",
      approvedAt: at(2026, 10, 25, 12),
      createdAt: at(2026, 10, 25, 11),
    });

    const tenantA = await profit("2026-10-25");
    assert.equal(tenantA.summary.totalSales, 0);
    assert.equal(tenantA.summary.totalRefund, 0);
    assert.equal(tenantA.summary.coverageComplete, false);
    assert.equal(tenantA.summary.cogsState, "NO_ITEMS");
    assert.equal(tenantA.summary.grossProfit, null);
    assert.deepEqual(tenantA.branches, []);
    assert.equal(tenantA.products.length, 0);

    const tenantB = await profitFor(REST_B, "2026-10-25");
    assert.equal(tenantB.summary.totalSales, 200000);
    assert.equal(tenantB.summary.totalRefund, 50000);
    assert.equal(tenantB.summary.netSales, 150000);
    assert.equal(tenantB.summary.cogs, 120000);
    assert.equal(tenantB.summary.cogsReversal, 30000);
    assert.equal(tenantB.summary.retainedCogs, 90000);
    assert.equal(tenantB.summary.grossProfit, 60000);
    assert.equal(tenantB.summary.refundState, "PARTIAL");

    // The service is tenant-scoped too: tenant A cannot refund tenant B's order.
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: soldB.orderId,
          amount: 1000,
          reason: `${RUN} cross tenant`,
        }),
      (err: unknown) => err instanceof NotFoundError
    );
  });

  // ------------------------------------------------------------------
  // 20. Branch authorization / isolation
  // ------------------------------------------------------------------
  it("20. branch scoping follows the branchFilters service contract", async () => {
    const product1 = await mkProduct("s20a", 100000);
    const sold1 = await mkSoldOrder("s20a", {
      grandTotal: 100000,
      createdAt: at(2026, 10, 26, 10),
      branchId: BR_A1,
      items: [
        {
          productId: product1,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    const product2 = await mkProduct("s20b", 50000);
    const sold2 = await mkSoldOrder("s20b", {
      grandTotal: 50000,
      createdAt: at(2026, 10, 26, 11),
      branchId: BR_A2,
      items: [
        {
          productId: product2,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 30000, hppTotal: 30000 },
        },
      ],
    });

    const all = await profit("2026-10-26");
    assert.equal(all.summary.totalSales, 150000);
    assert.equal(all.branches.length, 2);
    assert.equal(all.products.length, 2);

    const onlyA1 = await profit("2026-10-26", "2026-10-26", [BR_A1]);
    assert.equal(onlyA1.summary.totalSales, 100000);
    assert.equal(onlyA1.summary.cogs, 60000);
    assert.equal(onlyA1.branches.length, 1);
    assert.equal(onlyA1.branches[0].branchId, BR_A1);
    assert.equal(onlyA1.branches[0].branchName, "Branch A1");
    assert.equal(onlyA1.products.length, 1);
    assert.equal(onlyA1.products[0].productId, product1);

    const onlyA2 = await profit("2026-10-26", "2026-10-26", [BR_A2]);
    assert.equal(onlyA2.summary.totalSales, 50000);
    assert.equal(onlyA2.products[0].productId, product2);

    // Service contract: a branch-scoped caller cannot touch another branch's
    // order (it is not even found).
    await assert.rejects(
      () =>
        approvalService.requestRefund({
          restaurantId: REST_A,
          userId: USER_A,
          orderId: sold1.orderId,
          amount: 1000,
          reason: `${RUN} wrong branch`,
          branchFilters: [BR_A2],
        }),
      (err: unknown) => err instanceof NotFoundError
    );

    // …and cannot decide a refund belonging to another branch.
    const pending = await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: sold2.orderId,
      amount: 10000,
      reason: `${RUN} branch scoped decide`,
    });
    await assert.rejects(
      () =>
        approvalService.decideRefund({
          restaurantId: REST_A,
          adminId: USER_A,
          refundId: pending.id,
          approve: true,
          branchFilters: [BR_A1],
        }),
      (err: unknown) => err instanceof NotFoundError
    );
    const stillPending = await prisma.refund.findUniqueOrThrow({ where: { id: pending.id } });
    assert.equal(stillPending.status, "PENDING");
  });

  // ------------------------------------------------------------------
  // 21. Empty dataset
  // ------------------------------------------------------------------
  it("21. an empty dataset reports NO_ITEMS coverage and an unknown profit", async () => {
    const empty = await profit("2026-10-27", "2026-10-28");

    assert.equal(empty.summary.totalSales, 0);
    assert.equal(empty.summary.grossSales, 0);
    assert.equal(empty.summary.totalRefund, 0);
    assert.equal(empty.summary.refundReversal, 0);
    assert.equal(empty.summary.netSales, 0);
    assert.equal(empty.summary.cogs, 0);
    assert.equal(empty.summary.cogsReversal, 0);
    assert.equal(empty.summary.retainedCogs, 0);
    assert.equal(empty.summary.grossProfit, null, "an empty scope is never a covered 0-COGS profit");
    assert.equal(empty.summary.grossMarginPct, null);
    assert.equal(empty.summary.foodCostPct, null);
    assert.equal(empty.summary.coverageComplete, false);
    assert.equal(empty.summary.cogsState, "NO_ITEMS");
    assert.equal(empty.summary.refundState, "NONE");
    assert.deepEqual(empty.summary.coverage, {
      totalOrderItems: 0,
      costedOrderItems: 0,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.deepEqual(empty.summary.revenueWithoutItems, { orders: 0, headerValue: 0 });
    assert.deepEqual(empty.summary.unpaidCompleted, { orders: 0, orderItems: 0, cogs: 0 });
    assert.deepEqual(empty.branches, []);
    assert.deepEqual(empty.products, []);
    assert.equal(empty.productSummary.totalNetSales, 0);
    assert.equal(empty.productSummary.totalCogs, 0);
    assert.equal(empty.pagination.total, 0);
    assert.equal(empty.filters.productId, null);
    assert.equal(empty.period, "custom");
  });
});
