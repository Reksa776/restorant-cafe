# Test Infrastructure Documentation

## Overview

This directory contains integration test infrastructure for the Accounting module.

## Directory Structure

```
tests/
├── README.md                        # This file
├── setup.ts                         # Test environment bootstrap (fail-closed)
├── fixtures/
│   └── accounting.ts                # Test data factories + run cleanup helpers
└── accounting/
    ├── cashbook.integration.test.ts             # STEP 2B.1 — Cashbook (15 tests, PASS)
    ├── revenue.integration.test.ts              # STEP 2B.2 — Revenue & Reporting (21 tests, PASS)
    ├── refund-profitability.integration.test.ts # STEP 2B.3 — Refund & Profitability (21 tests, PASS)
    ├── pnl.integration.test.ts                  # STEP 2B.4 — P&L (24 tests, PASS)
    └── integrity.integration.test.ts            # STEP 2B.5 / STEP 2C.5 — M2 Integrity SQL (30 tests, PASS)
```

Totals: **111** accounting integration tests (Cashbook 15, Revenue 21, Refund & Profitability 21,
P&L 24, M2 Integrity 30), plus the F-2 approved-target suite
(`tests/database-connection.integration.test.ts`, 4 tests) and two DB-free unit suites:
**78** in `src/services/accounting/integrity.unit.test.ts` (the 57 M2 baseline + 21 STEP 2C.5
cutoff tests) and **24** in `src/lib/database-url.unit.test.ts`.

## Test target (STEP 2C.2F) — the ONLY approved database

The integration suites run against **one** disposable database on the isolated
container already published on the host as **127.0.0.1:3308**:

| Target | Purpose | Status |
|--------|---------|--------|
| `127.0.0.1:3308/restaurant_app_test_v3` | `restaurant_test_v3` — the approved integration target, provisioned by a real `prisma migrate deploy` (22 migration ledger rows, all 49 tables, genuine F.5 row) | **ACTIVE** |
| `127.0.0.1:3308/restaurant_app_test` | legacy isolated test DB (v1) — `[F-4]` hybrid, 6 ledger rows, no F.5 row | preserved read-only |
| `127.0.0.1:3308/restaurant_app_test_v2` | failed STEP 2C.2B evidence DB | preserved read-only, never written |
| `127.0.0.1:3306/restaurant_app` | shared **host** application database | PROTECTED |
| `127.0.0.1:3307` | sibling project `restorant-cafe2`'s container | PROTECTED (different project) |

The switch is a **single edit** in the gitignored `.env.test` (`TEST_DATABASE_URL`
+ `DATABASE_URL`); the v1/v2 URLs stay in that file as inert `LEGACY_TEST_V1_URL` /
`DISPOSABLE_TEST_V2_URL` lines so the change can be rolled back by swapping two
lines. Nothing in the v1/v2 databases is dropped, altered or recreated by this
phase. See `ACCOUNTING-INTEGRATION-TEST-PLAN.md` §27.

## Running Tests

`tests/setup.ts` imports `@/...` paths, so the tests run through **tsx** (Node's
native type stripping does not resolve `tsconfig` path aliases), from the
**project root** — and **one suite file at a time**, because each suite asserts
that every monitored table returns to its pre-run count (Node runs multiple test
*files* in parallel, which would break that measurement):

```bash
# Cashbook integration suite (real MariaDB, isolated test DB)
npx tsx --test tests/accounting/cashbook.integration.test.ts

# Revenue & Reporting integration suite
npx tsx --test tests/accounting/revenue.integration.test.ts

# Refund & Profitability integration suite
npx tsx --test tests/accounting/refund-profitability.integration.test.ts

# P&L integration suite
npx tsx --test tests/accounting/pnl.integration.test.ts

# M2 integrity (SQL) integration suite
npx tsx --test tests/accounting/integrity.integration.test.ts

# TypeScript check
npx tsc --noEmit
```

No `--env-file` flag is needed: the bootstrap loads `.env.test` itself.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TEST_DATABASE_URL` | Yes | MySQL connection URL for the approved test target (`127.0.0.1:3308/restaurant_app_test_v3` — any other target is **refused**) |
| `DATABASE_URL` | Yes | Must resolve to the **same** approved target — the bootstrap refuses a disagreeing pair instead of preferring one |
| `NODE_ENV` | No | Must NOT be `"production"` |
| `TEST_DB_EXPECTED_PORT` | No | Expected test-DB host port for the identity assertion (default `3308`) |

`.env.test` (gitignored) is loaded automatically when `TEST_DATABASE_URL` is not
already exported. See `.env.test.example`.

## Safety Measures

`tests/setup.ts` must be the **first import** of every integration test file:

1. **Production prevention** — fails if `NODE_ENV=production`.
2. **Isolation requirement** — fails when `TEST_DATABASE_URL` is missing, names a
   production database (`restaurant_app`, `production`, `main`, `app`), or when it
   equals `DATABASE_URL` outside `NODE_ENV=test`.
3. **Credential guard** — fails when `TEST_DATABASE_URL` credentials are
   percent-encoded (`%2B`, `%3D`, …). **STEP 2C.4 (F-2) fixed the cause**:
   `src/lib/database-url.ts` decodes the credentials exactly once and
   `src/lib/prisma.ts` hands the decoded pair to the driver, so an encoded
   credential now authenticates normally. The guard is deliberately KEPT as
   defence-in-depth: it fails fast on a URL the parser would mis-handle instead of
   degrading into a confusing `pool timeout`. See `src/lib/database-url.unit.test.ts`
   and the F-2 suite above.
4. **Database pinning** — `DATABASE_URL` is re-pointed at `TEST_DATABASE_URL`
   before any service/prisma import. The application Prisma singleton therefore
   can never open the application database during a test run, even if the ambient
   `DATABASE_URL` points there. A warning is logged when the ambient value differed.
5. **Runtime identity assertion** — the suite asserts through SQL
   (`SELECT DATABASE()`) that the live connection really is the test database.
6. **Approved-target guard (STEP 2C.2F, centralised here — never only in a suite)** —
   *after* the legacy checks above, both effective URLs must parse to **exactly**
   scheme `mysql`, host `127.0.0.1` (`localhost` is rejected on purpose: it can
   resolve to `::1` or to another daemon), port `3308`, database
   `restaurant_app_test_v3` and user `restaurant_test_v3`; a missing, empty, URL-shaped
   or disagreeing pair is a refusal, not a warning.
7. **Protected targets rejected by name AND by port** —
   `restaurant_app`, `restaurant_app_test`, `restaurant_app_test_v2`,
   `production`, `main`, `app`; ports `3306` (shared host MariaDB) and `3307`
   (sibling project). The guard runs at import time, before any Prisma client exists.
8. **Live half of the guard** — `assertLiveTestTarget(prisma)` (exported from this
   module and called by every suite's safety test) runs
   `SELECT DATABASE(), USER(), @@hostname, @@port, VERSION()` on the connection the
   suite actually opened and requires the approved database name, the dedicated
   account and a MariaDB server. `@@port` is deliberately not asserted: inside the
   container the server always listens on 3306, the host-side mapping was already
   enforced from the URL.

**Credentials are never printed**: the bootstrap logs the parsed host, database and
username only (no password, no userinfo), and `SHOW GRANTS` output is never echoed
(the `USAGE` line carries a password hash).

## Cashbook Integration Suite (STEP 2B.1)

15 tests (1 safety assertion + the 14 required scenarios), all real Prisma/MariaDB
queries against `src/services/accounting/cashbook.service.ts` — no mocked
aggregation:

1. single PAID payment
2. split tender / multiple collected payments (counted once each)
3. duplicate collection callback does not double count
4. `PaymentTransaction` is never an extra cash movement
5. partial approved refund
6. full approved refund
7. `PENDING` / `REJECTED` refunds do not reduce the Cashbook
8. expense dated by `spentAt`
9. payment dated by `paidAt`
10. refund dated by `approvedAt`
11. tenant isolation
12. branch isolation (`authorizedBranches`; out-of-scope `branchId` is rejected)
13. empty date range
14. cross-period behaviour

### Date semantics (do not "fix" these)

Cashbook recognises money on its **cash movement date**:
`Payment.paidAt`, `Refund.approvedAt`, `Expense.spentAt` — never `createdAt` and
never the order date. Cashbook and Revenue are therefore **not required to match**
for the same calendar period (order created Sep 30 + collected Oct 1 → Cashbook
sees Oct 1). The tests assert this existing rule.

### Test isolation & cleanup

* Every fixture id carries a unique run prefix (`cbt-…`).
* `cleanupRun()` deletes child-first with explicit sequential `deleteMany`
  statements (no long interactive transaction, no `TRUNCATE`, nothing outside the
  run's own rows). Rows written by production services (`PaymentTransaction`,
  `AuditLog`) are reached through their parent ids.
* `findResiduals()` re-counts run-scoped rows afterwards (must all be 0) and the
  suite asserts every monitored table returned to its **pre-run count**.

## Revenue & Reporting Integration Suite (STEP 2B.2)

19 tests (1 safety assertion + 18 scenarios) against the canonical revenue engine
in `src/services/report/report.service.ts` — real Prisma/SQL, no mocked aggregation:

1. UNPAID order excluded
2. PENDING payment excluded
3. FAILED payment excluded
4. EXPIRED payment excluded
5. PAID payment on an eligible order included
6. CANCELLED order excluded even with PAID/REFUNDED payment rows
7. multiple payment attempts do not multiply order revenue
8. `PaymentTransaction` callbacks neither multiply revenue nor add refund impact
9. collected-then-refunded order stays in revenue via its REFUNDED payment
10. partial refund attributed to its approval date, on the product basis
11. full refund nets the order to zero (never negative)
12. revenue filtered by `Order.createdAt`
13. a collection in another period does not move revenue into that period
14. tenant isolation
15. branch isolation through the `branchFilters` contract
16. empty date range → zeros + densified empty series
17. server-side totals/aggregations agree with the fixture values
18. Prisma `revenueWhere` and the SQL reporting predicates agree on identical data

### Revenue semantics asserted (do not "fix" these)

* **Revenue set** = non-`CANCELLED` order **and** (`Order.paymentStatus = 'PAID'`
  **or** an existing `Payment.status = 'REFUNDED'`). The order mirror the payment
  engine writes is authoritative — a PAID payment row whose order mirror is not
  PAID (and with no REFUNDED payment) is **not** revenue.
* **Order-date attribution** for sales (`Order.createdAt`); **approval-date
  attribution** for refund impact (`Refund.approvedAt`) with a date-free order
  scope. A period containing only refund impact can legitimately show a negative
  `netSales`.
* Cashbook (cash movement dates) and Revenue (order date) are intentionally **not**
  required to match in the same calendar period.
* `filters.status` never changes revenue totals; branch scoping comes from
  `branchFilters` (session-resolved), not from `filters.branchId`.
* Known recorded discrepancies (not test failures): two raw sub-reports still filter
  `paymentStatus = 'PAID'` only, so a fully-refunded order appears in
  `dailySeries`/`totalSales`/`bestSellingProducts` but not in those buckets:
  `busiestHours` (§17.3 **A-9**) and the `getProductReport` product rows, which also
  list such a product as "unsold" (§21.4 **A-11** — found in the STEP 2C.1 audit, no
  test covers `getProductReport` yet). Both are `Must fix` release blockers.

## Refund & Profitability Integration Suite (STEP 2B.3)

21 tests covering required items 1–21 (item 1 **is** the runtime-identity assertion)
driving the **real** refund
state machine (`src/services/approval/approval.service.ts`) and the **real**
profitability read model (`src/services/profitability/profitability.service.ts` +
`coverage.ts`) through Prisma/MariaDB — no mocked aggregation:

1. runtime test-DB identity (SQL)
2. valid partial refund request + approval
3. full refund request + approval (`Payment` → `REFUNDED`, order mirror → `UNPAID`)
4. over-refund and ineligible requests rejected (amount, reason, UNPAID order, CANCELLED order)
5. Σ approved refunds can never exceed the collected amount
6. duplicate approval applies nothing twice
7. concurrent approvals (and concurrent requests) cannot over-refund
8. `PENDING` / `REJECTED` refunds never reduce recognized totals
9. refund impact attributed to `Refund.approvedAt`, not the order date
10. `PaymentTransaction` mirror rows never double-count a refund
11. quantity-based partial refund (amount derived server-side, exact frozen COGS)
12. full item refund with a historical COGS snapshot (frozen, but **no** release)
13. legacy amount-only refund without `RefundItem`
14. write-side frozen COGS vs read-side reversal consistency
15. profitability uses the historical snapshot, never the current/manual HPP
16. missing snapshot coverage → INCOMPLETE coverage and `null` profit
17. explicit zero historical HPP ≠ missing HPP
18. fractional refund amounts and pro-rata COGS round deterministically
19. tenant isolation (report + service)
20. branch authorization/isolation via the `branchFilters` contract
21. empty dataset + cleanup verification

### Refund / profitability semantics asserted (do not "fix" these)

* **Eligibility**: refundable = Σ collected payments (`PAID` | `REFUNDED`) − Σ `APPROVED`
  refunds; one `PENDING` refund per order (atomic under a `FOR UPDATE` order lock);
  reason ≥ 5 chars; CANCELLED orders and orders without collected money are refused.
* **Quantity allocations**: prices come from the DB
  (`round2(OrderItem.totalPrice / quantity × qty)`); a client-supplied `amount` is
  ignored when items are present; remaining = purchased − already-approved allocations.
* **Approval side effects**: exactly one negative `PaymentTransaction` mirror; payments
  become `REFUNDED` only when the order is fully refunded; the order mirror returns to
  `UNPAID` at `netPaid ≤ MONEY_EPSILON`; a **sequential** repeat decision → 404
  (`PENDING` pre-read), a **racing** repeat → 409 (guarded transition).
* **COGS coverage** is decided by snapshot **status**, never by value: an explicit
  `SNAPSHOTTED` 0 is COVERED; an empty scope is `NO_ITEMS`; a COMPLETED order without a
  snapshot is `LEGACY`; profit is `null` whenever coverage is incomplete.
* **Refund-aware COGS release happens only for PARTIAL refunds** — a fully refunded order
  keeps all incurred COGS (`netSales` 0 with `retainedCogs > 0`). Item-based refunds use
  the frozen `RefundItem.reversedCogs`; legacy amount-only refunds use the documented
  **pro-rata approximation** (no write-side ledger exists for them).

### Window design

Read-side scenarios each own a calendar day; service-driven scenarios share “today” but
use unique product ids and scope their read-side assertions to the **product row**
(`filters.productId` narrows product rows only — summary aggregates stay window-wide).

## P&L Integration Suite (STEP 2B.4)

24 tests — the 22 requested scenarios plus 2 audited extras (test 18 expense-window
boundary, test 24 query contract + canonical composition); item 1 is the runtime-identity
assertion. Mapping requested items → tests: 1–17 → 1–17, 18 → 19, 19 → 20, 20 → 21,
21 → 22, 22 → 23 — all driving the **real** P&L read-model (`getPnlReport` in `src/services/accounting/pnl.service.ts`),
which composes the canonical Profitabilitas engine (revenue/net sales/COGS/gross profit)
with the `Expense` table (operating expenses) — real Prisma/SQL, no mocked aggregation:

1. runtime test-DB identity (SQL)
2. empty period (zeros, `NO_ITEMS`, `grossProfit`/`netProfit` null)
3. single paid eligible order + expense → gross/net profit
4. multiple paid orders + two expense categories
5. UNPAID/PENDING/FAILED/EXPIRED exclusion + `unpaidCompleted` disclosure
6. CANCELLED order exclusion (expenses still recognised, profit unknown)
7. multiple payment attempts never multiply revenue
8. gross sales / tax / service charge / discount / **net-sales product basis**
9. historical snapshot COGS, never the current/manual HPP
10. complete coverage → gross profit and derived margins
11. missing (`LEGACY`) and partial (`PARTIAL`) coverage → `null` profit
12. explicit zero historical HPP is a real cost (COVERED, not null)
13. partial item-based refund (real approval service) → exact frozen reversal
14. full item-based refund → netSales 0 with ALL COGS retained (negative profit)
15. legacy amount-only refund → pro-rata reversal applied once
16. refund-only period (approval-date attribution) + cross-period partition
17. expenses recognised by `spentAt` only (never `createdAt`)
18. the expense window is the whole local day of the period
19. multi-order P&L with categorised expenses (exact amounts + margins)
20. rounding/decimal precision (fractional refund + 1-cent expenses)
21. tenant isolation (report + branch scope)
22. branch isolation/authorization (`branchFilters` scopes; `branchId` is a hint)
23. cross-period order/payment/refund/expense (+ Cashbook divergence evidence)
24. query contract (validation + filters) and P&L ≡ Profitabilitas composition

### P&L semantics asserted (do not "fix" these)

* The P&L read-model **writes nothing** and adds no engine: `grossSales`/`netSales`/
  COGS/coverage/refund state come from the canonical Profitabilitas summary, so the two
  can never diverge; `pagination limit 1` trims only the product table.
* `Gross Profit = netSales − retainedCogs`; **`Net Profit = Gross Profit − Operating
  Expenses`, and stays `null` whenever Gross Profit is `null`** (never `revenue − 0`).
* Refunds are attributed to `Refund.approvedAt`; a refund-only period is legitimately
  negative and has no verifiable COGS (`NO_ITEMS` → unknown profit).
* Expenses use `spentAt` only (local calendar day); the expense window is widened to the
  **end of the period's last local day**, while the revenue window ends at "now" for
  `today`.
* The P&L contract exposes **no margin percentage** — margins are derived arithmetic,
  asserted against fixed expected values in the tests.

## Test Types

| Type | Location | Database Required |
|------|----------|-------------------|
| Unit Tests | `src/**/*.unit.test.ts` | No |
| Integration Tests | `tests/accounting/**/*.test.ts` | Yes (isolated test DB) |

## M2 Integrity Suite (STEP 2B.5)

29 tests against the READ-ONLY integrity read-model
(`src/services/accounting/integrity.service.ts` → `getIntegrityReport`) with real
Prisma/MariaDB — no mocked aggregation. Required coverage item → test:
1→1, 2→2, 3→4, 4→5, 5→6, 6→7, 7→8, 8→9, 9→10, 10→11, 11→12, 12→13, 13→14, 14→15,
15→16, 16→17, 17→18, 18→19, 19→20, 20→21, 21→22, 22→23, 23→24, 24→25; extras: test 3
(environment gap), 26 (C1 revenue orders without items), 27 (C3 branch-scoped invariants),
28 (C3 tenant-wide invariants + sample scoping), 29 (query contract).

The suite pins the audited rules: C2 population = COMPLETED items without a snapshot,
completion = `MIN(orderstatushistory.createdAt) WHERE status='COMPLETED'`, cutoff = the F.5
migration apply time from `_prisma_migrations`, and the observed tenant-wide marker
(`MIN(snapshot.completedAt)` with the tenant-consistency predicate) which may only carve the
deployment window when it is strictly newer than the cutoff. Buckets always partition
`items`; `statusCutoffOnly` exposes the marker-free verdict; no evidence field can change a
severity.

### Genuine F.5 cutoff — no fixture ledger row any more (STEP 2C.2F, M-1/M-2 finalized in STEP 2C.5)

The approved target `restaurant_app_test_v3` was provisioned by a real
`prisma migrate deploy` (STEP 2C.2E), so it **has** the genuine F.5 row in
`_prisma_migrations` (`20260911143644_f5_order_item_cost_snapshot`, stored
`finished_at` `2026-10-14 07:52:58.220` → `2026-10-14T07:52:58.220Z`) — the `[F-4]` gap that forced the old v1 workaround is
closed there. Consequences for the suite:

* `resolveLegacyCutoff()` resolves a **real** cutoff, and the cutoff every test uses
  **is** that ledger row's `finished_at`. Nothing is inserted, mirrored or updated:
  the old reversible ledger-row install/remove `describe` is **gone**, and the
  ledger is asserted to hold **exactly one** such row before and after every test
  (`[M-1]`: the read is deterministic *by construction* — eligible rows only,
  ordered `finished_at ASC, id ASC`, and more than one eligible row is disclosed
  instead of hidden; see below).
* Test 3 was re-baselined from the degraded fallback (`resolved:false`, every item
  `unknownCompletion`, overall `WARN`) to the **resolved** path (`appliedAt` = the
  ledger's own `finished_at`, `resolved:true`, real buckets, overall `CRITICAL`).
  The unresolved-cutoff contract is still pinned — in the pure-rules layer of
  `integrity.unit.test.ts`, where a `null` cutoff is deterministic.
* **Timezone (M-2, finalized in STEP 2C.5)**: `finished_at` is a naive `DATETIME(3)`
  whose stored literal is **UTC wall clock** (measured: the F.5 literal
  `2026-10-14 07:52:58.220` matches the replay's own `information_schema.CREATE_TIME`
  instant while the session time zone is UTC). It is therefore interpreted
  **explicitly as UTC** by `parseNaiveUtcDateTime()` — the same instant the Prisma
  driver adapter reports, so the cutoff value is unchanged — and the parse never
  reads the process time zone. The raw `mariadb` driver re-interprets the same
  literal in the PROCESS time zone (7 h off on this host) and must never supply a
  cutoff or be compared with a Prisma value. The suite still derives every fixture
  instant by **millisecond offsets** from the resolved cutoff (`at()`), which keeps
  the boundary equalities (`mand-5 === cutoff`, `mand-7 === marker`, `marker ± 1 ms`)
  exact in any server timezone. The eight-row fixture
  (`legacy 3 / before 2 / anomaly 2 / unknown 1`), the mandated marker and the
  sample set are unchanged.
* **Eligibility, determinism, ambiguity (M-1 / M1-R, STEP 2C.5)**: the ledger read
  returns **every** row for the migration (no `LIMIT 1`, no `ORDER BY` in SQL) and
  the pure `selectLegacyCutoff()` decides eligibility
  (`finished_at IS NOT NULL AND rolled_back_at IS NULL`), orders deterministically
  (`finished_at ASC, id ASC`) and uses the **earliest** eligible apply instant.
  `started_at` is never a fallback. One eligible row is unambiguous; more than one is
  **disclosed** through the additive `cutoffDisclosure` field
  (`LEGACY_CUTOFF_AMBIGUOUS`) rather than silently treated as proven — it is
  display-only metadata and never an input to a severity rule.

## Adding New Tests (STEP 2B.5+)

1. Create the test file in `tests/accounting/`.
2. Import `../setup` **first** (safety + DB pin), then the service under test. The
   first import is `import { assertLiveTestTarget, EXPECTED_TEST_DB } from "../setup";`
   and the suite's safety test must `await assertLiveTestTarget(prisma)` — the
   import-time guard protects the target, the live call proves which connection the
   suite actually opened.
3. Reuse the factories in `tests/fixtures/accounting.ts`
   (`createRestaurantFixture`, `createBranchFixture`, `createUserFixture`,
   `createCustomerFixture`, `createOrderFixture`, `createPaymentFixture`,
   `createPaymentTransactionFixture`, `createRefundFixture`,
   `createOrderItemCostSnapshotFixture`, `createOrderStatusHistoryFixture`,
   `createBranchProductFixture`, `createExpenseCategoryFixture`, `createExpenseFixture`,
   `createCategoryFixture`, `createProductFixture`, `createOrderItemFixture`, …).
   Always set `completedAt` explicitly on a snapshot when the M2 marker matters — the column
   defaults to `now()`.
4. Give every row a run-prefixed id and clean up with `cleanupRun()` +
   `findResiduals()` in an `after()` hook. `createRefundFixture()` returns `void` —
   keep your own refund id if a test needs to query the rows it created.
5. Assert product-level values in shared windows and whole-window totals only in a
   dedicated single-order day (refunds bring COGS reversal, so windows are not
   additive).

**Note:** the older helpers `createTestOrder`, `createOrderWithItemAndSnapshot`,
`createFullRefund` and `createLegacyRefund` predate the working database fixtures
and do **not** satisfy the required FKs (`restaurantId`, `Order.customerId`) — they
must be re-based on the tenant/customer fixtures above before they can run against
a real database.

---

**Status:** STEP 2B.1 Cashbook (15/15), STEP 2B.2 Revenue & Reporting (19/19),
STEP 2B.3 Refund & Profitability (21/21), STEP 2B.4 P&L (24/24) and STEP 2B.5 M2 Integrity
(29/29) integration tests implemented and passing against the isolated MariaDB test database
(**108 tests total**).

**STEP 2C.1 — final cross-module evidence audit (read-only):** no suite was re-run. The audit
reviewed 108/108 + 57/57 as *reported* evidence (production services, real SQL, tenant
isolation, cleanup proof) and issued the release verdict **NOT READY FOR PRODUCTION**. Open blockers: **A-9**, **A-11 (new)**
and **F-2** (must fix); **F-4**, **F-5** and **F-6 (new)** (must verify). The isolated test
schema is a hybrid — it has all 49 tables but only 55 of the application DB's 105 FK columns
(`orderitemcostsnapshot` 0 vs 5) and only the first 6 migration ledger rows (no F.5) — see
`ACCOUNTING-INTEGRATION-TEST-PLAN.md` §21.5. Restoring test-DB parity requires re-running all
five suites and re-baselining M2 test 3 (STEP 2C.2, not started).
