/**
 * STEP 2B.2 — REVENUE & REPORTING INTEGRATION TESTS (real MariaDB, isolated test DB)
 *
 * Scope (and nothing else): the canonical revenue engine in
 * `src/services/report/report.service.ts` (Sales report + the exported
 * `revenueWhere` / `revenueScopeWhere` / `computeRefundRevenue` /
 * `computeCustomerRevenue` predicates), exercised through real Prisma/MariaDB
 * queries — no mocked aggregation. Refund/P&L, Profitability and M2 SQL
 * integration tests are NOT part of this phase.
 *
 * AUDITED REVENUE RULES (see ACCOUNTING-INTEGRATION-TEST-PLAN.md §17.3):
 *   revenue set  = non-CANCELLED order AND (Order.paymentStatus = 'PAID'
 *                  OR EXISTS a Payment with status REFUNDED)
 *   order scope  = Order.createdAt inside the range (order-date attribution)
 *   refund scope = Refund.approvedAt inside the range, order scope date-free
 *                  (approval-date attribution; the order may be older)
 *   sales total  = Σ Order.grandTotal over the revenue set
 *   net sales    = Σ (grandTotal − tax − serviceCharge) − refund share
 *                  (share = LEAST(refunded/grandTotal, 1) × product basis)
 *
 * The revenue set is keyed on the ORDER mirror (`Order.paymentStatus`), which
 * the payment/refund engine owns — NOT on the payment rows themselves, except
 * for the collected-then-refunded branch. Payment rows in PENDING / FAILED /
 * EXPIRED / CANCELLED states therefore never contribute revenue.
 *
 * DATE BASIS — Cashbook (cash movement dates) and Revenue (order date) are
 * intentionally NOT required to match within the same calendar period; these
 * tests assert that existing rule instead of "fixing" it.
 *
 * Safety: `tests/setup.ts` is imported FIRST — it loads `.env.test`, runs the
 * fail-closed checks and pins `DATABASE_URL` to `TEST_DATABASE_URL` before any
 * service/prisma module is evaluated.
 *
 * Run (from the project root, one file at a time):
 *   npx tsx --test tests/accounting/revenue.integration.test.ts
 */

import { assertLiveTestTarget, EXPECTED_TEST_DB } from "../setup"; // MUST stay first (see header)

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "@/lib/prisma";
import {
  computeCustomerRevenue,
  computeRefundRevenue,
  reportService,
  revenueWhere,
  type ReportFilters,
  type ReportRange,
} from "@/services/report/report.service";
import {
  cleanupRun,
  createBranchFixture,
  createCategoryFixture,
  createCustomerFixture,
  createOrderFixture,
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

const RUN = createRunId("cbr");
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
const PRODUCT_A = `${RUN}-prod-a`;
// STEP 2C.3B — A-11 / A-12 regression fixtures.
const PRODUCT_B = `${RUN}-prod-b`;
const PRODUCT_C = `${RUN}-prod-c`;
const CATEGORY_B = `${RUN}-cat-b`;
const PRODUCT_BR = `${RUN}-prod-br`;

/** Local wall-clock dates; midday times keep every fixture inside its day. */
const at = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

const D = {
  sep1: "2026-09-01",
  sep25: "2026-09-25",
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
  oct14: "2026-10-14",
  oct15: "2026-10-15",
  oct16: "2026-10-16",
  oct17: "2026-10-17",
  oct18: "2026-10-18",
  oct20: "2026-10-20",
  oct21: "2026-10-21",
  // STEP 2C.3B — the A-11 / A-12 predicate-drift regressions. They must NOT
  // reuse the oct20–oct21 window: test 16 asserts that window is EMPTY.
  oct22: "2026-10-22",
  oct23: "2026-10-23",
};

function range(dateFrom: string, dateTo: string = dateFrom): ReportRange {
  return {
    start: new Date(`${dateFrom}T00:00:00`),
    end: new Date(`${dateTo}T23:59:59.999`),
  };
}

/** Sales report for restaurant A over an explicit (deterministic) period. */
function sales(
  dateFrom: string,
  dateTo: string = dateFrom,
  branchFilters?: string[] | null,
  filters?: ReportFilters
) {
  return reportService.getSalesReport(
    REST_A,
    "custom",
    dateFrom,
    dateTo,
    branchFilters,
    filters
  );
}

function salesFor(
  restaurantId: string,
  dateFrom: string,
  dateTo: string = dateFrom
) {
  return reportService.getSalesReport(restaurantId, "custom", dateFrom, dateTo);
}

/**
 * `getProductReport` over an explicit range (STEP 2C.3B / A-11).
 * `opts` mirrors the production route contract (branchFilters + filters).
 */
function products(
  dateFrom: string,
  dateTo: string = dateFrom,
  opts?: { branchFilters?: string[] | null; filters?: ReportFilters }
) {
  return reportService.getProductReport(REST_A, "custom", {
    startDate: dateFrom,
    endDate: dateTo,
    branchFilters: opts?.branchFilters ?? null,
    filters: opts?.filters,
  });
}

/** `getMultiOutletReport` over an explicit range (STEP 2C.3B / A-12). */
function multiOutlet(
  dateFrom: string,
  dateTo: string = dateFrom,
  branchFilters?: string[] | null
) {
  return reportService.getMultiOutletReport(
    REST_A,
    "custom",
    dateFrom,
    dateTo,
    branchFilters
  );
}

/** The revenue set as the Prisma predicate sees it (production `revenueWhere`). */
async function prismaRevenueOrderIds(
  dateFrom: string,
  dateTo: string = dateFrom,
  branchFilters?: string[] | null
): Promise<Set<string>> {
  const rows = await prisma.order.findMany({
    where: revenueWhere(REST_A, range(dateFrom, dateTo), branchFilters, {}),
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
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
    status?: "COMPLETED" | "CANCELLED";
    paymentStatus?: "UNPAID" | "PENDING" | "PAID" | "FAILED" | "EXPIRED";
    subtotal?: number;
    tax?: number;
    serviceCharge?: number;
    discount?: number;
    orderType?: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
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
    status: opts.status,
    paymentStatus: opts.paymentStatus,
    subtotal: opts.subtotal,
    tax: opts.tax,
    serviceCharge: opts.serviceCharge,
    discount: opts.discount,
    orderType: opts.orderType,
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
    status?:
      | "UNPAID"
      | "PENDING"
      | "PAID"
      | "FAILED"
      | "EXPIRED"
      | "REFUNDED"
      | "CANCELLED";
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
    requestedByCashierId: USER_A,
    status: opts.status,
    approvedAt: opts.approvedAt,
    createdAt: opts.createdAt,
  });
  return id;
}

async function mkItem(
  label: string,
  orderId: string,
  quantity: number,
  unitPrice: number,
  /** Defaults to PRODUCT_A; STEP 2C.3B passes explicit products. */
  productId: string = PRODUCT_A
): Promise<void> {
  await createOrderItemFixture(prisma, {
    id: `${RUN}-${label}-item`,
    orderId,
    productId,
    quantity,
    unitPrice,
    totalPrice: quantity * unitPrice,
  });
}

// ============================================================
// SUITE
// ============================================================

describe("STEP 2B.2 — Revenue & Reporting integration (real MariaDB, isolated test DB)", () => {
  let baseline: ScopedCounts;

  before(async () => {
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
    await createCategoryFixture(prisma, {
      id: CATEGORY_A,
      restaurantId: REST_A,
      name: `${RUN} Makanan`,
    });
    await createProductFixture(prisma, {
      id: PRODUCT_A,
      restaurantId: REST_A,
      categoryId: CATEGORY_A,
      name: `${RUN} Nasi Goreng`,
      price: 25000,
    });
    // STEP 2C.3B — extra products so the product/multi-outlet regressions can
    // tell the two revenue sets apart (a per-product row must exist for a
    // product that is sold ONLY on a fully-refunded order).
    await createProductFixture(prisma, {
      id: PRODUCT_B,
      restaurantId: REST_A,
      categoryId: CATEGORY_A,
      name: `${RUN} Mie Goreng`,
      price: 20000,
    });
    await createProductFixture(prisma, {
      id: PRODUCT_C,
      restaurantId: REST_A,
      categoryId: CATEGORY_A,
      name: `${RUN} Es Teh`,
      price: 4000,
    });
    await createCategoryFixture(prisma, {
      id: CATEGORY_B,
      restaurantId: REST_B,
      name: `${RUN} Makanan B`,
    });
    await createProductFixture(prisma, {
      id: PRODUCT_BR,
      restaurantId: REST_B,
      categoryId: CATEGORY_B,
      name: `${RUN} Nasi Goreng B`,
      price: 9000,
    });
  });

  after(async () => {
    const result = await cleanupRun(prisma, RUN);
    const afterCounts = await snapshotCounts(prisma);
    const residual = await findResiduals(prisma, RUN, result.scope);

    console.log("\n[STEP 2B.2 CLEANUP] rows deleted:", JSON.stringify(result.deleted));
    console.log("[STEP 2B.2 CLEANUP] residual (run-scoped):", JSON.stringify(residual));
    console.log(
      "[STEP 2B.2 CLEANUP] table counts (baseline → after):",
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
    assert.equal(EXPECTED_TEST_DB.port, process.env.TEST_DB_EXPECTED_PORT ?? "3308");
    assert.ok(process.env.DATABASE_URL?.includes(`/${EXPECTED_TEST_DB.name}`));
    assert.ok(
      identity.user.startsWith(EXPECTED_TEST_DB.user),
      "connected as the dedicated test user"
    );
  });

  // ------------------------------------------------------------------
  // 1. Unpaid order excluded
  // ------------------------------------------------------------------
  it("1. an UNPAID order is excluded from recognized revenue", async () => {
    const orderId = await mkOrder("s1", 100000, {
      createdAt: at(2026, 10, 1, 10),
      paymentStatus: "UNPAID",
    });
    await mkPayment("s1", orderId, 100000, {
      status: "UNPAID",
      paidAt: null,
      createdAt: at(2026, 10, 1, 10, 5),
    });

    const r = await sales(D.oct1);

    assert.equal(r.summary.totalSales, 0);
    assert.equal(r.summary.grossRevenue, 0);
    assert.equal(r.summary.netSales, 0);
    assert.equal(r.summary.paidOrders, 0);
    assert.equal(r.summary.averageOrderValue, 0);
    // Activity is still counted (the report's "Total Order" semantics).
    assert.equal(r.summary.totalOrders, 1);
    assert.equal(r.paymentBreakdown.unpaid.count, 1);
    assert.equal(r.paymentBreakdown.unpaid.amount, 100000);
    assert.equal(r.paymentBreakdown.cash.count, 0);
    assert.equal((await prismaRevenueOrderIds(D.oct1)).size, 0);
  });

  // ------------------------------------------------------------------
  // 2. Pending payment excluded
  // ------------------------------------------------------------------
  it("2. a PENDING payment/order is excluded from revenue", async () => {
    const orderId = await mkOrder("s2", 110000, {
      createdAt: at(2026, 10, 2, 10),
      paymentStatus: "PENDING",
    });
    await mkPayment("s2", orderId, 110000, {
      method: "QRIS",
      status: "PENDING",
      paidAt: null,
      createdAt: at(2026, 10, 2, 10, 5),
    });

    const r = await sales(D.oct2);

    assert.equal(r.summary.totalSales, 0);
    assert.equal(r.summary.netSales, 0);
    assert.equal(r.summary.paidOrders, 0);
    assert.equal(r.summary.totalOrders, 1);
    assert.equal(r.paymentBreakdown.unpaid.count, 1);
    assert.equal(r.paymentBreakdown.qris.count, 0);
    assert.equal((await prismaRevenueOrderIds(D.oct2)).size, 0);
  });

  // ------------------------------------------------------------------
  // 3. Failed payment excluded
  // ------------------------------------------------------------------
  it("3. a FAILED payment/order is excluded from revenue", async () => {
    const orderId = await mkOrder("s3", 120000, {
      createdAt: at(2026, 10, 3, 10),
      paymentStatus: "FAILED",
    });
    await mkPayment("s3", orderId, 120000, {
      status: "FAILED",
      paidAt: null,
      createdAt: at(2026, 10, 3, 10, 5),
    });

    const r = await sales(D.oct3);

    assert.equal(r.summary.totalSales, 0);
    assert.equal(r.summary.paidOrders, 0);
    assert.equal(r.summary.totalOrders, 1);
    assert.equal(r.paymentBreakdown.failed.count, 1);
    assert.equal(r.paymentBreakdown.failed.amount, 120000);
    assert.equal((await prismaRevenueOrderIds(D.oct3)).size, 0);
  });

  // ------------------------------------------------------------------
  // 4. Expired payment excluded
  // ------------------------------------------------------------------
  it("4. an EXPIRED payment/order is excluded from revenue", async () => {
    const orderId = await mkOrder("s4", 130000, {
      createdAt: at(2026, 10, 4, 10),
      paymentStatus: "EXPIRED",
    });
    await mkPayment("s4", orderId, 130000, {
      status: "EXPIRED",
      paidAt: null,
      createdAt: at(2026, 10, 4, 10, 5),
    });

    const r = await sales(D.oct4);

    assert.equal(r.summary.totalSales, 0);
    assert.equal(r.summary.paidOrders, 0);
    assert.equal(r.summary.totalOrders, 1);
    // FAILED and EXPIRED share the "failed" bucket by design.
    assert.equal(r.paymentBreakdown.failed.count, 1);
    assert.equal((await prismaRevenueOrderIds(D.oct4)).size, 0);
  });

  // ------------------------------------------------------------------
  // 5. PAID payment with eligible order included
  // ------------------------------------------------------------------
  it("5. a PAID payment on an eligible (PAID) order is recognized", async () => {
    const orderId = await mkOrder("s5", 50000, {
      createdAt: at(2026, 10, 5, 10),
      paymentStatus: "PAID",
    });
    await mkPayment("s5", orderId, 50000, {
      method: "KASIR",
      status: "PAID",
      paidAt: at(2026, 10, 5, 10, 5),
      createdAt: at(2026, 10, 5, 10, 5),
    });

    const r = await sales(D.oct5);

    assert.equal(r.summary.totalSales, 50000);
    assert.equal(r.summary.grossSales, 50000);
    assert.equal(r.summary.grossRevenue, 50000);
    assert.equal(r.summary.netSales, 50000);
    assert.equal(r.summary.paidOrders, 1);
    assert.equal(r.summary.totalOrders, 1);
    assert.equal(r.summary.averageOrderValue, 50000);
    assert.equal(r.summary.totalRefund, 0);
    assert.equal(r.paymentBreakdown.cash.count, 1);
    assert.equal(r.paymentBreakdown.cash.amount, 50000);
    assert.deepEqual([...(await prismaRevenueOrderIds(D.oct5))], [orderId]);
    assert.equal(r.range.start, range(D.oct5).start.toISOString());
    assert.equal(r.range.end, range(D.oct5).end.toISOString());
  });

  // ------------------------------------------------------------------
  // 6. CANCELLED order excluded even with payment records
  // ------------------------------------------------------------------
  it("6. a CANCELLED order is excluded even with PAID/REFUNDED payment rows", async () => {
    const orderId = await mkOrder("s6", 999999, {
      status: "CANCELLED",
      paymentStatus: "PAID",
      createdAt: at(2026, 10, 6, 10),
    });
    await mkPayment("s6-paid", orderId, 500000, {
      method: "KASIR",
      status: "PAID",
      paidAt: at(2026, 10, 6, 10, 5),
      createdAt: at(2026, 10, 6, 10, 5),
    });
    // A REFUNDED payment row would match the collected-then-refunded branch —
    // the CANCELLED scope still excludes the order.
    await mkPayment("s6-refunded", orderId, 499999, {
      method: "QRIS",
      status: "REFUNDED",
      paidAt: at(2026, 10, 6, 10, 10),
      createdAt: at(2026, 10, 6, 10, 10),
    });

    const r = await sales(D.oct6);

    assert.equal(r.summary.totalSales, 0);
    assert.equal(r.summary.netSales, 0);
    assert.equal(r.summary.paidOrders, 0);
    assert.equal(r.summary.totalOrders, 0, "CANCELLED orders are not activity either");
    assert.equal((await prismaRevenueOrderIds(D.oct6)).size, 0);
    // Documented sub-report behaviour: the payment breakdown is a PAYMENT-level
    // view (all statuses), so the cancelled order's collection is still listed
    // there while the order never enters revenue.
    assert.equal(r.paymentBreakdown.cash.count, 1);
    assert.equal(r.paymentBreakdown.refunded.count, 1);
  });

  // ------------------------------------------------------------------
  // 7. Multiple payment attempts do not multiply order revenue
  // ------------------------------------------------------------------
  it("7. multiple payment attempts do not multiply order revenue", async () => {
    const orderId = await mkOrder("s7", 200000, {
      createdAt: at(2026, 10, 7, 10),
      paymentStatus: "PAID",
    });
    // Split collection: 3 × PAID summing to the order total.
    await mkPayment("s7a", orderId, 60000, { status: "PAID", paidAt: at(2026, 10, 7, 10, 1) });
    await mkPayment("s7b", orderId, 70000, { status: "PAID", paidAt: at(2026, 10, 7, 10, 2) });
    await mkPayment("s7c", orderId, 70000, { status: "PAID", paidAt: at(2026, 10, 7, 10, 3) });
    // Superseded attempts that must not add anything.
    await mkPayment("s7d", orderId, 30000, { status: "PENDING", paidAt: null });
    await mkPayment("s7e", orderId, 30000, { status: "CANCELLED", paidAt: null });

    const r = await sales(D.oct7);

    assert.equal(r.summary.totalSales, 200000, "grandTotal is counted once per order");
    assert.equal(r.summary.paidOrders, 1);
    assert.equal(r.summary.totalOrders, 1);
    assert.equal(r.summary.netSales, 200000);
    assert.deepEqual([...(await prismaRevenueOrderIds(D.oct7))], [orderId]);
  });

  // ------------------------------------------------------------------
  // 8. PaymentTransaction callbacks do not multiply revenue
  // ------------------------------------------------------------------
  it("8. PaymentTransaction rows never multiply revenue or refund impact", async () => {
    const orderId = await mkOrder("s8", 60000, {
      createdAt: at(2026, 10, 8, 10),
      paymentStatus: "PAID",
    });
    const paymentId = await mkPayment("s8", orderId, 60000, {
      status: "PAID",
      paidAt: at(2026, 10, 8, 10, 5),
    });

    await createPaymentTransactionFixture(prisma, {
      paymentId,
      provider: "ipaymu",
      type: "webhook",
      status: "PAID",
      amount: 60000,
    });
    await createPaymentTransactionFixture(prisma, {
      paymentId,
      provider: "ipaymu",
      type: "webhook",
      status: "PAID",
      amount: 60000, // duplicated callback
    });
    await createPaymentTransactionFixture(prisma, {
      paymentId,
      provider: "ipaymu",
      type: "webhook",
      status: "IGNORED_STALE",
      amount: 60000,
    });
    // A mirrored refund row lives on PaymentTransaction, NOT on `refund`.
    await createPaymentTransactionFixture(prisma, {
      paymentId,
      provider: "cashier",
      type: "refund",
      status: "REFUNDED",
      amount: -20000,
    });

    assert.equal(await prisma.paymentTransaction.count({ where: { paymentId } }), 4);

    const r = await sales(D.oct8);

    assert.equal(r.summary.totalSales, 60000);
    assert.equal(r.summary.netSales, 60000);
    assert.equal(
      r.summary.totalRefund,
      0,
      "a PaymentTransaction refund mirror is not an approved Refund row"
    );
    assert.equal(r.summary.paidOrders, 1);
  });

  // ------------------------------------------------------------------
  // 9. REFUNDED-payment qualification (actual revenueWhere rule)
  // ------------------------------------------------------------------
  it("9. a collected-then-refunded order stays in revenue via its REFUNDED payment", async () => {
    // Realistic fully-refunded state (approval engine): Refund row APPROVED,
    // Payment REFUNDED, Order.paymentStatus back to UNPAID.
    const refundedOrderId = await mkOrder("s9-refunded", 70000, {
      createdAt: at(2026, 10, 9, 10),
      paymentStatus: "UNPAID",
    });
    await mkPayment("s9-refunded", refundedOrderId, 70000, {
      status: "REFUNDED",
      paidAt: at(2026, 10, 9, 10, 5),
    });

    // Audited rule: a PAID payment whose ORDER mirror is not PAID (and that has
    // no REFUNDED payment) is NOT revenue — the order mirror the payment engine
    // writes is authoritative for both the Prisma and the SQL predicate.
    const mirrorMismatchId = await mkOrder("s9-mismatch", 80000, {
      createdAt: at(2026, 10, 9, 11),
      paymentStatus: "UNPAID",
    });
    await mkPayment("s9-mismatch", mirrorMismatchId, 80000, {
      status: "PAID",
      paidAt: at(2026, 10, 9, 11, 5),
    });

    const r = await sales(D.oct9);

    assert.equal(r.summary.totalSales, 70000, "only the REFUNDED-payment order qualifies");
    assert.equal(r.summary.paidOrders, 1);
    assert.deepEqual([...(await prismaRevenueOrderIds(D.oct9))], [refundedOrderId]);
  });

  // ------------------------------------------------------------------
  // 10. Partial refund attribution
  // ------------------------------------------------------------------
  it("10. a partial refund is attributed to its approval date on the product basis", async () => {
    // subtotal 100000, tax 10000, serviceCharge 5000 → grandTotal 115000,
    // product basis (grandTotal − tax − serviceCharge) = 100000.
    const orderId = await mkOrder("s10", 115000, {
      createdAt: at(2026, 10, 10, 10),
      paymentStatus: "PAID",
      subtotal: 100000,
      tax: 10000,
      serviceCharge: 5000,
    });
    const paymentId = await mkPayment("s10", orderId, 115000, {
      status: "PAID",
      paidAt: at(2026, 10, 10, 10, 5),
    });
    // Partial refund: 50% of the collected amount (payment/order stay PAID).
    await mkRefund("s10", orderId, 57500, {
      paymentId,
      status: "APPROVED",
      approvedAt: at(2026, 10, 10, 11),
    });

    const r = await sales(D.oct10);

    assert.equal(r.summary.totalSales, 115000);
    assert.equal(r.summary.totalRefund, 57500);
    assert.equal(r.summary.refundReversal, 57500);
    // netSales = 100000 − LEAST(57500/115000, 1) × 100000 = 100000 − 50000
    assert.equal(r.summary.netSales, 50000);
    assert.equal(r.summary.paidOrders, 1);

    // Same window through the canonical SQL engine.
    const canonical = await computeRefundRevenue({
      restaurantId: REST_A,
      start: range(D.oct10).start,
      end: range(D.oct10).end,
    });
    assert.equal(canonical.total.productRevenue, 100000);
    assert.equal(canonical.total.refundRevenue, 50000);
    assert.equal(canonical.total.netSales, 50000);
  });

  // ------------------------------------------------------------------
  // 11. Full refund attribution
  // ------------------------------------------------------------------
  it("11. a full refund nets the order to zero (never negative)", async () => {
    // Fully refunded state: Payment REFUNDED, Order UNPAID, refund APPROVED
    // for the whole collected amount.
    const orderId = await mkOrder("s11", 200000, {
      createdAt: at(2026, 10, 11, 10),
      paymentStatus: "UNPAID",
    });
    const paymentId = await mkPayment("s11", orderId, 200000, {
      status: "REFUNDED",
      paidAt: at(2026, 10, 11, 10, 5),
    });
    await mkRefund("s11", orderId, 200000, {
      paymentId,
      status: "APPROVED",
      approvedAt: at(2026, 10, 11, 11),
    });

    const r = await sales(D.oct11);

    assert.equal(r.summary.totalSales, 200000, "stays in the revenue set so it can be reversed");
    assert.equal(r.summary.totalRefund, 200000);
    assert.equal(r.summary.netSales, 0);
    assert.equal(r.summary.paidOrders, 1);

    // A-9 — FIXED in STEP 2C.3B. This assertion deliberately pinned the defect
    // (`Σ busiestHours.revenue === 0` while the daily series showed 200 000)
    // because the hourly bucket filtered `paymentStatus = 'PAID'` only. It now
    // composes the canonical `revenueSetSql`, so the fully-refunded order is in
    // the daily series AND the hourly bucket, while its revenue is still
    // reversed by computeRefundRevenue (netSales stays 0).
    const dailySales = r.dailySeries.reduce((sum, d) => sum + d.sales, 0);
    const hourlyRevenue = r.busiestHours.reduce((sum, h) => sum + h.revenue, 0);
    const hourlyOrders = r.busiestHours.reduce((sum, h) => sum + h.orders, 0);
    assert.equal(dailySales, 200000);
    assert.equal(hourlyRevenue, 200000);
    assert.equal(hourlyOrders, 1);
    assert.equal(
      hourlyRevenue,
      r.summary.totalSales,
      "raw-SQL hourly revenue must equal the Prisma revenue set"
    );
  });

  // ------------------------------------------------------------------
  // 12. Revenue date filtering uses order.createdAt
  // ------------------------------------------------------------------
  it("12. revenue is filtered by order.createdAt (not by the payment date)", async () => {
    // Created Oct 12, collected Sep 1 (an EARLIER period).
    const earlyCollection = await mkOrder("s12-early", 30000, {
      createdAt: at(2026, 10, 12, 10),
      paymentStatus: "PAID",
    });
    await mkPayment("s12-early", earlyCollection, 30000, {
      status: "PAID",
      paidAt: at(2026, 9, 1, 10),
      createdAt: at(2026, 9, 1, 10),
    });
    const sameDay = await mkOrder("s12-same", 70000, {
      createdAt: at(2026, 10, 12, 12),
      paymentStatus: "PAID",
    });
    await mkPayment("s12-same", sameDay, 70000, {
      status: "PAID",
      paidAt: at(2026, 10, 12, 12, 5),
    });

    const october = await sales(D.oct12);
    assert.equal(october.summary.totalSales, 100000);
    assert.equal(october.summary.paidOrders, 2);
    assert.deepEqual(
      [...(await prismaRevenueOrderIds(D.oct12))].sort(),
      [earlyCollection, sameDay].sort()
    );

    // The collection period itself holds no revenue for these orders.
    const september = await sales(D.sep1);
    assert.equal(september.summary.totalSales, 0);
    assert.equal(september.summary.totalOrders, 0);
    assert.equal((await prismaRevenueOrderIds(D.sep1)).size, 0);
  });

  // ------------------------------------------------------------------
  // 13. Cross-period: collection ≠ order date
  // ------------------------------------------------------------------
  it("13. a payment collected in another period does not move revenue into that period", async () => {
    // Order created Sep 25, collected Oct 13, refunded (approved) Oct 14.
    const orderId = await mkOrder("s13", 120000, {
      createdAt: at(2026, 9, 25, 10),
      paymentStatus: "PAID",
    });
    const paymentId = await mkPayment("s13", orderId, 120000, {
      status: "PAID",
      paidAt: at(2026, 10, 13, 10),
      createdAt: at(2026, 10, 13, 10),
    });
    await mkRefund("s13", orderId, 40000, {
      paymentId,
      status: "APPROVED",
      approvedAt: at(2026, 10, 14, 11),
    });

    // Order-date attribution: the September period owns the revenue.
    const september = await sales(D.sep25);
    assert.equal(september.summary.totalSales, 120000);
    assert.equal(september.summary.netSales, 120000);
    assert.equal(september.summary.totalRefund, 0, "the refund was approved in October");
    assert.deepEqual([...(await prismaRevenueOrderIds(D.sep25))], [orderId]);

    // The collection period does NOT inherit the order's revenue
    // (Cashbook is the report that recognises Oct 13 — a different report).
    const collection = await sales(D.oct13);
    assert.equal(collection.summary.totalSales, 0);
    assert.equal(collection.summary.totalOrders, 0);
    assert.equal(collection.summary.netSales, 0);

    // Approval-date attribution: the refund lands in its own period, on the
    // order's product basis (120000 × 40000/120000 = 40000). A period holding
    // only refund impact legitimately shows a negative netSales — existing rule.
    const approval = await sales(D.oct14);
    assert.equal(approval.summary.totalSales, 0);
    assert.equal(approval.summary.totalRefund, 40000);
    assert.equal(approval.summary.netSales, -40000);
  });

  // ------------------------------------------------------------------
  // 14. Tenant isolation
  // ------------------------------------------------------------------
  it("14. tenant isolation: revenue never crosses tenants", async () => {
    const orderA = await mkOrder("s14a", 40000, {
      createdAt: at(2026, 10, 15, 10),
      paymentStatus: "PAID",
    });
    await mkPayment("s14a", orderA, 40000, { status: "PAID", paidAt: at(2026, 10, 15, 10, 5) });

    const orderB = await mkOrder("s14b", 90000, {
      restaurantId: REST_B,
      branchId: BR_B1,
      customerId: CUST_B,
      createdAt: at(2026, 10, 15, 10),
      paymentStatus: "PAID",
    });
    await mkPayment("s14b", orderB, 90000, {
      restaurantId: REST_B,
      branchId: BR_B1,
      status: "PAID",
      paidAt: at(2026, 10, 15, 10, 5),
    });

    const resA = await sales(D.oct15);
    const resB = await salesFor(REST_B, D.oct15);

    assert.equal(resA.summary.totalSales, 40000);
    assert.equal(resA.summary.paidOrders, 1);
    assert.equal(resB.summary.totalSales, 90000);
    assert.equal(resB.summary.paidOrders, 1);
    assert.deepEqual([...(await prismaRevenueOrderIds(D.oct15))], [orderA]);
  });

  // ------------------------------------------------------------------
  // 15. Branch isolation (service contract)
  // ------------------------------------------------------------------
  it("15. branch isolation follows the branchFilters contract", async () => {
    const orderA1 = await mkOrder("s15a", 40000, {
      branchId: BR_A1,
      createdAt: at(2026, 10, 16, 10),
      paymentStatus: "PAID",
    });
    await mkPayment("s15a", orderA1, 40000, {
      branchId: BR_A1,
      status: "PAID",
      paidAt: at(2026, 10, 16, 10, 5),
    });
    const orderA2 = await mkOrder("s15b", 60000, {
      branchId: BR_A2,
      createdAt: at(2026, 10, 16, 11),
      paymentStatus: "PAID",
    });
    await mkPayment("s15b", orderA2, 60000, {
      branchId: BR_A2,
      status: "PAID",
      paidAt: at(2026, 10, 16, 11, 5),
    });

    const all = await sales(D.oct16);
    assert.equal(all.summary.totalSales, 100000);
    assert.equal(all.summary.paidOrders, 2);

    const onlyA1 = await sales(D.oct16, D.oct16, [BR_A1]);
    assert.equal(onlyA1.summary.totalSales, 40000);
    assert.equal(onlyA1.summary.paidOrders, 1);
    assert.deepEqual([...(await prismaRevenueOrderIds(D.oct16, D.oct16, [BR_A1]))], [orderA1]);

    const onlyA2 = await sales(D.oct16, D.oct16, [BR_A2]);
    assert.equal(onlyA2.summary.totalSales, 60000);
    assert.equal(onlyA2.summary.paidOrders, 1);

    // Contract: branch scoping comes from `branchFilters` (resolved server-side
    // from the session). `filters.branchId` is echoed only — it never widens or
    // narrows the scope by itself.
    const hintOnly = await sales(D.oct16, D.oct16, undefined, { branchId: BR_A1 });
    assert.equal(hintOnly.summary.totalSales, 100000);
    assert.equal(hintOnly.filters.branchId, BR_A1);
  });

  // ------------------------------------------------------------------
  // 16. Empty date range
  // ------------------------------------------------------------------
  it("16. an empty date range returns zeros and a densified empty series", async () => {
    const r = await sales(D.oct20, D.oct21);

    assert.equal(r.summary.totalSales, 0);
    assert.equal(r.summary.grossSales, 0);
    assert.equal(r.summary.netSales, 0);
    assert.equal(r.summary.totalRefund, 0);
    assert.equal(r.summary.totalOrders, 0);
    assert.equal(r.summary.paidOrders, 0);
    assert.equal(r.summary.totalItemsSold, 0);
    assert.equal(r.summary.averageOrderValue, 0);
    assert.equal(r.summary.totalDiscount, 0);
    assert.equal(r.summary.totalTax, 0);
    assert.equal(r.summary.totalServiceCharge, 0);
    assert.deepEqual(r.bestSellingProducts, []);
    assert.deepEqual(r.bestCategories, []);
    assert.deepEqual(r.busiestHours, []);
    assert.deepEqual(r.promoPerformance, []);
    assert.deepEqual(r.orderType, {
      DINE_IN: { count: 0, amount: 0 },
      TAKEAWAY: { count: 0, amount: 0 },
      DELIVERY: { count: 0, amount: 0 },
    });
    assert.ok(r.dailySeries.length >= 1, "the series is densified, never empty");
    assert.ok(r.dailySeries.every((d) => d.sales === 0 && d.orders === 0));
    for (const bucket of Object.values(r.paymentBreakdown)) {
      assert.deepEqual(bucket, { count: 0, amount: 0 });
    }
    assert.equal(r.period, "custom");
    assert.equal(r.range.start, range(D.oct20, D.oct21).start.toISOString());
    assert.equal(r.range.end, range(D.oct20, D.oct21).end.toISOString());

    // STEP 2C.3B — the A-11 / A-12 views must also be empty in an empty window
    // (§28.7 matrix row 10): no phantom product rows and no phantom branch rows.
    const p = await products(D.oct20, D.oct21);
    assert.equal(p.summary.orderCount, 0);
    assert.equal(p.summary.soldProductCount, 0);
    assert.equal(p.summary.qtySold, 0);
    assert.equal(p.summary.grossSales, 0);
    assert.deepEqual(p.products, []);
    assert.deepEqual(
      p.unsoldProducts.map((x) => x.productId).sort(),
      [PRODUCT_A, PRODUCT_B, PRODUCT_C].sort(),
      "with nothing sold, the whole active catalog is unsold"
    );

    const m = await multiOutlet(D.oct20, D.oct21);
    assert.equal(m.summary.totalOrders, 0);
    assert.equal(m.summary.grossSales, 0);
    assert.equal(m.summary.netSales, 0);
    assert.equal(
      m.outlets.every(
        (o) =>
          o.orders === 0 &&
          o.totalSales === 0 &&
          o.orderType.DINE_IN.amount +
            o.orderType.TAKEAWAY.amount +
            o.orderType.DELIVERY.amount ===
            0
      ),
      true,
      "every outlet must be zeroed and its order-type breakdown must still add up"
    );
  });

  // ------------------------------------------------------------------
  // 17. Server-side totals agree with deterministic fixture values
  // ------------------------------------------------------------------
  it("17. server-side totals and aggregations agree with the fixtures", async () => {
    // a: subtotal 50000, discount 5000, tax 4500, serviceCharge 2000 → 51500
    const a = await mkOrder("s17a", 51500, {
      createdAt: at(2026, 10, 17, 10),
      paymentStatus: "PAID",
      subtotal: 50000,
      discount: 5000,
      tax: 4500,
      serviceCharge: 2000,
      orderType: "DINE_IN",
    });
    await mkItem("s17a", a, 2, 25000);
    await mkPayment("s17a", a, 51500, { status: "PAID", paidAt: at(2026, 10, 17, 10, 5) });

    // b: subtotal 30000, tax 3000 → 33000
    const b = await mkOrder("s17b", 33000, {
      createdAt: at(2026, 10, 17, 12),
      paymentStatus: "PAID",
      subtotal: 30000,
      tax: 3000,
      orderType: "TAKEAWAY",
    });
    await mkItem("s17b", b, 3, 10000);
    await mkPayment("s17b", b, 33000, {
      method: "QRIS",
      status: "PAID",
      paidAt: at(2026, 10, 17, 12, 5),
    });

    // c: UNPAID activity — counted in totalOrders, never in revenue/items.
    const c = await mkOrder("s17c", 11000, {
      createdAt: at(2026, 10, 17, 14),
      paymentStatus: "UNPAID",
      subtotal: 10000,
      tax: 1000,
    });
    await mkItem("s17c", c, 1, 10000);

    const r = await sales(D.oct17);

    assert.equal(r.summary.totalSales, 84500); // 51500 + 33000
    assert.equal(r.summary.grossSales, 80000); // 50000 + 30000
    assert.equal(r.summary.totalTax, 7500);
    assert.equal(r.summary.totalServiceCharge, 2000);
    assert.equal(r.summary.totalDiscount, 5000);
    assert.equal(r.summary.totalItemsSold, 5); // 2 + 3 (the unpaid item is excluded)
    assert.equal(r.summary.paidOrders, 2);
    assert.equal(r.summary.totalOrders, 3); // activity includes the unpaid order
    assert.equal(r.summary.averageOrderValue, 42250); // 84500 / 2
    assert.equal(r.summary.netSales, 75000); // (51500−4500−2000) + (33000−3000)
    assert.equal(r.summary.totalRefund, 0);

    // Best sellers / categories (sold items only).
    assert.equal(r.bestSellingProducts.length, 1);
    assert.equal(r.bestSellingProducts[0].productId, PRODUCT_A);
    assert.equal(r.bestSellingProducts[0].quantitySold, 5);
    assert.equal(r.bestSellingProducts[0].revenue, 80000);
    assert.equal(r.bestCategories.length, 1);
    assert.equal(r.bestCategories[0].quantitySold, 5);
    assert.equal(r.bestCategories[0].revenue, 80000);

    // Order-type breakdown (sold orders only).
    assert.deepEqual(r.orderType.DINE_IN, { count: 1, amount: 51500 });
    assert.deepEqual(r.orderType.TAKEAWAY, { count: 1, amount: 33000 });
    assert.deepEqual(r.orderType.DELIVERY, { count: 0, amount: 0 });

    // SQL daily series and SQL hourly series agree with the Prisma aggregates.
    assert.equal(
      r.dailySeries.reduce((sum, d) => sum + d.sales, 0),
      84500,
      "daily series (raw SQL) must equal summary.totalSales (Prisma aggregate)"
    );
    assert.equal(
      r.dailySeries.reduce((sum, d) => sum + d.orders, 0),
      2,
      "daily series counts the revenue set only"
    );
    assert.equal(
      r.busiestHours.reduce((sum, h) => sum + h.revenue, 0),
      84500,
      "hourly series (raw SQL) must equal summary.totalSales in a non-refunded window"
    );
    assert.equal(
      r.busiestHours.reduce((sum, h) => sum + h.orders, 0),
      2
    );

    // Independent Prisma re-aggregation of the documented fixture values.
    const independent = await prisma.order.aggregate({
      where: { id: { in: [a, b] } },
      _sum: { grandTotal: true, subtotal: true, tax: true, serviceCharge: true, discount: true },
    });
    assert.equal(Number(independent._sum.grandTotal), r.summary.totalSales);
    assert.equal(Number(independent._sum.subtotal), r.summary.grossSales);
  });

  // ------------------------------------------------------------------
  // 18. Prisma revenueWhere vs SQL reporting predicates
  // ------------------------------------------------------------------
  it("18. Prisma revenueWhere and the SQL reporting predicates agree", async () => {
    // Deterministic mixed dataset inside one window.
    const paid = await mkOrder("s18a", 10000, {
      createdAt: at(2026, 10, 18, 10),
      paymentStatus: "PAID",
      tax: 1000,
    });
    await mkPayment("s18a", paid, 10000, { status: "PAID", paidAt: at(2026, 10, 18, 10, 1) });

    // Activity-only order (never in revenue).
    await mkOrder("s18b", 11000, {
      createdAt: at(2026, 10, 18, 11),
      paymentStatus: "UNPAID",
    });

    const pending = await mkOrder("s18c", 12000, {
      createdAt: at(2026, 10, 18, 12),
      paymentStatus: "PENDING",
    });
    await mkPayment("s18c", pending, 12000, { method: "QRIS", status: "PENDING", paidAt: null });

    const refundedPayment = await mkOrder("s18d", 20000, {
      createdAt: at(2026, 10, 18, 13),
      paymentStatus: "UNPAID",
    });
    await mkPayment("s18d", refundedPayment, 20000, {
      status: "REFUNDED",
      paidAt: at(2026, 10, 18, 13, 5),
    });

    const cancelled = await mkOrder("s18e", 13000, {
      createdAt: at(2026, 10, 18, 14),
      status: "CANCELLED",
      paymentStatus: "PAID",
    });
    await mkPayment("s18e", cancelled, 13000, { status: "PAID", paidAt: at(2026, 10, 18, 14, 5) });

    const mirrorMismatch = await mkOrder("s18f", 14000, {
      createdAt: at(2026, 10, 18, 15),
      paymentStatus: "UNPAID",
    });
    await mkPayment("s18f", mirrorMismatch, 14000, {
      status: "PAID",
      paidAt: at(2026, 10, 18, 15, 5),
    });

    const splitTender = await mkOrder("s18g", 30000, {
      createdAt: at(2026, 10, 18, 16),
      paymentStatus: "PAID",
      tax: 3000,
    });
    await mkPayment("s18g-1", splitTender, 15000, { status: "PAID", paidAt: at(2026, 10, 18, 16, 1) });
    await mkPayment("s18g-2", splitTender, 15000, {
      method: "QRIS",
      status: "PAID",
      paidAt: at(2026, 10, 18, 16, 2),
    });

    const expectedSet = [paid, refundedPayment, splitTender].sort();

    // (a) The Prisma predicate.
    const prismaSet = await prismaRevenueOrderIds(D.oct18);
    assert.deepEqual([...prismaSet].sort(), expectedSet);

    const r = await sales(D.oct18);

    // (b) The Prisma aggregates over that same predicate.
    assert.equal(r.summary.totalSales, 60000); // 10000 + 20000 + 30000
    assert.equal(r.summary.paidOrders, 3);
    assert.equal(r.summary.totalOrders, 6); // activity: all non-cancelled orders

    // (c) The production RAW-SQL daily path (revenueSetSql) over the same range.
    assert.equal(
      r.dailySeries.reduce((sum, d) => sum + d.sales, 0),
      r.summary.totalSales,
      "raw-SQL revenue set must equal the Prisma revenue set"
    );
    assert.equal(r.dailySeries.reduce((sum, d) => sum + d.orders, 0), 3);

    // (c2) STEP 2C.3B — the HOURLY path must agree with the same set (A-9).
    // This dataset already contains the disagreeing case (s18d = `UNPAID` order
    // mirror + a `REFUNDED` payment), so before the fix these two lines read
    // 40 000 / 2 instead of 60 000 / 3.
    assert.equal(
      r.busiestHours.reduce((sum, h) => sum + h.revenue, 0),
      r.summary.totalSales,
      "raw-SQL hourly revenue must equal the Prisma revenue set"
    );
    assert.equal(r.busiestHours.reduce((sum, h) => sum + h.orders, 0), 3);

    // (d) The canonical SQL engine (computeRefundRevenue / revenueSetSql).
    const canonical = await computeRefundRevenue({
      restaurantId: REST_A,
      start: range(D.oct18).start,
      end: range(D.oct18).end,
    });
    const productBasis = await prisma.order.aggregate({
      where: { id: { in: expectedSet } },
      _sum: { grandTotal: true, tax: true, serviceCharge: true },
    });
    const expectedProductRevenue =
      Number(productBasis._sum.grandTotal ?? 0) -
      Number(productBasis._sum.tax ?? 0) -
      Number(productBasis._sum.serviceCharge ?? 0);
    assert.equal(canonical.total.productRevenue, expectedProductRevenue);
    assert.equal(canonical.total.refundRevenue, 0);
    assert.equal(canonical.total.netSales, r.summary.netSales);

    // (e) The customer-scoped canonical engine is derived from the same rule
    //     (PHASE 9B invariant): equal money totals for the same scope. Its
    //     bucket additionally carries `orderCount`, which must match the
    //     revenue set size.
    const customer = await computeCustomerRevenue({
      restaurantId: REST_A,
      range: range(D.oct18),
    });
    assert.deepEqual(
      {
        productRevenue: customer.total.productRevenue,
        refundRevenue: customer.total.refundRevenue,
        netSales: customer.total.netSales,
      },
      canonical.total
    );
    assert.equal(customer.total.orderCount, expectedSet.length);

    // (f) A non-PAID `status` filter changes activity counts, never revenue.
    const unpaidView = await sales(D.oct18, D.oct18, undefined, { status: "UNPAID" });
    assert.equal(unpaidView.summary.totalOrders, 3); // 2 UNPAID-in-revenue-set + mirror mismatch
    assert.equal(unpaidView.summary.totalSales, 60000);
    assert.equal(unpaidView.summary.paidOrders, 3);
  });

  // ------------------------------------------------------------------
  // 19. A-11 — the product report must use the canonical revenue set
  //
  // Before STEP 2C.3B the product ROWS filtered `paymentStatus = 'PAID'` while
  // `soldWhere` (unsoldProducts / summary.orderCount) used the canonical set, so
  // the report contradicted itself: a fully-refunded order was counted in
  // `summary.orderCount` but not in the product rows, and a product sold only on
  // such an order appeared in NEITHER `products` nor `unsoldProducts`.
  // ------------------------------------------------------------------
  it("19. the product report aggregates the canonical revenue set (A-11, STEP 2C.3B)", async () => {
    // A = 10 000/unit, B = 20 000/unit, C = 4 000/unit.
    const paid = await mkOrder("s19-paid", 30000, {
      createdAt: at(2026, 10, 22, 9),
      paymentStatus: "PAID",
    });
    await mkItem("s19-paid-a", paid, 1, 10000, PRODUCT_A);
    await mkItem("s19-paid-b", paid, 1, 20000, PRODUCT_B);
    await mkPayment("s19-paid", paid, 30000, {
      status: "PAID",
      paidAt: at(2026, 10, 22, 9, 5),
    });

    // Fully refunded → the order mirror is UNPAID and the payment is REFUNDED.
    const fullRef = await mkOrder("s19-fullref", 20000, {
      createdAt: at(2026, 10, 22, 10),
      paymentStatus: "UNPAID",
    });
    await mkItem("s19-fullref", fullRef, 1, 20000, PRODUCT_B);
    const fullRefPay = await mkPayment("s19-fullref", fullRef, 20000, {
      status: "REFUNDED",
      paidAt: at(2026, 10, 22, 10, 5),
    });
    await mkRefund("s19-fullref", fullRef, 20000, {
      paymentId: fullRefPay,
      status: "APPROVED",
      approvedAt: at(2026, 10, 22, 10, 30),
    });

    // The silent-omission case: PRODUCT_C is sold ONLY on a refunded order.
    const fullRefC = await mkOrder("s19-fullref-c", 4000, {
      createdAt: at(2026, 10, 22, 11),
      paymentStatus: "UNPAID",
    });
    await mkItem("s19-fullref-c", fullRefC, 1, 4000, PRODUCT_C);
    const fullRefCPay = await mkPayment("s19-fullref-c", fullRefC, 4000, {
      status: "REFUNDED",
      paidAt: at(2026, 10, 22, 11, 5),
    });
    await mkRefund("s19-fullref-c", fullRefC, 4000, {
      paymentId: fullRefCPay,
      status: "APPROVED",
      approvedAt: at(2026, 10, 22, 11, 30),
    });

    // Partially refunded → still PAID, in the set either way.
    const partRef = await mkOrder("s19-partref", 10000, {
      createdAt: at(2026, 10, 22, 12),
      paymentStatus: "PAID",
    });
    await mkItem("s19-partref", partRef, 1, 10000, PRODUCT_A);
    const partRefPay = await mkPayment("s19-partref", partRef, 10000, {
      status: "PAID",
      paidAt: at(2026, 10, 22, 12, 5),
    });
    await mkRefund("s19-partref", partRef, 3000, {
      paymentId: partRefPay,
      status: "APPROVED",
      approvedAt: at(2026, 10, 22, 12, 30),
    });

    // Excluded: unpaid, cancelled-with-PAID-payment, stale UNPAID mirror.
    const unpaid = await mkOrder("s19-unpaid", 5000, {
      createdAt: at(2026, 10, 22, 13),
      paymentStatus: "UNPAID",
    });
    await mkItem("s19-unpaid", unpaid, 1, 5000, PRODUCT_A);

    const cancelled = await mkOrder("s19-cancel", 7000, {
      createdAt: at(2026, 10, 22, 14),
      status: "CANCELLED",
      paymentStatus: "PAID",
    });
    await mkItem("s19-cancel", cancelled, 1, 7000, PRODUCT_B);
    await mkPayment("s19-cancel", cancelled, 7000, {
      status: "PAID",
      paidAt: at(2026, 10, 22, 14, 5),
    });

    const stale = await mkOrder("s19-stale", 11000, {
      createdAt: at(2026, 10, 22, 15),
      paymentStatus: "UNPAID",
    });
    await mkItem("s19-stale", stale, 1, 11000, PRODUCT_A);
    await mkPayment("s19-stale", stale, 11000, {
      status: "PAID",
      paidAt: at(2026, 10, 22, 15, 5),
    });

    // Split tender + PaymentTransaction mirrors — counted ONCE.
    const split = await mkOrder("s19-split", 30000, {
      createdAt: at(2026, 10, 22, 16),
      paymentStatus: "PAID",
    });
    await mkItem("s19-split-a", split, 1, 10000, PRODUCT_A);
    await mkItem("s19-split-b", split, 1, 20000, PRODUCT_B);
    const splitPay1 = await mkPayment("s19-split-1", split, 15000, {
      status: "PAID",
      paidAt: at(2026, 10, 22, 16, 1),
    });
    const splitPay2 = await mkPayment("s19-split-2", split, 15000, {
      method: "QRIS",
      status: "PAID",
      paidAt: at(2026, 10, 22, 16, 2),
    });
    for (const paymentId of [splitPay1, splitPay2]) {
      await createPaymentTransactionFixture(prisma, {
        paymentId,
        provider: "ipaymu",
        type: "PAYMENT",
        status: "PAID",
        amount: 15000,
      });
    }

    // Tenant isolation: the same shape in restaurant B, with its own product and
    // its own cashier, on the same day.
    const bRef = await mkOrder("s19-b-fullref", 9000, {
      restaurantId: REST_B,
      branchId: BR_B1,
      customerId: CUST_B,
      createdAt: at(2026, 10, 22, 10),
      paymentStatus: "UNPAID",
    });
    await mkItem("s19-b-fullref", bRef, 1, 9000, PRODUCT_BR);
    const bRefPay = await mkPayment("s19-b-fullref", bRef, 9000, {
      restaurantId: REST_B,
      branchId: BR_B1,
      status: "REFUNDED",
      paidAt: at(2026, 10, 22, 10, 5),
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-s19-b-fullref-refund`,
      restaurantId: REST_B,
      orderId: bRef,
      paymentId: bRefPay,
      branchId: BR_B1,
      amount: 9000,
      requestedByCashierId: USER_B,
      status: "APPROVED",
      approvedAt: at(2026, 10, 22, 10, 30),
    });

    const p = await products(D.oct22);
    const s = await sales(D.oct22);

    // The canonical revenue set: paid, fullref, fullref-c, partref, split.
    assert.equal(s.summary.paidOrders, 5);
    assert.equal(s.summary.totalSales, 94000);
    assert.equal(s.summary.netSales, 67000); // 94000 − 27000 approved refunds
    assert.equal(s.summary.totalOrders, 7); // activity: + unpaid + stale mirror

    // A-11 — the product rows must use that SAME set.
    assert.equal(
      p.summary.orderCount,
      5,
      "the product rows must count the canonical revenue set"
    );
    assert.equal(p.summary.soldProductCount, 3);
    assert.equal(p.summary.qtySold, 7);
    assert.equal(p.summary.grossSales, 94000);
    assert.equal(
      p.summary.grossSales,
      s.summary.totalSales,
      "the product report and the sales report must agree on gross revenue"
    );

    const row = (productId: string) =>
      p.products.find((x) => x.productId === productId);
    assert.deepEqual(
      { qty: row(PRODUCT_A)?.qtySold, gross: row(PRODUCT_A)?.grossSales },
      { qty: 3, gross: 30000 }
    );
    assert.deepEqual(
      { qty: row(PRODUCT_B)?.qtySold, gross: row(PRODUCT_B)?.grossSales },
      { qty: 3, gross: 60000 },
      "the fully-refunded order's product must be reported"
    );
    assert.deepEqual(
      { qty: row(PRODUCT_C)?.qtySold, gross: row(PRODUCT_C)?.grossSales },
      { qty: 1, gross: 4000 },
      "a product sold only on a fully-refunded order must never vanish (A-11)"
    );

    // Invariant 6 — a sold product is never reported as unsold either.
    const unsoldIds = p.unsoldProducts.map((x) => x.productId);
    for (const id of [PRODUCT_A, PRODUCT_B, PRODUCT_C]) {
      assert.equal(unsoldIds.includes(id), false, `${id} is sold on the canonical set`);
    }

    // Invariant 5 — the product report covers every best seller of the sales report.
    assert.ok(s.bestSellingProducts.length > 0);
    for (const best of s.bestSellingProducts) {
      assert.ok(row(best.productId), `best seller ${best.productId} must appear in the product report`);
    }

    // The excluded orders contributed nothing: 94 000 is exactly the four
    // non-refunded/excluded-proof orders (30 000 + 20 000 + 4 000 + 10 000 + 30 000).
    assert.equal(row(PRODUCT_A)!.qtySold * 10000 + row(PRODUCT_B)!.qtySold * 20000 + row(PRODUCT_C)!.qtySold * 4000, 94000);

    // Tenant isolation: B sees only its own refunded order; A's figures stand.
    const pB = await reportService.getProductReport(REST_B, "custom", {
      startDate: D.oct22,
      endDate: D.oct22,
    });
    assert.equal(pB.summary.orderCount, 1);
    assert.equal(pB.summary.grossSales, 9000);
    assert.deepEqual(pB.products.map((x) => x.productId), [PRODUCT_BR]);
    assert.equal((await salesFor(REST_B, D.oct22)).summary.totalSales, 9000);
  });

  // ------------------------------------------------------------------
  // 20. A-12 — the multi-outlet order-type breakdown must use that same set
  //
  // Before STEP 2C.3B this one query filtered `paymentStatus = 'PAID'` while the
  // branch totals beside it used the canonical set, so a branch's order-type
  // amounts could not add up to its own `totalSales`.
  // ------------------------------------------------------------------
  it("20. the multi-outlet order-type breakdown uses the canonical revenue set (A-12, STEP 2C.3B)", async () => {
    const paid = await mkOrder("s20-paid", 50000, {
      createdAt: at(2026, 10, 23, 9),
      paymentStatus: "PAID",
      orderType: "DINE_IN",
    });
    await mkItem("s20-paid", paid, 1, 50000, PRODUCT_A);
    await mkPayment("s20-paid", paid, 50000, {
      status: "PAID",
      paidAt: at(2026, 10, 23, 9, 5),
    });

    const fullRef = await mkOrder("s20-fullref", 20000, {
      createdAt: at(2026, 10, 23, 10),
      paymentStatus: "UNPAID",
      orderType: "TAKEAWAY",
    });
    await mkItem("s20-fullref", fullRef, 1, 20000, PRODUCT_A);
    const fullRefPay = await mkPayment("s20-fullref", fullRef, 20000, {
      status: "REFUNDED",
      paidAt: at(2026, 10, 23, 10, 5),
    });
    await mkRefund("s20-fullref", fullRef, 20000, {
      paymentId: fullRefPay,
      status: "APPROVED",
      approvedAt: at(2026, 10, 23, 10, 30),
    });

    // Excluded cases — they must never reach `orders`, `totalSales` or the breakdown.
    const unpaid = await mkOrder("s20-unpaid", 8000, {
      createdAt: at(2026, 10, 23, 11),
      paymentStatus: "UNPAID",
      orderType: "DINE_IN",
    });
    await mkItem("s20-unpaid", unpaid, 1, 8000, PRODUCT_A);

    const cancelled = await mkOrder("s20-cancel", 6000, {
      createdAt: at(2026, 10, 23, 12),
      status: "CANCELLED",
      paymentStatus: "PAID",
      orderType: "DELIVERY",
    });
    await mkItem("s20-cancel", cancelled, 1, 6000, PRODUCT_A);
    await mkPayment("s20-cancel", cancelled, 6000, {
      status: "PAID",
      paidAt: at(2026, 10, 23, 12, 5),
    });

    const stale = await mkOrder("s20-stale", 9000, {
      createdAt: at(2026, 10, 23, 13),
      paymentStatus: "UNPAID",
      orderType: "DINE_IN",
    });
    await mkItem("s20-stale", stale, 1, 9000, PRODUCT_A);
    await mkPayment("s20-stale", stale, 9000, {
      status: "PAID",
      paidAt: at(2026, 10, 23, 13, 5),
    });

    // Branch isolation: branch 2 holds a plain paid order the same day.
    const a2 = await mkOrder("s20-a2", 12000, {
      branchId: BR_A2,
      createdAt: at(2026, 10, 23, 10),
      paymentStatus: "PAID",
      orderType: "DINE_IN",
    });
    await mkItem("s20-a2", a2, 1, 12000, PRODUCT_A);
    await mkPayment("s20-a2", a2, 12000, {
      branchId: BR_A2,
      status: "PAID",
      paidAt: at(2026, 10, 23, 10, 5),
    });

    const all = await multiOutlet(D.oct23);
    const a1 = all.outlets.find((o) => o.branchId === BR_A1);
    const b2 = all.outlets.find((o) => o.branchId === BR_A2);
    assert.ok(a1);
    assert.ok(b2);

    // Branch A1 — canonical set = paid (DINE_IN 50 000) + fully refunded (TAKEAWAY 20 000).
    assert.equal(a1.orders, 2);
    assert.equal(a1.totalSales, 70000);
    assert.deepEqual(
      a1.orderType,
      {
        DINE_IN: { count: 1, amount: 50000 },
        TAKEAWAY: { count: 1, amount: 20000 },
        DELIVERY: { count: 0, amount: 0 },
      },
      "the fully-refunded order must appear in the order-type breakdown (A-12)"
    );
    // Invariant 4 — the breakdown must add up to the branch's own total.
    const orderTypeSum =
      a1.orderType.DINE_IN.amount +
      a1.orderType.TAKEAWAY.amount +
      a1.orderType.DELIVERY.amount;
    assert.equal(
      orderTypeSum,
      a1.totalSales,
      "Σ orderType.amount must equal the branch totalSales"
    );
    assert.equal(b2.totalSales, 12000);
    assert.equal(all.summary.totalOrders, 3);
    assert.equal(all.summary.grossSales, 82000);
    assert.equal(all.summary.netSales, 62000); // (70000 − 20000) + 12000

    // Branch isolation — the explicit scope can never widen or leak.
    const only1 = await multiOutlet(D.oct23, D.oct23, [BR_A1]);
    assert.deepEqual(only1.outlets.map((o) => o.branchId), [BR_A1]);
    assert.equal(only1.outlets[0]!.totalSales, 70000);
    assert.equal(only1.outlets[0]!.orderType.TAKEAWAY.amount, 20000);
    const only2 = await multiOutlet(D.oct23, D.oct23, [BR_A2]);
    assert.deepEqual(only2.outlets.map((o) => o.branchId), [BR_A2]);
    assert.equal(only2.outlets[0]!.totalSales, 12000);
    const foreign = await multiOutlet(D.oct23, D.oct23, [BR_B1]);
    assert.deepEqual(foreign.outlets, [], "another tenant's branch id exposes nothing");

    // A-9 cross-check on the same data: hourly == daily == summary.
    const r = await sales(D.oct23, D.oct23, [BR_A1]);
    assert.equal(r.summary.totalSales, 70000);
    assert.equal(r.summary.netSales, 50000); // 70000 − the approved 20000 refund
    assert.equal(r.summary.paidOrders, 2);
    assert.equal(r.summary.totalOrders, 4); // activity: + unpaid + stale mirror
    assert.equal(
      r.busiestHours.reduce((sum, h) => sum + h.revenue, 0),
      70000,
      "the hourly bucket must include the fully-refunded order (A-9)"
    );
    assert.equal(r.busiestHours.reduce((sum, h) => sum + h.orders, 0), 2);
    assert.equal(r.dailySeries.reduce((sum, d) => sum + d.sales, 0), 70000);
  });
});
