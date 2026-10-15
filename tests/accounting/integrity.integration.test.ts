/**
 * STEP 2B.5 — M2 INTEGRITY SQL INTEGRATION TESTS (real MariaDB, isolated test DB)
 *
 * Scope (and nothing else): the READ-ONLY M2 integrity read-model
 * (`src/services/accounting/integrity.service.ts` → `getIntegrityReport`) driven
 * against the isolated test database with real Prisma/SQL. The four M2
 * implementation files (`integrity.rules.ts`, `integrity.service.ts`,
 * `integrity.types.ts`, `integrity.unit.test.ts`) are the SOURCE UNDER TEST and
 * are NOT modified by this suite; no production/schema change is made.
 *
 * AUDITED BUSINESS RULES asserted below (see ACCOUNTING-INTEGRATION-TEST-PLAN.md §20.2):
 *   C1  revenue orders without items = non-CANCELLED AND (Order.paymentStatus =
 *       PAID OR a Payment.status = REFUNDED) AND `items: none`, over the
 *       canonical `revenueScopeWhere` predicate; `headerValue` = Σ grandTotal;
 *       any order → CRITICAL.
 *   C2  population = items of COMPLETED orders (scoped through `order`,
 *       LEFT JOIN snapshot ON `orderItemId`) that have NO snapshot row.
 *       Classification (cutoff = the F.5 migration apply time, the ONLY proven
 *       boundary; the code-deploy time is unprovable → `codeDeployUnproven`):
 *         h.done = MIN(orderstatushistory.createdAt) WHERE status = 'COMPLETED'
 *         done <  cutoff                        -> legacyExpected
 *         cutoff <= done <  carveFrom           -> beforeFirstSnapshot (carve only)
 *         done >= carveFrom (or no carve)       -> anomaly
 *         done IS NULL (no/missing history)     -> unknownCompletion
 *       `carveFrom = carveWindow(cutoff, marker)` — the observed tenant-wide
 *       marker (`MIN(snapshot.completedAt)` over rows whose `order` agrees on
 *       `restaurantId`) counts ONLY when it is STRICTLY NEWER than the cutoff;
 *       an EMPTY / UNVERIFIED / at-or-before-cutoff marker leaves the carve off,
 *       so buckets never overlap and the four buckets always partition `items`.
 *   C3  relation reconciliation over the DECLARED scope: BRANCH_SCOPED
 *       invariants (SNAPSHOT_ORDER_MISMATCH, SNAPSHOT_TENANT_MISMATCH,
 *       SNAPSHOTS_EXCEED_ORDER_ITEMS) share the counts' Order/branch scope;
 *       TENANT_WIDE ones (ORPHAN_SNAPSHOT_ITEM, SNAPSHOT_ORDER_MISSING,
 *       DUPLICATE_SNAPSHOT_PER_ITEM) are always evaluated tenant-wide and never
 *       merged into the branch verdict; tenant-wide samples are only emitted to
 *       a whole-tenant caller.
 *   Severity (evidence is NEVER an input): anomaly>0 → CRITICAL;
 *   beforeFirstSnapshot>0 → UNKNOWN (never OK); only unknownCompletion → WARN
 *   when the cutoff is resolved, UNKNOWN when it is not; nothing → OK.
 *
 * ---------------------------------------------------------------------------
 * GENUINE CUTOFF — no fixture ledger row any more (STEP 2C.2F)
 * ---------------------------------------------------------------------------
 * `resolveLegacyCutoff()` reads `_prisma_migrations.finished_at` for
 * `20260911143644_f5_order_item_cost_snapshot`. The isolated test database used
 * to be a `[F-4]` hybrid with NO such row, so this suite installed a mirrored
 * ledger row to obtain a cutoff. Since STEP 2C.2E the approved test target
 * (`restaurant_app_test_v3`, 127.0.0.1:3308) was provisioned by a real
 * `prisma migrate deploy`, so the row exists genuinely: the cutoff is resolved
 * from the ledger itself and the mirrored install/remove maneuver is GONE.
 *
 * `finished_at` is NOT rewritten or mirrored, and it is never compared against
 * a hard-coded literal (see the timezone note below). The unresolved-cutoff
 * fallback (`resolved:false` → every item `unknownCompletion`) is still pinned,
 * but at the pure-rules layer in `integrity.unit.test.ts`, where a `null` cutoff
 * can be produced deterministically; the integration slot now exercises the
 * RESOLVED path against the genuine row. Tests 4–29 keep their expectations and
 * run against that same genuine cutoff — the describe that used to wrap them is
 * retained (so all 29 test slots survive) but no longer fabricates anything.
 *
 * SCHEMA NOTE (`[F-5]`, §21.5): the legacy v1 test database had NO foreign key
 * on `orderitemcostsnapshot`; the application database has five, and so does the
 * approved v3 target (provisioned by a real `prisma migrate deploy` in 2C.2E).
 * The tenancy-wide orphan / order-missing fixtures (test 28) therefore cannot be
 * written through Prisma any more: `createIncoherentSnapshot()` writes those two
 * rows on a dedicated connection with `FOREIGN_KEY_CHECKS` disabled for that one
 * statement, and every assertion stays as it was. See the helper's docblock.
 *
 * Safety: `tests/setup.ts` is imported FIRST — it loads `.env.test`, runs the
 * fail-closed checks and pins `DATABASE_URL` to `TEST_DATABASE_URL` before any
 * service/prisma module is evaluated.
 *
 * Run (from the project root, ONE FILE AT A TIME — every suite asserts
 * whole-table baselines, so the suites must never run concurrently):
 *   npx tsx --test tests/accounting/integrity.integration.test.ts
 */

import { assertLiveTestTarget, EXPECTED_TEST_DB } from "../setup"; // MUST stay first (see header)

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { createConnection } from "mariadb";

import type { OrderItemCostStatus, OrderStatus, PaymentStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";
import { getIntegrityReport } from "@/services/accounting/integrity.service";
import {
  LEGACY_CUTOFF_MIGRATION,
  buildCutoffEvidence,
  buildSnapshotDisclosure,
  buildSnapshotMarker,
  carveWindow,
  classifyCompletionBucket,
  classifyCompletionBucketV2,
  completedWithoutSnapshotStatus,
  completedWithoutSnapshotStatusV3,
  deriveOverallStatus,
  deriveReconciliation,
  evidenceLevelFor,
  markerAllowsCarve,
  parseNaiveUtcDateTime,
  partitionViolations,
  reconciliationStatus,
  revenueWithoutItemsStatus,
  selectLegacyCutoff,
  selectSampleOrderIds,
  violationScope,
  type IntegrityMarkerObservation,
  type LegacyCutoffLedgerRow,
} from "@/services/accounting/integrity.rules";
import { IntegrityQuerySchema } from "@/services/accounting/integrity.types";
import type {
  CompletedItemsWithoutSnapshotCheck,
  IntegrityReport,
} from "@/services/accounting/integrity.types";
import {
  cleanupRun,
  createBranchFixture,
  createCategoryFixture,
  createCustomerFixture,
  createOrderFixture,
  createOrderItemCostSnapshotFixture,
  createOrderItemFixture,
  createOrderStatusHistoryFixture,
  createPaymentFixture,
  createProductFixture,
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

const RUN = createRunId("m2int");
const L = (s: string) => `${RUN}-${s}`;

// ============================================================
// The cutoff is resolved from the GENUINE F.5 ledger row (STEP 2C.2F)
//
// `resolveLegacyCutoff()` reads `_prisma_migrations.finished_at` for the F.5
// migration. The isolated `restaurant_app_test_v3` database HAS that row,
// because it was provisioned by `prisma migrate deploy` (STEP 2C.2E) — so the
// cutoff is genuinely resolved and NO mirrored ledger row is installed any more.
//
// TIMEZONE (M-2): `finished_at` is a naive DATETIME written in the SERVER's
// timezone, and the test container runs UTC while the host application server
// runs UTC+07:00. This suite therefore NEVER compares it with a literal: the
// cutoff is read through the SAME Prisma connection that writes the fixtures,
// so the cutoff and every `completedAt` share exactly one clock. The fixture
// instants below are then derived from that Date by MILLISECOND OFFSETS
// (`at()`), which keeps every boundary equality (`mand-5 === cutoff`,
// `mand-7 === marker`, `marker ± 1ms`) exact regardless of server timezone.
// ============================================================

/** The clock the original fixture offsets were authored against (reference only). */
const REF_CUTOFF = new Date("2026-09-11T16:06:57.831Z");
const REF_BEFORE_CUTOFF = new Date("2026-09-01T00:00:00.000Z"); // strictly < reference cutoff
const REF_BETWEEN = new Date("2026-09-15T00:00:00.000Z"); // reference cutoff < x < reference marker
const REF_MARKER = new Date("2026-09-20T00:00:00.000Z"); // the mandated first-snapshot marker
const REF_AFTER_MARKER = new Date("2026-10-01T00:00:00.000Z"); // strictly > reference marker
const REF_D1 = new Date("2026-09-11T00:00:00.000Z"); // 16h 06m 57.831s before the reference cutoff
const REF_D2 = new Date("2026-09-11T12:00:00.000Z"); //  4h 06m 57.831s before the reference cutoff
const REF_D3 = new Date("2026-09-25T00:00:00.000Z"); // iso-b marker
const REF_D4 = new Date("2026-09-26T00:00:00.000Z"); // x-b marker
const REF_D5 = new Date("2026-09-27T00:00:00.000Z"); // x-c marker

/**
 * Resolved genuine cutoff, assigned exactly once in the file-level `before()`.
 * These are `NaN` until then — every fixture below is built afterwards.
 */
let CUTOFF: Date = new Date(NaN);
let BEFORE_CUTOFF: Date = new Date(NaN); // strictly < cutoff
let BETWEEN: Date = new Date(NaN); // cutoff < x < marker
let MARKER: Date = new Date(NaN); // the first observed snapshot
let AFTER_MARKER: Date = new Date(NaN); // strictly > marker
let D1: Date = new Date(NaN); // 16h 06m 57.831s before the cutoff
let D2: Date = new Date(NaN); //  4h 06m 57.831s before the cutoff
let D3: Date = new Date(NaN); // iso-b marker
let D4: Date = new Date(NaN); // x-b marker
let D5: Date = new Date(NaN); // x-c marker

/** Translate a reference-clock instant into this database's own clock. */
const at = (ref: Date): Date =>
  new Date(CUTOFF.getTime() + (ref.getTime() - REF_CUTOFF.getTime()));
const ORDER_CREATED = new Date("2026-09-05T10:00:00.000Z");
const PAID_AT = new Date("2026-09-05T10:05:00.000Z");

const BK = ["legacy", "before", "anomaly", "unknown"] as const;
type BucketKey = (typeof BK)[number];

// ============================================================
// Fixture helpers (thin wrappers over the shared additive fixtures)
// ============================================================

interface Tenant {
  rest: string;
  b1: string;
  /** Second branch id; empty string for single-branch tenants. */
  b2: string;
  user: string;
  cust: string;
  cat: string;
  prod: string;
}

async function mkTenant(label: string, branches: 1 | 2 = 1): Promise<Tenant> {
  const rest = L(`rest-${label}`);
  const b1 = L(`br-${label}-1`);
  const b2 = branches === 2 ? L(`br-${label}-2`) : "";
  const user = L(`user-${label}`);
  const cust = L(`cust-${label}`);
  const cat = L(`cat-${label}`);
  const prod = L(`prod-${label}`);

  await createRestaurantFixture(prisma, { id: rest, name: `${RUN} ${label}` });
  const branchIds = branches === 2 ? [b1, b2] : [b1];
  for (const [idx, id] of branchIds.entries()) {
    await createBranchFixture(prisma, {
      id,
      restaurantId: rest,
      code: `B${idx + 1}`,
      name: `${label} Branch ${idx + 1}`,
    });
  }
  await createUserFixture(prisma, {
    id: user,
    restaurantId: rest,
    email: `${rest}@test.local`,
    name: `Admin ${label}`,
  });
  await createCustomerFixture(prisma, { id: cust, restaurantId: rest, phone: `${rest}-phone` });
  await createCategoryFixture(prisma, { id: cat, restaurantId: rest, name: `${label} Category` });
  await createProductFixture(prisma, {
    id: prod,
    restaurantId: rest,
    categoryId: cat,
    name: `${label} Product`,
    price: 10000,
  });

  return { rest, b1, b2, user, cust, cat, prod };
}

interface OrderOpts {
  branch?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  grandTotal?: number;
  /** 0 = a "revenue order without items" (C1) fixture. Defaults to 1. */
  itemCount?: number;
  /** "none" (default) = no history at all; "completed" = use `done`. */
  history?: "none" | "completed" | "non-completed";
  /** One or more COMPLETED history rows (the FIRST is `MIN(createdAt)`). */
  done?: Date | Date[];
  createdAt?: Date;
  /** Adds a REFUNDED Payment row (puts the order in the C1 revenue set). */
  refundedPayment?: boolean;
}

async function mkOrder(t: Tenant, label: string, opts: OrderOpts = {}) {
  const orderId = oid(t, label);
  await createOrderFixture(prisma, {
    id: orderId,
    restaurantId: t.rest,
    branchId: opts.branch ?? t.b1,
    orderNumber: L(label),
    customerId: t.cust,
    grandTotal: opts.grandTotal ?? 10000,
    createdAt: opts.createdAt ?? ORDER_CREATED,
    status: opts.status ?? "COMPLETED",
    paymentStatus: opts.paymentStatus ?? "PAID",
  });

  const itemIds: string[] = [];
  const itemCount = opts.itemCount ?? 1;
  for (let i = 1; i <= itemCount; i += 1) {
    const itemId = `${orderId}-i${i}`;
    itemIds.push(itemId);
    await createOrderItemFixture(prisma, {
      id: itemId,
      orderId,
      productId: t.prod,
      quantity: 1,
      unitPrice: 10000,
      totalPrice: 10000,
    });
  }

  const history = opts.history ?? "none";
  if (history === "completed") {
    const dones = Array.isArray(opts.done) ? opts.done : [opts.done!];
    for (const [idx, done] of dones.entries()) {
      await createOrderStatusHistoryFixture(prisma, {
        id: `${orderId}-h${idx + 1}`,
        orderId,
        status: "COMPLETED",
        createdAt: done,
      });
    }
  } else if (history === "non-completed") {
    for (const [idx, status] of (["READY", "PROCESSING"] as OrderStatus[]).entries()) {
      await createOrderStatusHistoryFixture(prisma, {
        id: `${orderId}-h${idx + 1}`,
        orderId,
        status,
        createdAt: BETWEEN,
      });
    }
  }

  if (opts.refundedPayment) {
    await createPaymentFixture(prisma, {
      id: `${orderId}-pay`,
      restaurantId: t.rest,
      orderId,
      branchId: opts.branch ?? t.b1,
      amount: opts.grandTotal ?? 10000,
      method: "CASH",
      status: "REFUNDED",
      paidAt: PAID_AT,
      createdAt: PAID_AT,
    });
  }

  return { orderId, itemIds };
}

async function mkSnapshot(
  t: Tenant,
  input: {
    id: string;
    orderId: string;
    itemId: string;
    completedAt: Date;
    status?: OrderItemCostStatus;
    branch?: string | null;
    /** Override to plant a CROSS-TENANT snapshot claim (test 27/29). */
    restaurantId?: string;
  }
) {
  await createOrderItemCostSnapshotFixture(prisma, {
    id: input.id,
    restaurantId: input.restaurantId ?? t.rest,
    orderId: input.orderId,
    orderItemId: input.itemId,
    productId: t.prod,
    quantity: 1,
    status: input.status ?? "SNAPSHOTTED",
    branchId: input.branch === undefined ? t.b1 : input.branch,
    hppUnit: 4000,
    hppTotal: 4000,
    completedAt: input.completedAt,
  });
}

/**
 * Write an intentionally INCOHERENT snapshot row: `orderItemId` or `orderId` that
 * does not exist (or both, across two rows).
 *
 * WHY THIS BYPASSES PRISMA (`[F-5]`, §21.5)
 * `orderitemcostsnapshot` carries five foreign keys in the application database,
 * and — since STEP 2C.2E provisioned it with a real `prisma migrate deploy` — in
 * the approved test target `restaurant_app_test_v3` as well. The C3 TENANT_WIDE
 * invariants (ORPHAN_SNAPSHOT_ITEM, SNAPSHOT_ORDER_MISSING) exist to detect rows
 * written BEFORE those constraints existed; with FK parity in place, no normal
 * write path can create them. This fixture therefore uses a DEDICATED,
 * short-lived connection that disables FOREIGN_KEY_CHECKS for that ONE statement.
 * The Prisma pool is never touched, so no pooled session can be left
 * unconstrained (`FOREIGN_KEY_CHECKS` is restored and the connection closed in
 * `finally`). The suite's assertions are unchanged: the service must still find
 * and report both rows.
 *
 * DATETIME columns are written as naive literals taken from the UTC wall clock of
 * the value the other fixtures were given — the same representation the Prisma
 * driver adapter round-trips — so the row reads back with exactly that instant
 * instead of drifting by the host's UTC+07:00 offset.
 */
const naiveUtc = (d: Date) => d.toISOString().slice(0, 23).replace("T", " ");

async function createIncoherentSnapshot(input: {
  id: string;
  restaurantId: string;
  orderId: string;
  orderItemId: string;
  branchId: string | null;
  productId: string;
  completedAt: Date;
}): Promise<void> {
  // DATABASE_URL was pinned to the approved target by `../setup` (first import).
  const url = new URL(process.env.DATABASE_URL!);
  const conn = await createConnection({
    host: url.hostname,
    port: Number(url.port || "3306"),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ""),
  });
  try {
    await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
    await conn.query(
      "INSERT INTO `orderitemcostsnapshot` (`id`, `restaurantId`, `orderId`, `orderItemId`, " +
        "`branchId`, `productId`, `quantity`, `hppUnit`, `hppTotal`, `status`, `completedAt`, " +
        "`createdAt`, `updatedAt`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        input.id,
        input.restaurantId,
        input.orderId,
        input.orderItemId,
        input.branchId,
        input.productId,
        1,
        "4000.00",
        "4000.00",
        "SNAPSHOTTED",
        naiveUtc(input.completedAt),
        naiveUtc(input.completedAt),
        naiveUtc(input.completedAt),
      ]
    );
  } finally {
    await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
    await conn.end();
  }
}

// ============================================================
// Report helpers
// ============================================================

function report(tenant: Tenant, query: Record<string, unknown> = {}, authorized?: string[] | null) {
  return getIntegrityReport(tenant.rest, { sampleLimit: 50, ...query }, authorized);
}

function c2(check: IntegrityReport): CompletedItemsWithoutSnapshotCheck {
  return check.checks.completedItemsWithoutSnapshot;
}

function buckets(check: CompletedItemsWithoutSnapshotCheck): Record<BucketKey, number> {
  return {
    legacy: check.buckets.legacyExpected.items,
    before: check.buckets.beforeFirstSnapshot.items,
    anomaly: check.buckets.anomaly.items,
    unknown: check.buckets.unknownCompletion.items,
  };
}

/** The four buckets must PARTITION `items` — never overlap, never lose a row. */
const RAW_BUCKET_KEY = {
  legacy: "legacyExpected",
  before: "beforeFirstSnapshot",
  anomaly: "anomaly",
  unknown: "unknownCompletion",
} as const;

function assertBucketPartition(check: CompletedItemsWithoutSnapshotCheck, label: string) {
  const b = buckets(check);
  const sum = b.legacy + b.before + b.anomaly + b.unknown;
  assert.equal(sum, check.items, `${label}: the four buckets must partition the item population`);
  for (const key of BK) {
    assert.ok(b[key] >= 0, `${label}: ${key} must not be negative`);
    assert.ok(b[key] <= check.items, `${label}: ${key} cannot exceed the population`);
    assert.equal(check.buckets[RAW_BUCKET_KEY[key]].items, b[key], `${label}: ${key} item count`);
  }
  for (const key of ["legacyExpected", "beforeFirstSnapshot", "anomaly", "unknownCompletion"] as const) {
    assert.ok(
      check.buckets[key].orders <= check.buckets[key].items,
      `${label}: bucket ${key} cannot cover more orders than items`
    );
  }
}

/** The marker observation the SERVICE itself derived (rebuilt from the report). */
function markerFrom(check: CompletedItemsWithoutSnapshotCheck): IntegrityMarkerObservation {
  return buildSnapshotMarker({
    population: check.snapshotPopulation,
    firstObservedSnapshotAt: check.firstObservedSnapshotAt
      ? new Date(check.firstObservedSnapshotAt)
      : null,
  });
}

const sorted = (ids: string[]) => [...ids].sort();

/** Order ids are TENANT-scoped (a label alone is not unique across tenants). */
const oid = (t: Tenant, label: string) => `${t.rest}-ord-${label}`;

// ============================================================
// Cutoff ledger helpers (READ-ONLY — the ledger row is genuine)
// ============================================================

interface LedgerRow {
  id: string;
  migrationName: string;
  finishedAt: Date | null;
  /** `CAST(finished_at AS CHAR)` — the naive literal exactly as stored (M-2). */
  finishedAtLiteral: string | null;
  /** `CAST(rolled_back_at AS CHAR)` — null for a live, successful apply. */
  rolledBackAtLiteral: string | null;
}

async function cutoffLedgerRows(): Promise<LedgerRow[]> {
  const rows = await prisma.$queryRaw<
    Array<{
      id: string;
      migration_name: string;
      finished_at: Date | null;
      finished_at_literal: string | null;
      rolled_back_at_literal: string | null;
    }>
  >`
    SELECT id,
           migration_name,
           finished_at,
           CAST(finished_at AS CHAR) AS finished_at_literal,
           CAST(rolled_back_at AS CHAR) AS rolled_back_at_literal
    FROM _prisma_migrations
    WHERE migration_name = ${LEGACY_CUTOFF_MIGRATION}`;
  return rows.map((r) => ({
    id: r.id,
    migrationName: r.migration_name,
    finishedAt: r.finished_at ? new Date(r.finished_at) : null,
    finishedAtLiteral: r.finished_at_literal,
    rolledBackAtLiteral: r.rolled_back_at_literal,
  }));
}

/** Ledger row → the pure selector's input shape. */
const toLedgerRow = (row: LedgerRow): LegacyCutoffLedgerRow => ({
  id: row.id,
  finishedAtLiteral: row.finishedAtLiteral,
  rolledBackAtLiteral: row.rolledBackAtLiteral,
});

/**
 * 2C.5: the F.5 row's stored metadata, captured in `before()` so `after()` can
 * prove the run never touched it (M-1's determinism precondition + M-2's "the
 * stored literal is never rewritten").
 */
let F5_LEDGER_METADATA:
  | { finishedAtLiteral: string | null; rolledBackAtLiteral: string | null }
  | null = null;

/**
 * Resolve the GENUINE cutoff from the ledger and return it.
 *
 * Read-only: nothing is inserted, updated or deleted. The row is the one
 * `prisma migrate deploy` wrote when the database was provisioned, so its
 * `finished_at` is an APPLY TIME — never a re-created production value.
 */
async function resolveGenuineCutoff(): Promise<Date> {
  const rows = await cutoffLedgerRows();
  assert.equal(
    rows.length,
    1,
    `[M-1] the isolated database must hold exactly ONE row for ${LEGACY_CUTOFF_MIGRATION}: ` +
      "the cutoff must always be selected deterministically from an unambiguous ledger",
  );
  const finishedAt = rows[0]!.finishedAt;
  assert.ok(finishedAt, "the genuine F.5 ledger row must carry a finished_at");
  assert.ok(!Number.isNaN(finishedAt!.getTime()), "finished_at must be a valid timestamp");

  // 2C.5 / M-1: the row must be ELIGIBLE and the pure selector must return
  // exactly that instant — the cutoff is never an arbitrary unordered row.
  const selection = selectLegacyCutoff(rows.map(toLedgerRow));
  assert.equal(selection.rowsRead, 1, "[M-1] one row read");
  assert.equal(selection.eligibleRows, 1, "[M-1] exactly one ELIGIBLE row");
  assert.equal(
    selection.appliedAt?.getTime(),
    finishedAt!.getTime(),
    "[M-1] the selector must return the genuine row's own instant",
  );

  // 2C.5 / M-2: the explicit UTC parse of the naive literal is the same instant
  // Prisma's adapter reports — the cutoff value is unchanged, it is only made
  // driver-independent.
  assert.equal(
    parseNaiveUtcDateTime(rows[0]!.finishedAtLiteral!).getTime(),
    finishedAt!.getTime(),
    "[M-2] explicit UTC parse must equal the adapter read",
  );

  F5_LEDGER_METADATA = {
    finishedAtLiteral: rows[0]!.finishedAtLiteral,
    rolledBackAtLiteral: rows[0]!.rolledBackAtLiteral,
  };
  return finishedAt!;
}

// ============================================================
// Fixtures
// ============================================================

const T: Record<string, Tenant> = {};

let baseline: ScopedCounts;

before(async () => {
  baseline = await snapshotCounts(prisma);

  // --- the GENUINE cutoff, resolved BEFORE any fixture row is written, so that
  //     every fixture instant below is derived from the database's own clock ---
  CUTOFF = await resolveGenuineCutoff();
  BEFORE_CUTOFF = at(REF_BEFORE_CUTOFF);
  BETWEEN = at(REF_BETWEEN);
  MARKER = at(REF_MARKER);
  AFTER_MARKER = at(REF_AFTER_MARKER);
  D1 = at(REF_D1);
  D2 = at(REF_D2);
  D3 = at(REF_D3);
  D4 = at(REF_D4);
  D5 = at(REF_D5);
  console.log(
    `\n[M2 CUTOFF] genuine _prisma_migrations.finished_at → ${CUTOFF.toISOString()} ` +
      `(fixture marker ${MARKER.toISOString()}, ${(MARKER.getTime() - CUTOFF.getTime()) / 86400000} days after it)`,
  );

  // --- empty tenant (nothing to classify) ---
  T.empty = await mkTenant("empty");

  // --- the mandated eight-row numerical fixture + one marker snapshot ---
  T.fix = await mkTenant("fix");
  const FIX_COMPLETIONS: Array<[string, Date | null]> = [
    ["1", null],
    ["2", BEFORE_CUTOFF],
    ["3", D1],
    ["4", D2],
    ["5", CUTOFF],
    ["6", BETWEEN],
    ["7", MARKER],
    ["8", AFTER_MARKER],
  ];
  for (const [n, done] of FIX_COMPLETIONS) {
    await mkOrder(T.fix, `mand-${n}`, done ? { history: "completed", done } : { history: "none" });
  }
  const fixCov = await mkOrder(T.fix, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.fix, {
    id: L("snap-fix-cov"),
    orderId: fixCov.orderId,
    itemId: fixCov.itemIds[0],
    completedAt: MARKER,
  });

  // --- boundary tenant: cutoff ±1ms and marker ±1ms ---
  T.bnd = await mkTenant("bnd");
  await mkOrder(T.bnd, "cutoff-m1", {
    history: "completed",
    done: new Date(CUTOFF.getTime() - 1),
  });
  await mkOrder(T.bnd, "cutoff-p1", {
    history: "completed",
    done: new Date(CUTOFF.getTime() + 1),
  });
  await mkOrder(T.bnd, "marker-m1", {
    history: "completed",
    done: new Date(MARKER.getTime() - 1),
  });
  await mkOrder(T.bnd, "marker-p1", {
    history: "completed",
    done: new Date(MARKER.getTime() + 1),
  });
  const bndCov = await mkOrder(T.bnd, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.bnd, {
    id: L("snap-bnd-cov"),
    orderId: bndCov.orderId,
    itemId: bndCov.itemIds[0],
    completedAt: MARKER,
  });

  // --- marker strictly BEFORE the cutoff (carve must stay off) ---
  T.m6 = await mkTenant("m6");
  await mkOrder(T.m6, "item", { history: "completed", done: BETWEEN });
  const m6Cov = await mkOrder(T.m6, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.m6, {
    id: L("snap-m6-cov"),
    orderId: m6Cov.orderId,
    itemId: m6Cov.itemIds[0],
    completedAt: BEFORE_CUTOFF,
  });

  // --- marker EXACTLY at the cutoff (carve must stay off) ---
  T.m7 = await mkTenant("m7");
  await mkOrder(T.m7, "item", { history: "completed", done: BETWEEN });
  const m7Cov = await mkOrder(T.m7, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.m7, {
    id: L("snap-m7-cov"),
    orderId: m7Cov.orderId,
    itemId: m7Cov.itemIds[0],
    completedAt: CUTOFF,
  });

  // --- marker strictly AFTER the cutoff (carve on) ---
  T.m8 = await mkTenant("m8");
  await mkOrder(T.m8, "legacy", { history: "completed", done: BEFORE_CUTOFF });
  await mkOrder(T.m8, "between", { history: "completed", done: BETWEEN });
  const m8Cov = await mkOrder(T.m8, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.m8, {
    id: L("snap-m8-cov"),
    orderId: m8Cov.orderId,
    itemId: m8Cov.itemIds[0],
    completedAt: MARKER,
  });

  // --- no snapshot at all (verified-empty marker population) ---
  T.nomark = await mkTenant("nomark");
  await mkOrder(T.nomark, "anom", { history: "completed", done: BETWEEN });
  await mkOrder(T.nomark, "unknown", { history: "none" });

  // --- completion-history edge cases ---
  T.nohist = await mkTenant("nohist");
  await mkOrder(T.nohist, "a-no-history", { history: "none" });
  await mkOrder(T.nohist, "b-non-completed", { history: "non-completed" });
  await mkOrder(T.nohist, "c-completed", { history: "completed", done: BETWEEN });
  await mkOrder(T.nohist, "d-two-completions", {
    history: "completed",
    done: [BEFORE_CUTOFF, AFTER_MARKER],
  });

  // --- statusCutoffOnly pair: carve visible, severity never lowered ---
  T.stat = await mkTenant("stat");
  await mkOrder(T.stat, "legacy", { history: "completed", done: BEFORE_CUTOFF });
  await mkOrder(T.stat, "between", { history: "completed", done: BETWEEN });
  const statCov = await mkOrder(T.stat, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.stat, {
    id: L("snap-stat-cov"),
    orderId: statCov.orderId,
    itemId: statCov.itemIds[0],
    completedAt: MARKER,
  });

  // --- coverage shapes ---
  T.fullcov = await mkTenant("fullcov");
  for (const [label, done] of [
    ["a", BETWEEN],
    ["b", BEFORE_CUTOFF],
  ] as const) {
    const o = await mkOrder(T.fullcov, label, { history: "completed", done });
    await mkSnapshot(T.fullcov, {
      id: L(`snap-fullcov-${label}`),
      orderId: o.orderId,
      itemId: o.itemIds[0],
      completedAt: MARKER,
    });
  }

  T.partcov = await mkTenant("partcov");
  const partCov = await mkOrder(T.partcov, "cov", { history: "completed", done: BETWEEN });
  await mkSnapshot(T.partcov, {
    id: L("snap-partcov-cov"),
    orderId: partCov.orderId,
    itemId: partCov.itemIds[0],
    completedAt: MARKER,
  });
  await mkOrder(T.partcov, "open", { history: "completed", done: AFTER_MARKER });

  T.nocov = await mkTenant("nocov");
  await mkOrder(T.nocov, "a", { history: "completed", done: BETWEEN, itemCount: 2 });
  await mkOrder(T.nocov, "b", { history: "completed", done: BETWEEN });

  // --- tenant isolation (distinct markers) ---
  T.isoa = await mkTenant("isoa");
  await mkOrder(T.isoa, "open", { history: "completed", done: AFTER_MARKER });
  const isoACov = await mkOrder(T.isoa, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.isoa, {
    id: L("snap-isoa-cov"),
    orderId: isoACov.orderId,
    itemId: isoACov.itemIds[0],
    completedAt: MARKER,
  });

  T.isob = await mkTenant("isob");
  for (const label of ["open-1", "open-2", "open-3"]) {
    await mkOrder(T.isob, label, { history: "completed", done: D4 });
  }
  const isoBCov = await mkOrder(T.isob, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.isob, {
    id: L("snap-isob-cov"),
    orderId: isoBCov.orderId,
    itemId: isoBCov.itemIds[0],
    completedAt: D3,
  });

  // --- branch isolation (marker is tenant-wide by contract) ---
  T.br = await mkTenant("br", 2);
  // b1 holds a post-marker gap (anomaly); b2 holds two booked activation
  // windows (beforeFirstSnapshot) — one branch survives, the other does not.
  await mkOrder(T.br, "b1-open", { branch: T.br.b1, history: "completed", done: AFTER_MARKER });
  await mkOrder(T.br, "b2-open-1", { branch: T.br.b2, history: "completed", done: BETWEEN });
  await mkOrder(T.br, "b2-open-2", { branch: T.br.b2, history: "completed", done: BETWEEN });
  const brCov = await mkOrder(T.br, "b2-cov", {
    branch: T.br.b2,
    history: "completed",
    done: BEFORE_CUTOFF,
  });
  await mkSnapshot(T.br, {
    id: L("snap-br-cov"),
    orderId: brCov.orderId,
    itemId: brCov.itemIds[0],
    completedAt: MARKER,
    branch: T.br.b2,
  });
  await mkOrder(T.br, "b2-revenue-no-items", {
    branch: T.br.b2,
    itemCount: 0,
    history: "none",
  });

  // --- cross-tenant snapshot claim ---
  T.xa = await mkTenant("x-a");
  T.xb = await mkTenant("x-b");
  T.xc = await mkTenant("x-c");
  const xaOrder = await mkOrder(T.xa, "item", { history: "completed", done: AFTER_MARKER });
  await mkSnapshot(T.xa, {
    id: L("snap-xa-mismatched"),
    orderId: xaOrder.orderId,
    itemId: xaOrder.itemIds[0],
    completedAt: MARKER,
    restaurantId: T.xb.rest, // WRONG tenant claim on a real order of X-A
  });
  const xbCov = await mkOrder(T.xb, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.xb, {
    id: L("snap-xb-cov"),
    orderId: xbCov.orderId,
    itemId: xbCov.itemIds[0],
    completedAt: D4,
  });
  const xcCov = await mkOrder(T.xc, "cov", { history: "completed", done: BEFORE_CUTOFF });
  await mkSnapshot(T.xc, {
    id: L("snap-xc-cov"),
    orderId: xcCov.orderId,
    itemId: xcCov.itemIds[0],
    completedAt: D5,
  });

  // --- C1 revenue-set semantics ---
  T.c1 = await mkTenant("c1");
  await mkOrder(T.c1, "paid-no-items", { itemCount: 0, history: "none" });
  await mkOrder(T.c1, "unpaid-no-items", {
    itemCount: 0,
    history: "none",
    paymentStatus: "UNPAID",
  });
  await mkOrder(T.c1, "cancelled-no-items", {
    itemCount: 0,
    history: "none",
    status: "CANCELLED",
  });
  await mkOrder(T.c1, "refunded-no-items", {
    itemCount: 0,
    history: "none",
    paymentStatus: "UNPAID",
    refundedPayment: true,
  });
  await mkOrder(T.c1, "with-items", { history: "completed", done: BETWEEN });

  // --- C3: branch-scoped mismatch + overshoot ---
  T.c3 = await mkTenant("c3", 2);
  const c3o1 = await mkOrder(T.c3, "o1", {
    branch: T.c3.b1,
    history: "completed",
    done: BEFORE_CUTOFF,
  });
  const c3o2 = await mkOrder(T.c3, "o2", {
    branch: T.c3.b2,
    history: "completed",
    done: BEFORE_CUTOFF,
  });
  await mkSnapshot(T.c3, {
    id: L("snap-c3-ok"),
    orderId: c3o2.orderId,
    itemId: c3o2.itemIds[0],
    completedAt: MARKER,
    branch: T.c3.b2,
  });
  // orderId belongs to o2 but the item belongs to o1 → ORDER_MISMATCH, and the
  // b2 scope then holds 2 snapshots over 1 order item → EXCEED_ORDER_ITEMS.
  await mkSnapshot(T.c3, {
    id: L("snap-c3-mismatch"),
    orderId: c3o2.orderId,
    itemId: c3o1.itemIds[0],
    completedAt: MARKER,
    branch: T.c3.b2,
  });

  // --- C3: tenant-wide invariants (deliberately incoherent rows, see the helper) ---
  T.c3w = await mkTenant("c3w");
  const c3wOrder = await mkOrder(T.c3w, "o", { history: "completed", done: BEFORE_CUTOFF });
  await createIncoherentSnapshot({
    id: L("snap-c3w-orphan"),
    restaurantId: T.c3w.rest,
    orderId: c3wOrder.orderId,
    orderItemId: L("no-such-item"),
    branchId: T.c3w.b1,
    productId: T.c3w.prod,
    completedAt: MARKER,
  });
  await createIncoherentSnapshot({
    id: L("snap-c3w-order-missing"),
    restaurantId: T.c3w.rest,
    orderId: L("no-such-order"),
    orderItemId: c3wOrder.itemIds[0],
    branchId: T.c3w.b1,
    productId: T.c3w.prod,
    completedAt: MARKER,
  });

  // --- query contract ---
  T.val = await mkTenant("val", 2);
  await mkOrder(T.val, "item", { branch: T.val.b1, history: "completed", done: BETWEEN });
  await mkOrder(T.val, "b2-item", { branch: T.val.b2, history: "completed", done: BETWEEN });
});

after(async () => {
  // No mirrored row exists any more: the genuine F.5 row must simply survive.
  const result = await cleanupRun(prisma, RUN);
  const afterCounts = await snapshotCounts(prisma);
  const residual = await findResiduals(prisma, RUN, result.scope);
  const ledger = await cutoffLedgerRows();

  console.log("\n[STEP 2B.5 CLEANUP] rows deleted:", JSON.stringify(result.deleted));
  console.log("[STEP 2B.5 CLEANUP] residual (run-scoped):", JSON.stringify(residual));
  console.log(
    "[STEP 2B.5 CLEANUP] table counts (baseline → after):",
    JSON.stringify(
      Object.fromEntries(
        Object.keys(baseline).map((k) => [
          k,
          `${baseline[k as keyof ScopedCounts]} → ${afterCounts[k as keyof ScopedCounts]}`,
        ])
      )
    )
  );
  console.log("[STEP 2B.5 CLEANUP] F.5 ledger rows after run:", ledger.length);
  assert.equal(
    ledger.length,
    1,
    "the genuine F.5 ledger row must still be the only one after the run",
  );
  // 2C.5: the row's stored metadata must be byte-identical — nothing was
  // rewritten, mirrored, rolled back or re-stamped by this suite.
  assert.ok(F5_LEDGER_METADATA, "the F.5 ledger metadata must have been captured in before()");
  assert.deepEqual(
    {
      finishedAtLiteral: ledger[0]!.finishedAtLiteral,
      rolledBackAtLiteral: ledger[0]!.rolledBackAtLiteral,
    },
    F5_LEDGER_METADATA,
    "the F.5 ledger metadata must be unchanged by the run",
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

// ============================================================
// Group A — the environment as it actually is (genuine F.5 row present)
// ============================================================

describe("environment as-is (genuine F.5 cutoff resolved)", () => {
  // ------------------------------------------------------------------
  // 1. Runtime isolated DB identity
  // ------------------------------------------------------------------
  it("1. the runtime connection targets the isolated test database [§5.1]", async () => {
    const rows = await prisma.$queryRaw<Array<{ db: string; user: string; version: string }>>`
      SELECT CAST(DATABASE() AS CHAR) AS db,
             CAST(USER() AS CHAR) AS user,
             CAST(VERSION() AS CHAR) AS version`;
    const identity = rows[0];
    assert.ok(identity);

    // Centralised live guard (STEP 2C.2F): database name + dedicated user.
    await assertLiveTestTarget(prisma);
    assert.equal(process.env.NODE_ENV, "test");
    assert.equal(identity.db, EXPECTED_TEST_DB.name);
    assert.ok(identity.db.includes("_test"), `database '${identity.db}' must be a test database`);
    assert.notEqual(identity.db, "restaurant_app");
    assert.ok(
      ["127.0.0.1", "localhost"].includes(EXPECTED_TEST_DB.host),
      "the test database must be reached over loopback"
    );
    assert.equal(EXPECTED_TEST_DB.port, process.env.TEST_DB_EXPECTED_PORT ?? "3308");
    assert.ok(EXPECTED_TEST_DB.port !== "3307", "port 3307 is the application database — never used here");
    assert.ok(process.env.DATABASE_URL?.includes(`/${EXPECTED_TEST_DB.name}`));
    assert.ok(identity.user.startsWith(EXPECTED_TEST_DB.user));
    assert.ok(/MariaDB/i.test(identity.version), `expected MariaDB, got ${identity.version}`);

    // Both effective connection strings must point at the isolated database and
    // must never fall back to the application database (port 3307 / name).
    for (const url of [process.env.DATABASE_URL, process.env.TEST_DATABASE_URL]) {
      assert.ok(url, "both DATABASE_URL and TEST_DATABASE_URL must be set");
      assert.ok(url!.includes(`/${EXPECTED_TEST_DB.name}`), "the connection string must name the test DB");
      assert.ok(!url!.includes(":3307"), "the connection string must not point at the application DB port");
    }

    // The dedicated v3 user has no grant on the application database: only
    // USAGE globally and ALL on `restaurant_app_test_v3`. (Never printed — the
    // USAGE line carries a password hash.)
    const grants = await prisma.$queryRaw<Array<Record<string, string>>>`SHOW GRANTS FOR CURRENT_USER()`;
    // MySQL escapes `_` in grant output; normalise before matching so the
    // assertion is about the database NAME, not about the escaping.
    const grantText = grants
      .map((g) => Object.values(g)[0] ?? "")
      .join("\n")
      .replace(/\\/g, "");
    assert.ok(
      !grantText.includes("`restaurant_app`"),
      "the test user must NOT hold any grant on the application database"
    );
    assert.ok(
      grantText.includes(`\`${EXPECTED_TEST_DB.name}\``),
      `the test user must be scoped to the approved test database (${EXPECTED_TEST_DB.name})`
    );
  });

  // ------------------------------------------------------------------
  // 2. Empty dataset
  // ------------------------------------------------------------------
  it("2. an empty restaurant reports zeroed checks with an OK verdict [§5.2]", async () => {
    const r = await report(T.empty);

    assert.deepEqual(r.scope, {
      restaurantId: T.empty.rest,
      branchIds: null,
      sampleLimit: 50,
    });

    const c1 = r.checks.revenueOrdersWithoutItems;
    assert.equal(c1.code, "REVENUE_ORDER_WITHOUT_ITEMS");
    assert.equal(c1.status, "OK");
    assert.equal(c1.orders, 0);
    assert.equal(c1.headerValue, 0);
    assert.deepEqual(c1.sampleOrderIds, []);

    const check = c2(r);
    assert.equal(check.code, "COMPLETED_ORDER_ITEM_WITHOUT_SNAPSHOT");
    assert.equal(check.items, 0);
    assert.equal(check.orders, 0);
    assert.deepEqual(buckets(check), { legacy: 0, before: 0, anomaly: 0, unknown: 0 });
    assert.equal(check.status, "OK");
    assert.equal(check.statusCutoffOnly, "OK");
    assert.equal(check.markerSource, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(check.firstObservedSnapshotAt, null);
    assert.equal(check.snapshotPopulation, 0);
    assert.equal(check.evidenceLevel, "MIGRATION_ONLY");
    assert.equal(check.activationUnproven, true);
    assert.equal(check.disclosure?.code, "SNAPSHOT_POPULATION_EMPTY");
    assert.ok(
      (check.disclosure?.text ?? "").includes("Tidak ada snapshot teramati"),
      "the verified-empty marker must be disclosed, never reported as healthy"
    );
    assert.deepEqual(check.sampleOrderIds, []);
    assertBucketPartition(check, "empty");

    // Cutoff evidence mirrors the ledger: never resolved without a real row,
    // and never guessed when the ledger has none.
    const ledger = await cutoffLedgerRows();
    assert.equal(check.cutoff.migration, LEGACY_CUTOFF_MIGRATION);
    assert.equal(check.cutoff.resolved, ledger.length > 0);
    assert.equal(
      check.cutoff.appliedAt,
      ledger.length > 0 ? ledger[0].finishedAt!.toISOString() : null,
      "appliedAt must be exactly the ledger's finished_at"
    );
    assert.equal(check.cutoff.codeDeployUnproven, true, "the code-deploy time is never proven");

    const c3 = r.checks.reconciliation;
    assert.equal(c3.code, "ORDER_ITEM_SNAPSHOT_RECONCILIATION");
    assert.equal(c3.status, "OK");
    assert.equal(c3.reconciled, true);
    assert.equal(c3.branchReconciled, true);
    assert.equal(c3.tenantReconciled, true);
    assert.deepEqual(c3.counts, { orders: 0, orderItems: 0, snapshots: 0 });
    assert.deepEqual(c3.snapshotByStatus, {});
    assert.deepEqual(
      c3.violations.map((v) => [v.code, v.count, v.scope]),
      [
        ["SNAPSHOT_ORDER_MISMATCH", 0, "BRANCH_SCOPED"],
        ["SNAPSHOT_TENANT_MISMATCH", 0, "BRANCH_SCOPED"],
        ["ORPHAN_SNAPSHOT_ITEM", 0, "TENANT_WIDE"],
        ["SNAPSHOT_ORDER_MISSING", 0, "TENANT_WIDE"],
        ["DUPLICATE_SNAPSHOT_PER_ITEM", 0, "TENANT_WIDE"],
      ],
      "all six reconciliation invariants are always reported with their scope"
    );
    assert.deepEqual(c3.sampleOrderIds, []);
    assert.ok(c3.scopeNote.length > 0);

    assert.equal(r.overallStatus, "OK");
  });

  // ------------------------------------------------------------------
  // 3. The GENUINE F.5 ledger row resolves the cutoff [F-4 fixed in 2C.2E]
  // ------------------------------------------------------------------
  it("3. the genuine F.5 ledger row resolves the cutoff and classifies the fixture", async () => {
    const ledger = await cutoffLedgerRows();
    assert.equal(
      ledger.length,
      1,
      `the provisioned database must hold exactly ONE ${LEGACY_CUTOFF_MIGRATION} row ` +
        "(the mirrored-ledger maneuver was removed in STEP 2C.2F)"
    );
    assert.ok(ledger[0]!.finishedAt, "the genuine ledger row must carry a finished_at");

    const r = await report(T.fix);
    const check = c2(r);

    // The cutoff is PROVEN, and it is exactly the ledger's own finished_at —
    // the value the replay wrote, never a re-created production literal.
    assert.deepEqual(check.cutoff, {
      migration: LEGACY_CUTOFF_MIGRATION,
      appliedAt: ledger[0]!.finishedAt!.toISOString(),
      resolved: true,
      codeDeployUnproven: true,
    });
    assert.equal(check.cutoff.appliedAt, CUTOFF.toISOString());
    assert.equal(check.items, 8);
    assert.equal(check.orders, 8);
    assert.deepEqual(
      buckets(check),
      { legacy: 3, before: 2, anomaly: 2, unknown: 1 },
      "legacy 3 / beforeFirstSnapshot 2 / anomaly 2 / unknownCompletion 1 = 8"
    );
    assert.equal(check.status, "CRITICAL", "a real post-cutoff gap is CRITICAL");
    assert.equal(check.statusCutoffOnly, "CRITICAL");

    // The marker is an independent read of the snapshot population.
    assert.equal(check.markerSource, "SNAPSHOT_MIN_OBSERVED");
    assert.equal(check.firstObservedSnapshotAt, MARKER.toISOString());
    assert.equal(check.snapshotPopulation, 1);
    assert.equal(check.evidenceLevel, "SNAPSHOT_OBSERVED");
    assert.equal(check.disclosure, null);
    assert.equal(check.activationUnproven, true);

    // Samples: the anomaly and activation-window items, then the unknown —
    // legacy items are never sampled as problems.
    assert.equal(check.sampleOrderIds.length, 5);
    assert.deepEqual(sorted(check.sampleOrderIds), [
      oid(T.fix, "mand-1"),
      oid(T.fix, "mand-5"),
      oid(T.fix, "mand-6"),
      oid(T.fix, "mand-7"),
      oid(T.fix, "mand-8"),
    ]);
    assertBucketPartition(check, "fix (genuine cutoff)");

    // C1/C3 are unaffected by the cutoff.
    assert.equal(r.checks.revenueOrdersWithoutItems.orders, 0);
    assert.equal(r.checks.reconciliation.status, "OK");
    assert.deepEqual(r.checks.reconciliation.counts, { orders: 9, orderItems: 9, snapshots: 1 });
  });
});

// ============================================================
// Group B — with the GENUINE F.5 cutoff ledger row (nothing installed)
// ============================================================

describe("with the genuine F.5 cutoff ledger row (no mirrored install)", () => {
  before(async () => {
    const ledger = await cutoffLedgerRows();
    assert.equal(ledger.length, 1, "the genuine cutoff ledger row must exist for these tests");
    assert.ok(ledger[0]!.finishedAt, "the ledger row must carry a finished_at");
    assert.equal(
      ledger[0]!.finishedAt!.toISOString(),
      CUTOFF.toISOString(),
      "the suite's cutoff must be exactly the genuine ledger finished_at"
    );
  });

  after(async () => {
    const ledger = await cutoffLedgerRows();
    assert.equal(
      ledger.length,
      1,
      "the genuine ledger row must be neither duplicated nor removed by the run"
    );
    console.log("\n[STEP 2C.2F LEDGER] genuine cutoff row verified unchanged (no fixture row)");
  });

  // ------------------------------------------------------------------
  // 4. The mandated numerical fixture through the REAL SQL aggregation
  // ------------------------------------------------------------------
  it("4. the mandated eight-row fixture splits 3 / 2 / 2 / 1 through the real SQL [§5.3]", async () => {
    const r = await report(T.fix);
    const check = c2(r);

    assert.deepEqual(check.cutoff, {
      migration: LEGACY_CUTOFF_MIGRATION,
      appliedAt: CUTOFF.toISOString(),
      resolved: true,
      codeDeployUnproven: true,
    });

    assert.equal(check.items, 8);
    assert.equal(check.orders, 8);
    assert.deepEqual(
      buckets(check),
      { legacy: 3, before: 2, anomaly: 2, unknown: 1 },
      "legacy 3 / beforeFirstSnapshot 2 / anomaly 2 / unknownCompletion 1 = 8"
    );
    assert.deepEqual(check.buckets, {
      legacyExpected: { items: 3, orders: 3 },
      beforeFirstSnapshot: { items: 2, orders: 2 },
      anomaly: { items: 2, orders: 2 },
      unknownCompletion: { items: 1, orders: 1 },
    });
    assertBucketPartition(check, "fix");

    assert.equal(check.status, "CRITICAL", "a real post-cutoff gap is CRITICAL");
    assert.equal(check.statusCutoffOnly, "CRITICAL");

    assert.equal(check.markerSource, "SNAPSHOT_MIN_OBSERVED");
    assert.equal(check.firstObservedSnapshotAt, MARKER.toISOString());
    assert.equal(check.snapshotPopulation, 1);
    assert.equal(check.evidenceLevel, "SNAPSHOT_OBSERVED");
    assert.equal(check.disclosure, null);
    assert.equal(check.activationUnproven, true);

    // Samples: anomalies first (ordered by their completion time), then the
    // unproven activation window, then the unknowns.
    assert.equal(check.sampleOrderIds.length, 5);
    assert.deepEqual(check.sampleOrderIds.slice(0, 2), [
      oid(T.fix, "mand-7"),
      oid(T.fix, "mand-8"),
    ]);
    assert.deepEqual(sorted(check.sampleOrderIds), [
      oid(T.fix, "mand-1"),
      oid(T.fix, "mand-5"),
      oid(T.fix, "mand-6"),
      oid(T.fix, "mand-7"),
      oid(T.fix, "mand-8"),
    ]);

    assert.equal(r.checks.revenueOrdersWithoutItems.status, "OK");
    assert.equal(r.checks.reconciliation.status, "OK");
    assert.equal(r.overallStatus, "CRITICAL");
  });

  // ------------------------------------------------------------------
  // 5. Exact cutoff boundary
  // ------------------------------------------------------------------
  it("5. the exact cutoff boundary lands in beforeFirstSnapshot, not legacy [§5.4]", async () => {
    // Rule level: `< cutoff` is legacy, `== cutoff` is NOT legacy.
    const marker = buildSnapshotMarker({ population: 1, firstObservedSnapshotAt: MARKER });
    assert.equal(classifyCompletionBucketV2(CUTOFF, CUTOFF, marker), "beforeFirstSnapshot");
    assert.equal(classifyCompletionBucketV2(new Date(CUTOFF.getTime() + 1), CUTOFF, marker), "beforeFirstSnapshot");
    assert.equal(classifyCompletionBucketV2(new Date(CUTOFF.getTime() - 1), CUTOFF, marker), "legacyExpected");
    // Without the carve the same instant is an anomaly — that is why the carve exists.
    assert.equal(classifyCompletionBucket(CUTOFF, CUTOFF), "anomaly");

    // SQL level: the mandated fixture's 3/2 split isolates `mand-5` (done
    // exactly at the cutoff) into `beforeFirstSnapshot`: if the boundary were
    // inclusive of legacy the split would be 4/1, and if it were an anomaly it
    // would be 3/1/3.
    const fix = c2(await report(T.fix));
    assert.deepEqual(buckets(fix), { legacy: 3, before: 2, anomaly: 2, unknown: 1 });

    // Dedicated ±1ms fixture.
    const bnd = c2(await report(T.bnd));
    assert.deepEqual(
      buckets(bnd),
      { legacy: 1, before: 2, anomaly: 1, unknown: 0 },
      "cutoff-1ms → legacy; cutoff+1ms & marker-1ms → beforeFirstSnapshot; marker+1ms → anomaly"
    );
    assert.equal(bnd.items, 4);
    assert.equal(bnd.status, "CRITICAL");
    assert.equal(bnd.firstObservedSnapshotAt, MARKER.toISOString());
  });

  // ------------------------------------------------------------------
  // 6. Exact first-snapshot marker boundary
  // ------------------------------------------------------------------
  it("6. the exact marker boundary is an anomaly; just below it is the carve window [§5.5]", async () => {
    const marker = buildSnapshotMarker({ population: 1, firstObservedSnapshotAt: MARKER });
    assert.equal(classifyCompletionBucketV2(MARKER, CUTOFF, marker), "anomaly");
    assert.equal(classifyCompletionBucketV2(new Date(MARKER.getTime() + 1), CUTOFF, marker), "anomaly");
    assert.equal(classifyCompletionBucketV2(new Date(MARKER.getTime() - 1), CUTOFF, marker), "beforeFirstSnapshot");
    assert.equal(carveWindow(CUTOFF, marker)?.toISOString(), MARKER.toISOString());

    // SQL: `mand-7` is done exactly AT the marker → anomaly, so the split stays
    // 2 anomalies (mand-7, mand-8); at-marker-as-before would make it 3/1.
    const fix = c2(await report(T.fix));
    assert.equal(fix.buckets.anomaly.items, 2);
    assert.equal(fix.buckets.beforeFirstSnapshot.items, 2);

    const bnd = c2(await report(T.bnd));
    assert.deepEqual(buckets(bnd), { legacy: 1, before: 2, anomaly: 1, unknown: 0 });
  });

  // ------------------------------------------------------------------
  // 7. Marker strictly before the cutoff
  // ------------------------------------------------------------------
  it("7. a marker before the cutoff disables the carve and keeps the anomaly CRITICAL [§5.6]", async () => {
    const check = c2(await report(T.m6));

    assert.equal(check.snapshotPopulation, 1);
    assert.equal(check.markerSource, "SNAPSHOT_MIN_OBSERVED");
    assert.equal(check.firstObservedSnapshotAt, BEFORE_CUTOFF.toISOString());
    assert.equal(check.items, 1);
    assert.deepEqual(
      buckets(check),
      { legacy: 0, before: 0, anomaly: 1, unknown: 0 },
      "a marker older than the cutoff must never carve an activation window"
    );
    assert.equal(check.status, "CRITICAL");
    assert.equal(check.statusCutoffOnly, "CRITICAL");
    assertBucketPartition(check, "marker before cutoff");

    const marker = markerFrom(check);
    assert.equal(markerAllowsCarve(marker), true, "the marker WAS observed …");
    assert.equal(carveWindow(CUTOFF, marker), null, "… but it is older than the cutoff, so the carve is off");
    assert.equal(evidenceLevelFor(marker), "SNAPSHOT_OBSERVED");
    assert.equal(check.evidenceLevel, "SNAPSHOT_OBSERVED");
    assert.equal(check.disclosure, null);
    assert.equal(classifyCompletionBucketV2(BETWEEN, CUTOFF, marker), "anomaly");
  });

  // ------------------------------------------------------------------
  // 8. Marker exactly at the cutoff
  // ------------------------------------------------------------------
  it("8. a marker exactly at the cutoff disables the carve (no overlap) [§5.7]", async () => {
    const check = c2(await report(T.m7));

    assert.equal(check.snapshotPopulation, 1);
    assert.equal(check.firstObservedSnapshotAt, CUTOFF.toISOString());
    assert.deepEqual(buckets(check), { legacy: 0, before: 0, anomaly: 1, unknown: 0 });
    assert.equal(check.status, "CRITICAL");
    assert.equal(check.statusCutoffOnly, "CRITICAL");
    assertBucketPartition(check, "marker at cutoff");

    const marker = markerFrom(check);
    assert.equal(carveWindow(CUTOFF, marker), null, "the window must be STRICTLY newer than the cutoff");
    // Anti-overlap: with the carve off, the legacy bucket cannot absorb the
    // [marker, cutoff) interval — the four buckets still partition `items`.
    assert.equal(buckets(check).legacy, 0);
  });

  // ------------------------------------------------------------------
  // 9. Marker strictly after the cutoff
  // ------------------------------------------------------------------
  it("9. a newer marker carves the unproven window and never lowers severity by itself [§5.8]", async () => {
    const check = c2(await report(T.m8));

    assert.equal(check.firstObservedSnapshotAt, MARKER.toISOString());
    assert.deepEqual(
      buckets(check),
      { legacy: 1, before: 1, anomaly: 0, unknown: 0 },
      "cutoff <= done < marker is the unproven activation window"
    );
    assert.equal(check.status, "UNKNOWN", "an unproven activation window is never OK");
    assert.equal(
      check.statusCutoffOnly,
      "CRITICAL",
      "without the marker the same item is a post-cutoff anomaly — both verdicts stay visible"
    );
    assert.equal(evidenceLevelFor(markerFrom(check)), "SNAPSHOT_OBSERVED");
    assert.equal(check.disclosure, null);
    assertBucketPartition(check, "marker after cutoff");
  });

  // ------------------------------------------------------------------
  // 10. No first-snapshot marker at all
  // ------------------------------------------------------------------
  it("10. a verified-empty snapshot population carves nothing and is disclosed [§5.9]", async () => {
    const check = c2(await report(T.nomark));

    assert.equal(check.markerSource, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(check.firstObservedSnapshotAt, null);
    assert.equal(check.snapshotPopulation, 0);
    assert.equal(check.evidenceLevel, "MIGRATION_ONLY");
    assert.equal(check.disclosure?.code, "SNAPSHOT_POPULATION_EMPTY");
    assert.ok((check.disclosure?.text ?? "").includes("Tidak ada snapshot teramati"));
    assert.equal(check.activationUnproven, true);

    assert.equal(check.items, 2);
    assert.deepEqual(
      buckets(check),
      { legacy: 0, before: 0, anomaly: 1, unknown: 1 },
      "no marker → plain cutoff-only classification"
    );
    assert.equal(check.status, "CRITICAL");
    assert.equal(check.statusCutoffOnly, "CRITICAL");
    assert.deepEqual(sorted(check.sampleOrderIds), [oid(T.nomark, "anom"), oid(T.nomark, "unknown")]);
    assert.equal(markerAllowsCarve(markerFrom(check)), false);
    assert.equal(carveWindow(CUTOFF, markerFrom(check)), null);
  });

  // ------------------------------------------------------------------
  // 11. Ineligible marker + unverifiable marker read
  // ------------------------------------------------------------------
  it("11. an ineligible marker is inert in SQL; an unverified read is covered by the rules [§5.10]", async () => {
    // Real SQL: the marker is genuinely observed but at/before the cutoff, so
    // the carve is disabled and the evidence level reports the observation
    // honestly (it is metadata only, never a severity input).
    for (const tenant of [T.m6, T.m7]) {
      const check = c2(await report(tenant));
      assert.equal(check.markerSource, "SNAPSHOT_MIN_OBSERVED");
      assert.equal(check.evidenceLevel, "SNAPSHOT_OBSERVED");
      assert.equal(check.disclosure, null);
      assert.equal(check.buckets.beforeFirstSnapshot.items, 0);
      assert.equal(check.status, check.statusCutoffOnly, "an inert marker cannot change the verdict");
    }

    // A FAILED marker read has no live trigger (the service catches the error
    // internally), so its contract is asserted through the pure rules.
    const unverified = buildSnapshotMarker({ population: null, firstObservedSnapshotAt: null });
    assert.deepEqual(unverified, {
      source: "SNAPSHOT_MARKER_UNVERIFIED",
      population: null,
      firstObservedSnapshotAt: null,
    });
    assert.equal(markerAllowsCarve(unverified), false);
    assert.equal(evidenceLevelFor(unverified), "MIGRATION_ONLY");
    assert.equal(carveWindow(CUTOFF, unverified), null);
    assert.equal(buildSnapshotDisclosure(unverified)?.code, "SNAPSHOT_MARKER_UNVERIFIED");
    assert.ok((buildSnapshotDisclosure(unverified)?.text ?? "").includes("BUKAN bukti"));
    assert.equal(
      classifyCompletionBucketV2(BETWEEN, CUTOFF, unverified),
      "anomaly",
      "a failed marker read must never lower severity"
    );

    // Impossible shapes fail safe into UNVERIFIED, never into OBSERVED/EMPTY.
    assert.equal(
      buildSnapshotMarker({ population: 3, firstObservedSnapshotAt: null }).source,
      "SNAPSHOT_MARKER_UNVERIFIED",
      "a non-empty population without a marker is an inconsistent read, not an observation"
    );
    assert.equal(
      buildSnapshotMarker({ population: 2, firstObservedSnapshotAt: new Date("nonsense") }).source,
      "SNAPSHOT_MARKER_UNVERIFIED"
    );
    assert.equal(
      buildSnapshotMarker({ population: -1, firstObservedSnapshotAt: MARKER }).source,
      "SNAPSHOT_POPULATION_EMPTY",
      "a nonsense population is clamped to verified-empty"
    );
  });

  // ------------------------------------------------------------------
  // 12. Missing OrderStatusHistory
  // ------------------------------------------------------------------
  it("12. orders with no (or only non-COMPLETED) history are unclassifiable [§5.11]", async () => {
    const check = c2(await report(T.nohist));

    assert.equal(check.items, 4);
    assert.equal(check.orders, 4);
    assert.deepEqual(
      buckets(check),
      { legacy: 1, before: 0, anomaly: 1, unknown: 2 },
      "a missing completion history is unknownCompletion, never legacy"
    );
    assert.deepEqual(check.buckets.unknownCompletion, { items: 2, orders: 2 });
    assert.equal(check.status, "CRITICAL");
    assert.deepEqual(sorted(check.sampleOrderIds), [
      oid(T.nohist, "a-no-history"),
      oid(T.nohist, "b-non-completed"),
      oid(T.nohist, "c-completed"),
    ]);
    assertBucketPartition(check, "missing history");

    // The first COMPLETED row wins (MIN(createdAt)), even with a later one.
    const legacy = await prisma.orderStatusHistory.count({
      where: { orderId: oid(T.nohist, "d-two-completions"), status: "COMPLETED" },
    });
    assert.equal(legacy, 2, "the fixture keeps two COMPLETED rows");
    assert.equal(check.buckets.legacyExpected.items, 1, "the EARLIEST completion decides the bucket");
  });

  // ------------------------------------------------------------------
  // 13. Null / invalid completion timestamp
  // ------------------------------------------------------------------
  it("13. a null or invalid completion time is never guessed [§5.12]", async () => {
    const marker = buildSnapshotMarker({ population: 1, firstObservedSnapshotAt: MARKER });
    for (const value of [null, undefined, "not-a-date", new Date("nonsense")]) {
      assert.equal(
        classifyCompletionBucketV2(value, CUTOFF, marker),
        "unknownCompletion",
        `completion ${String(value)} must be unknownCompletion`
      );
      assert.equal(classifyCompletionBucket(value, CUTOFF), "unknownCompletion");
    }
    // No cutoff ⇒ nothing can be classified, whatever the completion time is.
    assert.equal(classifyCompletionBucketV2(BEFORE_CUTOFF, null, marker), "unknownCompletion");
    assert.equal(classifyCompletionBucket(BEFORE_CUTOFF, null), "unknownCompletion");
    // A valid ISO string is accepted and classified normally.
    assert.equal(classifyCompletionBucketV2(BEFORE_CUTOFF.toISOString(), CUTOFF, marker), "legacyExpected");

    // SQL: SQL NULL completion (no COMPLETED history) → unknownCompletion, and
    // the unknown population is reported with its own order count.
    const nohist = c2(await report(T.nohist));
    assert.deepEqual(nohist.buckets.unknownCompletion, { items: 2, orders: 2 });
  });

  // ------------------------------------------------------------------
  // 14. StatusCutoffOnly
  // ------------------------------------------------------------------
  it("14. statusCutoffOnly exposes the marker-free verdict without weakening the status [§5.13]", async () => {
    const check = c2(await report(T.stat));

    assert.deepEqual(buckets(check), { legacy: 1, before: 1, anomaly: 0, unknown: 0 });
    assert.equal(check.status, "UNKNOWN", "a booked activation window is UNKNOWN, never OK");
    assert.equal(
      check.statusCutoffOnly,
      "CRITICAL",
      "cutoff-only, the same item is a post-cutoff anomaly — the carve must be visible"
    );
    assert.equal(
      check.statusCutoffOnly,
      completedWithoutSnapshotStatus({
        anomalyItems: check.buckets.anomaly.items + check.buckets.beforeFirstSnapshot.items,
        unknownItems: check.buckets.unknownCompletion.items,
        cutoffResolved: check.cutoff.resolved,
      }),
      "statusCutoffOnly is exactly anomaly+before treated as anomaly"
    );

    // The disclosed relation holds for every tenant, with and without a carve.
    for (const tenant of [T.fix, T.bnd, T.m6, T.m7, T.m8, T.nomark, T.nohist, T.stat, T.partcov, T.nocov]) {
      const c = c2(await report(tenant));
      assert.equal(c.status, completedWithoutSnapshotStatusV3({
        anomalyItems: c.buckets.anomaly.items,
        beforeFirstSnapshotItems: c.buckets.beforeFirstSnapshot.items,
        unknownItems: c.buckets.unknownCompletion.items,
        cutoffResolved: c.cutoff.resolved,
      }), `${tenant.rest}: status must be the documented severity rule`);
      assert.equal(c.statusCutoffOnly, completedWithoutSnapshotStatus({
        anomalyItems: c.buckets.anomaly.items + c.buckets.beforeFirstSnapshot.items,
        unknownItems: c.buckets.unknownCompletion.items,
        cutoffResolved: c.cutoff.resolved,
      }), `${tenant.rest}: statusCutoffOnly must fold the carve back into anomaly`);
      if (c.buckets.beforeFirstSnapshot.items === 0) {
        assert.equal(c.statusCutoffOnly, c.status, `${tenant.rest}: no carve ⇒ identical verdicts`);
      }
    }
  });

  // ------------------------------------------------------------------
  // 15. Complete snapshot coverage
  // ------------------------------------------------------------------
  it("15. complete snapshot coverage yields an empty C2 population and OK [§5.14]", async () => {
    const r = await report(T.fullcov);
    const check = c2(r);

    assert.equal(check.items, 0);
    assert.equal(check.orders, 0);
    assert.deepEqual(buckets(check), { legacy: 0, before: 0, anomaly: 0, unknown: 0 });
    assert.equal(check.status, "OK");
    assert.equal(check.statusCutoffOnly, "OK");
    assert.deepEqual(check.sampleOrderIds, []);
    assert.equal(check.markerSource, "SNAPSHOT_MIN_OBSERVED");
    assert.equal(check.snapshotPopulation, 2);
    assert.equal(check.firstObservedSnapshotAt, MARKER.toISOString());

    const c3 = r.checks.reconciliation;
    assert.deepEqual(c3.counts, { orders: 2, orderItems: 2, snapshots: 2 });
    assert.deepEqual(c3.snapshotByStatus, { SNAPSHOTTED: 2 });
    assert.equal(c3.status, "OK");
    assert.equal(c3.reconciled, true);
    assert.equal(c3.branchReconciled, true);
    assert.equal(c3.tenantReconciled, true);
    assert.ok(c3.violations.every((v) => v.count === 0));
    assert.equal(r.overallStatus, "OK");
  });

  // ------------------------------------------------------------------
  // 16. Partial snapshot coverage
  // ------------------------------------------------------------------
  it("16. partial coverage only counts the uncovered items [§5.15]", async () => {
    const r = await report(T.partcov);
    const check = c2(r);

    assert.equal(check.items, 1, "the covered item is excluded from the population");
    assert.equal(check.orders, 1);
    assert.deepEqual(buckets(check), { legacy: 0, before: 0, anomaly: 1, unknown: 0 });
    assert.equal(check.status, "CRITICAL");
    assert.equal(check.snapshotPopulation, 1);
    assert.equal(check.firstObservedSnapshotAt, MARKER.toISOString());

    const c3 = r.checks.reconciliation;
    assert.deepEqual(c3.counts, { orders: 2, orderItems: 2, snapshots: 1 });
    assert.equal(c3.status, "OK", "counts below the item count are not a relation violation");
    assert.equal(c3.reconciled, true);
    assert.equal(r.overallStatus, "CRITICAL");
  });

  // ------------------------------------------------------------------
  // 17. Missing snapshot coverage
  // ------------------------------------------------------------------
  it("17. a tenant with no snapshots is fully anomalous and fully disclosed [§5.16]", async () => {
    const r = await report(T.nocov);
    const check = c2(r);

    assert.equal(check.items, 3);
    assert.equal(check.orders, 2, "two items on one order count as two items / one order");
    assert.deepEqual(buckets(check), { legacy: 0, before: 0, anomaly: 3, unknown: 0 });
    assert.deepEqual(check.buckets.anomaly, { items: 3, orders: 2 });
    assert.equal(check.status, "CRITICAL");
    assert.equal(check.statusCutoffOnly, "CRITICAL");
    assert.equal(check.snapshotPopulation, 0);
    assert.equal(check.markerSource, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(check.disclosure?.code, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(check.evidenceLevel, "MIGRATION_ONLY");

    const c3 = r.checks.reconciliation;
    assert.deepEqual(c3.counts, { orders: 2, orderItems: 3, snapshots: 0 });
    assert.deepEqual(c3.snapshotByStatus, {});
    assert.equal(c3.status, "OK");
    assert.equal(r.overallStatus, "CRITICAL");
    assertBucketPartition(check, "no coverage");
  });

  // ------------------------------------------------------------------
  // 18. Severity rules
  // ------------------------------------------------------------------
  it("18. severity follows the documented rules and ignores every evidence field [§5.17]", async () => {
    assert.equal(revenueWithoutItemsStatus(0), "OK");
    assert.equal(revenueWithoutItemsStatus(1), "CRITICAL");

    const v3 = completedWithoutSnapshotStatusV3;
    assert.equal(v3({ anomalyItems: 1, beforeFirstSnapshotItems: 5, unknownItems: 9, cutoffResolved: false }), "CRITICAL");
    assert.equal(v3({ anomalyItems: 0, beforeFirstSnapshotItems: 1, unknownItems: 0, cutoffResolved: true }), "UNKNOWN");
    assert.equal(v3({ anomalyItems: 0, beforeFirstSnapshotItems: 0, unknownItems: 4, cutoffResolved: true }), "WARN");
    assert.equal(v3({ anomalyItems: 0, beforeFirstSnapshotItems: 0, unknownItems: 4, cutoffResolved: false }), "UNKNOWN");
    assert.equal(v3({ anomalyItems: 0, beforeFirstSnapshotItems: 0, unknownItems: 0, cutoffResolved: false }), "OK");
    assert.equal(v3({ anomalyItems: 0, beforeFirstSnapshotItems: 0, unknownItems: 0, cutoffResolved: true }), "OK");

    // Anti-downgrade: injecting every evidence field must not move the verdict.
    const withEvidence = {
      anomalyItems: 0,
      beforeFirstSnapshotItems: 0,
      unknownItems: 7,
      cutoffResolved: false,
      markerSource: "SNAPSHOT_MIN_OBSERVED",
      snapshotPopulation: 123,
      firstObservedSnapshotAt: MARKER,
      evidenceLevel: "SNAPSHOT_OBSERVED",
      activationUnproven: true,
      codeDeployUnproven: true,
      disclosure: null,
    } as never;
    assert.equal(
      v3(withEvidence),
      v3({ anomalyItems: 0, beforeFirstSnapshotItems: 0, unknownItems: 7, cutoffResolved: false }),
      "no evidence field may change the severity"
    );

    assert.equal(reconciliationStatus(0), "OK");
    assert.equal(reconciliationStatus(2), "CRITICAL");
    assert.equal(deriveOverallStatus(["OK", "OK", "OK"]), "OK");
    assert.equal(deriveOverallStatus(["OK", "UNKNOWN", "OK"]), "WARN");
    assert.equal(deriveOverallStatus(["OK", "WARN", "OK"]), "WARN");
    assert.equal(deriveOverallStatus(["OK", "CRITICAL", "WARN"]), "CRITICAL");

    // SQL: CRITICAL is produced by a real anomaly, and an unresolved cutoff
    // can only ever degrade to UNKNOWN — the production risk of F-4.
    assert.equal(c2(await report(T.fix)).status, "CRITICAL");
    assert.equal(c2(await report(T.stat)).status, "UNKNOWN");
    assert.equal((await report(T.nocov)).overallStatus, "CRITICAL");
    assert.equal((await report(T.m8)).overallStatus, "WARN");
    assert.equal((await report(T.empty)).overallStatus, "OK");
  });

  // ------------------------------------------------------------------
  // 19. Mutual exclusivity of the four buckets
  // ------------------------------------------------------------------
  it("19. the four buckets partition the eligible population for every tenant [§5.18]", async () => {
    const tenantKeys = [
      "empty",
      "fix",
      "bnd",
      "m6",
      "m7",
      "m8",
      "nomark",
      "nohist",
      "stat",
      "fullcov",
      "partcov",
      "nocov",
      "isoa",
      "isob",
      "br",
      "xa",
      "xb",
      "xc",
      "c1",
      "c3",
      "c3w",
      "val",
    ];
    for (const key of tenantKeys) {
      const check = c2(await report(T[key]));
      assertBucketPartition(check, key);
    }
  });

  // ------------------------------------------------------------------
  // 20. Sum of bucket counts equals the independently counted population
  // ------------------------------------------------------------------
  it("20. the bucket sum equals an ORM-counted eligible population [§5.19]", async () => {
    const tenantKeys = ["fix", "bnd", "m6", "m7", "m8", "nomark", "nohist", "stat", "fullcov", "partcov", "nocov", "br", "c3", "c3w"];
    for (const key of tenantKeys) {
      const t = T[key];
      const check = c2(await report(t));
      const independent = await prisma.orderItem.count({
        where: { order: { restaurantId: t.rest, status: "COMPLETED" }, costSnapshot: null },
      });
      assert.equal(
        check.items,
        independent,
        `${key}: the SQL population must match the independent ORM count`
      );
      const independentOrders = await prisma.order.count({
        where: {
          restaurantId: t.rest,
          status: "COMPLETED",
          items: { some: { costSnapshot: null } },
        },
      });
      assert.equal(check.orders, independentOrders, `${key}: the order count must match too`);
    }

    // For tenants whose snapshots are all tenant-consistent, the marker
    // population equals the number of items carrying a snapshot. (c3w is
    // excluded on purpose: it holds a deliberately inconsistent snapshot that
    // the marker read must ignore — asserted in test 28.)
    for (const key of ["fullcov", "partcov", "fix", "bnd", "isoa", "isob", "br"]) {
      const t = T[key];
      const check = c2(await report(t));
      const covered = await prisma.orderItem.count({
        where: { order: { restaurantId: t.rest }, costSnapshot: { isNot: null } },
      });
      assert.equal(
        check.snapshotPopulation,
        covered,
        `${key}: the marker population is the tenant's consistent snapshot count`
      );
    }
  });

  // ------------------------------------------------------------------
  // 21. Pure classifier versus real SQL
  // ------------------------------------------------------------------
  it("21. the pure classifier reproduces the SQL buckets on equivalent fixtures [§5.20]", async () => {
    const fix = c2(await report(T.fix));
    const marker = markerFrom(fix);
    assert.equal(marker.source, "SNAPSHOT_MIN_OBSERVED");

    // The eight mandated completion values (order mand-1 … mand-8).
    const mandated: Array<Date | null> = [
      null,
      BEFORE_CUTOFF,
      D1,
      D2,
      CUTOFF,
      BETWEEN,
      MARKER,
      AFTER_MARKER,
    ];

    const tally: Record<BucketKey, number> = { legacy: 0, before: 0, anomaly: 0, unknown: 0 };
    const tallyCutoffOnly: Record<string, number> = { legacyExpected: 0, anomaly: 0, unknownCompletion: 0 };
    for (const done of mandated) {
      const bucket = classifyCompletionBucketV2(done, CUTOFF, marker);
      tally[
        bucket === "legacyExpected"
          ? "legacy"
          : bucket === "beforeFirstSnapshot"
            ? "before"
            : bucket === "anomaly"
              ? "anomaly"
              : "unknown"
      ] += 1;
      tallyCutoffOnly[classifyCompletionBucket(done, CUTOFF)] += 1;
    }

    assert.deepEqual(tally, { legacy: 3, before: 2, anomaly: 2, unknown: 1 });
    assert.deepEqual(buckets(fix), tally, "pure rules and the real SQL must agree bucket-for-bucket");
    assert.deepEqual(tallyCutoffOnly, { legacyExpected: 3, anomaly: 4, unknownCompletion: 1 });
    assert.equal(
      fix.buckets.anomaly.items + fix.buckets.beforeFirstSnapshot.items,
      tallyCutoffOnly.anomaly,
      "the cutoff-only anomaly count folds the carve window back in"
    );

    // Same equivalence on the ±1ms boundary fixture.
    const bnd = c2(await report(T.bnd));
    const bndTally: Record<BucketKey, number> = { legacy: 0, before: 0, anomaly: 0, unknown: 0 };
    for (const done of [
      new Date(CUTOFF.getTime() - 1),
      new Date(CUTOFF.getTime() + 1),
      new Date(MARKER.getTime() - 1),
      new Date(MARKER.getTime() + 1),
    ]) {
      const bucket = classifyCompletionBucketV2(done, CUTOFF, markerFrom(bnd));
      bndTally[
        bucket === "legacyExpected"
          ? "legacy"
          : bucket === "beforeFirstSnapshot"
            ? "before"
            : bucket === "anomaly"
              ? "anomaly"
              : "unknown"
      ] += 1;
    }
    assert.deepEqual(buckets(bnd), bndTally);

    // The report's own cutoff evidence is the pure `buildCutoffEvidence` shape.
    assert.deepEqual(
      fix.cutoff,
      buildCutoffEvidence({
        migration: LEGACY_CUTOFF_MIGRATION,
        appliedAt: CUTOFF,
        resolved: true,
      })
    );
  });

  // ------------------------------------------------------------------
  // 22. Tenant isolation
  // ------------------------------------------------------------------
  it("22. one tenant's data never leaks into another tenant's buckets [§5.21]", async () => {
    const a = c2(await report(T.isoa));
    const b = c2(await report(T.isob));

    assert.equal(a.items, 1);
    assert.deepEqual(buckets(a), { legacy: 0, before: 0, anomaly: 1, unknown: 0 });
    assert.equal(a.firstObservedSnapshotAt, MARKER.toISOString());
    assert.equal(a.snapshotPopulation, 1);
    assert.deepEqual(a.sampleOrderIds, [oid(T.isoa, "open")]);

    assert.equal(b.items, 3);
    assert.deepEqual(buckets(b), { legacy: 0, before: 0, anomaly: 3, unknown: 0 });
    assert.equal(b.firstObservedSnapshotAt, D3.toISOString());
    assert.equal(b.snapshotPopulation, 1);
    assert.ok(
      b.sampleOrderIds.every((id) => id.startsWith(T.isob.rest)),
      "B's samples must never include A's orders"
    );

    const ra = await report(T.isoa);
    const rb = await report(T.isob);
    assert.deepEqual(ra.checks.reconciliation.counts, { orders: 2, orderItems: 2, snapshots: 1 });
    assert.deepEqual(rb.checks.reconciliation.counts, { orders: 4, orderItems: 4, snapshots: 1 });
    assert.equal(ra.checks.revenueOrdersWithoutItems.orders, 0);
    assert.equal(rb.checks.revenueOrdersWithoutItems.orders, 0);
  });

  // ------------------------------------------------------------------
  // 23. Branch isolation (with a tenant-wide marker)
  // ------------------------------------------------------------------
  it("23. branch scoping is enforced while the marker stays tenant-wide [§5.22]", async () => {
    const all = await report(T.br);
    const allC2 = c2(all);
    assert.equal(allC2.items, 3);
    assert.deepEqual(buckets(allC2), { legacy: 0, before: 2, anomaly: 1, unknown: 0 });
    assert.equal(allC2.status, "CRITICAL");
    assert.deepEqual(all.scope, { restaurantId: T.br.rest, branchIds: null, sampleLimit: 50 });
    assert.equal(all.checks.revenueOrdersWithoutItems.orders, 1, "the b2 revenue order without items");
    assert.deepEqual(all.checks.reconciliation.counts, { orders: 5, orderItems: 4, snapshots: 1 });

    // `branchId` is a hint that narrows the scope; `branchFilters` come from the
    // session. Either way the same branch-scoped WHERE clause is used.
    const byQuery = await report(T.br, { branchId: T.br.b1 });
    const byFilters = await report(T.br, {}, [T.br.b1]);
    for (const r of [byQuery, byFilters]) {
      const check = c2(r);
      assert.equal(check.items, 1);
      assert.deepEqual(buckets(check), { legacy: 0, before: 0, anomaly: 1, unknown: 0 });
      assert.equal(check.status, "CRITICAL", "b1 holds a real anomaly");
      assert.deepEqual(check.sampleOrderIds, [oid(T.br, "b1-open")]);
      assert.equal(
        check.firstObservedSnapshotAt,
        MARKER.toISOString(),
        "the marker is a TENANT-WIDE observation, even when another branch owns the snapshot"
      );
      assert.equal(check.snapshotPopulation, 1);
      assert.deepEqual(r.checks.reconciliation.counts, { orders: 1, orderItems: 1, snapshots: 0 });
      assert.equal(r.checks.revenueOrdersWithoutItems.orders, 0, "C1 is scoped to the branch");
      assert.equal(r.checks.revenueOrdersWithoutItems.status, "OK");
    }
    assert.deepEqual(byQuery.scope, { restaurantId: T.br.rest, branchIds: [T.br.b1], sampleLimit: 50 });
    assert.deepEqual(byFilters.scope, { restaurantId: T.br.rest, branchIds: [T.br.b1], sampleLimit: 50 });

    // An explicit branchId narrows even when the session authorizes another branch.
    const explicitWins = await report(T.br, { branchId: T.br.b1 }, [T.br.b2]);
    assert.deepEqual(explicitWins.scope.branchIds, [T.br.b1]);
    assert.equal(c2(explicitWins).items, 1);

    // A branch-scoped caller sees only its own branch's items — and its own,
    // branch-local verdict (b2 has no anomaly, only booked activation windows).
    const b2 = c2(await report(T.br, {}, [T.br.b2]));
    assert.equal(b2.items, 2);
    assert.deepEqual(buckets(b2), { legacy: 0, before: 2, anomaly: 0, unknown: 0 });
    assert.equal(b2.status, "UNKNOWN");
    assert.deepEqual(sorted(b2.sampleOrderIds), [oid(T.br, "b2-open-1"), oid(T.br, "b2-open-2")]);
  });

  // ------------------------------------------------------------------
  // 24. Cross-tenant data must not influence marker or classification
  // ------------------------------------------------------------------
  it("24. a cross-tenant snapshot claim influences neither marker nor buckets [§5.23]", async () => {
    const ra = await report(T.xa);
    const a = c2(ra);
    // The item is "covered" by a snapshot that claims ANOTHER tenant: the marker
    // read (which requires the order to agree on restaurantId) ignores it, and
    // the population LEFT JOIN (by orderItemId) still excludes the item.
    assert.equal(a.items, 0);
    assert.equal(a.markerSource, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(a.snapshotPopulation, 0);
    assert.equal(a.firstObservedSnapshotAt, null);
    assert.equal(a.disclosure?.code, "SNAPSHOT_POPULATION_EMPTY");
    assert.equal(a.status, "OK");
    assert.deepEqual(a.sampleOrderIds, []);

    // …but the reconciliation C3 flags it as a branch-scoped defect.
    const c3a = ra.checks.reconciliation;
    assert.deepEqual(c3a.counts, { orders: 1, orderItems: 1, snapshots: 1 });
    assert.equal(c3a.status, "CRITICAL");
    assert.equal(c3a.reconciled, false);
    assert.equal(c3a.branchReconciled, false);
    assert.equal(c3a.tenantReconciled, true);
    assert.deepEqual(
      c3a.violations.filter((v) => v.count > 0),
      [{ code: "SNAPSHOT_TENANT_MISMATCH", count: 1, scope: "BRANCH_SCOPED" }]
    );
    assert.deepEqual(c3a.sampleOrderIds, [oid(T.xa, "item")]);
    assert.equal(ra.overallStatus, "CRITICAL");

    // The claiming tenant and a clean third tenant stay untouched.
    const rb = await report(T.xb);
    const rc = await report(T.xc);
    assert.deepEqual(rb.checks.reconciliation.counts, { orders: 1, orderItems: 1, snapshots: 1 });
    assert.ok(rb.checks.reconciliation.violations.every((v) => v.count === 0));
    assert.equal(rb.checks.reconciliation.status, "OK");
    assert.equal(c2(rb).firstObservedSnapshotAt, D4.toISOString());
    assert.equal(c2(rb).items, 0, "X-B's report must not count X-A's order");
    assert.equal(rc.checks.reconciliation.status, "OK");
    assert.equal(c2(rc).firstObservedSnapshotAt, D5.toISOString());
    assert.equal(c2(rc).snapshotPopulation, 1);
  });

  // ------------------------------------------------------------------
  // 25. Deterministic repeatability + read-only
  // ------------------------------------------------------------------
  it("25. repeated runs are deterministic and the service writes nothing [§5.24]", async () => {
    const first = await report(T.fix);
    const second = await report(T.fix);
    assert.deepEqual(
      { ...first, generatedAt: "X" },
      { ...second, generatedAt: "X" },
      "two consecutive reports over the same data must be identical except for generatedAt"
    );
    const generated = new Date(first.generatedAt);
    assert.ok(!Number.isNaN(generated.getTime()), "generatedAt must be a valid timestamp");
    assert.equal(new Date(first.generatedAt).toISOString(), first.generatedAt);

    const beforeCounts = await snapshotCounts(prisma);
    const ledgerBefore = await cutoffLedgerRows();
    await report(T.fix, { sampleLimit: 5 });
    for (const key of ["empty", "fix", "bnd", "nocov", "br"]) {
      await report(T[key]);
    }
    const afterCounts = await snapshotCounts(prisma);
    assert.deepEqual(afterCounts, beforeCounts, "the integrity monitor must never write business rows");
    assert.deepEqual(await cutoffLedgerRows(), ledgerBefore);
  });

  // ------------------------------------------------------------------
  // 26. C1 — revenue orders without items
  // ------------------------------------------------------------------
  it("26. C1 follows the canonical revenue predicate and is CRITICAL on any hit [extra]", async () => {
    const r = await report(T.c1);
    const c1 = r.checks.revenueOrdersWithoutItems;

    assert.equal(c1.code, "REVENUE_ORDER_WITHOUT_ITEMS");
    assert.equal(c1.orders, 2, "PAID or refunded-payment orders only; UNPAID/CANCELLED excluded");
    assert.equal(c1.headerValue, 20000);
    assert.equal(c1.status, "CRITICAL");
    assert.deepEqual(sorted(c1.sampleOrderIds), [
      oid(T.c1, "paid-no-items"),
      oid(T.c1, "refunded-no-items"),
    ]);
    assert.equal(r.overallStatus, "CRITICAL");

    // The C1 set is independent of the C2 population (order without items has
    // no items to classify) but shares the same tenant scope.
    const check = c2(r);
    assert.equal(check.items, 1);
    assert.deepEqual(buckets(check), { legacy: 0, before: 0, anomaly: 1, unknown: 0 });
    assert.deepEqual(r.checks.reconciliation.counts, { orders: 5, orderItems: 1, snapshots: 0 });
  });

  // ------------------------------------------------------------------
  // 27. C3 — branch-scoped invariants
  // ------------------------------------------------------------------
  it("27. C3 detects order mismatches and snapshot overshoot within the declared scope [extra]", async () => {
    assert.equal(violationScope("SNAPSHOT_ORDER_MISMATCH"), "BRANCH_SCOPED");
    assert.equal(violationScope("SNAPSHOT_TENANT_MISMATCH"), "BRANCH_SCOPED");
    assert.equal(violationScope("SNAPSHOTS_EXCEED_ORDER_ITEMS"), "BRANCH_SCOPED");
    assert.equal(violationScope("ORPHAN_SNAPSHOT_ITEM"), "TENANT_WIDE");
    assert.equal(violationScope("SNAPSHOT_ORDER_MISSING"), "TENANT_WIDE");
    assert.equal(violationScope("DUPLICATE_SNAPSHOT_PER_ITEM"), "TENANT_WIDE");
    assert.equal(violationScope("SOMETHING_NEW"), "TENANT_WIDE", "unknown codes must widen, never narrow");

    // Branch b2: two snapshots over one order item.
    const b2 = await report(T.c3, { branchId: T.c3.b2 });
    const c3 = b2.checks.reconciliation;
    assert.deepEqual(c3.counts, { orders: 1, orderItems: 1, snapshots: 2 });
    assert.deepEqual(
      c3.violations.filter((v) => v.count > 0),
      [
        { code: "SNAPSHOT_ORDER_MISMATCH", count: 1, scope: "BRANCH_SCOPED" },
        { code: "SNAPSHOTS_EXCEED_ORDER_ITEMS", count: 1, scope: "BRANCH_SCOPED" },
      ]
    );
    assert.equal(c3.status, "CRITICAL");
    assert.equal(c3.branchReconciled, false);
    assert.equal(c3.tenantReconciled, true);
    assert.equal(c3.reconciled, false);
    assert.deepEqual(c3.sampleOrderIds, [oid(T.c3, "o2")]);
    assert.equal(b2.overallStatus, "CRITICAL");

    // Whole tenant: the overshoot disappears, the mismatch stays.
    const all = await report(T.c3);
    assert.deepEqual(all.checks.reconciliation.counts, { orders: 2, orderItems: 2, snapshots: 2 });
    assert.deepEqual(
      all.checks.reconciliation.violations.filter((v) => v.count > 0),
      [{ code: "SNAPSHOT_ORDER_MISMATCH", count: 1, scope: "BRANCH_SCOPED" }]
    );
    assert.equal(all.checks.reconciliation.status, "CRITICAL");
    assert.equal(all.checks.reconciliation.tenantReconciled, true);

    // Scope partitioning is the pure `partitionViolations` contract.
    const partitioned = partitionViolations([
      { code: "SNAPSHOT_ORDER_MISMATCH", count: 2 },
      { code: "ORPHAN_SNAPSHOT_ITEM", count: 3 },
    ]);
    assert.deepEqual(partitioned.branchScoped, [
      { code: "SNAPSHOT_ORDER_MISMATCH", count: 2, scope: "BRANCH_SCOPED" },
    ]);
    assert.deepEqual(partitioned.tenantWide, [
      { code: "ORPHAN_SNAPSHOT_ITEM", count: 3, scope: "TENANT_WIDE" },
    ]);
    assert.deepEqual(deriveReconciliation(0, 3), {
      branchReconciled: true,
      tenantReconciled: false,
      reconciled: false,
    });
  });

  // ------------------------------------------------------------------
  // 28. C3 — tenant-wide invariants + sample scoping (test-schema-only rows)
  // ------------------------------------------------------------------
  it("28. tenant-wide invariants are reported tenant-wide and never leak as branch samples [extra]", async () => {
    try {
      const all = await report(T.c3w);
      const c3 = all.checks.reconciliation;
      // The two incoherent snapshot rows are reachable on this schema only
      // through the FK-disabled fixture writer ([F-5]); the application database
      // (and this one, through Prisma) rejects both.
      assert.deepEqual(c3.counts, { orders: 1, orderItems: 1, snapshots: 1 });
      assert.deepEqual(
        c3.violations.filter((v) => v.count > 0),
        [
          { code: "ORPHAN_SNAPSHOT_ITEM", count: 1, scope: "TENANT_WIDE" },
          { code: "SNAPSHOT_ORDER_MISSING", count: 1, scope: "TENANT_WIDE" },
        ]
      );
      assert.equal(c3.status, "CRITICAL");
      assert.equal(c3.branchReconciled, true, "no BRANCH_SCOPED invariant is violated");
      assert.equal(c3.tenantReconciled, false);
      assert.equal(c3.reconciled, false);
      assert.deepEqual(
        c3.sampleOrderIds,
        [oid(T.c3w, "o")],
        "only the invariant with a joinable order yields a sample id"
      );

      // A branch-scoped caller must NEVER receive tenant-wide samples.
      const scoped = await report(T.c3w, { branchId: T.c3w.b1 });
      assert.deepEqual(scoped.checks.reconciliation.sampleOrderIds, []);
      assert.equal(
        scoped.checks.reconciliation.tenantReconciled,
        false,
        "the tenant-wide verdict is still reported (never silently merged away)"
      );
      assert.equal(scoped.checks.reconciliation.branchReconciled, true);

      // F1 — the pure selector encodes the same rule.
      assert.deepEqual(
        selectSampleOrderIds({
          branchScopedOrderIds: ["b-1", "b-2"],
          tenantWideOrderIds: ["t-1"],
          branchFilterActive: true,
          limit: 10,
        }),
        ["b-1", "b-2"]
      );
      assert.deepEqual(
        selectSampleOrderIds({
          branchScopedOrderIds: ["b-1", "b-2"],
          tenantWideOrderIds: ["t-1", "b-1"],
          branchFilterActive: false,
          limit: 3,
        }),
        ["b-1", "b-2", "t-1"],
        "de-duplicated, capped, tenant-wide ids only for a whole-tenant caller"
      );

      // C2: the item covered by the order-less snapshot is not in the population.
      assert.equal(c2(all).items, 0);
      assert.equal(c2(all).snapshotPopulation, 1, "the marker counts only snapshots that join a real order");
    } finally {
      // These two rows are not reachable by the run-scoped cleanup, so the test
      // removes them itself (and the pre-run/after counts prove it).
      await prisma.orderItemCostSnapshot.deleteMany({
        where: { id: { in: [L("snap-c3w-orphan"), L("snap-c3w-order-missing")] } },
      });
    }
    const left = await prisma.orderItemCostSnapshot.count({
      where: { id: { in: [L("snap-c3w-orphan"), L("snap-c3w-order-missing")] } },
    });
    assert.equal(left, 0, "the test-schema-only fixtures must be removed");
    const after = await report(T.c3w);
    assert.equal(after.checks.reconciliation.status, "OK");
    assert.deepEqual(after.checks.reconciliation.counts, { orders: 1, orderItems: 1, snapshots: 0 });
  });

  // ------------------------------------------------------------------
  // 29. Query contract
  // ------------------------------------------------------------------
  it("29. the query contract validates and echoes the caller's scope [extra]", async () => {
    for (const bad of [{ sampleLimit: 0 }, { sampleLimit: 51 }, { sampleLimit: "abc" }, { branchId: "" }]) {
      await assert.rejects(
        () => getIntegrityReport(T.val.rest, bad),
        (err: unknown) => err instanceof ValidationError,
        `${JSON.stringify(bad)} must be rejected`
      );
    }

    const defaulted = await getIntegrityReport(T.val.rest, {});
    assert.equal(defaulted.scope.sampleLimit, 10, "the default sample limit is 10");
    const echoed = await report(T.val, { branchId: T.val.b1, sampleLimit: 7, unknownKey: true } as never);
    assert.deepEqual(echoed.scope, {
      restaurantId: T.val.rest,
      branchIds: [T.val.b1],
      sampleLimit: 7,
    });
    assert.equal(c2(defaulted).items, 2, "both branches together");
    assert.equal(c2(echoed).items, 1, "the explicit branchId narrows to branch 1");

    // The tenant is never accepted from the client: it is not part of the schema.
    assert.equal(
      Object.prototype.hasOwnProperty.call(IntegrityQuerySchema.shape, "restaurantId"),
      false,
      "restaurantId must never be a client-supplied query parameter"
    );
  });

  // ------------------------------------------------------------------
  // 30. STEP 2C.5 — deterministic ledger selection (M-1) and the naive
  //     DATETIME normalization used for the cutoff (M-2), against the LIVE ledger
  // ------------------------------------------------------------------
  it("30. the cutoff row is selected deterministically and the naive literal normalizes to UTC [2C.5]", async () => {
    const rows = await cutoffLedgerRows();
    assert.equal(rows.length, 1, "[M-1] one F.5 ledger row");
    const row = rows[0]!;

    // M-1 — eligibility + deterministic selection over the real ledger.
    const selection = selectLegacyCutoff(rows.map(toLedgerRow));
    assert.equal(selection.rowsRead, 1, "[M-1] one row read");
    assert.equal(selection.eligibleRows, 1, "[M-1] the genuine row is eligible");
    assert.equal(selection.appliedAt?.toISOString(), CUTOFF.toISOString());

    // M1-R — one eligible row is unambiguous: no disclosure, classification intact.
    const check = c2(await report(T.val));
    assert.equal(check.cutoffDisclosure, null, "[M1-R] one eligible row → no ambiguity disclosure");
    assert.equal(check.cutoff.resolved, true);
    assert.equal(check.cutoff.appliedAt, CUTOFF.toISOString());
    assert.equal(check.cutoff.codeDeployUnproven, true);

    // M-2 — three readings of the SAME stored value.
    const prismaRead = row.finishedAt!.getTime();
    const explicitUtc = parseNaiveUtcDateTime(row.finishedAtLiteral!).getTime();
    assert.equal(explicitUtc, prismaRead, "[M-2] explicit UTC parse == Prisma adapter read");

    const url = new URL(process.env.DATABASE_URL!);
    const rawConn = await createConnection({
      host: url.hostname,
      port: Number(url.port || "3306"),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.replace(/^\//, ""),
    });
    try {
      // READ-ONLY: the raw driver is used ONLY to document its (different)
      // interpretation. It must never supply a cutoff or be compared with a
      // Prisma value in production code.
      const [rawRow] = await rawConn.query(
        "SELECT finished_at FROM _prisma_migrations WHERE migration_name = ?",
        [LEGACY_CUTOFF_MIGRATION]
      );
      const rawRead = new Date(rawRow.finished_at).getTime();
      assert.equal(
        rawRead,
        prismaRead + new Date().getTimezoneOffset() * 60_000,
        "[M-2] the raw driver re-interprets the naive literal in the PROCESS time zone " +
          "(documented; identical to the adapter read only when the process runs in UTC)"
      );
    } finally {
      await rawConn.end().catch(() => undefined);
    }

    // The comparison the SERVICE performs: the stored literal vs the bound Date.
    const [cmp] = await prisma.$queryRaw<Array<{ eq: number | bigint }>>`
      SELECT (CAST(${row.finishedAtLiteral} AS DATETIME(3)) = CAST(${CUTOFF} AS DATETIME(3))) AS eq
    `;
    assert.equal(Number(cmp!.eq), 1, "[M-2] the cutoff binds back to the identical stored literal");
  });
});
