/**
 * STEP 2B.4 — PROFIT & LOSS (P&L) INTEGRATION TESTS (real MariaDB, isolated test DB)
 *
 * Scope (and nothing else): the P&L read-model
 * (`src/services/accounting/pnl.service.ts` → `getPnlReport`) exercised against
 * the isolated test database with real Prisma/SQL — no mocked aggregation. The
 * M2 (integrity) SQL module and every production Accounting file are untouched.
 *
 * The P&L read-model is a READ-ONLY COMPOSITION of existing engines:
 *   * Revenue / Net Sales / Tax / Service Charge / Discount  → Profitabilitas
 *     (`profitabilityService.getProfitabilityReport` → `computeRefundRevenue`)
 *   * COGS / coverage / refund-aware reversal / Gross Profit  → Profitabilitas
 *     (`OrderItemCostSnapshot`, `computeRefundAware`)
 *   * Operating Expenses → the `Expense` table, bounded to the SAME period and
 *     the SAME branch scope, by `spentAt`
 *
 *   Gross Profit = netSales − retainedCogs        (null when coverage incomplete)
 *   Net Profit   = Gross Profit − operatingExpenses (null when GP is null)
 *
 * AUDITED RULES asserted below (see ACCOUNTING-INTEGRATION-TEST-PLAN.md §19.2):
 *   * Revenue set = non-CANCELLED AND (Order.paymentStatus = PAID OR a
 *     Payment.status = REFUNDED), attributed to `Order.createdAt`.
 *   * Refund impact attributed to `Refund.approvedAt` (a refund-only period is
 *     legitimate and yields negative netSales); one Refund row is applied once.
 *   * COGS only from `SNAPSHOTTED` snapshots; the CURRENT product/branch HPP is
 *     never consulted; an explicit SNAPSHOTTED 0 IS a real cost; a missing
 *     snapshot is UNKNOWN (never 0 → profit becomes null).
 *   * Expenses are recognised by `spentAt` only, never by `createdAt`.
 *   * `filters.branchId` is a HINT (echoed); scoping comes from `branchFilters`.
 *   * `pagination limit 1` trims only the product table — the summary is
 *     computed over all products.
 *
 * FIXTURE MANEUVER (documented, no production change): the refund tests drive the
 * REAL approval service (so every write-side effect is produced by production
 * code) and then relocate the resulting `Refund.approvedAt` onto a dedicated
 * calendar day, because `decideRefund` stamps `approvedAt = now` internally and
 * the P&L summary cannot be scoped to a single product. This keeps each read
 * window deterministic without weakening any assertion.
 *
 * Safety: `tests/setup.ts` is imported FIRST — it loads `.env.test`, runs the
 * fail-closed checks and pins `DATABASE_URL` to `TEST_DATABASE_URL` before any
 * service/prisma module is evaluated.
 *
 * Run (from the project root, ONE FILE AT A TIME — each suite asserts whole-table
 * baselines):
 *   npx tsx --test tests/accounting/pnl.integration.test.ts
 */

import { assertLiveTestTarget, EXPECTED_TEST_DB } from "../setup"; // MUST stay first (see header)

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";
import { getPnlReport } from "@/services/accounting/pnl.service";
import { getCashbook } from "@/services/accounting/cashbook.service";
import { createExpense } from "@/services/accounting/expense.service";
import { approvalService } from "@/services/approval/approval.service";
import { profitabilityService } from "@/services/profitability/profitability.service";
import {
  cleanupRun,
  createBranchFixture,
  createBranchProductFixture,
  createCategoryFixture,
  createCustomerFixture,
  createExpenseCategoryFixture,
  createExpenseFixture,
  createOrderFixture,
  createOrderItemCostSnapshotFixture,
  createOrderItemFixture,
  createPaymentFixture,
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

const RUN = createRunId("cbpnl");
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
const CATEGORY_B = `${RUN}-cat-b`;
const EXP_CAT_1 = `${RUN}-expcat-1`;
const EXP_CAT_1_NAME = `${RUN} Operasional`;
const EXP_CAT_2 = `${RUN}-expcat-2`;
const EXP_CAT_2_NAME = `${RUN} Marketing`;
const EXP_CAT_B = `${RUN}-expcat-b`;

const at = (y: number, m: number, d: number, h = 10, min = 0) =>
  new Date(y, m - 1, d, h, min, 0, 0);

/** Dedicated calendar day per scenario (no two scenarios share a day). */
const D = {
  sep1: "2026-09-01",
  sep25: "2026-09-25",
  sep26: "2026-09-26",
  sep27: "2026-09-27",
  sep28: "2026-09-28",
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
  oct16: "2026-10-16",
  oct17: "2026-10-17",
  oct18: "2026-10-18",
  oct19: "2026-10-19",
  oct20: "2026-10-20",
  oct21: "2026-10-21",
  oct22: "2026-10-22",
  oct23: "2026-10-23",
  oct24: "2026-10-24",
  empty: "2026-11-01",
} as const;

const T = {
  sep1: at(2026, 9, 1, 9),
  sep25: at(2026, 9, 25, 10),
  sep26: at(2026, 9, 26, 10),
  sep27: at(2026, 9, 27, 12),
  sep28: at(2026, 9, 28, 12),
  oct1: at(2026, 10, 1, 10),
  oct2: at(2026, 10, 2, 10),
  oct3: at(2026, 10, 3, 10),
  oct4: at(2026, 10, 4, 10),
  oct5: at(2026, 10, 5, 10),
  oct6: at(2026, 10, 6, 10),
  oct7: at(2026, 10, 7, 10),
  oct8: at(2026, 10, 8, 10),
  oct9: at(2026, 10, 9, 10),
  oct10: at(2026, 10, 10, 10),
  oct11: at(2026, 10, 11, 10),
  oct12: at(2026, 10, 12, 10),
  oct13: at(2026, 10, 13, 10),
  oct15: at(2026, 10, 15, 10),
  oct16: at(2026, 10, 16, 10),
  oct17: at(2026, 10, 17, 10),
  oct18: at(2026, 10, 18, 10),
  oct19: at(2026, 10, 19, 10),
  oct20: at(2026, 10, 20, 10),
  oct21: at(2026, 10, 21, 10),
  oct22: at(2026, 10, 22, 10),
  oct23: at(2026, 10, 23, 10),
  oct24: at(2026, 10, 24, 10),
} as const;

function localDateOnly(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** P&L for a `custom` (single-day) window of restaurant A. */
function pnl(dateFrom: string, dateTo: string = dateFrom, branchFilters?: string[] | null) {
  return getPnlReport(REST_A, { period: "custom", startDate: dateFrom, endDate: dateTo }, branchFilters);
}

function pnlFor(restaurantId: string, query: Record<string, unknown>) {
  return getPnlReport(restaurantId, query);
}

/** round2, re-implemented in the test so expectations are never self-derived. */
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
/** Every monetary value the P&L returns must be a clean 2-decimal number. */
function assertMoney(value: number | null, label: string) {
  if (value === null) return;
  assert.match(
    String(value),
    /^-?\d+(\.\d{1,2})?$/,
    `${label} must be a 2-decimal money value (got ${value})`
  );
}

// ------------------------------------------------------------
// Fixture shorthands.
// ------------------------------------------------------------

type SnapshotSpec = {
  status: "SNAPSHOTTED" | "NO_RECIPE" | "MISSING_WAC" | "INACTIVE_INGREDIENT" | "NO_BRANCH";
  hppUnit?: number | null;
  hppTotal?: number | null;
};

interface ItemSpec {
  productId: string;
  quantity: number;
  unitPrice: number;
  /** Defaults to `quantity × unitPrice`; set explicitly for rounding cases. */
  totalPrice?: number;
  snapshot?: SnapshotSpec;
}

interface PaymentSpec {
  amount: number;
  method?: string | null;
  status?: "UNPAID" | "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUNDED" | "CANCELLED";
  paidAt?: Date | null;
  createdAt?: Date;
}

async function mkOrder(
  label: string,
  opts: {
    grandTotal: number;
    createdAt: Date;
    restaurantId?: string;
    branchId?: string;
    customerId?: string;
    subtotal?: number;
    tax?: number;
    serviceCharge?: number;
    discount?: number;
    orderType?: "DINE_IN" | "TAKEAWAY" | "DELIVERY";
    status?: "COMPLETED" | "READY" | "PENDING" | "CONFIRMED" | "PROCESSING" | "CANCELLED";
    paymentStatus?: "UNPAID" | "PENDING" | "PAID" | "FAILED" | "EXPIRED" | "REFUNDED" | "CANCELLED";
    items?: ItemSpec[];
    /** Defaults to a single KASIR payment of `grandTotal` dated `createdAt`. */
    payments?: PaymentSpec[];
  }
): Promise<{ orderId: string; itemIds: string[]; paymentIds: string[] }> {
  const restaurantId = opts.restaurantId ?? REST_A;
  const branchId = opts.branchId ?? (restaurantId === REST_B ? BR_B1 : BR_A1);
  const customerId = opts.customerId ?? (restaurantId === REST_B ? CUST_B : CUST_A);
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
    serviceCharge: opts.serviceCharge ?? 0,
    discount: opts.discount ?? 0,
    createdAt: opts.createdAt,
    status: opts.status ?? "COMPLETED",
    paymentStatus: opts.paymentStatus ?? "PAID",
    ...(opts.orderType ? { orderType: opts.orderType } : {}),
  });

  const itemIds: string[] = [];
  let index = 0;
  for (const spec of opts.items ?? []) {
    index += 1;
    const itemId = `${RUN}-${label}-item-${index}`;
    await createOrderItemFixture(prisma, {
      id: itemId,
      orderId,
      productId: spec.productId,
      quantity: spec.quantity,
      unitPrice: spec.unitPrice,
      totalPrice: spec.totalPrice ?? spec.quantity * spec.unitPrice,
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
    itemIds.push(itemId);
  }

  const paymentSpecs: PaymentSpec[] =
    opts.payments === undefined
      ? [{ amount: opts.grandTotal, method: "KASIR", status: "PAID", paidAt: opts.createdAt }]
      : opts.payments;

  const paymentIds: string[] = [];
  let pIndex = 0;
  for (const spec of paymentSpecs) {
    pIndex += 1;
    const paymentId = `${RUN}-${label}-pay-${pIndex}`;
    await createPaymentFixture(prisma, {
      id: paymentId,
      restaurantId,
      orderId,
      branchId,
      amount: spec.amount,
      method: spec.method === undefined ? "KASIR" : spec.method,
      status: spec.status ?? "PAID",
      paidAt: spec.paidAt === undefined ? opts.createdAt : spec.paidAt,
      createdAt: spec.createdAt ?? opts.createdAt,
    });
    paymentIds.push(paymentId);
  }

  return { orderId, itemIds, paymentIds };
}

let productSeq = 0;
async function mkProduct(label: string, price = 25000, restaurantId = REST_A): Promise<string> {
  productSeq += 1;
  const id = `${RUN}-prod-${label}`;
  await createProductFixture(prisma, {
    id,
    restaurantId,
    categoryId: restaurantId === REST_B ? CATEGORY_B : CATEGORY_A,
    name: `${RUN} Product ${label}`,
    price,
  });
  void productSeq;
  return id;
}

/** Expense created through the REAL expense service (spentAt is date-only). */
async function mkExpenseViaService(
  label: string,
  input: {
    amount: number;
    spentAt: string;
    branchId?: string;
    categoryId?: string;
    restaurantId?: string;
    userId?: string;
    method?: "CASH" | "TRANSFER" | "QRIS" | "CARD" | "OTHER";
  }
) {
  return createExpense(input.restaurantId ?? REST_A, input.userId ?? USER_A, {
    branchId: input.branchId ?? BR_A1,
    categoryId: input.categoryId ?? EXP_CAT_1,
    amount: input.amount,
    spentAt: input.spentAt,
    method: input.method ?? "CASH",
    note: `${RUN} ${label}`,
  });
}

// ============================================================
// SUITE
// ============================================================

describe("STEP 2B.4 — P&L integration (real MariaDB, isolated test DB)", () => {
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
    await createCategoryFixture(prisma, {
      id: CATEGORY_B,
      restaurantId: REST_B,
      name: `${RUN} Makanan B`,
    });
    for (const [id, restaurantId, name] of [
      [EXP_CAT_1, REST_A, EXP_CAT_1_NAME],
      [EXP_CAT_2, REST_A, EXP_CAT_2_NAME],
      [EXP_CAT_B, REST_B, `${RUN} Operasional B`],
    ] as const) {
      await createExpenseCategoryFixture(prisma, { id, restaurantId, name });
    }
  });

  after(async () => {
    const result = await cleanupRun(prisma, RUN);
    const afterCounts = await snapshotCounts(prisma);
    const residual = await findResiduals(prisma, RUN, result.scope);

    console.log("\n[STEP 2B.4 CLEANUP] rows deleted:", JSON.stringify(result.deleted));
    console.log("[STEP 2B.4 CLEANUP] residual (run-scoped):", JSON.stringify(residual));
    console.log(
      "[STEP 2B.4 CLEANUP] table counts (baseline → after):",
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
  // 1. Runtime isolated DB identity
  // ------------------------------------------------------------------
  it("1. the runtime connection targets the isolated test database", async () => {
    const rows = await prisma.$queryRaw<Array<{ db: string; user: string }>>`
      SELECT CAST(DATABASE() AS CHAR) AS db, CAST(USER() AS CHAR) AS user
    `;
    const identity = rows[0];
    assert.ok(identity);
    // Centralised live guard (STEP 2C.2F): database name + dedicated user.
    await assertLiveTestTarget(prisma);
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(identity.db, EXPECTED_TEST_DB.name);
    assert.ok(identity.db.includes("_test"));
    assert.notEqual(identity.db, "restaurant_app");
    assert.equal(EXPECTED_TEST_DB.port, process.env.TEST_DB_EXPECTED_PORT ?? "3308");
    assert.ok(process.env.DATABASE_URL?.includes(`/${EXPECTED_TEST_DB.name}`));
    assert.ok(identity.user.startsWith(EXPECTED_TEST_DB.user));
  });

  // ------------------------------------------------------------------
  // 2. Empty period
  // ------------------------------------------------------------------
  it("2. an empty period reports zeros with an UNKNOWN profit", async () => {
    const report = await pnl(D.empty);

    assert.equal(report.period, "custom");
    assert.equal(
      new Date(report.range.start).getTime(),
      new Date(`${D.empty}T00:00:00`).getTime()
    );
    assert.equal(
      new Date(report.range.end).getTime(),
      new Date(`${D.empty}T23:59:59.999`).getTime()
    );
    assert.deepEqual(report.filters, { branchId: null, orderType: null, paymentMethod: null });

    assert.equal(report.summary.grossSales, 0);
    assert.equal(report.summary.totalDiscount, 0);
    assert.equal(report.summary.totalTax, 0);
    assert.equal(report.summary.totalServiceCharge, 0);
    assert.equal(report.summary.totalRefund, 0);
    assert.equal(report.summary.netSales, 0);
    assert.equal(report.summary.cogs, 0);
    assert.equal(report.summary.historicalCogs, 0);
    assert.equal(report.summary.cogsReversal, 0);
    assert.equal(report.summary.grossProfit, null, "an empty scope is never a covered 0-cost profit");
    assert.equal(report.summary.operatingExpenses, 0);
    assert.equal(report.summary.netProfit, null);

    assert.deepEqual(report.coverage, {
      totalOrderItems: 0,
      costedOrderItems: 0,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.equal(report.coverageComplete, false);
    assert.equal(report.cogsState, "NO_ITEMS");
    assert.equal(report.refundState, "NONE");
    assert.deepEqual(report.unpaidCompleted, { orders: 0, orderItems: 0, cogs: 0 });

    assert.deepEqual(report.opex, { total: 0, count: 0, byCategory: [] });

    assert.equal(report.disclosure.netProfitProvisional, true);
    assert.equal(report.disclosure.expenseDataEmpty, true);
    assert.equal(report.disclosure.purchaseExcluded, true);
    assert.deepEqual(report.disclosure.revenueWithoutItems, { orders: 0, headerValue: 0 });
    assert.deepEqual(report.disclosure.dateBasis, {
      revenue: "order.createdAt",
      refund: "refund.approvedAt",
      cogs: "order.createdAt",
      expense: "expense.spentAt",
    });
  });

  // ------------------------------------------------------------------
  // 3. Single paid eligible order
  // ------------------------------------------------------------------
  it("3. a single paid order produces revenue, COGS and a net profit", async () => {
    const product = await mkProduct("s3", 100000);
    const order = await mkOrder("s3", {
      grandTotal: 100000,
      createdAt: T.oct1,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    await mkExpenseViaService("s3", { amount: 25000, spentAt: D.oct1 });

    const report = await pnl(D.oct1);

    assert.equal(report.summary.grossSales, 100000);
    assert.equal(report.summary.totalRefund, 0);
    assert.equal(report.summary.netSales, 100000);
    assert.equal(report.summary.historicalCogs, 60000);
    assert.equal(report.summary.cogsReversal, 0);
    assert.equal(report.summary.cogs, 60000);
    assert.equal(report.summary.grossProfit, 40000);
    assert.equal(report.summary.operatingExpenses, 25000);
    assert.equal(report.summary.netProfit, 15000);
    // Net Profit is always exactly Gross Profit − Operating Expenses.
    assert.equal(
      report.summary.netProfit,
      r2((report.summary.grossProfit ?? 0) - report.summary.operatingExpenses)
    );

    assert.deepEqual(report.coverage, {
      totalOrderItems: 1,
      costedOrderItems: 1,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.equal(report.coverageComplete, true);
    assert.equal(report.cogsState, "COVERED");
    assert.equal(report.refundState, "NONE");

    assert.equal(report.opex.count, 1);
    assert.deepEqual(report.opex.byCategory, [
      { categoryId: EXP_CAT_1, categoryName: EXP_CAT_1_NAME, total: 25000, count: 1 },
    ]);
    assert.equal(report.disclosure.expenseDataEmpty, false);

    // Derived margins (the P&L contract exposes no percentage field — see §19.2).
    assert.equal(r2((40000 / 100000) * 100), 40);
    assert.equal(r2((15000 / 100000) * 100), 15);
    assertMoney(report.summary.netProfit, "netProfit");
    assert.ok(order.orderId);
  });

  // ------------------------------------------------------------------
  // 4. Multiple eligible paid orders
  // ------------------------------------------------------------------
  it("4. multiple paid orders aggregate into one P&L", async () => {
    const productA = await mkProduct("s4a", 100000);
    const productB = await mkProduct("s4b", 50000);
    await mkOrder("s4a", {
      grandTotal: 100000,
      createdAt: T.oct2,
      items: [
        {
          productId: productA,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    await mkOrder("s4b", {
      grandTotal: 50000,
      createdAt: T.oct2,
      items: [
        {
          productId: productB,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 20000, hppTotal: 20000 },
        },
      ],
    });
    await mkExpenseViaService("s4a", { amount: 10000, spentAt: D.oct2, categoryId: EXP_CAT_1 });
    await mkExpenseViaService("s4b", { amount: 5000, spentAt: D.oct2, categoryId: EXP_CAT_2 });

    const report = await pnl(D.oct2);

    assert.equal(report.summary.grossSales, 150000);
    assert.equal(report.summary.netSales, 150000);
    assert.equal(report.summary.historicalCogs, 80000);
    assert.equal(report.summary.cogs, 80000);
    assert.equal(report.summary.grossProfit, 70000);
    assert.equal(report.summary.operatingExpenses, 15000);
    assert.equal(report.summary.netProfit, 55000);
    assert.equal(report.coverageComplete, true);
    assert.deepEqual(report.coverage, {
      totalOrderItems: 2,
      costedOrderItems: 2,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.equal(report.opex.count, 2);
    assert.deepEqual(report.opex.byCategory, [
      { categoryId: EXP_CAT_1, categoryName: EXP_CAT_1_NAME, total: 10000, count: 1 },
      { categoryId: EXP_CAT_2, categoryName: EXP_CAT_2_NAME, total: 5000, count: 1 },
    ]);
  });

  // ------------------------------------------------------------------
  // 5. UNPAID / PENDING / FAILED / EXPIRED exclusion
  // ------------------------------------------------------------------
  it("5. uncollected orders never enter revenue (but stay disclosed)", async () => {
    const product = await mkProduct("s5", 100000);
    const productPaid = await mkProduct("s5-paid", 20000);

    const excluded: Array<{
      label: string;
      total: number;
      status: "UNPAID" | "PENDING" | "FAILED" | "EXPIRED";
      cogs: number;
    }> = [
      { label: "u1", total: 100000, status: "UNPAID", cogs: 60000 },
      { label: "p2", total: 110000, status: "PENDING", cogs: 66000 },
      { label: "f3", total: 120000, status: "FAILED", cogs: 72000 },
      { label: "e4", total: 130000, status: "EXPIRED", cogs: 78000 },
    ];
    for (const spec of excluded) {
      await mkOrder(`s5-${spec.label}`, {
        grandTotal: spec.total,
        createdAt: T.oct3,
        paymentStatus: "UNPAID",
        items: [
          {
            productId: product,
            quantity: 1,
            unitPrice: spec.total,
            snapshot: { status: "SNAPSHOTTED", hppUnit: spec.cogs, hppTotal: spec.cogs },
          },
        ],
        payments: [{ amount: spec.total, method: "KASIR", status: spec.status, paidAt: null }],
      });
    }

    await mkOrder("s5-paid", {
      grandTotal: 20000,
      createdAt: T.oct3,
      items: [
        {
          productId: productPaid,
          quantity: 1,
          unitPrice: 20000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 12000, hppTotal: 12000 },
        },
      ],
    });

    const report = await pnl(D.oct3);

    assert.equal(report.summary.grossSales, 20000, "only the collected order is revenue");
    assert.equal(report.summary.netSales, 20000);
    assert.equal(report.summary.historicalCogs, 12000, "uncollected COGS is not recognised");
    assert.equal(report.summary.cogs, 12000);
    assert.equal(report.summary.grossProfit, 8000);
    assert.equal(report.summary.netProfit, 8000);
    assert.deepEqual(report.coverage, {
      totalOrderItems: 1,
      costedOrderItems: 1,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    // …and the incurred-but-uncollected COGS is disclosed instead of hidden.
    assert.deepEqual(report.unpaidCompleted, {
      orders: 4,
      orderItems: 4,
      cogs: 60000 + 66000 + 72000 + 78000,
    });
    assert.equal(report.disclosure.expenseDataEmpty, true);
    assert.equal(report.summary.operatingExpenses, 0);
  });

  // ------------------------------------------------------------------
  // 6. CANCELLED order exclusion
  // ------------------------------------------------------------------
  it("6. a cancelled order contributes neither revenue nor net profit", async () => {
    const product = await mkProduct("s6", 999999);
    await mkOrder("s6", {
      grandTotal: 999999,
      createdAt: T.oct4,
      branchId: BR_A1,
      paymentStatus: "CANCELLED",
      status: "CANCELLED",
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 999999,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 600000, hppTotal: 600000 },
        },
      ],
      payments: [
        { amount: 500000, method: "KASIR", status: "PAID", paidAt: T.oct4 },
        { amount: 499999, method: "QRIS", status: "REFUNDED", paidAt: T.oct4 },
      ],
    });
    await mkExpenseViaService("s6", { amount: 5000, spentAt: D.oct4 });

    const report = await pnl(D.oct4);

    assert.equal(report.summary.grossSales, 0);
    assert.equal(report.summary.netSales, 0);
    assert.equal(report.summary.cogs, 0);
    assert.equal(report.coverageComplete, false);
    assert.equal(report.cogsState, "NO_ITEMS");
    assert.equal(report.summary.grossProfit, null, "a cancelled order can never produce a profit");
    assert.equal(report.summary.operatingExpenses, 5000, "the expense is still recognised");
    assert.equal(report.summary.netProfit, null, "an unknown gross profit keeps net profit unknown");
    assert.equal(report.opex.count, 1);
    assert.deepEqual(report.unpaidCompleted, { orders: 0, orderItems: 0, cogs: 0 });
  });

  // ------------------------------------------------------------------
  // 7. Multiple payment attempts do not multiply revenue
  // ------------------------------------------------------------------
  it("7. multiple payment attempts never multiply revenue", async () => {
    const product = await mkProduct("s7", 100000);
    await mkOrder("s7", {
      grandTotal: 200000,
      createdAt: T.oct5,
      items: [
        {
          productId: product,
          quantity: 2,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 120000 },
        },
      ],
      payments: [
        { amount: 60000, method: "KASIR", status: "PAID", paidAt: T.oct5 },
        { amount: 70000, method: "KASIR", status: "PAID", paidAt: T.oct5 },
        { amount: 70000, method: "QRIS", status: "PAID", paidAt: T.oct5 },
        { amount: 30000, method: "QRIS", status: "PENDING", paidAt: null },
        { amount: 30000, method: "QRIS", status: "CANCELLED", paidAt: null },
      ],
    });

    const report = await pnl(D.oct5);

    assert.equal(report.summary.grossSales, 200000, "the ORDER is revenue, once");
    assert.equal(report.summary.netSales, 200000);
    assert.equal(report.summary.cogs, 120000);
    assert.equal(report.summary.grossProfit, 80000);
    assert.equal(report.summary.netProfit, 80000);
    assert.deepEqual(report.coverage, {
      totalOrderItems: 1,
      costedOrderItems: 1,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.deepEqual(report.unpaidCompleted, { orders: 0, orderItems: 0, cogs: 0 });
  });

  // ------------------------------------------------------------------
  // 8. Gross sales / tax / service charge / discount / net sales
  // ------------------------------------------------------------------
  it("8. tax, service charge and discount follow the documented formula", async () => {
    const product = await mkProduct("s8", 100000);
    await mkOrder("s8", {
      grandTotal: 110000,
      subtotal: 100000,
      discount: 5000,
      tax: 11000,
      serviceCharge: 4000,
      createdAt: T.oct6,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });
    await mkExpenseViaService("s8", { amount: 10000, spentAt: D.oct6 });

    const report = await pnl(D.oct6);

    assert.equal(report.summary.grossSales, 110000, "gross sales = Σ grandTotal");
    assert.equal(report.summary.totalDiscount, 5000);
    assert.equal(report.summary.totalTax, 11000);
    assert.equal(report.summary.totalServiceCharge, 4000);
    // netSales uses the PRODUCT basis (grandTotal − tax − serviceCharge), which is
    // exactly the order's product revenue here: 110000 − 11000 − 4000 = 95000.
    assert.equal(report.summary.netSales, 95000);
    assert.equal(
      report.summary.netSales,
      r2(report.summary.grossSales - report.summary.totalTax - report.summary.totalServiceCharge)
    );
    // It is NOT gross sales minus refunds.
    assert.notEqual(
      report.summary.netSales,
      r2(report.summary.grossSales - report.summary.totalRefund)
    );
    assert.equal(report.summary.totalRefund, 0);
    assert.equal(report.summary.cogs, 60000);
    assert.equal(report.summary.grossProfit, 35000);
    assert.equal(report.summary.operatingExpenses, 10000);
    assert.equal(report.summary.netProfit, 25000);
  });

  // ------------------------------------------------------------------
  // 9. Historical snapshot COGS, never the current product HPP
  // ------------------------------------------------------------------
  it("9. COGS comes from the historical snapshot, never the current HPP", async () => {
    const product = await mkProduct("s9", 100000);
    await createBranchProductFixture(prisma, {
      id: `${RUN}-s9-branchproduct`,
      branchId: BR_A1,
      productId: product,
      costingMode: "MANUAL",
      manualHpp: 99000,
    });
    await mkOrder("s9", {
      grandTotal: 100000,
      createdAt: T.oct7,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
    });

    const branchProduct = await prisma.branchProduct.findFirstOrThrow({
      where: { productId: product },
      select: { manualHpp: true },
    });
    assert.equal(Number(branchProduct.manualHpp), 99000);

    const report = await pnl(D.oct7);
    assert.equal(report.summary.historicalCogs, 60000, "the frozen snapshot wins");
    assert.notEqual(report.summary.cogs, 99000, "the current manual HPP is never used");
    assert.equal(report.summary.cogs, 60000);
    assert.equal(report.summary.grossProfit, 40000);
    assert.equal(report.summary.netProfit, 40000);
    assert.equal(report.coverageComplete, true);
  });

  // ------------------------------------------------------------------
  // 10. Complete coverage → gross profit (and derived margins)
  // ------------------------------------------------------------------
  it("10. complete coverage yields a real gross profit and margins", async () => {
    const productA = await mkProduct("s10a", 25000);
    const productB = await mkProduct("s10b", 50000);
    await mkOrder("s10", {
      grandTotal: 100000,
      createdAt: T.oct8,
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
    await mkExpenseViaService("s10", { amount: 20000, spentAt: D.oct8 });

    const report = await pnl(D.oct8);

    assert.deepEqual(report.coverage, {
      totalOrderItems: 2,
      costedOrderItems: 2,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.equal(report.coverageComplete, true);
    assert.equal(report.cogsState, "COVERED");
    assert.equal(report.summary.netSales, 100000);
    assert.equal(report.summary.cogs, 50000);
    assert.equal(report.summary.grossProfit, 50000);
    assert.equal(report.summary.operatingExpenses, 20000);
    assert.equal(report.summary.netProfit, 30000);
    // Deterministic margin arithmetic (no margin field exists in the contract).
    assert.equal(r2(((report.summary.grossProfit ?? 0) / report.summary.netSales) * 100), 50);
    assert.equal(r2((report.summary.netProfit! / report.summary.netSales) * 100), 30);
  });

  // ------------------------------------------------------------------
  // 11. Missing / incomplete snapshot coverage → INCOMPLETE & null profit
  // ------------------------------------------------------------------
  it("11. missing or partial snapshot coverage makes the profit UNKNOWN", async () => {
    const productLegacy = await mkProduct("s11l", 100000);
    await mkOrder("s11-legacy", {
      grandTotal: 100000,
      createdAt: T.oct9,
      items: [{ productId: productLegacy, quantity: 1, unitPrice: 100000 }], // no snapshot at all
    });
    await mkOrder("s11-headless", {
      grandTotal: 70000,
      createdAt: T.oct9,
      items: [],
    });
    await mkExpenseViaService("s11", { amount: 15000, spentAt: D.oct9 });

    const legacy = await pnl(D.oct9);
    assert.deepEqual(legacy.coverage, {
      totalOrderItems: 1,
      costedOrderItems: 0,
      uncostedOrderItems: 0,
      legacyOrderItems: 1,
      pendingOrderItems: 0,
    });
    assert.equal(legacy.coverageComplete, false);
    assert.equal(legacy.cogsState, "LEGACY");
    assert.equal(legacy.summary.netSales, 170000);
    assert.equal(legacy.summary.historicalCogs, 0);
    assert.equal(legacy.summary.cogs, 0, "a missing cost is never fabricated as 0");
    assert.equal(legacy.summary.grossProfit, null);
    assert.equal(legacy.summary.netProfit, null, "expenses are recognised but profit stays unknown");
    assert.equal(legacy.summary.operatingExpenses, 15000);
    assert.deepEqual(legacy.disclosure.revenueWithoutItems, { orders: 1, headerValue: 70000 });
    assert.equal(legacy.opex.count, 1);

    // PARTIAL coverage: one covered item, one snapshot whose status is not SNAPSHOTTED.
    const productP = await mkProduct("s11p", 50000);
    const productQ = await mkProduct("s11q", 30000);
    await mkOrder("s11-partial", {
      grandTotal: 80000,
      createdAt: T.oct10,
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

    const partial = await pnl(D.oct10);
    assert.deepEqual(partial.coverage, {
      totalOrderItems: 2,
      costedOrderItems: 1,
      uncostedOrderItems: 1,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });
    assert.equal(partial.coverageComplete, false);
    assert.equal(partial.cogsState, "PARTIAL");
    assert.equal(partial.summary.cogs, 20000);
    assert.equal(partial.summary.netSales, 80000);
    assert.equal(partial.summary.grossProfit, null);
    assert.equal(partial.summary.operatingExpenses, 0);
    // With zero expenses the net profit is STILL null — never 0, never revenue.
    assert.equal(partial.summary.netProfit, null);
  });

  // ------------------------------------------------------------------
  // 12. Explicit zero historical HPP is a real value
  // ------------------------------------------------------------------
  it("12. an explicit zero historical HPP is a real cost, not missing data", async () => {
    const product = await mkProduct("s12", 50000);
    await mkOrder("s12", {
      grandTotal: 50000,
      createdAt: T.oct11,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 0, hppTotal: 0 },
        },
      ],
    });
    await mkExpenseViaService("s12", { amount: 10000, spentAt: D.oct11 });

    const report = await pnl(D.oct11);
    assert.equal(report.coverageComplete, true, "a valid zero cost IS covered");
    assert.equal(report.cogsState, "COVERED");
    assert.equal(report.summary.cogs, 0);
    assert.equal(report.summary.grossProfit, 50000);
    assert.equal(report.summary.netProfit, 40000);
    assert.equal(r2((report.summary.cogs / report.summary.netSales) * 100), 0, "food cost 0 %");
    assert.equal(r2(((report.summary.grossProfit ?? 0) / report.summary.netSales) * 100), 100);

    // Contrast with the LEGACY window (missing snapshot) → null, never full margin.
    const missing = await pnl(D.oct9);
    assert.equal(missing.cogsState, "LEGACY");
    assert.equal(missing.summary.grossProfit, null);
    assert.equal(missing.summary.netProfit, null);
  });

  // ------------------------------------------------------------------
  // 13. Partial item-based refund (real approval service)
  // ------------------------------------------------------------------
  it("13. a partial item-based refund releases its frozen COGS exactly once", async () => {
    const productA = await mkProduct("s13a", 25000);
    const productB = await mkProduct("s13b", 50000);
    const order = await mkOrder("s13", {
      grandTotal: 125000,
      createdAt: T.oct12,
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

    // REAL service: amount is derived server-side from the requested quantity.
    const refund = await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: order.orderId,
      amount: 1, // decoy — ignored because item allocations are present
      reason: `${RUN} s13 partial item refund`,
      items: [{ orderItemId: order.itemIds[0], quantity: 2 }],
    });
    assert.equal(Number(refund.amount), 50000);
    const decided = await approvalService.decideRefund({
      restaurantId: REST_A,
      adminId: USER_A,
      refundId: refund.id,
      approve: true,
    });
    assert.equal(decided.status, "APPROVED");

    // Fixture maneuver: the service stamps approvedAt = now; relocate the read-side
    // attribution date to this scenario's dedicated day (documented in the header).
    await prisma.refund.update({
      where: { id: refund.id },
      data: { approvedAt: at(2026, 10, 12, 12) },
    });

    await mkExpenseViaService("s13", { amount: 8000, spentAt: D.oct12 });

    // Write-side state produced by the production engine.
    const refundItem = await prisma.refundItem.findFirstOrThrow({ where: { refundId: refund.id } });
    assert.equal(refundItem.quantity, 2);
    assert.equal(Number(refundItem.amount), 50000);
    assert.equal(Number(refundItem.reversedCogs), 30000, "round2(15000 × 2), frozen");
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentIds[0] } });
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    assert.equal(payment.status, "PAID", "a partial refund keeps the collection");
    assert.equal(orderRow.paymentStatus, "PAID");
    assert.equal(
      await prisma.paymentTransaction.count({
        where: { paymentId: order.paymentIds[0], type: "refund" },
      }),
      1
    );

    const report = await pnl(D.oct12);
    assert.equal(report.summary.grossSales, 125000);
    assert.equal(report.summary.totalRefund, 50000);
    assert.equal(report.summary.netSales, 75000);
    assert.equal(report.summary.historicalCogs, 65000);
    assert.equal(report.summary.cogsReversal, 30000, "the frozen exact reversal");
    assert.equal(report.summary.cogs, 35000);
    assert.equal(report.summary.grossProfit, 40000);
    assert.equal(report.summary.operatingExpenses, 8000);
    assert.equal(report.summary.netProfit, 32000);
    assert.equal(report.refundState, "PARTIAL");
    assert.equal(report.coverageComplete, true);
  });

  // ------------------------------------------------------------------
  // 14. Full item-based refund
  // ------------------------------------------------------------------
  it("14. a full item-based refund keeps ALL the incurred COGS", async () => {
    const product = await mkProduct("s14", 25000);
    const order = await mkOrder("s14", {
      grandTotal: 50000,
      createdAt: T.oct13,
      items: [
        {
          productId: product,
          quantity: 2,
          unitPrice: 25000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 15000, hppTotal: 30000 },
        },
      ],
    });

    const refund = await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: order.orderId,
      amount: 1,
      reason: `${RUN} s14 full item refund`,
      items: [{ orderItemId: order.itemIds[0], quantity: 2 }],
    });
    assert.equal(Number(refund.amount), 50000);
    await approvalService.decideRefund({
      restaurantId: REST_A,
      adminId: USER_A,
      refundId: refund.id,
      approve: true,
    });
    await prisma.refund.update({
      where: { id: refund.id },
      data: { approvedAt: at(2026, 10, 13, 12) },
    });
    await mkExpenseViaService("s14", { amount: 5000, spentAt: D.oct13 });

    // Write-side: the full refund flips the mirrors and still freezes the COGS.
    const refundItem = await prisma.refundItem.findFirstOrThrow({ where: { refundId: refund.id } });
    assert.equal(Number(refundItem.reversedCogs), 30000);
    const payment = await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentIds[0] } });
    const orderRow = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    assert.equal(payment.status, "REFUNDED");
    assert.equal(orderRow.paymentStatus, "UNPAID");

    const report = await pnl(D.oct13);
    assert.equal(report.summary.grossSales, 50000);
    assert.equal(report.summary.totalRefund, 50000);
    assert.equal(report.summary.netSales, 0, "a full refund nets to exactly zero");
    assert.equal(report.summary.historicalCogs, 30000);
    assert.equal(report.summary.cogsReversal, 0, "a full refund releases NO cost");
    assert.equal(report.summary.cogs, 30000);
    assert.equal(report.summary.grossProfit, -30000, "no revenue, all the cost retained");
    assert.equal(report.summary.operatingExpenses, 5000);
    assert.equal(report.summary.netProfit, -35000);
    assert.equal(report.refundState, "FULL");
    assert.equal(report.coverageComplete, true);
  });

  // ------------------------------------------------------------------
  // 15. Legacy refund without RefundItem
  // ------------------------------------------------------------------
  it("15. a legacy amount-only refund is projected pro-rata and applied once", async () => {
    const productA = await mkProduct("s15a", 25000);
    const productB = await mkProduct("s15b", 50000);
    const order = await mkOrder("s15", {
      grandTotal: 100000,
      createdAt: T.oct15,
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
    const refundId = `${RUN}-s15-ref`;
    await createRefundFixture(prisma, {
      id: refundId,
      restaurantId: REST_A,
      orderId: order.orderId,
      paymentId: order.paymentIds[0],
      branchId: BR_A1,
      amount: 40000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 15, 12),
      createdAt: at(2026, 10, 15, 11),
    });
    await mkExpenseViaService("s15", { amount: 10000, spentAt: D.oct15 });

    // Carried forward from STEP 2B.3: the legacy path writes NO allocation row.
    assert.equal(await prisma.refundItem.count({ where: { refundId } }), 0);

    const report = await pnl(D.oct15);
    assert.equal(report.summary.grossSales, 100000);
    assert.equal(report.summary.totalRefund, 40000);
    assert.equal(report.summary.netSales, 60000);
    assert.equal(report.summary.historicalCogs, 50000);
    assert.equal(
      report.summary.cogsReversal,
      20000,
      "pro-rata 50000 × 40000/100000, applied EXACTLY ONCE (never 40000)"
    );
    assert.notEqual(report.summary.cogsReversal, 40000, "the reversal is not double-counted");
    assert.equal(report.summary.cogs, 30000);
    assert.equal(report.summary.grossProfit, 30000);
    assert.equal(report.summary.operatingExpenses, 10000);
    assert.equal(report.summary.netProfit, 20000);
    assert.equal(report.refundState, "PARTIAL");

    // Cross-module consistency: P&L inherits the canonical Profitabilitas numbers.
    const profitability = await profitabilityService.getProfitabilityReport(REST_A, "custom", {
      startDate: D.oct15,
      endDate: D.oct15,
    });
    assert.equal(report.summary.cogsReversal, profitability.summary.cogsReversal);
    assert.equal(report.summary.cogs, profitability.summary.retainedCogs);
    assert.equal(report.summary.netSales, profitability.summary.netSales);
    assert.equal(report.summary.grossProfit, profitability.summary.grossProfit);
  });

  // ------------------------------------------------------------------
  // 16. Refund-only reporting period + date attribution
  // ------------------------------------------------------------------
  it("16. a refund-only period carries no revenue and no verifiable profit", async () => {
    const product = await mkProduct("s16", 120000);
    const order = await mkOrder("s16", {
      grandTotal: 120000,
      createdAt: T.sep26,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 120000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 72000, hppTotal: 72000 },
        },
      ],
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-s16-ref`,
      restaurantId: REST_A,
      orderId: order.orderId,
      paymentId: order.paymentIds[0],
      branchId: BR_A1,
      amount: 40000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 16, 12),
      createdAt: at(2026, 10, 16, 11),
    });
    await mkExpenseViaService("s16", { amount: 5000, spentAt: D.oct16 });

    // The refund lands in its APPROVAL period, not the order's period.
    const refundOnly = await pnl(D.oct16);
    assert.equal(refundOnly.summary.grossSales, 0);
    assert.equal(refundOnly.summary.totalRefund, 40000);
    assert.equal(refundOnly.summary.netSales, -40000, "a refund-only period is legitimately negative");
    assert.equal(refundOnly.summary.historicalCogs, 0);
    assert.equal(refundOnly.summary.cogsReversal, 24000, "72000 × 40000/120000");
    assert.equal(refundOnly.summary.cogs, -24000);
    assert.equal(refundOnly.coverageComplete, false);
    assert.equal(refundOnly.cogsState, "NO_ITEMS");
    assert.equal(refundOnly.summary.grossProfit, null, "no in-scope item → the cost is unverifiable");
    assert.equal(refundOnly.summary.operatingExpenses, 5000);
    assert.equal(refundOnly.summary.netProfit, null);
    assert.equal(refundOnly.refundState, "PARTIAL");

    // The order's own period is untouched by the later refund.
    const orderPeriod = await pnl(D.sep26);
    assert.equal(orderPeriod.summary.grossSales, 120000);
    assert.equal(orderPeriod.summary.totalRefund, 0);
    assert.equal(orderPeriod.summary.netSales, 120000);
    assert.equal(orderPeriod.summary.cogs, 72000);
    assert.equal(orderPeriod.summary.grossProfit, 48000);
    assert.equal(orderPeriod.summary.netProfit, 48000);

    // Cross-period invariant: cost released + cost retained = incurred cost.
    assert.equal(
      orderPeriod.summary.cogs + refundOnly.summary.cogs,
      72000 - 24000,
      "the two periods partition the historical COGS"
    );
  });

  // ------------------------------------------------------------------
  // 17. Expense recognition date basis
  // ------------------------------------------------------------------
  it("17. expenses are recognised by spentAt only", async () => {
    const product = await mkProduct("s17", 60000);
    await mkOrder("s17", {
      grandTotal: 60000,
      createdAt: T.oct17,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 60000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 36000, hppTotal: 36000 },
        },
      ],
    });

    // (a) spentAt = the report day, created through the real service (createdAt = now).
    await mkExpenseViaService("s17-today", { amount: 30000, spentAt: D.oct17 });
    // (b) spentAt = a September day → belongs to September even though it was
    //     entered today.
    await mkExpenseViaService("s17-sep", { amount: 12000, spentAt: D.sep28 });
    // (c) a back-dated ROW (createdAt = Sep 1) whose spentAt is the report day.
    await createExpenseFixture(prisma, {
      id: `${RUN}-s17-exp-backdated`,
      restaurantId: REST_A,
      branchId: BR_A1,
      categoryId: EXP_CAT_2,
      amount: 7000,
      spentAt: at(2026, 10, 17, 14),
      createdByUserId: USER_A,
      note: `${RUN} s17 back-dated row`,
      createdAt: T.sep1,
    });

    const oct17 = await pnl(D.oct17);
    assert.equal(oct17.summary.operatingExpenses, 37000, "30000 (service) + 7000 (back-dated row)");
    assert.equal(oct17.opex.count, 2);
    assert.equal(oct17.summary.grossSales, 60000);
    assert.equal(oct17.summary.cogs, 36000);
    assert.equal(oct17.summary.grossProfit, 24000);
    assert.equal(oct17.summary.netProfit, -13000, "24000 − 37000");

    // September sees only the September-dated expense…
    const sep28 = await pnl(D.sep28);
    assert.equal(sep28.summary.operatingExpenses, 12000);
    assert.equal(sep28.opex.count, 1);
    assert.equal(sep28.summary.grossSales, 0);
    assert.equal(sep28.cogsState, "NO_ITEMS");
    assert.equal(sep28.summary.netProfit, null);

    // …and the row's createdAt day sees nothing from it.
    const sep1 = await pnl(D.sep1);
    assert.equal(sep1.summary.operatingExpenses, 0);
    assert.equal(sep1.opex.count, 0);
    assert.equal(sep1.disclosure.expenseDataEmpty, true);
  });

  // ------------------------------------------------------------------
  // 18. Expense window boundary ("today" widens to the end of the day)
  // ------------------------------------------------------------------
  it("18. the expense window covers the whole local day of the period", async () => {
    const now = new Date();
    const today = localDateOnly(now);
    const tomorrowDate = new Date(now);
    tomorrowDate.setDate(tomorrowDate.getDate() + 1);
    const tomorrow = localDateOnly(tomorrowDate);

    // Deltas are used for both windows: other suites' fixtures may legitimately
    // land on the same calendar days, so only the CHANGE caused by this test is
    // asserted (exactly, not as a range).
    const before = await getPnlReport(REST_A, { period: "today" });
    const tomorrowBefore = await pnl(tomorrow);

    await createExpenseFixture(prisma, {
      id: `${RUN}-s18-e1`,
      restaurantId: REST_A,
      branchId: BR_A1,
      categoryId: EXP_CAT_1,
      amount: 111.11,
      spentAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 100),
      createdByUserId: USER_A,
      note: `${RUN} s18 start-of-day`,
    });
    await createExpenseFixture(prisma, {
      id: `${RUN}-s18-e2`,
      restaurantId: REST_A,
      branchId: BR_A1,
      categoryId: EXP_CAT_1,
      amount: 222.22,
      spentAt: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 30, 0, 0),
      createdByUserId: USER_A,
      note: `${RUN} s18 later-today`,
    });
    await createExpenseFixture(prisma, {
      id: `${RUN}-s18-e3`,
      restaurantId: REST_A,
      branchId: BR_A1,
      categoryId: EXP_CAT_1,
      amount: 333.33,
      spentAt: new Date(
        tomorrowDate.getFullYear(),
        tomorrowDate.getMonth(),
        tomorrowDate.getDate(),
        0,
        0,
        0,
        100
      ),
      createdByUserId: USER_A,
      note: `${RUN} s18 tomorrow`,
    });
    // A COVERED order so the period is a normal one (its value is not asserted here).
    const product = await mkProduct("s18", 40000);
    await mkOrder("s18", {
      grandTotal: 40000,
      createdAt: now,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 40000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 24000, hppTotal: 24000 },
        },
      ],
    });

    const after = await getPnlReport(REST_A, { period: "today" });
    assert.equal(r2(after.summary.operatingExpenses - before.summary.operatingExpenses), 333.33);
    assert.equal(after.opex.count - before.opex.count, 2, "today 00:00 and today 23:30 are both in");

    // The revenue window of `today` ends at "now", while the expense window is the
    // FULL calendar day (audited asymmetry — asserted, not "fixed").
    assert.ok(new Date(after.range.end).getTime() <= Date.now());
    assert.ok(
      new Date(after.range.end).getHours() < 23 || new Date(after.range.end).getMinutes() < 59,
      "the returned range end is the moment of the request, not end-of-day"
    );

    // Tomorrow's expense is excluded today and included in tomorrow's window.
    const tomorrowReport = await pnl(tomorrow);
    assert.equal(
      r2(tomorrowReport.summary.operatingExpenses - tomorrowBefore.summary.operatingExpenses),
      333.33
    );
    assert.equal(tomorrowReport.opex.count - tomorrowBefore.opex.count, 1);
  });

  // ------------------------------------------------------------------
  // 19. Gross profit / net profit / margins with deterministic amounts
  // ------------------------------------------------------------------
  it("19. multi-order P&L with categorised expenses stays exact", async () => {
    const productA = await mkProduct("s19a", 150000);
    const productB = await mkProduct("s19b", 80000);
    const productC = await mkProduct("s19c", 70000);
    await mkOrder("s19a", {
      grandTotal: 150000,
      createdAt: T.oct18,
      items: [
        {
          productId: productA,
          quantity: 1,
          unitPrice: 150000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 90000, hppTotal: 90000 },
        },
      ],
    });
    await mkOrder("s19b", {
      grandTotal: 80000,
      createdAt: T.oct18,
      items: [
        {
          productId: productB,
          quantity: 1,
          unitPrice: 80000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 40000, hppTotal: 40000 },
        },
      ],
    });
    await mkOrder("s19c", {
      grandTotal: 70000,
      createdAt: T.oct18,
      items: [
        {
          productId: productC,
          quantity: 1,
          unitPrice: 70000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 30000, hppTotal: 30000 },
        },
      ],
    });
    await mkExpenseViaService("s19-1", { amount: 20000, spentAt: D.oct18, categoryId: EXP_CAT_1 });
    await mkExpenseViaService("s19-2", { amount: 15000, spentAt: D.oct18, categoryId: EXP_CAT_1 });
    await mkExpenseViaService("s19-3", { amount: 5000, spentAt: D.oct18, categoryId: EXP_CAT_2 });

    const report = await pnl(D.oct18);

    assert.equal(report.summary.grossSales, 300000);
    assert.equal(report.summary.netSales, 300000);
    assert.equal(report.summary.historicalCogs, 160000);
    assert.equal(report.summary.cogsReversal, 0);
    assert.equal(report.summary.cogs, 160000);
    assert.equal(report.summary.grossProfit, 140000);
    assert.equal(report.summary.operatingExpenses, 40000);
    assert.equal(report.summary.netProfit, 100000);
    assert.deepEqual(report.opex.byCategory, [
      { categoryId: EXP_CAT_1, categoryName: EXP_CAT_1_NAME, total: 35000, count: 2 },
      { categoryId: EXP_CAT_2, categoryName: EXP_CAT_2_NAME, total: 5000, count: 1 },
    ]);
    assert.equal(report.coverageComplete, true);
    assert.deepEqual(report.coverage, {
      totalOrderItems: 3,
      costedOrderItems: 3,
      uncostedOrderItems: 0,
      legacyOrderItems: 0,
      pendingOrderItems: 0,
    });

    // Deterministic margins (derived arithmetic; no margin field in the contract).
    assert.equal(r2((140000 / 300000) * 100), 46.67);
    assert.equal(r2((100000 / 300000) * 100), 33.33);
    for (const v of [
      report.summary.grossSales,
      report.summary.netSales,
      report.summary.cogs,
      report.summary.grossProfit,
      report.summary.operatingExpenses,
      report.summary.netProfit,
    ]) {
      assertMoney(v, "s19 money");
    }
  });

  // ------------------------------------------------------------------
  // 20. Rounding / decimal precision
  // ------------------------------------------------------------------
  it("20. fractional amounts round deterministically at 2 decimals", async () => {
    // (a) item-based: a 100000.00 line of 3 units → unit share is non-terminating.
    const product = await mkProduct("s20a", 33333.33);
    const order = await mkOrder("s20a", {
      grandTotal: 100000,
      createdAt: T.oct19,
      items: [
        {
          productId: product,
          quantity: 3,
          unitPrice: 33333.33,
          totalPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 12000.11, hppTotal: 36000.33 },
        },
      ],
    });
    const refund = await approvalService.requestRefund({
      restaurantId: REST_A,
      userId: USER_A,
      orderId: order.orderId,
      amount: 1,
      reason: `${RUN} s20 rounding refund`,
      items: [{ orderItemId: order.itemIds[0], quantity: 1 }],
    });
    assert.equal(Number(refund.amount), 33333.33, "round2(100000/3 × 1)");
    await approvalService.decideRefund({
      restaurantId: REST_A,
      adminId: USER_A,
      refundId: refund.id,
      approve: true,
    });
    await prisma.refund.update({
      where: { id: refund.id },
      data: { approvedAt: at(2026, 10, 19, 12) },
    });
    const refundItem = await prisma.refundItem.findFirstOrThrow({ where: { refundId: refund.id } });
    assert.equal(Number(refundItem.reversedCogs), 12000.11, "round2(12000.11 × 1)");

    await createExpenseFixture(prisma, {
      id: `${RUN}-s20-cents-1`,
      restaurantId: REST_A,
      branchId: BR_A1,
      categoryId: EXP_CAT_1,
      amount: 0.01,
      spentAt: at(2026, 10, 19, 9),
      createdByUserId: USER_A,
      note: `${RUN} s20 cent 1`,
    });
    await createExpenseFixture(prisma, {
      id: `${RUN}-s20-cents-2`,
      restaurantId: REST_A,
      branchId: BR_A1,
      categoryId: EXP_CAT_1,
      amount: 0.02,
      spentAt: at(2026, 10, 19, 9, 5),
      createdByUserId: USER_A,
      note: `${RUN} s20 cent 2`,
    });
    await mkExpenseViaService("s20", { amount: 8888.88, spentAt: D.oct19 });

    const oct19 = await pnl(D.oct19);
    assert.equal(oct19.summary.grossSales, 100000);
    assert.equal(oct19.summary.totalRefund, 33333.33);
    assert.equal(oct19.summary.netSales, 66666.67);
    assert.equal(oct19.summary.historicalCogs, 36000.33);
    assert.equal(oct19.summary.cogsReversal, 12000.11);
    assert.equal(oct19.summary.cogs, 24000.22, "36000.33 − 12000.11");
    assert.equal(oct19.summary.grossProfit, 42666.45, "66666.67 − 24000.22");
    assert.equal(oct19.summary.operatingExpenses, 8888.91, "8888.88 + 0.02 + 0.01");
    assert.equal(oct19.summary.netProfit, 33777.54, "42666.45 − 8888.91");
    assert.equal(oct19.opex.count, 3);
    assert.equal(
      oct19.summary.netProfit,
      r2((oct19.summary.grossProfit ?? 0) - oct19.summary.operatingExpenses)
    );

    // (b) legacy pro-rata on a repeating fraction (1/3).
    const productL = await mkProduct("s20l", 10000);
    const legacyOrder = await mkOrder("s20l", {
      grandTotal: 30000,
      createdAt: T.oct20,
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
      id: `${RUN}-s20l-ref`,
      restaurantId: REST_A,
      orderId: legacyOrder.orderId,
      paymentId: legacyOrder.paymentIds[0],
      branchId: BR_A1,
      amount: 10000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 20, 12),
      createdAt: at(2026, 10, 20, 11),
    });
    await mkExpenseViaService("s20l", { amount: 3333.33, spentAt: D.oct20 });

    const oct20 = await pnl(D.oct20);
    assert.equal(oct20.summary.totalRefund, 10000);
    assert.equal(oct20.summary.netSales, 20000);
    assert.equal(oct20.summary.historicalCogs, 10000);
    assert.equal(oct20.summary.cogsReversal, 3333.33, "round2(10000 × 1/3)");
    assert.equal(oct20.summary.cogs, 6666.67);
    assert.equal(oct20.summary.grossProfit, 13333.33);
    assert.equal(oct20.summary.operatingExpenses, 3333.33);
    assert.equal(oct20.summary.netProfit, 10000, "exactly 13333.33 − 3333.33");
    for (const v of [
      oct19.summary.netSales,
      oct19.summary.cogs,
      oct19.summary.grossProfit,
      oct19.summary.netProfit,
      oct20.summary.cogsReversal,
      oct20.summary.netProfit,
    ]) {
      assertMoney(v, "s20 money");
    }
  });

  // ------------------------------------------------------------------
  // 21. Tenant isolation
  // ------------------------------------------------------------------
  it("21. P&L never crosses tenants", async () => {
    const productB = await mkProduct("b-s21", 200000, REST_B);
    await mkOrder("b-s21", {
      grandTotal: 200000,
      createdAt: T.oct21,
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
    await mkExpenseViaService("b-s21", {
      amount: 50000,
      spentAt: D.oct21,
      restaurantId: REST_B,
      userId: USER_B,
      branchId: BR_B1,
      categoryId: EXP_CAT_B,
    });

    const tenantB = await pnlFor(REST_B, {
      period: "custom",
      startDate: D.oct21,
      endDate: D.oct21,
    });
    assert.equal(tenantB.summary.grossSales, 200000);
    assert.equal(tenantB.summary.netSales, 200000);
    assert.equal(tenantB.summary.cogs, 120000);
    assert.equal(tenantB.summary.grossProfit, 80000);
    assert.equal(tenantB.summary.operatingExpenses, 50000);
    assert.equal(tenantB.summary.netProfit, 30000);
    assert.equal(tenantB.opex.count, 1);

    const tenantA = await pnl(D.oct21);
    assert.equal(tenantA.summary.grossSales, 0);
    assert.equal(tenantA.summary.netSales, 0);
    assert.equal(tenantA.summary.cogs, 0);
    assert.equal(tenantA.coverageComplete, false);
    assert.equal(tenantA.cogsState, "NO_ITEMS");
    assert.equal(tenantA.summary.grossProfit, null);
    assert.equal(tenantA.summary.operatingExpenses, 0, "another tenant's expense is invisible");
    assert.equal(tenantA.opex.count, 0);
    assert.equal(tenantA.summary.netProfit, null);

    // A branch scope belonging to another tenant narrows A to nothing, not to B.
    const scoped = await pnl(D.oct21, D.oct21, [BR_B1]);
    assert.equal(scoped.summary.grossSales, 0);
    assert.equal(scoped.summary.operatingExpenses, 0);
  });

  // ------------------------------------------------------------------
  // 22. Branch isolation and authorization
  // ------------------------------------------------------------------
  it("22. branch scoping covers revenue, COGS and expenses (hint never scopes)", async () => {
    const product1 = await mkProduct("s22a", 100000);
    const product2 = await mkProduct("s22b", 50000);
    await mkOrder("s22a", {
      grandTotal: 100000,
      createdAt: T.oct22,
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
    await mkOrder("s22b", {
      grandTotal: 50000,
      createdAt: T.oct22,
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
    await mkExpenseViaService("s22a", { amount: 10000, spentAt: D.oct22, branchId: BR_A1 });
    await mkExpenseViaService("s22b", { amount: 20000, spentAt: D.oct22, branchId: BR_A2 });

    const all = await pnl(D.oct22);
    assert.equal(all.summary.grossSales, 150000);
    assert.equal(all.summary.cogs, 90000);
    assert.equal(all.summary.grossProfit, 60000);
    assert.equal(all.summary.operatingExpenses, 30000);
    assert.equal(all.summary.netProfit, 30000);

    const onlyA1 = await pnl(D.oct22, D.oct22, [BR_A1]);
    assert.equal(onlyA1.summary.grossSales, 100000);
    assert.equal(onlyA1.summary.cogs, 60000);
    assert.equal(onlyA1.summary.grossProfit, 40000);
    assert.equal(onlyA1.summary.operatingExpenses, 10000, "expenses follow the same branch scope");
    assert.equal(onlyA1.opex.count, 1);
    assert.equal(onlyA1.summary.netProfit, 30000);

    const onlyA2 = await pnl(D.oct22, D.oct22, [BR_A2]);
    assert.equal(onlyA2.summary.grossSales, 50000);
    assert.equal(onlyA2.summary.cogs, 30000);
    assert.equal(onlyA2.summary.grossProfit, 20000);
    assert.equal(onlyA2.summary.operatingExpenses, 20000);
    assert.equal(onlyA2.summary.netProfit, 0, "20000 − 20000 is a real zero, not unknown");

    // `branchId` is only a HINT: it is echoed but never scopes (scoping is the
    // `branchFilters` argument, server-resolved from authorizedBranches).
    const hinted = await getPnlReport(REST_A, {
      period: "custom",
      startDate: D.oct22,
      endDate: D.oct22,
      branchId: BR_A1,
    });
    assert.equal(hinted.filters.branchId, BR_A1);
    assert.equal(hinted.summary.grossSales, 150000, "the hint does not narrow the query");
    assert.equal(hinted.summary.operatingExpenses, 30000);

    // A branch outside the tenant yields nothing at all.
    const foreign = await pnl(D.oct22, D.oct22, [BR_B1]);
    assert.equal(foreign.summary.grossSales, 0);
    assert.equal(foreign.summary.operatingExpenses, 0);
    assert.equal(foreign.opex.count, 0);
  });

  // ------------------------------------------------------------------
  // 23. Cross-period order / payment / refund / expense
  // ------------------------------------------------------------------
  it("23. each basis lands in its own period (order, payment, refund, expense)", async () => {
    const product = await mkProduct("s23", 120000);
    const order = await mkOrder("s23", {
      grandTotal: 120000,
      createdAt: T.sep25,
      items: [
        {
          productId: product,
          quantity: 1,
          unitPrice: 120000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 72000, hppTotal: 72000 },
        },
      ],
      // Collected in October, ordered in September.
      payments: [
        {
          amount: 120000,
          method: "KASIR",
          status: "PAID",
          paidAt: at(2026, 10, 23, 10),
          createdAt: T.oct23,
        },
      ],
    });
    await createRefundFixture(prisma, {
      id: `${RUN}-s23-ref`,
      restaurantId: REST_A,
      orderId: order.orderId,
      paymentId: order.paymentIds[0],
      branchId: BR_A1,
      amount: 40000,
      requestedByCashierId: USER_A,
      status: "APPROVED",
      approvedAt: at(2026, 10, 23, 12),
      createdAt: at(2026, 10, 23, 11),
    });
    await mkExpenseViaService("s23", { amount: 15000, spentAt: D.sep27 });

    // September = the ORDER's period: full revenue, full COGS, no refund impact.
    const september = await pnl(D.sep25);
    assert.equal(september.summary.grossSales, 120000);
    assert.equal(september.summary.totalRefund, 0, "the later refund is not pulled back in");
    assert.equal(september.summary.netSales, 120000);
    assert.equal(september.summary.cogs, 72000);
    assert.equal(september.summary.grossProfit, 48000);
    assert.equal(september.summary.operatingExpenses, 0);
    assert.equal(september.summary.netProfit, 48000);

    // The expense-only September day: a real expense, an unverifiable profit.
    const expenseDay = await pnl(D.sep27);
    assert.equal(expenseDay.summary.grossSales, 0);
    assert.equal(expenseDay.summary.operatingExpenses, 15000);
    assert.equal(expenseDay.opex.count, 1);
    assert.equal(expenseDay.cogsState, "NO_ITEMS");
    assert.equal(expenseDay.summary.grossProfit, null);
    assert.equal(expenseDay.summary.netProfit, null);

    // October = the COLLECTION + REFUND period: no revenue (the order is older),
    // refund impact only, and an unknown profit.
    const october = await pnl(D.oct23);
    assert.equal(october.summary.grossSales, 0, "revenue follows the ORDER date, not paidAt");
    assert.equal(october.summary.totalRefund, 40000);
    assert.equal(october.summary.netSales, -40000);
    assert.equal(october.summary.historicalCogs, 0);
    assert.equal(october.summary.cogsReversal, 24000, "72000 × 40000/120000");
    assert.equal(october.summary.cogs, -24000);
    assert.equal(october.cogsState, "NO_ITEMS");
    assert.equal(october.summary.grossProfit, null);
    assert.equal(october.summary.netProfit, null);

    // Cross-module evidence (NOT equality): the Cashbook sees the cash movements
    // on their own dates, so the same window differs from the P&L by design.
    const cashbook = await getCashbook(
      REST_A,
      { page: 1, limit: 100, dateFrom: D.oct23, dateTo: D.oct23 },
      null
    );
    assert.equal(cashbook.summary.totalIn, 120000, "Cashbook: money in on paidAt (Oct 23)");
    assert.equal(cashbook.summary.totalOut, 40000, "Cashbook: refund out on approvedAt (Oct 23)");
    assert.equal(
      cashbook.items.some((i) => i.id === `payment:${order.paymentIds[0]}`),
      true
    );
    assert.equal(october.summary.grossSales, 0, "P&L: no revenue in Oct — the bases differ");
  });

  // ------------------------------------------------------------------
  // 24. Query contract, filters and composition consistency
  // ------------------------------------------------------------------
  it("24. the query contract, filters and the canonical composition hold", async () => {
    const productA = await mkProduct("s24a", 100000);
    const productB = await mkProduct("s24b", 70000);
    await mkOrder("s24-dine", {
      grandTotal: 100000,
      createdAt: T.oct24,
      orderType: "DINE_IN",
      items: [
        {
          productId: productA,
          quantity: 1,
          unitPrice: 100000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 60000, hppTotal: 60000 },
        },
      ],
      payments: [{ amount: 100000, method: "KASIR", status: "PAID", paidAt: T.oct24 }],
    });
    await mkOrder("s24-take", {
      grandTotal: 70000,
      createdAt: T.oct24,
      orderType: "TAKEAWAY",
      items: [
        {
          productId: productB,
          quantity: 1,
          unitPrice: 70000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 30000, hppTotal: 30000 },
        },
      ],
      payments: [{ amount: 70000, method: "QRIS", status: "PAID", paidAt: T.oct24 }],
    });
    await mkOrder("s24-qris-dine", {
      grandTotal: 50000,
      createdAt: T.oct24,
      orderType: "DINE_IN",
      items: [
        {
          productId: productA,
          quantity: 1,
          unitPrice: 50000,
          snapshot: { status: "SNAPSHOTTED", hppUnit: 20000, hppTotal: 20000 },
        },
      ],
      payments: [{ amount: 50000, method: "QRIS", status: "PAID", paidAt: T.oct24 }],
    });

    const unfiltered = await pnl(D.oct24);
    assert.equal(unfiltered.summary.grossSales, 220000);
    assert.equal(unfiltered.summary.cogs, 110000);

    const dineIn = await pnlFor(REST_A, {
      period: "custom",
      startDate: D.oct24,
      endDate: D.oct24,
      orderType: "DINE_IN",
    });
    assert.equal(dineIn.summary.grossSales, 150000);
    assert.equal(dineIn.filters.orderType, "DINE_IN");

    const qris = await pnlFor(REST_A, {
      period: "custom",
      startDate: D.oct24,
      endDate: D.oct24,
      paymentMethod: "QRIS",
    });
    assert.equal(qris.summary.grossSales, 120000, "QRIS-collected orders only");
    assert.equal(qris.filters.paymentMethod, "QRIS");

    const both = await pnlFor(REST_A, {
      period: "custom",
      startDate: D.oct24,
      endDate: D.oct24,
      orderType: "DINE_IN",
      paymentMethod: "QRIS",
    });
    assert.equal(both.summary.grossSales, 50000);

    // Validation (Zod contract) — invalid input never reaches a query.
    for (const bad of [
      { period: "bogus" },
      { period: "custom" },
      { period: "custom", startDate: D.oct24, endDate: D.oct23 },
      { period: "custom", startDate: "2026-10-32", endDate: "2026-10-32" },
      { period: "custom", startDate: "24/10/2026", endDate: "2026-10-24" },
    ]) {
      await assert.rejects(
        () => getPnlReport(REST_A, bad),
        (err: unknown) => err instanceof ValidationError,
        `expected ValidationError for ${JSON.stringify(bad)}`
      );
    }
    await assert.rejects(
      () => getPnlReport(REST_A, "not-an-object"),
      (err: unknown) => err instanceof ValidationError
    );

    // Unknown/extra keys are ignored — and a client-supplied restaurantId can
    // never re-target the tenant (it always comes from the session argument).
    const injected = await getPnlReport(REST_A, {
      period: "custom",
      startDate: D.oct24,
      endDate: D.oct24,
      restaurantId: REST_B,
      foo: "bar",
    });
    assert.equal(injected.summary.grossSales, 220000, "still tenant A");

    // Composition: the P&L summary is EXACTLY the canonical Profitabilitas
    // summary for the same window, even though the P&L call trims products to 1.
    const profitability = await profitabilityService.getProfitabilityReport(REST_A, "custom", {
      startDate: D.oct24,
      endDate: D.oct24,
      branchFilters: null,
      filters: {
        branchId: null,
        productId: null,
        categoryId: null,
        orderType: null,
        paymentMethod: null,
      },
      pagination: { page: 1, limit: 1 },
    });
    assert.equal(profitability.products.length, 1, "the product table is trimmed");
    assert.equal(profitability.pagination.total, 2, "…while all products are aggregated");

    assert.equal(unfiltered.summary.grossSales, profitability.summary.totalSales);
    assert.equal(unfiltered.summary.totalDiscount, profitability.summary.totalDiscount);
    assert.equal(unfiltered.summary.totalTax, profitability.summary.totalTax);
    assert.equal(unfiltered.summary.totalServiceCharge, profitability.summary.totalServiceCharge);
    assert.equal(unfiltered.summary.totalRefund, profitability.summary.refundReversal);
    assert.equal(unfiltered.summary.netSales, profitability.summary.netSales);
    assert.equal(unfiltered.summary.historicalCogs, profitability.summary.historicalCogs);
    assert.equal(unfiltered.summary.cogsReversal, profitability.summary.cogsReversal);
    assert.equal(unfiltered.summary.cogs, profitability.summary.retainedCogs);
    assert.equal(unfiltered.summary.grossProfit, profitability.summary.grossProfit);
    assert.deepEqual(unfiltered.coverage, profitability.summary.coverage);
    assert.equal(unfiltered.coverageComplete, profitability.summary.coverageComplete);
    assert.equal(unfiltered.cogsState, profitability.summary.cogsState);
    assert.equal(unfiltered.refundState, profitability.summary.refundState);
    assert.deepEqual(unfiltered.unpaidCompleted, profitability.summary.unpaidCompleted);
    assert.deepEqual(
      unfiltered.disclosure.revenueWithoutItems,
      profitability.summary.revenueWithoutItems
    );

    assert.equal(unfiltered.disclosure.netProfitProvisional, true);
    assert.equal(unfiltered.disclosure.purchaseExcluded, true);
    assert.equal(unfiltered.disclosure.expenseDataEmpty, true);
  });
});
