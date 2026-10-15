# Accounting Integration Test Plan

**Date:** 2026-10-14  
**Project:** /home/reksa/restorant-cafe  
**Latest phase:** STEP 2C.3A — A-9 & A-11 REPORTING CONSISTENCY AUDIT (strict audit, no code change)  
**Status:** ✅ **AUDIT COMPLETE — 3 drift sites confirmed, 1 NEW** — A-9 `busiestHours` (`report.service.ts:1354`), A-11 `getProductReport` product rows (`:1798`) and **A-12 NEW** `getMultiOutletReport` per-branch order-type breakdown (`:2479`) all filter `paymentStatus = 'PAID'` instead of composing the canonical `revenueSetSql` (`:545`); **6** further inline duplicates catalogued; root cause = predicate drift triggered by the refund side-effect (`Payment → REFUNDED` + order mirror `→ UNPAID`, `approval.service.ts:502–528`); fix = **3 lines in one file**, no schema/data/security change; 10-row test matrix + 6 invariants prepared; **no production or test file touched — awaiting approval for 2C.3B**  
**Previous phases:** STEP 2C.2F Test-env v3 migration & full regression ✅ (108/108 + 57/57, exit 0) · STEP 2C.2E Fresh migration replay ✅ (22/22, exit 0) · STEP 2C.2D F-7 repair patch ✅ (Option A applied, 4 files) · STEP 2C.2C F-7 repair strategy audit ✅ (Option A) · STEP 2C.2B Fresh isolated DB ⛔ (P3018) · STEP 2C.2A Topology preflight ✅ · STEP 2C.1 Final evidence audit ✅ · STEP 2B.5 M2 Integrity ✅ · STEP 2B.4 P&L ✅ · STEP 2B.3 Refund & Profitability ✅ · STEP 2B.2 Revenue ✅ · STEP 2B.1 Cashbook ✅ · STEP 2A.5-F Final database safety verification ✅  
**Production readiness:** 🚫 **NOT READY FOR PRODUCTION** — audit done, fix not applied (**A-9, A-11, A-12**); **F-7 fixed & proven**, **F-4 resolved and exercised**; still must fix F-2; must decide F-5 (apply-time cutoff), verify F-6 (deployed target UNKNOWN), resolve F-8 (5-table collation drift); M-1/M-2 open (M-2 evidence in §27.7)

> Sections 1–15 document STEP 2A.5-F (historical), §16 documents STEP 2B.1 (Cashbook),  
> §17 documents STEP 2B.2 (Revenue & Reporting), §18 documents STEP 2B.3  
> (Refund & Profitability), §19 documents STEP 2B.4 (Profit & Loss), §20 documents  
> STEP 2B.5 (M2 Integrity SQL), §21 documents STEP 2C.1, §22 documents STEP 2C.2A,  
> §23 documents STEP 2C.2B (stopped), §24 documents STEP 2C.2C (F-7 repair strategy audit),  
> §25 documents STEP 2C.2D (F-7 repair patch), §26 documents STEP 2C.2E (fresh migration  
> replay & schema parity), §27 documents STEP 2C.2F (test-env v3 migration & full  
> regression), and **§28 — STEP 2C.3A — REPORTING PREDICATE CONSISTENCY AUDIT** is the  
> current phase. §28.12 holds the updated master roadmap tracker.

---

## 1. INITIAL GIT STATUS

```
$ git -C /home/reksa/restorant-cafe status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? tests/README.md
?? tests/setup.ts
?? tests/fixtures/accounting.ts
```

**Uncommitted changes preserved:** 4 Accounting M2 files intact

---

## 2. DATABASE IDENTITY VERIFICATION

### Container Status
| Container | Port | Status |
|-----------|------|--------|
| `restaurant-mariadb` (existing) | 3307→3306 | ✅ UNCHANGED |
| `restaurant-mariadb-test` (new) | 3308→3306 | ✅ HEALTHY |

### Database Access Tests
```
✓ Test user connects to restaurant_app_test (127.0.0.1:3308)
✓ Test user BLOCKED from restaurant_app (port 3307) - verified
✓ Schema tables present: 107 tables
```

---

## 3. ENVIRONMENT CONFIGURATION CORRECTED

### .env.test (Local - NOT committed)
```
TEST_DATABASE_URL="mysql://restaurant_test:<REDACTED_TEST_USER_PASSWORD>@127.0.0.1:3308/restaurant_app_test"
DATABASE_URL="mysql://restaurant_test:<REDACTED_TEST_USER_PASSWORD>@127.0.0.1:3308/restaurant_app_test"
NODE_ENV=test
```

---

## 4. BOOTSTRAP VERIFICATION RESULTS

### tests/setup.ts Safety Guards
```typescript
// 1. Production mode rejection
if (process.env.NODE_ENV === 'production') throw Error('[TEST SAFETY]');

// 2. TEST_DATABASE_URL mandatory
if (!process.env.TEST_DATABASE_URL) throw Error('[TEST SAFETY]');

// 3. Database name validation (rejects restaurant_app, restaurant)
if (productionNames.includes(dbName)) throw Error('[TEST SAFETY]');

// 4. Modified to allow equal URLs during NODE_ENV=test
```

### Test Results
```
✓ 1. Missing TEST_DATABASE_URL → FAIL (throws error)
✓ 2. Wrong database name → FAIL (rejects restaurant_app)
✓ 3. Production mode → FAIL (rejects NODE_ENV=production)
✓ 4. Test URL pointing to application DB → FAIL (rejects port 3307)
✓ 5. Correct isolated configuration → PASS
✓ 6. Both URLs equal allowed when NODE_ENV=test
```

---

## 5. M2 NUMERICAL FIXTURE (CORRECTED)

**Cutoff:** 2026-09-11T16:06:57.831Z  
**Marker:** 2026-09-20T00:00:00.000Z  

```
Expected totals:
  legacyExpected: 3
  beforeFirstSnapshot: 2
  anomaly: 2
  unknownCompletion: 1
  TOTAL: 8
```

---

## 6. SCHEMA INITIALIZED

### Method Used
`npx prisma db push --accept-data-loss`

### Tables Created (107 total)
Core: restaurant, order, payment, refund, product, category, ingredient, supplier, expense, cashbook, profitability, revenue, etc.

### Prisma Client Generated
✅ Client generated successfully

---

## 7. PRISMA DB PUSH IMPACT

### Schema Drift Assessment
- `prisma/schema.prisma` and `restaurant_app_test` are **in sync**
- No migration files need modification

### TypeScript Validation
```
$ npx tsc --noEmit
✓ PASSED - No type errors
```

---

## 8. GIT VALIDATION

```
$ git diff --check
✓ PASSED - No whitespace errors
```

---

## 9. DATABASE ISOLATION EVIDENCE

| Test | Result |
|------|--------|
| Test user connects to test DB | ✅ PASS |
| Test user blocked from main DB | ✅ PASS |
| Test DB on isolated port 3308 | ✅ VERIFIED |
| Existing container unchanged | ✅ VERIFIED |
| Volume isolated | ✅ VERIFIED |
| Schema accessible | ✅ VERIFIED |
| Tables match schema | ✅ VERIFIED |

---

## 10. FILES CREATED

| File | Purpose |
|------|---------|
| `tests/README.md` | Test documentation |
| `tests/setup.ts` | Fail-closed bootstrap |
| `tests/fixtures/accounting.ts` | Test data factory |
| `.env.test.example` | Template for local .env.test |

## 11. FILES MODIFIED

| File | Change |
|------|--------|
| `.env.example` | Added TEST_DATABASE_URL documentation |
| `.gitignore` | Already contains `.env.test` |
| `.env.test.example` | Updated DATABASE_URL to test DB |
| `tests/fixtures/accounting.ts` | Fixed TypeScript errors |
| `tests/setup.ts` | Allow equal URLs in test mode |

---

## 12. EXISTING APPLICATION DATABASE PROTECTION

| Verification | Status |
|--------------|--------|
| `restaurant-mariadb` container untouched | ✅ VERIFIED |
| Port 3307 mapping unchanged | ✅ VERIFIED |
| `restaurant_app` database accessible | ✅ VERIFIED |
| No schema modifications to production DB | ✅ VERIFIED |

---

## 13. FINAL GIT STATUS

**New files:**
- tests/README.md, tests/setup.ts, tests/fixtures/accounting.ts, .env.test.example

**Modified (uncommitted):**
- .env.example, .gitignore, .env.test.example, tests/fixtures/accounting.ts, tests/setup.ts

**Preserved:**
- src/services/accounting/integrity.rules.ts
- src/services/accounting/integrity.service.ts
- src/services/accounting/integrity.types.ts
- src/services/accounting/integrity.unit.test.ts

---

## 14. STEP 2B READINESS

| Component | Status |
|-----------|--------|
| Test database created | ✅ DONE |
| Dedicated user created | ✅ DONE |
| Schema initialized | ✅ DONE |
| Bootstrap verified | ✅ DONE |
| Isolation verified | ✅ DONE |
| TypeScript check | ✅ PASSED |
| Git diff --check | ✅ PASSED |
| All smoke tests | ✅ PASSED |

---

## 15. COMPLETION SUMMARY

✅ **STEP 2A.1** – Database topology audit  
✅ **STEP 2A.2** – Preflight verification  
✅ **STEP 2A.3-R** – Admin access recovery  
✅ **STEP 2A.4** – Isolated test container created  
✅ **STEP 2A.5** – Schema initialized  
✅ **STEP 2A.5-F** – Final database safety verification

**STOP** — STEP 2A.5-F COMPLETE.  
All infrastructure verified and protected.  
**AWAITING APPROVAL FOR STEP 2B** (financial integration tests).

*(Historical — superseded by §16 below.)*

---

## 16. STEP 2B.1 — CASHBOOK INTEGRATION TEST RESULTS

**Date:** 2026-10-14  
**Scope lock:** Cashbook integration tests only. Revenue, Refund, P&L and M2 SQL
integration tests were NOT worked on in this session.  
**Status:** ✅ COMPLETE — 15 tests, 15 passed, 0 failed, 0 skipped.

### 16.1 Initial Git status (start of this phase)

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

All pre-existing uncommitted work (including the four Accounting **M2** files:
`integrity.rules.ts`, `integrity.service.ts`, `integrity.types.ts`,
`integrity.unit.test.ts`) was preserved untouched. No commit, push or merge was
performed.

### 16.2 Exact files changed

| File | Change |
|------|--------|
| `tests/accounting/cashbook.integration.test.ts` | **NEW** — the 14-scenario Cashbook suite + runtime DB identity assertion |
| `tests/fixtures/accounting.ts` | **MODIFIED** — added FK-complete cashbook factories (`createRestaurantFixture`, `createBranchFixture`, `createUserFixture`, `createCustomerFixture`, `createOrderFixture`, `createPaymentFixture`, `createPaymentTransactionFixture`, `createRefundFixture`, `createExpenseCategoryFixture`), `createRunId`, `snapshotCounts`, `cleanupRun`, `findResiduals`. Existing exports left intact. |
| `tests/setup.ts` | **MODIFIED** — auto-loads `.env.test`, rejects percent-encoded credentials, and **pins `DATABASE_URL` = `TEST_DATABASE_URL`** before any prisma/service import. |
| `tests/README.md` | **MODIFIED** — run command (`npx tsx --test …`), safety measures, date semantics, cleanup contract. |
| `ACCOUNTING-INTEGRATION-TEST-PLAN.md` | **MODIFIED** — this report section. |

**Local (gitignored) environment file also changed — not part of the repository:**

| File | Change |
|------|--------|
| `.env.test` | `DATABASE_URL` repaired to target the isolated test DB (it pointed at the **application** DB — see 16.9 F-1); the dedicated test user's password was rotated to a URL-safe value (see 16.9 F-2). |

**No production file was modified.** `src/` is byte-identical to the start of this
phase (verified with `git diff --name-only`: only the four pre-existing M2 files
remain modified).

### 16.3 Test scenarios implemented

All 14 required scenarios plus one safety assertion, exercised through the real
read-model `getCashbook()` / `createExpense()` / `PaymentService.markCashierPaymentPaid()`:

| # | Scenario | Assertion highlights |
|---|----------|----------------------|
| — | Runtime DB identity | `SELECT DATABASE()` = `restaurant_app_test`; both URLs pinned to `127.0.0.1:3308` |
| 1 | Single PAID payment | 1 IN entry, `source=PAYMENT`, method KASIR, `date = paidAt`, `shiftAttributed=false` kept (not hidden), summary buckets all-zero except kasir |
| 2 | Split tender | 2 payments → 2 entries summed once each (120000 KASIR + 80000 QRIS = 200000 = grandTotal); QRIS in its own bucket, `settlementVerified=false`; stable pagination (limit 1, 2 pages) |
| 3 | Duplicate payment callback | Real service called twice: `alreadyPaid` false→true, exactly **1** `PaymentTransaction`, Cashbook counts the payment **once** |
| 4 | `PaymentTransaction` not an extra movement | Mirror + `IGNORED_STALE` + negative refund rows on one payment → still 1 entry, `totalOut = 0` |
| 5 | Partial approved refund | IN 100000 + OUT 40000 = net 60000; refund method inherited from the parent payment; `outflow.refundKasir` |
| 6 | Full approved refund | `REFUNDED` payment still counts as collected; net 0 |
| 7 | PENDING/REJECTED refund | Not counted at all (`totalOut = 0`), and their `createdAt` is not a cash date |
| 8 | Expense `spentAt` basis | Created through the expense service with `spentAt` = Oct 8 and `createdAt` = today → appears Oct 8, `outflow.expenseCash`, `categoryName`/`note`; **absent** from today's range |
| 9 | Payment `paidAt` basis | `paidAt` Oct 9, `createdAt` Sep 29 → Oct 9 range has it, Sep 29 range is empty |
| 10 | Refund `approvedAt` basis | `approvedAt` Oct 10, `createdAt` Oct 15 → only Oct 10 range contains it; Sep 28 shows the payment only |
| 11 | Tenant isolation | Tenant A sees only A's payment (50000), tenant B only B's (40000); no cross-leak |
| 12 | Branch isolation | Unscoped admin sees both branches (100000); `[BR_A1]` sees 30000; `[BR_A2]` sees 70000; out-of-scope `branchId` → `ForbiddenError`; foreign `branchId` hint → 0 rows |
| 13 | Empty date range | 0 items, all summary buckets zero, `openingBalance=null`, `qrisSettlementVerified=false`, range start/end ISO correct |
| 14 | Cross-period | Order created Sep 30, collected Oct 13 → Sep 30 empty, Oct 13 has the collection, span contains it exactly once. **Cashbook ≠ Revenue for the same period is the existing rule, asserted — not “fixed”.** |

### 16.4 Expected vs actual results

| Check | Expected | Actual | Verdict |
|-------|----------|--------|---------|
| Scenario outcomes (14) | All pass on the existing read-model | All pass, no service behaviour changed | ✅ MATCH |
| Payment counted once per row | Yes | Yes (split tender 2 entries; duplicate callback 1 entry) | ✅ MATCH |
| `PaymentTransaction` excluded | Yes | Yes (3 mirror rows → still 1 movement, 0 outflow) | ✅ MATCH |
| Refund status gate | Only `APPROVED` | Only `APPROVED` | ✅ MATCH |
| Date bases | paidAt / approvedAt / spentAt | paidAt / approvedAt / spentAt (local-midnight for `spentAt`) | ✅ MATCH |
| Tenant/branch scoping | Tenant from session, branch via `authorizedBranches` | Matches, incl. `ForbiddenError` on out-of-scope branch | ✅ MATCH |
| Table count in `restaurant_app_test` | Prior report claimed **107** | Actually **49** tables — all cashbook-required tables present (`payment`, `paymenttransaction`, `refund`, `expense`, `expensecategory`, `order`, `branch`, `restaurant`, `auditlog`, `cashiershift`) | ⚠️ PRIOR CLAIM CORRECTED (no functional impact) |
| Application DB (`3307/restaurant_app`) | Untouched | Untouched (container up 14 h, port mapping unchanged, test user still denied) | ✅ MATCH |

### 16.5 Test counts

```
$ npx tsx --test tests/accounting/cashbook.integration.test.ts
▶ STEP 2B.1 — Cashbook integration (real MariaDB, isolated test DB)
  ✔ safety: the runtime connection targets the isolated test database
  ✔ 1..14 (all scenarios)
ℹ tests 15
ℹ suites 1
ℹ pass 15
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2722
```

| Metric | Value |
|--------|-------|
| Total tests | 15 |
| Passed | 15 |
| Failed | 0 |
| Skipped / todo / cancelled | 0 / 0 / 0 |
| Suite duration | ~1.3–1.6 s (plus ~0.6 s Node startup) |
| Runs performed | 3 consecutive full runs, identical results (repeatability verified) |
| SQL integration | Real: Prisma 7 + `@prisma/adapter-mariadb` against MariaDB 11.8 on `127.0.0.1:3308` — no mocks, no stubbed aggregation |

Three assertions failed on the **first** run and were corrected in the test file
(they were test-expectation errors, not product defects): the `spentAt` local-midnight
ISO expectation, a day (Oct 9) reused by two scenarios, and a span-total assertion
that also summed the other scenarios' movements. The service was never modified to
make a test pass.

### 16.6 Database isolation verification

```
[1] NODE_ENV            = test
[1] TEST_DATABASE_URL   -> 127.0.0.1:3308/restaurant_app_test user=restaurant_test pass=***
[1] DATABASE_URL        -> 127.0.0.1:3308/restaurant_app_test user=restaurant_test pass=***
[2] PASS TEST host is 127.0.0.1/localhost
[2] PASS TEST port == 3308
[2] PASS TEST dbname == restaurant_app_test
[2] PASS DATABASE host is 127.0.0.1/localhost
[2] PASS DATABASE port == 3308
[2] PASS DATABASE dbname == restaurant_app_test
[2] PASS TEST_DATABASE_URL === DATABASE_URL
[3] runtime identity    -> db=restaurant_app_test port=3306 user=restaurant_test@% host=bae65d9fc587
[3] tables in test db   -> 49 | required cashbook tables present: 9
[3] visible databases   -> information_schema, restaurant_app_test
[2] PASS restaurant_app NOT visible to test user
[2] PASS test user DENIED on application db (3307) (ER_ACCESS_DENIED_ERROR)
[5] overall: ALL PASS
```

* `DATABASE_URL` and `TEST_DATABASE_URL` were verified to resolve to the **same
  isolated target** (`127.0.0.1:3308` / `restaurant_app_test`) *before* any test ran.
* The test environment is loaded **before** Prisma/accounting services import:
  `tests/setup.ts` is the first import and pins `DATABASE_URL` in-process.
* The database identity is re-verified at runtime from inside the suite via SQL.
* The runtime user cannot reach `restaurant_app` (and cannot even see it in
  `SHOW DATABASES`).
* `restaurant-mariadb` (application, port 3307) remained `Up` with an unchanged
  port mapping; no connection, schema change or migration touched it.
* No credentials or full database URLs were printed.

### 16.7 Cleanup verification

```
[STEP 2B.1 CLEANUP] rows deleted: {"paymentTransaction":4,"refundItem":0,"refund":5,
  "payment":15,"expense":1,"orderItemCostSnapshot":0,"orderItem":0,
  "orderStatusHistory":0,"order":14,"expenseCategory":1,"cashierShift":0,
  "auditLog":2,"userBranch":0,"customer":2,"user":2,"branch":3,"restaurant":2}
[STEP 2B.1 CLEANUP] residual (run-scoped): {all keys → 0}
[STEP 2B.1 CLEANUP] table counts (baseline → after): {every monitored table → "0 → 0"}
```

* Cleanup is **run-scoped**: every fixture id carries the `cbt-…` prefix and rows
  written by production services are removed through their parent ids.
* Deletion is child-first with explicit sequential `deleteMany` calls — no global
  interactive transaction, no `TRUNCATE`, nothing outside this run's rows.
* The suite asserts (a) every monitored table returned to its exact pre-run count
  and (b) zero residual run-scoped rows. Both hold on both runs.
* Independently re-verified outside the test process with a raw MariaDB driver
  after the runs: `restaurant/branch/user/customer/order/orderitem/
  orderitemcostsnapshot/payment/paymenttransaction/refund/refunditem/expense/
  expensecategory/cashiershift/auditlog` = **0 rows each**.

### 16.8 TypeScript / build / diff-check results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ PASS — exit 0, no output |
| Whitespace | `git diff --check` | ✅ PASS — exit 0, no output |
| Whitespace (untracked test infra, which `git diff --check` does not cover) | `git diff --no-index --check /dev/null <file>` for `tests/accounting/cashbook.integration.test.ts`, `tests/fixtures/accounting.ts`, `tests/setup.ts`, `tests/README.md` | ✅ PASS — clean (one pre-existing trailing space in the fixtures header was removed) |
| Production build | `npm run build` | ✅ PASS — exit 0, `✓ Compiled successfully in 19.6s`, full route table emitted (re-run on the final tree) |

The build prints 6 pre-existing warnings about dynamic filesystem tracing from the
product/branding upload routes — unrelated to this phase and present before it.
`next-env.d.ts` is regenerated by `next build`; that generated churn was reverted
afterwards so the working tree contains only intentional changes.

### 16.9 Confirmed defects / findings

**F-1 — SAFETY DRIFT (confirmed, corrected in the local test env).** At the start
of this phase `.env.test` contained
`DATABASE_URL="mysql://restaurant:***@localhost:3307/restaurant_app"` — i.e. the
**application** database — while `TEST_DATABASE_URL` correctly pointed at
`127.0.0.1:3308/restaurant_app_test`. Because `src/lib/prisma.ts` builds its client
from `DATABASE_URL`, simply importing any accounting service in a test would have
opened the application database. Evidence: preflight run printed
`[2] FAIL DATABASE port == 3308` / `FAIL DATABASE dbname == restaurant_app_test`.
Correction: (a) `.env.test` now points `DATABASE_URL` at the isolated test DB;
(b) `tests/setup.ts` **pins** `DATABASE_URL := TEST_DATABASE_URL` after validation,
so a future drift can no longer reach the application database. No production code
changed.

**F-2 — Credential encoding defect (confirmed; mitigated in the test env; production
code intentionally NOT changed).** The dedicated test user's password was
base64-style (`…+…==`). The WHATWG URL parser percent-encodes `+` and `=` inside
userinfo (28 chars), and `src/lib/prisma.ts` passes `urlObj.password` straight to
the `mariadb` driver **without percent-decoding**, so every query failed with
`pool timeout: failed to retrieve a connection from pool after 10000ms`
(Prisma `P2010`, driver code `45028`) even though the raw driver connected fine.
Evidence: probe using `new URL(url).password` → `ER_ACCESS_DENIED_ERROR` (len 28);
using `decodeURIComponent(url.password)` → connect OK (len 24).
Mitigation: the isolated test user's password was rotated to a URL-safe value and
`.env.test` updated; `tests/setup.ts` now rejects percent-encoded credentials with
an explicit message instead of a confusing pool timeout.
**Recommendation (later phase, production code):** make `src/lib/prisma.ts`
`decodeURIComponent()` the URL username/password — any deployment whose
`DATABASE_URL` password contains URL-encoded characters would currently fail to
connect. Not fixed here because production logic changes are out of scope for
STEP 2B.1.

**F-3 — Test-container healthcheck misconfiguration (infrastructure note, not
fixed).** `restaurant-mariadb-test` reports `unhealthy` because its healthcheck
invokes `mysqladmin`, which is not present in the `mariadb:11.8` image
(`exit 127: mysqladmin: not found`). The database itself is fully functional
(verified via the raw driver, Prisma and the whole test suite). Fixing the
healthcheck requires recreating the container — deferred, no impact on this phase.

**Correction:** STEP 2A.5-F reported “107 tables”; the actual count in
`restaurant_app_test` is **49**. Every table required by the Cashbook suite exists,
so there is no functional impact.

**No production defect was found in the Cashbook read-model.** Every scenario
behaved as the existing rules specify, so no production code was touched and no
failing test was silenced.

### 16.10 Regression risk

| Area | Risk | Mitigation / evidence |
|------|------|-----------------------|
| Production code | **None** — `src/` is unchanged | `git diff --name-only` shows only the four pre-existing M2 files |
| Application database | **None** — never contacted | Isolation preflight + runtime `SELECT DATABASE()` + test user denied on 3307 + container uptime/port unchanged |
| Test DB data | **None** — fully restored to pre-run counts | Baseline equality + zero residuals, verified twice |
| Existing test infra | Low — `tests/setup.ts` gained env loading, credential guard and DB pinning; existing fail-closed behaviour kept | All checks still fire; suite passes |
| Legacy fixtures | Low — `createTestOrder`/`createOrderWithItemAndSnapshot`/`createFullRefund`/`createLegacyRefund` were **left as-is** but cannot run against a real DB (missing `restaurantId` / `Order.customerId`) | Documented in `tests/README.md`; new FK-complete factories added alongside. STEP 2B.2+ must re-base them on the tenant/customer fixtures |
| `.env.test` credential rotation (F-2) | Low — test-only user on the isolated container; anyone reusing the old password must update their copy | Recorded here; the new value lives only in the gitignored `.env.test` |

### 16.11 Next-phase readiness

| Item | Status |
|------|--------|
| Isolated test DB reachable via the app's own Prisma path | ✅ READY (F-1/F-2 fixed) |
| Fail-closed safety bootstrap with `DATABASE_URL` pinning | ✅ READY |
| Reusable fixtures / run-scoped cleanup + verification helpers | ✅ READY |
| Cashbook coverage (14 scenarios) | ✅ COMPLETE |
| Revenue / Refund / P&L / integrity integration tests | ⏳ NOT STARTED (phase lock respected) |
| `npx tsc --noEmit` / `git diff --check` / `npm run build` | ✅ ALL GREEN |

**STEP 2B.1 STOPS HERE.** STEP 2B.2 was not started.

### 16.12 Progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1 | Database topology audit | ✅ DONE |
| 2A.2 | Preflight verification | ✅ DONE |
| 2A.3-R | Admin access recovery | ✅ DONE |
| 2A.4 | Isolated test container created | ✅ DONE |
| 2A.5 | Schema initialized | ✅ DONE |
| 2A.5-F | Final database safety verification | ✅ DONE |
| 2B.1 | Cashbook integration tests | ✅ DONE — 15/15 pass |
| **2B.2** | **Revenue & Reporting integration tests** | **✅ DONE — 19/19 pass (see §17.13)** |
| 2B.3 | Refund & Profitability integration tests | ✅ DONE — 21/21 pass (see §18.13) |
| 2B.4 | P&L integration tests | ✅ DONE — 24/24 pass (see §19.16) |
| 2B.5 | Integrity (M2 SQL) integration tests | ⏳ NOT STARTED |

### 16.13 Final Git status

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the initial state: **no commit, no push, no merge, no deploy**. The
test additions live under the untracked `tests/` directory; the four Accounting M2
files and every pre-existing uncommitted change are preserved.

---

## 17. STEP 2B.2 — REVENUE & REPORTING INTEGRATION TEST RESULTS

**Date:** 2026-10-14  
**Scope lock:** Revenue & Reporting integration tests only. Refund & Profitability,
P&L and M2 SQL integration tests were NOT worked on in this session.  
**Status:** ✅ COMPLETE — 19 tests, 19 passed, 0 failed, 0 skipped (Cashbook suite preserved: 15/15).

### 17.1 Initial Git status (start of this phase)

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

The four Accounting **M2** files (`integrity.rules.ts`, `integrity.service.ts`,
`integrity.types.ts`, `integrity.unit.test.ts`) and every other pre-existing
uncommitted change were preserved untouched. The STEP 2B.1 Cashbook suite was
preserved (re-run after the fixture change: still 15/15).

### 17.2 Files changed

| File | Change |
|------|--------|
| `tests/accounting/revenue.integration.test.ts` | **NEW** — the 18-scenario Revenue & Reporting suite + runtime DB identity assertion |
| `tests/fixtures/accounting.ts` | **MODIFIED** — `createOrderFixture` gained optional `subtotal` / `tax` / `serviceCharge` / `discount` / `orderType` (defaults unchanged, so the Cashbook suite is unaffected); added `createCategoryFixture`, `createProductFixture`, `createOrderItemFixture`; `snapshotCounts` / `cleanupRun` / `findResiduals` now also cover `product` + `category` |
| `tests/README.md` | **MODIFIED** — Revenue & Reporting suite documentation |
| `ACCOUNTING-INTEGRATION-TEST-PLAN.md` | **MODIFIED** — this section (§17) + refreshed tracker/header |

**No production file was modified.** `src/` is byte-identical to the start of this
phase (`git diff --name-only` still lists only the four pre-existing M2 files).

### 17.3 Audit findings (before implementation)

The audit read `src/services/report/report.service.ts` (3 532 lines) end to end for
the revenue paths: `resolveReportRange`, `reportScopeWhere` / `reportBaseWhere` /
`reportActivityWhere`, `revenueWhere` / `revenueScopeWhere`, `computeRefundRevenue`,
`computeCustomerRevenue`, `getSalesReport`, and the raw-SQL fragments
(`paidRevenueSql`, `revenueSetSql`, `productRevenueSql`, `refundRevenueSql`,
`approvedRefundsSql`). Findings:

| # | Audited behaviour | How it is covered |
|---|-------------------|-------------------|
| A-1 | **The revenue set is keyed on the ORDER mirror** — `status <> 'CANCELLED' AND (Order.paymentStatus = 'PAID' OR EXISTS Payment.status = 'REFUNDED')`. Payment rows in PENDING/FAILED/EXPIRED/CANCELLED never qualify an order. | Scenarios 1–4, 6, 7, 9, 18(a) |
| A-2 | Consequence of A-1: a **PAID payment whose order mirror is not PAID** (and with no REFUNDED payment) contributes **no** revenue. The mirror the payment engine writes is authoritative; the Prisma predicate and the SQL predicate agree exactly. Asserted as the actual rule; **not** a defect. | Scenarios 9, 18(a) |
| A-3 | `filters.status` **never changes revenue totals** — it only narrows the activity count and the payment-breakdown buckets. | Scenario 18(f) |
| A-4 | `filters.branchId` is **echoed only**; branch scoping is enforced exclusively through the `branchFilters` argument (session-resolved `authorizedBranches` / explicit `branchId` param at the route). | Scenario 15 |
| A-5 | The payment breakdown is a **payment-level, all-status view**: a CANCELLED order's collection is still listed there while the order never enters revenue/activity. | Scenario 6 |
| A-6 | Revenue date basis = `Order.createdAt`; refund impact basis = `Refund.approvedAt` with a date-free order scope. A period containing only refund impact can therefore show **negative `netSales`** by design. | Scenarios 12, 13 |
| A-7 | `netSales` = Σ(grandTotal − tax − serviceCharge) − LEAST(refunded/grandTotal, 1) × product basis, so a full refund lands exactly on **0** (never negative). | Scenarios 10, 11 |
| A-8 | `dailySeries` is densified and its day keys are derived from the **UTC** parts of the range bounds while the grouping uses the stored UTC `createdAt` — so both sides agree: Σ`dailySeries.sales` ≡ `summary.totalSales`. | Scenarios 11, 17, 18(c) |
| A-9 | **DISCREPANCY (recorded, NOT fixed):** the `busiestHours` raw SQL still filters `paymentStatus = 'PAID'` only, so it is the one sub-report **not** derived from the canonical revenue set — a collected-then-refunded order appears in `dailySeries`/`totalSales` but not in `busiestHours`. Exact reproduction: scenario 11 (fully refunded 200 000 order → `Σ dailySeries.sales = 200000`, `Σ busiestHours.revenue = 0`). The behaviour is asserted and reported for review; production code untouched per the phase lock. | Scenario 11 |
| A-10 | **No report unit tests exist** (`src/**` + `tests/**` contain none for the report engine) — this suite is the first automated coverage of the revenue engine. | — |

### 17.4 Test scenarios and fixture amounts

All amounts are `Order.grandTotal` unless stated. Each scenario owns its own
calendar day so windows never overlap.

| # | Scenario | Window | Fixture |
|---|----------|--------|---------|
| — | Runtime DB identity | — | `SELECT DATABASE()` / `USER()` |
| 1 | UNPAID order excluded | Oct 1 | order 100 000 `UNPAID` + payment `UNPAID` 100 000 |
| 2 | PENDING excluded | Oct 2 | order 110 000 `PENDING` + payment `PENDING` 110 000 |
| 3 | FAILED excluded | Oct 3 | order 120 000 `FAILED` + payment `FAILED` 120 000 |
| 4 | EXPIRED excluded | Oct 4 | order 130 000 `EXPIRED` + payment `EXPIRED` 130 000 |
| 5 | PAID included | Oct 5 | order 50 000 `PAID` + payment PAID KASIR 50 000 |
| 6 | CANCELLED excluded with payments | Oct 6 | order 999 999 `CANCELLED` + PAID 500 000 + REFUNDED 499 999 |
| 7 | Multiple attempts don't multiply | Oct 7 | order 200 000 `PAID` + 3×PAID (60 000/70 000/70 000) + PENDING 30 000 + CANCELLED 30 000 |
| 8 | PaymentTransaction not multiplied | Oct 8 | order 60 000 + PAID 60 000 + 3 mirror callbacks + mirrored refund −20 000 |
| 9 | REFUNDED-payment qualification | Oct 9 | order 70 000 `UNPAID` + payment `REFUNDED` 70 000 (included) vs order 80 000 `UNPAID` + payment PAID 80 000 (excluded, A-2) |
| 10 | Partial refund attribution | Oct 10 | order 115 000 (subtotal 100 000, tax 10 000, sc 5 000) + PAID 115 000 + refund APPROVED 57 500 |
| 11 | Full refund attribution | Oct 11 | order 200 000 `UNPAID` + payment `REFUNDED` 200 000 + refund APPROVED 200 000 |
| 12 | Order-date filtering | Oct 12 / Sep 1 | order 30 000 created Oct 12 with payment paidAt Sep 1 + order 70 000 created/paid Oct 12 |
| 13 | Cross-period | Sep 25 / Oct 13 / Oct 14 | order 120 000 created Sep 25, collected Oct 13, refund APPROVED 40 000 on Oct 14 |
| 14 | Tenant isolation | Oct 15 | tenant A order 40 000, tenant B order 90 000 |
| 15 | Branch isolation | Oct 16 | branch A1 order 40 000 + branch A2 order 60 000 |
| 16 | Empty range | Oct 20–21 | no rows |
| 17 | Totals agree with fixtures | Oct 17 | order A 51 500 (subtotal 50 000, discount 5 000, tax 4 500, sc 2 000, items 2×25 000), order B 33 000 (subtotal 30 000, tax 3 000, items 3×10 000), order C 11 000 UNPAID (items 1×10 000) |
| 18 | Prisma vs SQL predicates | Oct 18 | 7 orders: PAID 10 000 (tax 1 000), UNPAID 11 000, PENDING 12 000, REFUNDED-payment 20 000, CANCELLED 13 000 + PAID, mirror-mismatch 14 000, split tender 30 000 (tax 3 000) |

### 17.5 Expected vs actual Revenue values

| Check | Expected | Actual | Verdict |
|-------|----------|--------|---------|
| Sc1–4 revenue | 0 each; activity `totalOrders` 1 each | 0 / 1 each | ✅ MATCH |
| Sc6 cancelled | revenue 0, activity 0, breakdown still lists the payments | 0 / 0 / listed | ✅ MATCH (A-5) |
| Sc7 multiple attempts | 200 000 once, `paidOrders` 1 | 200 000 / 1 | ✅ MATCH |
| Sc8 PaymentTransaction mirror | `totalSales` 60 000, `totalRefund` 0 | 60 000 / 0 | ✅ MATCH |
| Sc9 qualification | 70 000 (REFUNDED payment only) | 70 000 | ✅ MATCH |
| Sc10 partial refund | `totalSales` 115 000, `totalRefund` 57 500, `netSales` 50 000, canonical SQL productRevenue 100 000 / refundRevenue 50 000 | exact match | ✅ MATCH |
| Sc11 full refund | `totalSales` 200 000, `totalRefund` 200 000, `netSales` 0, `Σ dailySeries.sales` 200 000, `Σ busiestHours.revenue` 0 | exact match | ✅ MATCH (A-9 discrepancy recorded) |
| Sc12 order-date basis | Oct 12 → 100 000 (2 orders); Sep 1 → 0 | 100 000 / 0 | ✅ MATCH |
| Sc13 cross-period | Sep 25 sales 120 000 / refund 0; Oct 13 sales 0; Oct 14 refund 40 000, `netSales` −40 000 | exact match | ✅ MATCH (A-6) |
| Sc14 tenant | A 40 000, B 90 000 | 40 000 / 90 000 | ✅ MATCH |
| Sc15 branch | all 100 000; [A1] 40 000; [A2] 60 000; hint-only 100 000 | exact match | ✅ MATCH (A-4) |
| Sc16 empty | all zeros, `bestSellers`/`categories`/`hourly` `[]`, densified zero series | exact match | ✅ MATCH |
| Sc17 totals | sales 84 500 · gross 80 000 · tax 7 500 · sc 2 000 · discount 5 000 · items 5 · paidOrders 2 · orders 3 · AOV 42 250 · netSales 75 000 · best seller qty 5 / revenue 80 000 | exact match | ✅ MATCH |
| Sc18 predicate agreement | Prisma set = {PAID 10 000, REFUNDED-payment 20 000, split 30 000}; sales 60 000; orders 6; daily Σ 60 000; canonical productRevenue 56 000 (= 60 000 − 4 000 tax); customer-engine money == canonical; UNPAID filter keeps sales 60 000 with orders 3 | exact match | ✅ MATCH |

**No financial value differed from the documented rule.** The only failed assertion
in the first run was a test-side expectation (the customer-scoped bucket carries an
additional `orderCount` field) — corrected in the test, not in production code.

### 17.6 Test counts and repeated-run results

```
$ npx tsx --test tests/accounting/revenue.integration.test.ts
▶ STEP 2B.2 — Revenue & Reporting integration (real MariaDB, isolated test DB)
  ✔ safety + 18 scenarios
ℹ tests 19   ℹ suites 1   ℹ pass 19   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
ℹ duration_ms 3583
```

| Metric | Value |
|--------|-------|
| Total tests | 19 (1 safety assertion + 18 required scenarios) |
| Passed / Failed / Skipped | 19 / 0 / 0 |
| Runs on the final tree | 3 consecutive full runs (run 1 after the fix, run 2, run 3) — identical results |
| Suite duration | ~2.4–2.5 s per run (≈3.6 s incl. Node startup) |
| SQL integration | Real: Prisma 7 + `@prisma/adapter-mariadb` → MariaDB 11.8 on `127.0.0.1:3308`, incl. production raw-SQL paths (`dailySeries`, `busiestHours`, `computeRefundRevenue`, `computeCustomerRevenue`) |
| Cashbook suite after the fixture change | ✅ 15/15 still passing (preserved) |

### 17.7 Database isolation evidence

```
[TEST SETUP] Loaded test environment from /home/reksa/restorant-cafe/.env.test
[TEST SETUP] Database configuration validated:
  Host: 127.0.0.1:3308
  Database: restaurant_app_test
  User: restaurant_test
(asserted inside the suite)
  SELECT DATABASE() -> restaurant_app_test   (not restaurant_app)
  USER()           -> restaurant_test@...
  EXPECTED_TEST_DB.port == 3308, DATABASE_URL pinned to the same test DB
```

* Bootstrap ordering is guaranteed: `tests/setup.ts` is the **first static import**
  of the suite, and it performs the env load, the fail-closed checks and the
  `DATABASE_URL` pin *before* `@/lib/prisma` or any report service is evaluated
  (ESM/CJS module evaluation order). A static import of the service can therefore
  never run before the validation.
* The runtime identity is re-verified from inside the suite over SQL.
* The dedicated test user still cannot reach `restaurant_app` — re-verified in
  THIS phase with a read-only probe (no application DB mutation):

```
visible databases to test user: information_schema, restaurant_app_test
restaurant_app visible: false
application db (3307) access DENIED: ER_ACCESS_DENIED_ERROR
probe exit: 0
```
* The application database (`restaurant-mariadb`, port 3307) was never contacted;
  `restaurant_app_test` remains the only database the test user can see.
* No credentials or complete connection URLs are printed anywhere.

### 17.8 Cleanup verification

```
[STEP 2B.2 CLEANUP] rows deleted: {"paymentTransaction":4,"refund":3,"payment":33,
  "order":29,"orderItem":3,"product":1,"category":1,"customer":2,"user":2,
  "branch":3,"restaurant":2, ...}
[STEP 2B.2 CLEANUP] residual (run-scoped): {every key → 0}
[STEP 2B.2 CLEANUP] table counts (baseline → after): {18 tables → "0 → 0"}
```

* Every fixture id carries the `cbr-…` run prefix; deletion is child-first with
  explicit sequential `deleteMany` calls (no global transaction, no `TRUNCATE`).
* The suite asserts both exact pre-run table counts **and** zero residual
  run-scoped rows (`product`/`category` are now part of that check).
* Independently re-verified outside the test process with a raw MariaDB driver
  after the final runs: **TOTAL = 0 rows** across `restaurant`, `branch`, `user`,
  `customer`, `order`, `orderitem`, `payment`, `paymenttransaction`, `refund`,
  `expense`, `expensecategory`, `cashiershift`, `auditlog`, `product`,
  `category`.

### 17.9 TypeScript / build / diff-check results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ PASS — exit 0 |
| Whitespace (tracked) | `git diff --check` | ✅ PASS — exit 0 |
| Whitespace (untracked test infra, not covered by the above) | `git diff --no-index --check /dev/null <file>` over `tests/README.md`, `tests/accounting/cashbook.integration.test.ts`, `tests/accounting/revenue.integration.test.ts`, `tests/fixtures/accounting.ts`, `tests/setup.ts` | ✅ PASS — all clean |
| Production build | `npm run build` | ✅ PASS — exit 0, `✓ Compiled successfully in 18.7s` (6 pre-existing upload-tracing warnings only) |

The build-regenerated `next-env.d.ts` was reverted afterwards so the working tree
contains only intentional changes.

### 17.10 Confirmed defects

* **No defect was found in the revenue engine itself** — every one of the 18
  scenarios matched the documented rules on the first implementation run (after one
  test-side expectation fix), and the Prisma and SQL predicates agreed on identical
  datasets.
* **A-9 is the one confirmed discrepancy** (sub-report level): `busiestHours` uses a
  legacy `paymentStatus = 'PAID'` filter instead of the canonical revenue set, so a
  fully-refunded order is counted by `dailySeries`/`totalSales` but not by the hourly
  bucket. Evidence: scenario 11 (`200000` vs `0`). The failing *expectation of
  equality* between those two series is deliberately NOT asserted (they genuinely
  differ); the observed values are asserted and this entry records it for review.
  Production code was **not** modified, per the phase lock and the "report, don't
  rewrite" rule.
* Asserted-as-designed behaviours that a reader might mistake for defects are
  documented in §17.3 (A-2 order-mirror authority, A-6 negative netSales in a
  refund-only period, A-5 payment breakdown including cancelled orders' payments).

### 17.11 Carried-forward findings F-1 / F-2 / F-3

| Finding | Status in STEP 2B.2 |
|---------|---------------------|
| **F-1** — `DATABASE_URL` safety drift (`.env.test` pointed at the application DB) | ✅ **Remains fixed.** `.env.test` still targets `127.0.0.1:3308/restaurant_app_test` and `tests/setup.ts` still pins `DATABASE_URL := TEST_DATABASE_URL` before any import. Re-verified this phase (both URLs identical, runtime identity = test DB). |
| **F-2** — percent-encoded credential handling in `src/lib/prisma.ts` | ✅ **Test mitigation intact, production issue still deferred as instructed.** The test user's URL-safe credential is unchanged; the fail-fast guard in `tests/setup.ts` remains; `src/lib/prisma.ts` was **not** modified this phase. |
| **F-3** — test-container healthcheck reports `unhealthy` (missing `mysqladmin`) | ✅ **Unchanged, container NOT recreated** as instructed. Database connectivity re-verified (suite + raw driver): fully functional. |
| Schema count | Correct figure **49 tables** (not 107) — unchanged. |
| Old `.env.test` configuration | Not reintroduced: no `DATABASE_URL=…3307/restaurant_app` anywhere in the test env. |

### 17.12 Regression risks

| Area | Risk | Mitigation / evidence |
|------|------|-----------------------|
| Production code | **None** — `src/` unchanged (`git diff --name-only` = the four pre-existing M2 files) | — |
| Application database | **None** — never contacted | Preflight + runtime SQL identity + app container untouched |
| Test DB data | **None** — 18 monitored tables back to baseline, 0 residual rows, raw-driver recount = 0 | Cleanup assertions on every run |
| STEP 2B.1 Cashbook suite | Low — shared fixtures were extended (optional fields default to the previous values; new factories additive; cleanup/baseline gained `product`/`category`) | Cashbook suite re-run after the change: **15/15 pass**, cleanup still balanced |
| Running both suites in one command | Low — Node runs multiple test **files** in parallel, and each suite asserts whole-table counts return to *its* baseline, so parallel execution can flake | Documented in `tests/README.md`: run **one file at a time** |
| `busiestHours` discrepancy (A-9) | Low/known — the hourly chart under-reports fully-refunded orders; no other consumer of that field in this phase | Recorded with reproduction; fix belongs to a future phase that is allowed to touch production code |

### 17.13 Updated overall progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1 | Database topology audit | ✅ DONE |
| 2A.2 | Preflight verification | ✅ DONE |
| 2A.3-R | Admin access recovery | ✅ DONE |
| 2A.4 | Isolated test container created | ✅ DONE |
| 2A.5 | Schema initialized | ✅ DONE |
| 2A.5-F | Final database safety verification | ✅ DONE |
| 2B.1 | Cashbook integration tests | ✅ DONE — 15/15 pass |
| **2B.2** | **Revenue & Reporting integration tests** | **✅ DONE — 19/19 pass** |
| 2B.3 | Refund & Profitability integration tests | ✅ DONE — 21/21 pass (see §18.13) |
| 2B.4 | P&L integration tests | ✅ DONE — 24/24 pass (see §19.16) |
| 2B.5 | Integrity (M2 SQL) integration tests | ⏳ NOT STARTED |

### 17.14 STEP 2B.3 readiness

| Item | Status |
|------|--------|
| Isolated DB + fail-closed bootstrap + `DATABASE_URL` pin | ✅ READY |
| Revenue fixtures (tenant/customer/branch/category/product/order-item) + run-scoped cleanup | ✅ READY and reusable |
| Revenue engine coverage (18 scenarios, incl. Prisma↔SQL predicate agreement) | ✅ COMPLETE |
| Canonical refund-attribution semantics documented for the next phase (`approvedAt` basis, capped product-basis share, negative netSales possible) | ✅ DOCUMENTED (§17.3 A-6/A-7) and asserted in scenarios 10/11/13 |
| `npx tsc --noEmit` / `git diff --check` / untracked whitespace / `npm run build` | ✅ ALL GREEN |
| Refund & Profitability / P&L / M2 SQL integration tests | ⏳ NOT STARTED (phase lock respected) |

**Recommended first checks for STEP 2B.3:** the refund-approval state machine
(`approval.service.decideRefund` → PaymentTransaction mirror, payment REFUNDED on
full refund, order `paymentStatus` back to UNPAID) plus the already-asserted
approval-date attribution; the fixtures and windows used here can be reused directly.

**STEP 2B.2 STOPS HERE.** STEP 2B.3 was not started.

### 17.15 Final Git status

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the initial state of this phase (and to the end of STEP 2B.1): **no
commit, no push, no merge, no deploy**.

---

## 18. STEP 2B.3 — REFUND & PROFITABILITY INTEGRATION TEST RESULTS

**Date:** 2026-10-14  
**Scope lock (phase boundary — respected):** Refund approval state machine +
Profitability read-model integration tests only. **No** P&L, **no** M2 SQL, **no**
production Revenue fix (A-9 untouched), **no** M2 production logic change.  
**Status:** ✅ COMPLETE — 21 tests, 21 passed, 0 failed, 0 skipped (4 consecutive clean
runs on the final tree). Cashbook 15/15 and Revenue 19/19 preserved.

### 18.1 Initial Git status (start of this phase)

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

All four uncommitted Accounting M2 files and every prior integration suite were
preserved unchanged.

### 18.2 Audit findings recorded BEFORE implementation

The refund state machine (`src/services/approval/approval.service.ts`) and the
profitability read model (`src/services/profitability/profitability.service.ts` +
`coverage.ts`) were audited first; every expectation below was derived from the
code and data, never invented.

| # | Audited rule |
|---|--------------|
| R-1 | `requestRefund` eligibility: reason < 5 chars → `ValidationError`; order not in tenant → `NotFoundError`; `branchFilters` set and the order's branch not in it → `NotFoundError` (a scoped request is never widened); order `CANCELLED` → `ConflictError`; **no collected payment** (`PAID`/`REFUNDED`) → `ConflictError`; refundable = Σcollected − Σ`APPROVED`, and refundable ≤ `MONEY_EPSILON` → `ConflictError` ("sudah direfund penuh"); amount ≤ 0 → `ValidationError`; amount > refundable → `ConflictError`. |
| R-2 | Only **one PENDING refund per order**, enforced atomically inside the insert transaction under `SELECT … FROM \`order\` WHERE id = ? FOR UPDATE`. |
| R-3 | Quantity allocations: item must belong to **this** order (`ValidationError`), duplicate `orderItemId` → `ValidationError`, non-integer / ≤ 0 → `ValidationError`, > purchased → `ValidationError`, > remaining after approved allocations → `ConflictError`. **Prices come from the DB** — effective unit = `OrderItem.totalPrice / OrderItem.quantity`, line = `round2(unit × qty)`; with items present the client `amount` is **ignored**. |
| R-4 | `decideRefund` transition: a **sequential** repeat decision is refused by the `status: "PENDING"` pre-read (`NotFoundError`); a **concurrent** repeat is refused by the guarded `updateMany` (`ConflictError`). Both leave state and money untouched. Re-decision is impossible in either direction (approve→reject too). |
| R-5 | Approval side effects (all in ONE transaction): `RefundItem.reversedCogs = round2(snapshot.hppUnit × qty)` when the snapshot is `SNAPSHOTTED` and `hppUnit != null`, else `NULL` (never 0); **exactly one** `PaymentTransaction` mirror (`provider = "cashier"` for KASIR else `"refund"`, `type = "refund"`, `status = "REFUNDED"`, `amount = −amount`) attached to `refund.payment`; `netPaid ≤ MONEY_EPSILON` → every still-`PAID` payment becomes `REFUNDED`; `Order.paymentStatus = netPaid > MONEY_EPSILON ? "PAID" : "UNPAID"`; stock restore only for item-based refunds on a `COMPLETED` order with a `branchId`. |
| R-6 | The refund row: `branchId` = the **order's** branch, `paymentId` = the KASIR payment, `requestedByCashierId` = requester, `requestedAt` = now, `status = PENDING`; only approval sets `approvedAt` + `approvedByAdminId` (rejection sets `rejectedByAdminId`, `approvedAt = null`). |
| R-7 | Read model: COGS comes **only** from `status = SNAPSHOTTED` snapshots. Coverage is decided by **status, never by value**: `coverageComplete = totalItems > 0 && costed === totalItems`; summary buckets are disjoint (`costed` / `uncosted` = snapshot present but not SNAPSHOTTED / `legacy` = COMPLETED with no snapshot / `pending` = not COMPLETED and no snapshot); `grossProfit`, `grossMarginPct`, `foodCostPct` are `null` whenever coverage is incomplete; an explicit `SNAPSHOTTED` COGS of **0** is COVERED; an **empty** scope is `NO_ITEMS` (never vacuously COVERED). |
| R-8 | Refund-aware COGS release: **only PARTIAL refunds release COGS.** An order whose approved refunds reach the collected amount is "fully refunded" and releases **nothing** (netSales 0 with `retainedCogs > 0`). Item-based refunds release the **frozen exact** `Σ RefundItem.reversedCogs`; legacy amount-only refunds (no `RefundItem`) fall back to the **documented pro-rata approximation** `round2(coveredCogs × min(1, refundAmount / grandTotal))`, split per product by that product's share of the order's covered COGS. |
| R-9 | `refundState` is window-level: `PARTIAL` if ≥ 1 partial refund is in scope (even when a full refund is also present), else `FULL` if only full refunds, else `NONE`. |
| R-10 | `netSales` = Σ(`grandTotal` − tax − serviceCharge) − refund share on the same product basis, with refunds attributed by `Refund.approvedAt` (date-free order scope). A fully refunded order is exactly **0**; a period containing only refund impact is legitimately **negative**. |
| R-11 | `filters.productId` narrows the **product rows only** — the summary/branch aggregates stay window-wide. The suite therefore asserts product-level values inside polluted (multi-order) windows and summary values only in dedicated single-order windows. |
| R-12 | D1 disclosure `summary.revenueWithoutItems { orders, headerValue }` surfaces revenue-bearing orders with **no** `OrderItem` rows. |
| R-13 | Before this phase there was **no automated test** of the refund state machine or the profitability engine — this suite is the first coverage of both. |

### 18.3 Exact files changed

| File | Change |
|------|--------|
| `tests/accounting/refund-profitability.integration.test.ts` | **NEW** (1 861 lines) — **21 tests** covering required items 1–21 (**item 1 IS the runtime-identity assertion**; there is no separate extra test — see §18.10), all real Prisma/MariaDB against the production services |
| `tests/fixtures/accounting.ts` | Extended additively: `createOrderItemCostSnapshotFixture` (frozen historical COGS incl. non-`SNAPSHOTTED` statuses) and `createBranchProductFixture` (plant a different **current** HPP), plus `stockMovement`, `ingredientStockMovement` and `branchProduct` added to the baseline count, cleanup and residual checks (`SCOPED_COUNT_TABLES` 21 tables) |
| `ACCOUNTING-INTEGRATION-TEST-PLAN.md` | This report (§18 + header + trackers) |
| `tests/README.md` | Suite list + §18 suite documentation |

**No production file was touched** (`git diff --name-only` = the four pre-existing M2
files only). No schema change, no migration, no `prisma db push`/`reset`.

### 18.4 Test scenarios and deterministic fixture amounts

Every scenario owns its own calendar day (read-side windows) or uses a unique product
id inside the shared “today” window (service-driven windows), so no window overlaps.
Run prefix: `cbrf-…`.

| # | Scenario | Window | Deterministic fixture |
|---|----------|--------|-----------------------|
| 1 | Runtime test DB identity | — | `SELECT DATABASE() / USER()` + `EXPECTED_TEST_DB` + `DATABASE_URL` |
| 2 | Valid **partial** refund request + approval | today | order 100 000 · item 2×50 000 · snapshot 15 000/u (30 000) · refund 40 000 → one `PaymentTransaction` −40 000 |
| 3 | **Full** refund | today | order 100 000 · item 2×50 000 · snapshot 30 000 · refund 100 000 → payment `REFUNDED`, order `UNPAID` |
| 4 | Over-refund / ineligible rejected | today | 100 000 paid: request 100 001 → `ConflictError`; amount 0 → `ValidationError`; reason `"abc"` → `ValidationError`; UNPAID order → `ConflictError`; CANCELLED order → `ConflictError`; 0 refund rows created |
| 5 | Σ approved ≤ collected | today | order 100 000 · snapshot 60 000 → refund 60 000 then 40 001 rejected, 40 000 accepted → Σ 100 000, `REFUNDED`, `UNPAID` |
| 6 | Duplicate approval | today | order 100 000 · snapshot 60 000 · refund 30 000 → repeat approve **and** repeat reject → `NotFoundError`; 1 mirror row; Σ 30 000 |
| 7 | Concurrent approval | today | (a) same pending refund approved twice in parallel → 1 fulfilled + 1 `ConflictError`; 1 mirror row; Σ 40 000. (b) two parallel `requestRefund` → 1 fulfilled + 1 `ConflictError`; exactly 1 PENDING; Σ requested 50 000→20 000 |
| 8 | PENDING / REJECTED invisible | today + Oct 2 | (a) rejected 20 000 + pending 30 000 → 0 impact, 0 mirror rows. (b) Oct 2: PENDING 30 000 + REJECTED 20 000 rows → `totalRefund` 0, `refundState` NONE, netSales 100 000, cogs 60 000, reversal 0 |
| 9 | Approval-date attribution | Oct 12 / Oct 13 | order 100 000 created+paid Oct 12 (snapshot 60 000), refund 40 000 approved Oct 13 11:00 |
| 10 | Mirror rows never double-count | Oct 15 | order 100 000 (snapshot 60 000) + refund 40 000 approved Oct 15 **+ 2 duplicate mirror rows** |
| 11 | Item-based partial refund (quantity) | today | order 125 000 · A 3×25 000 (snapshot 45 000) + B 1×50 000 (snapshot 20 000) · request A qty 2 with a **decoy amount of 1** → derived 50 000, frozen `reversedCogs` 30 000 |
| 12 | Full item refund + snapshot | today | order 50 000 · item 2×25 000 (snapshot 30 000) · request qty 2 → 50 000, `REFUNDED`, `UNPAID`, frozen 30 000 but **0** release |
| 13 | Legacy refund without `RefundItem` | Oct 17 / Oct 18 | two identical orders (100 000; A 2×25 000 snapshot 30 000 + B 1×50 000 snapshot 20 000): legacy 40 000 (no items) vs allocated 50 000 (A qty 2, frozen 30 000) |
| 14 | Write-side vs read-side consistency | today + Oct 17 | Σ`RefundItem.reversedCogs` (item-based) **==** reported `cogsReversal`; legacy fallback **==** the recomputed pro-rata formula |
| 15 | Historical snapshot ≠ current HPP | Oct 19 | order 100 000 · snapshot 60 000 · `BranchProduct` MANUAL `manualHpp` 99 000 |
| 16 | Missing coverage → INCOMPLETE/null | Oct 20 / Oct 21 | (a) order 100 000 COMPLETED with **no** snapshot + headless 70 000 order with no items. (b) order 80 000: 1×50 000 SNAPSHOTTED 20 000 + 1×30 000 `NO_RECIPE` (NULL) |
| 17 | Explicit zero HPP ≠ missing HPP | Oct 22 (+ Oct 20 contrast) | order 50 000 · snapshot `SNAPSHOTTED` hppUnit 0 / hppTotal 0 |
| 18 | Rounding / fractional allocation | today + Oct 24 | (a) order 100 000 = 3×33 333.33 line, snapshot 12 000.11/u → refund qty 2 = 66 666.67, frozen 24 000.22. (b) Oct 24: order 30 000 (3×10 000, snapshot 10 000) + legacy refund 10 000 |
| 19 | Tenant isolation | Oct 25 | tenant B: order 200 000 (snapshot 120 000) + refund 50 000; tenant A must see **nothing**; `requestRefund` cross-tenant → `NotFoundError` |
| 20 | Branch authorization / isolation | Oct 26 | A1 order 100 000 (snapshot 60 000) + A2 order 50 000 (snapshot 30 000); scoped request/decision for the wrong branch → `NotFoundError` |
| 21 | Empty dataset | Oct 27–28 | no rows |

### 18.5 Expected vs actual financial results

| Scenario | Expected (documented rule) | Actual | Verdict |
|----------|---------------------------|--------|---------|
| 2 | pro-rata release 30 000 × 40 000/100 000 = **12 000**; retained 18 000 | 12 000 / 18 000 | ✅ MATCH |
| 3 | full refund → release **0**, retained 30 000 | 0 / 30 000 | ✅ MATCH |
| 5 | Σ approved 100 000 (never more), full-refund rule → release 0, retained 60 000 | 100 000 / 0 / 60 000 | ✅ MATCH |
| 9 (Oct 12) | sales 100 000, refund 0, cogs 60 000, reversal 0, profit 40 000 | exact match | ✅ MATCH |
| 9 (Oct 13) | refund 40 000, netSales **−40 000**, coverage `NO_ITEMS`, cogs 0, reversal 24 000, retained −24 000, profit `null`; cross-period retained total 36 000 | exact match | ✅ MATCH (R-10) |
| 10 | `totalRefund` 40 000 **once**; netSales 60 000; cogs 60 000; reversal 24 000; retained 36 000; profit 24 000; `refundState` PARTIAL | exact match | ✅ MATCH |
| 11 | derived amount 50 000 (decoy ignored); frozen 30 000; product A reversal 30 000 / retained 15 000; product B reversal 0 | exact match | ✅ MATCH |
| 12 | frozen 30 000 but read-side release **0**; retained 30 000 | exact match | ✅ MATCH |
| 13 legacy | refund 40 000; netSales 60 000; cogs 50 000; reversal 20 000; retained 30 000; profit 30 000; A 12 000 / B 8 000 | exact match | ✅ MATCH |
| 13 allocated | refund 50 000; netSales 50 000; reversal **30 000** (exact); retained 20 000; profit 30 000 | exact match | ✅ MATCH |
| 15 | cogs 60 000 (snapshot), never 99 000 (current manual HPP); margin 40 %; food cost 60 % | exact match | ✅ MATCH |
| 16 (Oct 20) | coverage `{1,0,0,1,0}`, `LEGACY`, cogs 0, netSales 170 000, **profit `null`**, `revenueWithoutItems {1, 70000}` | exact match | ✅ MATCH (R-12) |
| 16 (Oct 21) | coverage `{2,1,1,0,0}`, `PARTIAL`, cogs 20 000, profit `null` | exact match | ✅ MATCH |
| 17 | coverage complete, cogs **0**, profit 50 000, food cost 0 %, margin 100 % | exact match | ✅ MATCH |
| 18 (a) | amount `round2(99999.99/3 × 2)` = **66 666.67**; frozen `round2(12000.11 × 2)` = **24 000.22**; retained 12 000.11 | exact match | ✅ MATCH |
| 18 (b) | reversal `round2(10000 × 1/3)` = **3 333.33**; netSales 20 000; retained 6 666.67; profit 13 333.33 | exact match | ✅ MATCH |
| 19 | tenant A all zeros (`NO_ITEMS`, profit `null`, no branches/products); tenant B sales 200 000, refund 50 000, netSales 150 000, cogs 120 000, reversal 30 000, retained 90 000, profit 60 000 | exact match | ✅ MATCH |
| 20 | unfiltered sales 150 000 / 2 branches / 2 products; `[A1]` 100 000, 1 branch, 1 product; `[A2]` 50 000 | exact match | ✅ MATCH |
| 21 | all zeros, `NO_ITEMS`, profit `null`, `refundState` NONE, empty branches/products, pagination 0 | exact match | ✅ MATCH |

**No financial value differed from the documented rules.** The only three failed
assertions in the very first run were **test-side** (see §18.10) and were corrected in
the test — production code was not modified.

### 18.6 Legacy refund / COGS analysis (the critical §6 case)

Deterministic fixture: one order per basis, both identical —
`grandTotal` 100 000 = A (2 × 25 000, snapshot `hppUnit` 15 000 → 30 000) + B
(1 × 50 000, snapshot `hppUnit` 20 000 → 20 000).

| Quantity | Legacy basis (Oct 17) | Allocated basis (Oct 18) |
|----------|----------------------|--------------------------|
| Original product revenue | 100 000 | 100 000 |
| Original historical COGS | 50 000 (A 30 000 + B 20 000, both `SNAPSHOTTED`) | 50 000 |
| `RefundItem` rows written by the approval | **0** (amount-only refund) | 1 (A × 2, `reversedCogs` 30 000) |
| Refund amount | 40 000 | 50 000 |
| **Write-side** COGS result | **none recorded** (no frozen reversal exists) | **30 000** frozen on the row |
| **Read-side** projected release | **20 000** = `round2(50 000 × 40 000/100 000)`, split A 12 000 / B 8 000 by cost share | **30 000** (exact frozen value) |
| Read-side netSales | 60 000 | 50 000 |
| Read-side retained COGS | 30 000 | 20 000 |
| Expected vs actual gross profit | expected 60 000 − 30 000 = 30 000 → **actual 30 000** | expected 50 000 − 20 000 = 30 000 → **actual 30 000** |

**Verdict: this is NOT a confirmed production defect — it is a divergence of two
accounting projections, and it is only observable when the refunded basket's cost
ratio differs from the order average.** The write-side ledger is silent for legacy
refunds (they predate `RefundItem` and carry no allocation), so the read model applies
its documented pro-rata approximation. Because the two bases are *disjoint by design*
(one refund is either item-based or legacy, never both — asserted), no money is ever
double-counted; the difference is a **5 000 cost-attribution difference** in the
demonstrated case (allocated 30 000 vs pro-rata 25 000 for the same 50 000 refund
targeted at the costlier item A). The reproducing tests are preserved
(scenario 13 + 14) and **no production code was changed**, per the phase lock.

### 18.7 Concurrency test evidence

```
scenario 7(a) — two racing approvals of the SAME pending refund (separate transactions)
  fulfilled 1 · rejected 1 · loser error = ConflictError("Permintaan refund sudah diproses")
  Σ APPROVED amount         = 40000   (applied exactly once)
  PaymentTransaction rows   = 1
scenario 7(b) — two racing requestRefund calls on the same order
  fulfilled 1 · rejected 1 · loser error = ConflictError("Refund untuk order ini masih menunggu persetujuan")
  PENDING refunds           = 1       (one PENDING per order, atomic under FOR UPDATE)
  Σ requested amount        = 20000   (no duplicate request landed)
scenario 6 — sequential duplicate approval AND duplicate rejection → NotFoundError, 0 extra effects
```

Both guarantees are enforced where the audit said they are: the refund-request insert
and the `PENDING → APPROVED/REJECTED` transition are each a single guarded write inside
the approval transaction.

### 18.8 Database isolation verification (re-verified in THIS phase)

```
[TEST SETUP] Loaded test environment from /home/reksa/restorant-cafe/.env.test
[TEST SETUP] Database configuration validated:
  Host: 127.0.0.1:3308   Database: restaurant_app_test   User: restaurant_test
(inside the suite, scenario 1)
  SELECT DATABASE() -> restaurant_app_test   USER() -> restaurant_test@172.18.0.1
  MariaDB 11.8.9   NODE_ENV=test   EXPECTED_TEST_DB.port=3308   DATABASE_URL ⊆ /restaurant_app_test
(read-only external probe)
  [2] test user denied on restaurant_app -> ER_TABLEACCESS_DENIED_ERROR
  [3] tables in test schema: 49
  [5] app DB (restaurant_app) run-prefixed rows: auditlog=0 order=0 orderitem=0 payment=0 refund=0 refunditem=0 restaurant=0
```

* Both effective URLs (`DATABASE_URL` and `TEST_DATABASE_URL` in `.env.test`) target
  `127.0.0.1:3308/restaurant_app_test`; the application `.env` still points at
  `localhost:3306/restaurant_app` and was **never** used by a test connection.
* `tests/setup.ts` is the **first static import** of the suite, so the env load, the
  fail-closed checks and the `DATABASE_URL := TEST_DATABASE_URL` pin all happen before
  `@/lib/prisma` or any service module is evaluated.
* The dedicated test user still **cannot** reach `restaurant_app`
  (`ER_TABLEACCESS_DENIED_ERROR`), and a read-only probe of the application database
  found **0** rows carrying this run's `cbrf-` prefix → no test data leaked into the
  application database. The application database was read (SELECT only); it was **not
  mutated**.
* **Credential hygiene:** the historical test-DB password literal present in an earlier
  section of this document was found to be **already inactive** (rotated in STEP 2B.1),
  so no rotation was required; the literal was redacted from this plan and from
  `.env.test.example`. No credential (old or new) is printed anywhere; `.env.test`
  remains gitignored and untracked.

### 18.9 Cleanup verification

```
[STEP 2B.3 CLEANUP] rows deleted: {"paymentTransaction":11,"stockMovement":3,"ingredientStockMovement":0,
  "refundItem":4,"refund":21,"payment":28,"expense":0,"orderItemCostSnapshot":27,"orderItem":31,
  "orderStatusHistory":0,"order":28,"branchProduct":4,"product":26,"category":1,"expenseCategory":0,
  "cashierShift":0,"auditLog":23,"userBranch":0,"customer":2,"user":2,"branch":3,"restaurant":2}
[STEP 2B.3 CLEANUP] residual (run-scoped): {every key → 0}
[STEP 2B.3 CLEANUP] table counts (baseline → after): {21 tables → "0 → 0"}
raw-driver recount after the final run: TOTAL = 6 rows, ALL in `_prisma_migrations`
  → every one of the 49 business tables is at 0 rows (no residual test data)
```

* Every fixture id carries the `cbrf-…` run prefix; deletion is child-first with
  explicit sequential `deleteMany` statements (no long interactive transaction, no
  `TRUNCATE`, nothing outside the run's own rows). Rows written by production services
  (`PaymentTransaction`, `AuditLog`, stock-restore `StockMovement` + the
  `BranchProduct` reservations they create) are reached through their parent ids.
* The suite asserts 21 monitored tables return to their exact pre-run counts **and**
  that every run-scoped residual count is 0 — verified on all 4 clean runs.
* Each scenario also created its own products/categories so that a failure can never
  be masked by another suite's data.

### 18.10 New suite counts and repeated-run results

```
$ npx tsx --test tests/accounting/refund-profitability.integration.test.ts
▶ STEP 2B.3 — Refund & Profitability integration (real MariaDB, isolated test DB)
  ✔ 21 tests — required items 1–21 (item 1 = runtime DB identity)
ℹ tests 21   ℹ suites 1   ℹ pass 21   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
EXIT=0
```

| Metric | Value |
|--------|-------|
| Total tests | **21** — `it()` count (21) equals the runner count (`ℹ tests 21`); **required items 1–21, where item 1 IS the runtime-identity assertion** (no separate extra test). The earlier sentence “1 identity assertion + 21 scenarios” over-counted by one; **corrected here from the runner output and the test definitions — the coverage was never changed** (documentation-only fix). |
| Passed / Failed / Skipped | 21 / 0 / 0 |
| Runs on the final tree | **4 consecutive clean runs** (incl. one re-run after the tsc-only type change) — identical results, exit 0 each |
| First run (before test-side fixes) | 18 passed / 3 failed — all three were **test-side** and are detailed below |
| Suite duration | ≈ 3.5–4.1 s per run (≈ 4.7–5.9 s incl. Node startup) |
| SQL integration | Real: Prisma 7 + `@prisma/adapter-mariadb` → MariaDB 11.8 on `127.0.0.1:3308`; production paths exercised: `approvalService.requestRefund/decideRefund`, `profitabilityService.getProfitabilityReport`, `computeRefundAware`, the product/branch/coverage raw SQL, `computeRefundRevenue` |

**First-run failures — all test-side, all fixed in the test (production untouched):**

1. Scenario 6 expected `ConflictError` for a *sequential* duplicate approval; the
   audited rule is `NotFoundError` (the `status: "PENDING"` pre-read no longer finds
   the row). The test now asserts the documented behaviour and additionally proves the
   real race guard in scenario 7 (where the `ConflictError` does fire).
2. Scenario 13 read `.id` off `createRefundFixture()`, which returns `void` — the test
   now holds its own refund ids.
3. Scenario 19 omitted the `amount`/`branchId` fields on its tenant-B refund fixture
   (invalid Decimal) — corrected, and the tenant-B expectations then matched exactly.

One further TypeScript-only fix (TS2322, nullable `hppUnit`/`hppTotal` inside the local
fixture helper) was made after `tsc --noEmit` flagged it; the suite was re-run afterwards
(4th clean run) to confirm the final tree.

### 18.11 Cashbook and Revenue regression results

```
$ npx tsx --test tests/accounting/cashbook.integration.test.ts   → ℹ tests 15  pass 15  fail 0  EXIT=0
$ npx tsx --test tests/accounting/revenue.integration.test.ts    → ℹ tests 19  pass 19  fail 0  EXIT=0
   (revenue residual: every run-scoped key → 0)
```

Both prior suites remain green after the shared-fixture extension (the new factories are
additive and the added monitored tables are counted/cleaned symmetrically). Suites were
run **one file at a time** (each asserts whole-table baselines; Node parallelises test
*files*).

### 18.12 TypeScript / build / diff-check results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ PASS — exit 0 (after fixing one test-side TS2322) |
| Whitespace (tracked) | `git diff --check` | ✅ PASS — exit 0 |
| Whitespace (untracked files, not covered above) | `git diff --no-index --check /dev/null <file>` over the new suite + `revenue`/`cashbook` suites + `tests/fixtures/accounting.ts` + `tests/setup.ts` + `tests/README.md` + `.env.example` + `.env.test.example` | ✅ PASS — all clean. `ACCOUNTING-INTEGRATION-TEST-PLAN.md` reports trailing spaces on lines 3–4 etc. — **intentional Markdown hard line breaks** in the document's pre-existing style (code/test files are clean) |
| Production build | `npm run build` | ✅ PASS — exit 0, `✓ Compiled successfully in 27.7s` (6 pre-existing upload-tracing warnings only) |

The build-regenerated `next-env.d.ts` was reverted afterwards (and the temporary probe
scripts removed) so the working tree contains only intentional changes.

### 18.13 Confirmed defects and unresolved discrepancies

* **No new production defect was confirmed** in the refund state machine or the
  profitability read model: all 21 scenarios matched the documented rules, and the
  write-side/read-side divergence for legacy refunds is a *documented projection
  difference*, not a mis-statement (netSales and grossProfit stay correct on both
  bases — §18.6).
* **A-9 (OPEN, not touched this phase):** `busiestHours` in the revenue report still
  filters `paymentStatus = 'PAID'` only and is therefore not derived from the canonical
  revenue set (reproduced in §17, scenario 11 of the Revenue suite). **No production
  Revenue fix was attempted**, per the phase lock.
* **F-2 (deferred, by instruction):** `src/lib/prisma.ts` still does not percent-decode
  URL credentials; only the test environment is mitigated (URL-safe credential +
  fail-fast guard in `tests/setup.ts`).
* **Legacy-refund write/read basis divergence** — recorded above (§18.6) with a
  deterministic reproduction; deliberately **not** normalised or "fixed".
* **Production readiness remains BLOCKED**: A-9 is unresolved, the test-container
  healthcheck (F-3) is still misconfigured, and STEP 2B.4/2B.5 do not exist yet.

### 18.14 Carried-forward findings F-1 / F-2 / F-3 / A-9

| Finding | Status in STEP 2B.3 |
|---------|---------------------|
| **F-1** — `DATABASE_URL` safety drift (`.env.test` once pointed at the application DB) | ✅ **Remains fixed and re-verified this phase.** Both `.env.test` URLs target `127.0.0.1:3308/restaurant_app_test`; `tests/setup.ts` still pins `DATABASE_URL := TEST_DATABASE_URL` before any import; the safety gate stays active. |
| **F-2** — percent-encoded credential handling in `src/lib/prisma.ts` | ✅ **Test mitigation intact; production issue still deferred as instructed.** The fixture password is URL-safe, the fail-fast guard is unchanged, and `src/lib/prisma.ts` was **not** modified. |
| **F-3** — test-container healthcheck reports `unhealthy` (missing `mysqladmin`) | ✅ **Unchanged; container NOT recreated** as instructed. Connectivity re-verified (suite + raw driver) — fully functional. |
| **A-9** — Revenue `busiestHours` predicate discrepancy | ⏳ **OPEN — not modified in this phase** (phase lock). Still the reason production readiness is blocked. |
| Test schema count | **49 tables** — confirmed again this phase via `information_schema` (not 107). |
| Historical credential literal | Redacted from the plan + `.env.test.example`; the credential itself was already inactive. |

### 18.15 Updated overall progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1 | Database topology audit | ✅ DONE |
| 2A.2 | Preflight verification | ✅ DONE |
| 2A.3-R | Admin access recovery | ✅ DONE |
| 2A.4 | Isolated test container created | ✅ DONE |
| 2A.5 | Schema initialized | ✅ DONE |
| 2A.5-F | Final database safety verification | ✅ DONE |
| 2B.1 | Cashbook integration tests | ✅ DONE — 15/15 pass |
| 2B.2 | Revenue & Reporting integration tests | ✅ DONE — 19/19 pass |
| **2B.3** | **Refund & Profitability integration tests** | **✅ DONE — 21/21 pass** |
| 2B.4 | P&L integration tests | ✅ DONE — 24/24 pass (see §19.16) |
| 2B.5 | Integrity (M2 SQL) integration tests | ⏳ NOT STARTED |
| Final | Cross-module verification | ⏳ NOT STARTED |

**Existing integration tests implemented so far: 15 + 19 + 21 = 55 passing**
(Cashbook 15, Revenue 19, Refund & Profitability 21) — **as of STEP 2B.3**; STEP 2B.4
adds 24 more → **79** (see §19.16). **Production readiness remains BLOCKED**
(A-9 open, 2B.4/2B.5 outstanding, F-2/F-3 deferred).

### 18.16 STEP 2B.4 readiness (P&L)

| Item | Status |
|------|--------|
| Isolated DB + fail-closed bootstrap + `DATABASE_URL` pin | ✅ READY |
| Fixtures: tenant/branch/user/customer/category/product/order/order-item/snapshot/branch-product/refund/payment/`PaymentTransaction` + run-scoped cleanup over 21 tables | ✅ READY and reusable (`createOrderItemCostSnapshotFixture`, `createBranchProductFixture` added this phase) |
| Refund engine coverage (21 scenarios incl. concurrency, rounding, tenant/branch scoping) | ✅ COMPLETE |
| Profitability read-model coverage (coverage states, legacy, retained COGS, `revenueWithoutItems`) | ✅ COMPLETE (first automated coverage ever) |
| Documented semantics the P&L phase must reuse: revenue set (order mirror or REFUNDED payment), refund impact on **approval date**, COGS only from `SNAPSHOTTED` snapshots, partial-refund-only release, full refund keeps all COGS, empty coverage = unknown profit | ✅ DOCUMENTED (§18.2 R-7/R-8/R-10) and asserted |
| `npx tsc --noEmit` / `git diff --check` / untracked whitespace / `npm run build` | ✅ ALL GREEN |
| P&L implementation / M2 SQL integration | ⏳ NOT STARTED (phase lock respected) |

**Recommended first checks for STEP 2B.4:** the P&L service's expense/hpp basis against
the same COGS snapshot rules proven here (a P&L that re-derives COGS from current HPP or
from recipes would contradict §18.5 scenario 15), plus re-use of this suite's
single-order-window pattern when the P&L aggregation is order-window scoped.

**STEP 2B.3 STOPS HERE.** STEP 2B.4 was not started.

### 18.17 Final Git status

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the start of this phase (and to the end of STEP 2B.2): the four
pre-existing M2 files plus the pre-existing untracked docs, with `tests/` added.
`next-env.d.ts` was reverted after the build, no temporary probe scripts remain, and
**no commit, no push, no merge, no deploy** was performed.

---

## 19. STEP 2B.4 — PROFIT & LOSS (P&L) INTEGRATION TEST RESULTS

**Date:** 2026-10-14  
**Scope lock (phase boundary — respected):** P&L integration tests only. **No** M2 SQL
integration tests, **no** production Accounting change, **no** A-9/F-2 production fix.
**Status:** ✅ COMPLETE — 24 tests, 24 passed, 0 failed, 0 skipped (3 consecutive clean
runs on the final tree). Cashbook 15/15, Revenue 19/19 and Refund & Profitability 21/21
preserved.

### 19.1 Initial Git status (start of this phase)

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

All four uncommitted Accounting M2 files and all three prior integration suites were
preserved untouched.

### 19.2 Audited P&L business rules and formulas (recorded BEFORE implementation)

Source of truth: `src/services/accounting/pnl.service.ts` (`getPnlReport`),
`src/services/accounting/pnl.rules.ts` (`computeNetProfit`),
`src/services/accounting/pnl.types.ts` (`PnlQuerySchema`, `PnlSummary`), and the
composed engines (`profitability/profitability.service.ts`, `report/report.service.ts`,
`accounting/expense.service.ts`). Nothing below is assumed — each rule was read from code
and then asserted.

| # | Audited rule | Source |
|---|--------------|--------|
| P-1 | `getPnlReport(restaurantId, rawQuery, branchFilters?)` is a **read-only composition**; it writes nothing and introduces no new engine. `restaurantId` comes from the session argument, never from the query. | `pnl.service.ts` |
| P-2 | Query contract: `PnlQuerySchema.safeParse(rawQuery ?? {})` → `ValidationError` on failure. `period` ∈ {today, yesterday, week, month, custom} (default `month`); `startDate`/`endDate` must be strict `YYYY-MM-DD` **and** a real calendar date; `custom` requires both; `startDate <= endDate`; `orderType` ∈ {DINE_IN, TAKEAWAY, DELIVERY}; `paymentMethod` ∈ {KASIR, QRIS}. Unknown/extra keys are ignored (not rejected). | `pnl.types.ts` |
| P-3 | Period resolution reuses `resolveReportRange` (custom = local 00:00:00 → 23:59:59.999). | `report.service.ts` |
| P-4 | Revenue/Net Sales/Tax/Service/Discount/COGS/coverage/refund state are delegated to `profitabilityService.getProfitabilityReport` with the SAME filters and scope, with `pagination {page:1, limit:1}` — so the summary is computed over **all** products while the product table is trimmed. | `pnl.service.ts` |
| P-5 | Revenue set & date basis (inherited): non-`CANCELLED` order **and** (`Order.paymentStatus = 'PAID'` **or** an existing `Payment.status = 'REFUNDED'`), attributed to **`Order.createdAt`**. | `report.service.ts`, `profitability.service.ts` |
| P-6 | `grossSales` = Σ `Order.grandTotal` over the revenue set; `totalDiscount`/`totalTax`/`totalServiceCharge` = Σ of the respective order columns. | `pnl.service.ts` |
| P-7 | `netSales` = the **product basis**: Σ(`grandTotal` − tax − serviceCharge) − refund share on the same basis (never `grossSales − refund`). | `computeRefundRevenue` |
| P-8 | Refunds are attributed to **`Refund.approvedAt`** with a date-free order scope; `totalRefund` = Σ approved refund amounts; a refund-only period is legitimately negative. | `profitability.service.ts`, `pnl.service.ts` |
| P-9 | COGS comes only from `OrderItemCostSnapshot.status = 'SNAPSHOTTED'`; the CURRENT product/branch HPP (`BranchProduct.manualHpp`, `Product.price`) is never consulted. | `profitability.service.ts` |
| P-10 | Coverage is decided by **status, never by value**: `coverageComplete = totalItems > 0 && costed === totalItems`; empty scope = `NO_ITEMS` (unknown); an explicit `SNAPSHOTTED` 0 IS covered; `LEGACY` = COMPLETED with no snapshot; `PARTIAL` = mixed. | `profitability/coverage.ts` |
| P-11 | Refund-aware COGS: only **PARTIAL** refunds release cost. Item-based refunds release the frozen `Σ RefundItem.reversedCogs`; legacy amount-only refunds fall back to the documented pro-rata `round2(coveredCost × min(1, refund/grandTotal))`. A fully refunded order releases **nothing**. | `profitability.service.ts` |
| P-12 | `grossProfit` = `netSales − retainedCogs`, **`null` whenever coverage is incomplete**; `cogs` = `historicalCogs − cogsReversal` (retained COGS). | `profitability.service.ts` |
| P-13 | **`netProfit` = `Gross Profit − Operating Expenses` and is `null` whenever `grossProfit` is `null`** (never `revenue − 0`, never `−expenses`). | `pnl.rules.ts` |
| P-14 | Operating expenses: Σ `Expense.amount` scoped by `restaurantId` + `branchFilters`, bounded to `[startOfLocalDay(range.start), endOfLocalDay(range.end)]` — i.e. **`spentAt` is the only date basis** and the window is the FULL local day (wider than the revenue window for `today`). `opex.byCategory` is grouped by `categoryId` (name resolved, `total` desc) with a `count` per category. | `pnl.service.ts` |
| P-15 | `filters.branchId` is a **HINT** — echoed back, never used to scope; scoping comes from the `branchFilters` argument (server-resolved `authorizedBranches`). Expenses follow the same scope as revenue. | `pnl.service.ts`, `/api/admin/accounting/pnl/route.ts` |
| P-16 | Disclosure block: `netProfitProvisional: true` (only `Expense` is counted as operating cost), `expenseDataEmpty` = (expense count === 0), `purchaseExcluded: true` (a Purchase is inventory, never an expense), `revenueWithoutItems` inherited from Profitabilitas, and `dateBasis` = {revenue: `order.createdAt`, refund: `refund.approvedAt`, cogs: `order.createdAt`, expense: `expense.spentAt`}. | `pnl.service.ts` |
| P-17 | The P&L summary exposes **no margin percentage** (unlike the Profitabilitas read-model): gross/net margin are derived arithmetic on the returned values. Asserted as such instead of inventing a field. | `pnl.types.ts` (`PnlSummary`) |
| P-18 | Date bases are deliberately heterogeneous: **Cashbook** (cash movement dates) and **Revenue/P&L** (order date) are **not** required to match for the same calendar window. | audited in §16/§17, re-asserted here (scenario 23) |

**Rounding/precision:** every monetary value is produced through `round2`/`num`
(`src/lib/money.ts`, half-up at the final boundary) over Prisma `Decimal` aggregates
(`Decimal(10,2)` order/line columns, `Decimal(12,2)` expense amount). Scenario 20 pins
this with a non-terminating unit share and a repeating pro-rata fraction.

### 19.3 Exact files changed

| File | Change |
|------|--------|
| `tests/accounting/pnl.integration.test.ts` | **NEW** (2 059 lines) — **24 tests = the 22 requested scenarios** (request items 1–22) **+ 2 audited extras** (test 18 = expense-window boundary; test 24 = query contract + canonical composition). Item 1 **is** the runtime-identity assertion. Real Prisma/MariaDB, real `getPnlReport`. See the item mapping in §19.4. |
| `tests/fixtures/accounting.ts` | Extended additively: `createExpenseFixture` (explicit `spentAt` **and** `createdAt`, needed to prove the date basis) + `ExpenseMethod` import |
| `ACCOUNTING-INTEGRATION-TEST-PLAN.md` | This report (§19 + header + trackers) **and** the §18/§19.10 count reconciliation for STEP 2B.3 |
| `tests/README.md` | Suite list, P&L suite section, corrected 2B.3 wording, 79-test total |

**No production file was touched** (`git diff --name-only` = the four pre-existing M2
files only). No schema change, no migration, no `prisma db push`/`reset`, no container
recreation.

### 19.4 Test scenarios and fixture amounts

Each scenario owns a dedicated calendar day (no two scenarios share one); the two
service-driven refund scenarios relocate only the read-side `approvedAt` (documented in
the suite header) and the boundary scenario uses exact deltas. Run prefix: `cbpnl-…`.

**Requested-item mapping** (request items 1–22 → suite tests): 1→1 · 2→2 · 3→3 · 4→4 ·
5→5 · 6→6 · 7→7 · 8→8 · 9→9 · 10→10 · 11→11 · 12→12 · 13→13 · 14→14 · 15→15 · 16→16 ·
17→17 · **18→19** · **19→20** · **20→21** · **21→22** · **22→23**. The two remaining tests are
the audited extras required by the implementation: **test 18** (the expense-window
boundary semantics of P-14) and **test 24** (the query contract and canonical composition
of P-2/P-4). No requested scenario is missing and none was replaced.

| # | Scenario | Window | Deterministic fixture |
|---|----------|--------|-----------------------|
| 1 | Runtime isolated DB identity | — | `SELECT DATABASE()/USER()` + `EXPECTED_TEST_DB` + `DATABASE_URL` |
| 2 | Empty period | Nov 1 | no rows |
| 3 | Single paid order + expense | Oct 1 | order 100 000 · snapshot 60 000 · expense 25 000 |
| 4 | Multiple paid orders | Oct 2 | orders 100 000 / 50 000 (snapshots 60 000 / 20 000) · expenses 10 000 + 5 000 (2 categories) |
| 5 | Uncollected orders | Oct 3 | 4 orders (UNPAID/PENDING/FAILED/EXPIRED, mirrors UNPAID) + 1 PAID order 20 000 (snapshot 12 000) |
| 6 | CANCELLED order | Oct 4 | CANCELLED 999 999 + PAID 500 000 + REFUNDED 499 999 payments + expense 5 000 |
| 7 | Payment attempts | Oct 5 | order 200 000 (3×PAID 60k/70k/70k, PENDING 30k, CANCELLED 30k) · snapshot 120 000 |
| 8 | Tax / service / discount | Oct 6 | subtotal 100 000, discount 5 000, tax 11 000, service 4 000, grandTotal 110 000 · snapshot 60 000 · expense 10 000 |
| 9 | Historical vs current HPP | Oct 7 | order 100 000 · snapshot 60 000 · `BranchProduct` MANUAL `manualHpp` 99 000 |
| 10 | Complete coverage | Oct 8 | order 100 000 (2 items; snapshots 30 000 + 20 000) · expense 20 000 |
| 11 | missing/partial coverage | Oct 9 + Oct 10 | (a) LEGACY order 100 000 with no snapshot + headless 70 000 + expense 15 000. (b) 80 000 = SNAPSHOTTED 20 000 + `NO_RECIPE` NULL |
| 12 | Explicit zero HPP | Oct 11 | order 50 000 · snapshot `SNAPSHOTTED` 0/0 · expense 10 000 |
| 13 | Partial item-based refund | Oct 12 | order 125 000 (A 3×25 000 → 45 000; B 1×50 000 → 20 000) · refund A qty 2 (decoy amount 1) · expense 8 000 |
| 14 | Full item-based refund | Oct 13 | order 50 000 (2×25 000 → 30 000) · refund qty 2 = 50 000 · expense 5 000 |
| 15 | Legacy refund | Oct 15 | order 100 000 (A 2×25 000 → 30 000; B 1×50 000 → 20 000) · legacy refund 40 000 · expense 10 000 |
| 16 | Refund-only period | Oct 16 / Sep 26 | order 120 000 created Sep 26 (snapshot 72 000) · refund 40 000 approved Oct 16 · expense 5 000 |
| 17 | Expense date basis | Oct 17 / Sep 28 / Sep 1 | order 60 000 (snapshot 36 000) · expense 30 000 `spentAt` Oct 17 · expense 12 000 `spentAt` Sep 28 · back-dated row 7 000 (`createdAt` Sep 1, `spentAt` Oct 17) |
| 18 | Expense window boundary | today / tomorrow | expenses at today 00:00:00.100 (111.11), today 23:30 (222.22), tomorrow 00:00:00.100 (333.33) + a COVERED order 40 000 |
| 19 | Multi-order + categories | Oct 18 | orders 150 000 / 80 000 / 70 000 (snapshots 90 000 / 40 000 / 30 000) · expenses 20 000 + 15 000 (cat 1) + 5 000 (cat 2) |
| 20 | Rounding / precision | Oct 19 + Oct 20 | (a) order 100 000 = 3 units, snapshot 12 000.11/u (36 000.33) · refund qty 1 · expenses 8 888.88 + 0.02 + 0.01. (b) order 30 000 (snapshot 10 000) · legacy refund 10 000 · expense 3 333.33 |
| 21 | Tenant isolation | Oct 21 | tenant B: order 200 000 (snapshot 120 000) + expense 50 000 |
| 22 | Branch isolation | Oct 22 | A1: order 100 000 (snapshot 60 000) + expense 10 000; A2: order 50 000 (snapshot 30 000) + expense 20 000 |
| 23 | Cross-period | Sep 25 / Sep 27 / Oct 23 | order 120 000 created Sep 25, collected Oct 23 (snapshot 72 000) · refund 40 000 approved Oct 23 · expense 15 000 `spentAt` Sep 27 |
| 24 | Query contract + composition | Oct 24 | 3 orders (100 000 DINE_IN/KASIR, 70 000 TAKEAWAY/QRIS, 50 000 DINE_IN/QRIS; snapshots 60 000/30 000/20 000) |

### 19.5 Expected versus actual financial calculations

| Scenario | Expected (audited rule) | Actual | Verdict |
|----------|------------------------|--------|---------|
| 2 | all zero; `grossProfit`/`netProfit` `null`; `NO_ITEMS`; opex 0/0/[] | exact match | ✅ MATCH |
| 3 | sales 100 000 · net 100 000 · cogs 60 000 · GP 40 000 · opex 25 000 · **NP 15 000** | exact match | ✅ MATCH |
| 4 | sales/net 150 000 · cogs 80 000 · GP 70 000 · opex 15 000 · NP 55 000 · byCategory [10 000, 5 000] | exact match | ✅ MATCH |
| 5 | sales 20 000 only · cogs 12 000 · GP 8 000 · `unpaidCompleted {4, 4, 276 000}` | exact match | ✅ MATCH (P-5) |
| 6 | sales 0 · GP `null` · opex 5 000 · **NP `null`** | exact match | ✅ MATCH (P-13) |
| 7 | sales 200 000 **once** · cogs 120 000 · GP/NP 80 000 | exact match | ✅ MATCH |
| 8 | gross 110 000 · disc 5 000 · tax 11 000 · service 4 000 · netSales **95 000** = 110 000 − 11 000 − 4 000 (≠ gross − refund) · GP 35 000 · NP 25 000 | exact match | ✅ MATCH (P-7) |
| 9 | cogs 60 000 (snapshot) — never 99 000 (current manual HPP) | exact match | ✅ MATCH (P-9) |
| 10 | coverage `{2,2,0,0,0}` · GP 50 000 · margins 50 % / 30 % | exact match | ✅ MATCH |
| 11 | (a) `LEGACY` · cogs 0 · GP `null` · **NP `null`** with opex 15 000 · `revenueWithoutItems {1, 70 000}`. (b) `PARTIAL` · cogs 20 000 · GP/NP `null` even with opex 0 | exact match | ✅ MATCH (P-10/P-13) |
| 12 | `COVERED` · cogs 0 · GP 50 000 · NP 40 000 · food cost 0 % · margin 100 % | exact match | ✅ MATCH |
| 13 | refund 50 000 (derived; decoy ignored) · frozen `reversedCogs` 30 000 · net 75 000 · cogs 35 000 · GP 40 000 · NP 32 000 | exact match | ✅ MATCH |
| 14 | refund 50 000 · **net 0** · reversal **0** · cogs 30 000 · GP −30 000 · NP −35 000 · `FULL` | exact match | ✅ MATCH (P-11) |
| 15 | reversal 20 000 pro-rata applied **once** (≠ 40 000) · cogs 30 000 · GP 30 000 · NP 20 000 | exact match | ✅ MATCH |
| 16 | Oct 16: sales 0 · refund 40 000 · net **−40 000** · reversal 24 000 · cogs −24 000 · `NO_ITEMS` · GP/NP `null`. Sep 26: sales/net 120 000 · cogs 72 000 · GP/NP 48 000 · refund 0 | exact match | ✅ MATCH (P-8/P-13) |
| 17 | Oct 17: opex 37 000 (service 30 000 + back-dated row 7 000) · GP 24 000 · NP −13 000. Sep 28: opex 12 000, NP `null`. Sep 1: opex 0 | exact match | ✅ MATCH (P-14) |
| 18 | `today` opex delta **333.33** (00:00 and 23:30 in), count delta 2 · tomorrow delta 333.33, count 1 · `range.end` ≤ now yet the later-today expense is counted | exact match | ✅ MATCH (P-14, audited asymmetry) |
| 19 | sales/net 300 000 · cogs 160 000 · GP 140 000 · opex 40 000 · **NP 100 000** · byCategory [35 000 (×2), 5 000] · margins 46.67 % / 33.33 % | exact match | ✅ MATCH |
| 20 | (a) refund 33 333.33 · reversal 12 000.11 · net 66 666.67 · cogs 24 000.22 · GP 42 666.45 · opex 8 888.91 · NP 33 777.54. (b) reversal 3 333.33 · cogs 6 666.67 · GP 13 333.33 · NP 10 000 | exact match | ✅ MATCH |
| 21 | tenant B: 200 000 / cogs 120 000 / GP 80 000 / opex 50 000 / NP 30 000; tenant A: all zero, GP/NP `null` | exact match | ✅ MATCH |
| 22 | all 150 000/90 000/GP 60 000/opex 30 000/NP 30 000 · `[A1]` 100 000/60 000/40 000/10 000/30 000 · `[A2]` 50 000/30 000/20 000/20 000/**0** · hint-only → unscoped | exact match | ✅ MATCH (P-15) |
| 23 | Sep 25: 120 000/72 000/GP 48 000/NP 48 000, refund 0 · Sep 27: opex 15 000, NP `null` · Oct 23: sales 0, refund 40 000, net −40 000, reversal 24 000, cogs −24 000, GP/NP `null` · Cashbook Oct 23 in 120 000 / out 40 000 | exact match | ✅ MATCH (P-18) |
| 24 | unfiltered 220 000 · DINE_IN 150 000 · QRIS 120 000 · both 50 000 · 5 invalid inputs → `ValidationError` · injected `restaurantId` ignored · P&L summary ≡ Profitabilitas summary (products trimmed to 1 of 2) | exact match | ✅ MATCH (P-4/P-2) |

**No financial value differed from the audited rules.** One assertion failed on the first
run and was **test-side** (see §19.10) — corrected in the test, production untouched.

### 19.6 Historical COGS and incomplete-coverage behaviour

| Case | Fixture | Coverage buckets | `cogsState` | `coverageComplete` | `cogs` | `grossProfit` | `netProfit` |
|------|---------|------------------|-------------|--------------------|--------|---------------|-------------|
| Full coverage | Oct 18 (3 orders) | `{3,3,0,0,0}` | `COVERED` | ✅ | 160 000 | 140 000 | 100 000 |
| Explicit zero HPP | Oct 11 | `{1,1,0,0,0}` | `COVERED` | ✅ | **0** | 50 000 | 40 000 |
| Partial (NO_RECIPE) | Oct 10 | `{2,1,1,0,0}` | `PARTIAL` | ❌ | 20 000 | **`null`** | **`null`** (even with opex 0) |
| Legacy (no snapshot) | Oct 9 | `{1,0,0,1,0}` | `LEGACY` | ❌ | 0 | **`null`** | **`null`** (with opex 15 000) |
| Empty scope | Nov 1 / Oct 16 / Sep 27 | `{0,0,0,0,0}` | `NO_ITEMS` | ❌ | 0 | **`null`** | **`null`** |
| Current HPP differs | Oct 7 | `{1,1,0,0,0}` | `COVERED` | ✅ | 60 000 (never 99 000) | 40 000 | 40 000 |

Two load-bearing rules are therefore pinned: **a missing cost is never 0 (it makes the
profit unknown)**, and **expenses are recognised even when the profit is unknown**
(`operatingExpenses` is reported; `netProfit` stays `null`).

### 19.7 Legacy refund / COGS reconciliation evidence (carried forward from 2B.3)

* The legacy path writes **no** `RefundItem` row (asserted: `refundItem.count = 0`), so
  there is no stored write-side reversal — a *stored-movement vs read-time-projection*
  distinction, not a missing record.
* The P&L **reads the same historical cost basis** as Profitabilitas and inherits its
  reversal verbatim: for Oct 15 the P&L `cogsReversal` (20 000), `cogs` (30 000),
  `netSales` (60 000) and `grossProfit` (30 000) were asserted **equal** to the direct
  `profitabilityService` summary for the same window.
* The reversal is applied **exactly once**: expected 20 000, and explicitly asserted
  `≠ 40 000` (no double count) — the read model derives it from the `Refund` row, never
  from the mirror `PaymentTransaction`.
* Item-based refunds keep their STEP 2B.3 semantics: the frozen `reversedCogs` is used
  exactly (30 000 in scenario 13, 12 000.11 in scenario 20), and a full refund releases
  **nothing** while retaining all COGS (scenario 14: net 0, GP −30 000).
* Gross and net profit stay internally consistent on both bases
  (`NP = GP − opex` asserted numerically in every scenario).
* **Verdict (unchanged):** the legacy/allocated difference is a documented divergence of
  two disjoint projections (one refund is either item-based or legacy, never both), **not
  a P&L defect**; still under cross-module review, still not normalised. No production
  code was changed.

### 19.8 Date-basis and cross-period evidence

| Source | Date basis | Proven by |
|--------|------------|-----------|
| Revenue (incl. `grossSales`, COGS scope) | `Order.createdAt` | 23: the Sep 25 order is revenue in September although it was **collected Oct 23** |
| Refund impact (`totalRefund`, `cogsReversal`) | `Refund.approvedAt` | 16 (refund-only October period, September order untouched), 23 |
| Expense (`operatingExpenses`) | `Expense.spentAt` | 17 (a Sep-28-`spentAt` expense entered today lands in September; a `spentAt`-Oct-17 row created Sep 1 lands in October) |
| COGS | `Order.createdAt` | 23 (October has no COGS of its own) |
| **Cashbook** | cash-movement dates | 23: the same Oct 23 window shows in 120 000 / out 40 000 in Cashbook while P&L revenue is **0** — asserted as a deliberate divergence, never as an error |

Cross-period partition: `cogs(Sep 26) + cogs(Oct 16) = 72 000 − 24 000` (scenario 16) and
the four bases land in four different periods in scenario 23.

### 19.9 Tenant and branch isolation

```
scenario 21 — tenant isolation
  tenant B: grossSales 200000 · cogs 120000 · GP 80000 · opex 50000 (its own expense) · NP 30000
  tenant A: grossSales 0 · cogs 0 · NO_ITEMS · GP null · opex 0 (count 0) · NP null
  tenant A with branchFilters [BR_B1]: still 0 / 0
scenario 22 — branch isolation (tenant A)
  unfiltered: sales 150000 · cogs 90000 · GP 60000 · opex 30000 · NP 30000
  [BR_A1]   : sales 100000 · cogs 60000 · GP 40000 · opex 10000 (count 1) · NP 30000
  [BR_A2]   : sales  50000 · cogs 30000 · GP 20000 · opex 20000 (count 1) · NP     0
  branchId hint only (no branchFilters): filters.branchId echoed, totals UNSCOPED (150000/30000)
  [BR_B1] (foreign tenant branch): 0 / 0 / count 0
```

Expenses follow the same `branchFilters` scope as revenue (P-14/P-15); the `branchId`
hint can never narrow a query, and the route still validates it with
`assertBranchInScope` before the service runs.

### 19.10 Test counts and repeated runs

```
$ npx tsx --test tests/accounting/pnl.integration.test.ts
▶ STEP 2B.4 — P&L integration (real MariaDB, isolated test DB)
  ✔ 24 tests — 22 requested scenarios + 2 audited extras (item 1 = runtime DB identity)
ℹ tests 24   ℹ suites 1   ℹ pass 24   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ todo 0
EXIT=0
```

| Metric | Value |
|--------|-------|
| Total tests | **24** — `it()` count (24) equals the runner count (`ℹ tests 24`). Mapping: tests 1–17 and 19–23 = requested items 1–22 (item 1 IS the identity assertion); test 18 and test 24 are the two audited extras justified by P-14 and P-2/P-4 |
| Passed / Failed / Skipped | 24 / 0 / 0 |
| Runs on the final tree | **3 consecutive clean runs** (runs 2–4; run 1 = first implementation) — exit 0 each |
| First run | 23 passed / 1 failed — **test-side only** (below) |
| Suite duration | ≈ 3.6–4.1 s per run |
| SQL integration | Real: Prisma 7 + `@prisma/adapter-mariadb` → MariaDB 11.8 on `127.0.0.1:3308`; production paths: `getPnlReport`, `profitabilityService.getProfitabilityReport`, `computeRefundRevenue`, `computeRefundAware`, the coverage/product raw SQL, `expense` aggregation, plus the real refund engine for scenarios 13/14/20 and `getCashbook` for scenario 23 |

**First-run failure — test-side, fixed in the test (production untouched):** scenario 18
asserted an absolute "tomorrow" expense total, but `tomorrow` (= Oct 15) is the dedicated
day of scenario 15, whose own 10 000 expense therefore landed in that window
(10 333.33 vs 333.33 expected). The test now measures **deltas** for both the `today` and
the `tomorrow` window, so it is exact regardless of which fixtures exist on those days.

**STEP 2B.3 documentation reconciliation (requested in this phase):** the STEP 2B.3 report
said "21 tests (1 identity assertion + 21 scenarios)", which double-counted the identity
assertion. Source of truth used: the runner output (`ℹ tests 21`) and the test
definitions (`grep -c 'it("' = 21`). The wording was corrected to **"21 tests covering
required items 1–21, where item 1 IS the runtime-identity assertion"** in §18.4, §18.10
and `tests/README.md`. **Test coverage was not changed to manufacture a count.**

### 19.11 Cleanup verification

```
[STEP 2B.4 CLEANUP] rows deleted: {"paymentTransaction":3,"stockMovement":3,"ingredientStockMovement":0,
  "refundItem":3,"refund":7,"payment":40,"expense":29,"orderItemCostSnapshot":37,"orderItem":38,
  "orderStatusHistory":0,"order":35,"branchProduct":4,"product":34,"category":2,"expenseCategory":3,
  "cashierShift":0,"auditLog":29,"userBranch":0,"customer":2,"user":2,"branch":3,"restaurant":2}
[STEP 2B.4 CLEANUP] residual (run-scoped): {every key → 0}
[STEP 2B.4 CLEANUP] table counts (baseline → after): {21 tables → "0 → 0"}
raw-driver recount before the runs: TOTAL = 6 rows, ALL in `_prisma_migrations`
  (schema metadata, not leaked fixtures) → every one of the 49 business tables at 0 rows
```

* Every fixture id carries the `cbpnl-…` run prefix; deletion is child-first with explicit
  sequential `deleteMany` statements (no interactive transaction, no `TRUNCATE`, nothing
  outside the run's own rows). Rows written by production services (`PaymentTransaction`,
  `AuditLog`, stock-restore `StockMovement` + `BranchProduct` reservations) are reached
  through their parent ids.
* The suite asserts 21 monitored tables return to their exact pre-run counts **and** that
  every run-scoped residual count is 0 — verified on all 3 clean runs.

### 19.12 Previous-suite regression results

Executed **sequentially, one file at a time** (each suite asserts whole-table baselines):

```
$ npx tsx --test tests/accounting/cashbook.integration.test.ts
  ℹ tests 15   ℹ pass 15   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0      EXIT=0
$ npx tsx --test tests/accounting/revenue.integration.test.ts
  ℹ tests 19   ℹ pass 19   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0      EXIT=0
$ npx tsx --test tests/accounting/refund-profitability.integration.test.ts
  ℹ tests 21   ℹ pass 21   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0      EXIT=0
```

All three prior suites remain green after the additive fixture change
(`createExpenseFixture` + the `ExpenseMethod` import; nothing existing was modified).

### 19.13 TypeScript / build / whitespace results

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | ✅ PASS — exit 0 |
| Whitespace (tracked) | `git diff --check` | ✅ PASS — exit 0 |
| Whitespace (untracked, not covered above) | `git diff --no-index --check /dev/null <file>` over `tests/accounting/pnl.integration.test.ts`, `tests/accounting/refund-profitability.integration.test.ts`, `tests/fixtures/accounting.ts`, `tests/README.md` | ✅ PASS — all clean (the plan document's trailing spaces are intentional Markdown hard breaks) |
| Production build | `npm run build` | ✅ PASS — exit 0, `✓ Compiled successfully in 9.8s` (6 pre-existing upload-tracing warnings only) |

The build-regenerated `next-env.d.ts` was reverted afterwards and the temporary safety-gate
probe script removed, so the working tree holds only intentional changes.

### 19.14 Confirmed defects and limitations

* **No production defect was confirmed in the P&L read-model.** All 24 scenarios matched
  the audited rules; the composition is verifiably canonical (P&L summary ≡ Profitabilitas
  summary, field by field).
* **P-19 (documented limitation, not a defect):** the P&L **contract exposes no margin
  percentage** — gross/net margins are derived arithmetic (`GP/netSales`, `NP/netSales`),
  asserted against fixed expected values (46.67 % / 33.33 % in scenario 19). If a margin
  field is wanted in the UI it must be added deliberately in a future phase.
* **P-20 (documented asymmetry, audited not "fixed"):** for `period = today`, the revenue
  window ends at the request time (`range.end = now`) while the **expense** window is
  widened to the end of the local day, so an expense dated later today is included
  (scenario 18). Deterministic and harmless, but it means a same-day "today" P&L can
  include expenses that are not yet "past".
* **P-21 (inherited disclosure):** `netProfitProvisional` is always `true` because only
  `Expense` rows are counted as operating cost (payroll/rent/depreciation are not
  represented), and `purchaseExcluded` is always `true` (a Purchase is inventory whose cost
  becomes COGS when sold — counting it again would double-count). Both asserted.
* **A-9 (OPEN, untouched):** the Revenue `busiestHours` predicate discrepancy remains —
  **no production fix was attempted** in this phase.
* **F-2 (deferred by instruction):** `src/lib/prisma.ts` still does not percent-decode URL
  credentials; the isolated test environment is mitigated (URL-safe credential + fail-fast
  guard).
* **Legacy refund write/read divergence:** unchanged (§19.7), reported, not normalised.
* **Production readiness remains BLOCKED**: A-9 open, F-3 container healthcheck still
  misconfigured, STEP 2B.5 and the cross-module verification not started.

### 19.15 Carried-forward findings

| Finding | Status in STEP 2B.4 |
|---------|---------------------|
| **F-1** — `DATABASE_URL` safety drift (`.env.test` once pointed at the application DB) | ✅ **Fixed and re-verified this phase.** Both `.env.test` URLs = `127.0.0.1:3308/restaurant_app_test`; the runtime SQL identity is the test DB; `tests/setup.ts` still pins `DATABASE_URL := TEST_DATABASE_URL` before any import |
| **F-2** — percent-encoded credential parsing in `src/lib/prisma.ts` | ✅ **Test mitigation intact; production issue still deferred** — `src/lib/prisma.ts` was not modified |
| **F-3** — test-container healthcheck misconfiguration | ✅ **Unchanged; container NOT recreated.** DB fully functional (suites + raw driver) |
| **A-9** — Revenue `busiestHours` non-canonical predicate | ⏳ **OPEN — not modified in this phase** |
| Legacy refund / COGS projection difference | ⏳ **Under cross-module review**; re-asserted end-to-end through the P&L (§19.7), still no production change |
| Isolated test schema count | **49 tables** — re-verified this phase via `information_schema` |
| `_prisma_migrations` rows | **6 rows = schema metadata**, explicitly not business fixtures (raw-driver recount) |
| Historical credential literals | **Redacted** (the only remaining occurrences are `<REDACTED_TEST_USER_PASSWORD>` placeholders); the credential itself was already inactive |
| STEP 2B.3 test-count wording | ✅ **Reconciled** from the runner output/test definitions (§19.10) |

### 19.16 Updated overall progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1 | Database topology audit | ✅ DONE |
| 2A.2 | Preflight verification | ✅ DONE |
| 2A.3-R | Admin access recovery | ✅ DONE |
| 2A.4 | Isolated test container created | ✅ DONE |
| 2A.5 | Schema initialized | ✅ DONE |
| 2A.5-F | Final database safety verification | ✅ DONE |
| 2B.1 | Cashbook integration tests | ✅ DONE — 15/15 pass |
| 2B.2 | Revenue & Reporting integration tests | ✅ DONE — 19/19 pass |
| 2B.3 | Refund & Profitability integration tests | ✅ DONE — 21/21 pass |
| **2B.4** | **P&L integration tests** | **✅ DONE — 24/24 pass** |
| 2B.5 | Integrity (M2 SQL) integration tests | ⏳ NOT STARTED |
| Final | Cross-module verification | ⏳ NOT STARTED |

**Integration tests implemented so far: 15 + 19 + 21 + 24 = 79 passing**
(Cashbook 15, Revenue 19, Refund & Profitability 21, P&L 24).
**Production readiness remains BLOCKED** (A-9 open; 2B.5 and the cross-module
verification outstanding; F-2/F-3 deferred).

### 19.17 STEP 2B.5 readiness (M2 integrity SQL)

| Item | Status |
|------|--------|
| Isolated DB + fail-closed bootstrap + `DATABASE_URL` pin (re-verified this phase) | ✅ READY |
| Fixtures: tenants/branches/users/customers/categories/products/branch-products/orders/order-items/snapshots/payments/`PaymentTransaction`/refunds/`RefundItem`/**expenses**/expense categories + run-scoped cleanup over 21 tables | ✅ READY (`createExpenseFixture` added this phase) |
| Shared full-window pattern (dedicated day per scenario, single-order windows) and delta pattern for shared windows | ✅ DOCUMENTED (this suite) |
| Canonical semantics now proven end-to-end: revenue set + order-date basis, approval-date refund attribution, snapshot-only COGS, partial-only release, full refund retains cost, `NO_ITEMS` never a covered profit, `netProfit null` propagation | ✅ ASSERTED (2B.2/2B.3/2B.4) |
| M2 integrity SQL integration tests | ⏳ NOT STARTED (phase lock respected) — only the pre-existing `src/services/accounting/integrity.unit.test.ts` exists |
| `npx tsc --noEmit` / `git diff --check` / untracked whitespace / `npm run build` | ✅ ALL GREEN |

**Recommended first checks for STEP 2B.5:** run the M2 integrity rules against a **real**
database (the existing unit test is mock/rule-level only), asserting the same invariants
the three read-models now pin — revenue set consistency, refund ≤ collected, COGS coverage
disclosure, expense date basis — and reuse this suite's dedicated-day window pattern
because integrity checks compare whole-table aggregates.

**STEP 2B.4 STOPS HERE.** STEP 2B.5 was not started — awaiting review.

### 19.18 Final Git status

```
$ git status --short
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the start of this phase (and to the end of STEP 2B.3): the four pre-existing
M2 files plus the pre-existing untracked docs, with `tests/` added. `next-env.d.ts` was
reverted after the build, no probe scripts remain, and **no commit, no push, no merge, no
deploy** was performed.

---

## 20. STEP 2B.5 — M2 INTEGRITY SQL INTEGRATION TEST RESULTS

**Date:** 2026-10-14
**Deliverable:** `tests/accounting/integrity.integration.test.ts` (**NEW**, 1 978 lines, **29 tests**) —
the 24 required coverage items from the phase brief (**§5.1–§5.24**) plus 5 audited extras
(C1 semantics, C3 branch-scoped invariants, C3 tenant-wide invariants + sample scoping, the
query contract, and the environment-gap probe).
**Source under test:** `src/services/accounting/integrity.service.ts` (`getIntegrityReport`) and
`src/services/accounting/integrity.rules.ts` — driven through **real Prisma/MariaDB**; no mocked
aggregation. The four M2 implementation files were **not modified** (mtimes 2026-10-10, this phase
ran 2026-10-14).

Mapping required item → test (the request's §5 list):
1→1 · 2→2 · 3→4 · 4→5 · 5→6 · 6→7 · 7→8 · 8→9 · 9→10 · 10→11 · 11→12 · 12→13 · 13→14 · 14→15 ·
15→16 · 16→17 · 17→18 · 18→19 · 19→20 · 20→21 · 21→22 · 22→23 · 23→24 · 24→25.
Extras: test 3 (environment gap / F-4), 26 (C1), 27 (C3 branch-scoped), 28 (C3 tenant-wide + F1
samples), 29 (query contract).

### 20.1 Initial Git status (start of this phase)

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

The four M2 files (rules/service/types/unit test) are the implementation under test and were
preserved untouched — verified by mtime (`2026-10-10 12:27–12:44`, days before this phase) and by
the final `git status` being identical to the above.

### 20.2 Audited M2 business rules (recorded BEFORE writing the tests)

| Area | Audited rule (source of truth) |
|------|-------------------------------|
| C1 | `revenueScopeWhere` (report.service) + non-CANCELLED + `items: none`; `orders` = count, `headerValue` = Σ `grandTotal`; severity `orders > 0 → CRITICAL` |
| C2 population | `orderitem oi JOIN order o` where `o.status='COMPLETED' AND o.restaurantId=?` `LEFT JOIN orderitemcostsnapshot s ON s.orderItemId = oi.id` with `s.id IS NULL` |
| Completion time | `h.done = MIN(orderstatushistory.createdAt) WHERE status='COMPLETED' GROUP BY orderId` (never `Order.updatedAt`; duplicates resolve to the EARLIEST) |
| Cutoff | `_prisma_migrations.finished_at` (else `started_at`) for `20260911143644_f5_order_item_cost_snapshot`; unresolved ⇒ **no** classification (`resolved:false`, `codeDeployUnproven:true` always) |
| Buckets | `done < cutoff` → legacyExpected; `cutoff <= done < carveFrom` → beforeFirstSnapshot; `done >= carveFrom` (or no carve) → anomaly; `done IS NULL` → unknownCompletion |
| Carve | `carveFrom = carveWindow(cutoff, marker)` — marker = `MIN(s.completedAt)` over snapshots whose `order` **agrees** on `restaurantId`, tenant-wide (K1); enabled ONLY when strictly newer than the cutoff (K2/K3); EMPTY/UNVERIFIED/at-or-before ⇒ carve OFF |
| Marker provenance | `SNAPSHOT_MIN_OBSERVED` / `SNAPSHOT_POPULATION_EMPTY` / `SNAPSHOT_MARKER_UNVERIFIED`; `population=null` ⇔ read FAILED (never "empty") |
| Evidence | `evidenceLevel` = `SNAPSHOT_OBSERVED` iff `markerAllowsCarve`; `disclosure` only for the two non-carving states; `activationUnproven` always true; **no evidence field is a severity input** |
| C3 | BRANCH_SCOPED = SNAPSHOT_ORDER_MISMATCH, SNAPSHOT_TENANT_MISMATCH, SNAPSHOTS_EXCEED_ORDER_ITEMS (share the counts' Order/branch scope); TENANT_WIDE = ORPHAN_SNAPSHOT_ITEM, SNAPSHOT_ORDER_MISSING, DUPLICATE_SNAPSHOT_PER_ITEM; `reconciled = branchReconciled && tenantReconciled`; unknown codes widen to TENANT_WIDE |
| C3 samples (F1) | tenant-wide sample ids are emitted ONLY to a whole-tenant caller |
| Severity | C2: anomaly>0 → CRITICAL; before>0 → UNKNOWN; unknown only → WARN if the cutoff resolved else UNKNOWN; nothing → OK. C1/C3: any hit → CRITICAL. overall = max(OK < WARN/UNKNOWN < CRITICAL) |
| Scope | `restaurantId` always from the caller; `branchId` is a validated HINT that narrows to one branch, otherwise the session's `authorizedBranches` apply, and `null` = all branches |

### 20.3 Exact files changed

| File | Change |
|------|--------|
| `tests/accounting/integrity.integration.test.ts` | **NEW** — 1 978 lines, 29 tests |
| `tests/fixtures/accounting.ts` | **ADDITIVE** — new `createOrderStatusHistoryFixture()`; optional `completedAt` on `createOrderItemCostSnapshotFixture()` (the marker column defaults to `now()`, so marker tests must set it); trailing-whitespace normalisation (no semantic change) |
| `ACCOUNTING-INTEGRATION-TEST-PLAN.md` | this §20 report + header |
| `tests/README.md` | suite inventory + status line |

No production source, schema, migration or application-database row was modified.

### 20.4 SQL predicates and cutoff / marker semantics (the exact code path)

```sql
-- population (counts + all three sample queries share this FROM)
FROM orderitem oi
JOIN `order` o            ON o.id = oi.orderId
LEFT JOIN orderitemcostsnapshot s ON s.orderItemId = oi.id
LEFT JOIN (SELECT orderId, MIN(createdAt) AS done FROM orderstatushistory
           WHERE status = 'COMPLETED' GROUP BY orderId) h ON h.orderId = o.id
WHERE o.status = 'COMPLETED' AND s.id IS NULL AND o.restaurantId = ? [AND o.`branchId` IN (...)]

-- marker (tenant-wide, no branch filter, tenant-consistency predicate)
SELECT COUNT(*), MIN(s.completedAt) FROM orderitemcostsnapshot s JOIN `order` o ON o.id = s.orderId
WHERE o.restaurantId = ? AND s.restaurantId = o.restaurantId
```

Boundary operators verified against the real SQL: `<` for legacy, `>= cutoff AND < carveFrom`
for the activation window, `>= carveFrom` for anomaly. The cutoff is compared as a **bound
parameter** and the fixtures store the same convention (UTC wall-clock), so the instants are
exact — proven by the ±1 ms fixture (test 5) and the at-boundary rows (tests 5/6).

### 20.5 The mandated numerical fixture — expected versus ACTUAL (real SQL)

Cutoff resolved from the ledger row `2026-09-11 16:06:57.831` → `appliedAt = 2026-09-11T16:06:57.831Z`
(the mandated value); marker `2026-09-20T00:00:00.000Z`; 8 COMPLETED orders, one item each, none
snapshotted, one marker snapshot in the tenant.

| # | Order | `done` (completion) | Expected bucket | Actual bucket (SQL) |
|---|-------|--------------------|-----------------|---------------------|
| 1 | `…-ord-mand-1` | *(no COMPLETED history)* | unknownCompletion | ✅ unknownCompletion |
| 2 | `…-ord-mand-2` | 2026-09-01T00:00:00Z | legacyExpected | ✅ legacyExpected |
| 3 | `…-ord-mand-3` | 2026-09-11T00:00:00Z | legacyExpected | ✅ legacyExpected |
| 4 | `…-ord-mand-4` | 2026-09-11T12:00:00Z | legacyExpected | ✅ legacyExpected |
| 5 | `…-ord-mand-5` | **exactly** the cutoff | beforeFirstSnapshot | ✅ beforeFirstSnapshot |
| 6 | `…-ord-mand-6` | 2026-09-15T00:00:00Z | beforeFirstSnapshot | ✅ beforeFirstSnapshot |
| 7 | `…-ord-mand-7` | **exactly** the marker | anomaly | ✅ anomaly |
| 8 | `…-ord-mand-8` | 2026-10-01T00:00:00Z | anomaly | ✅ anomaly |

**TOTAL = 8 → legacy 3 / beforeFirstSnapshot 2 / anomaly 2 / unknownCompletion 1 — exactly as
mandated, with no discrepancy.** Also asserted on the same report: `items 8`, `orders 8`,
`status CRITICAL`, `statusCutoffOnly CRITICAL`, `markerSource SNAPSHOT_MIN_OBSERVED`,
`snapshotPopulation 1`, `evidenceLevel SNAPSHOT_OBSERVED`, `disclosure null`,
`activationUnproven true`, `codeDeployUnproven true`, and samples
`[mand-7, mand-8]` (anomalies, ordered by completion) then `{mand-5, mand-6}` and `{mand-1}`.

> **The environment's own result differs, and is preserved as F-4.** The isolated test database's
> `_prisma_migrations` has **no** row for the F.5 migration, so the *unmodified* environment makes
> `resolveLegacyCutoff()` return `resolved:false` and the same eight items all land in
> `unknownCompletion` with status `UNKNOWN`. Test 3 asserts that fallback verbatim (8/8 unknown,
> `appliedAt null`, marker still observed). Tests 4–29 run with ONE reversible ledger row mirroring
> the **production** row (identical migration name, checksum, `started_at`/`finished_at` DATETIME
> literals; run-scoped id) installed in `before` and removed in `after` — a documented fixture
> maneuver, not a production change, and the SQL aggregation under test is the real one.

### 20.6 SQL versus the pure classifier

| Input set | Pure `classifyCompletionBucketV2` tally | Pure `classifyCompletionBucket` (cutoff-only) | Real SQL buckets | Match |
|-----------|----------------------------------------|-----------------------------------------------|------------------|-------|
| mandated 8 values | `{legacy 3, before 2, anomaly 2, unknown 1}` | `{legacy 3, anomaly 4, unknown 1}` | `{legacy 3, before 2, anomaly 2, unknown 1}` | ✅ bucket-for-bucket (test 21) |
| ±1 ms boundary 4 values | `{legacy 1, before 2, anomaly 1, unknown 0}` | — | `{legacy 1, before 2, anomaly 1, unknown 0}` | ✅ (tests 5/6/21) |

`anomaly + beforeFirstSnapshot (SQL) == cutoff-only anomaly (pure)` was asserted as well, i.e. the
API's `statusCutoffOnly` really is the same classification without the carve. The report's
`cutoff` object was also compared against `buildCutoffEvidence({ migration, appliedAt, resolved })`
— structurally identical.

### 20.7 Marker eligibility, `statusCutoffOnly` and severity evidence

| Scenario (tenant) | Marker vs cutoff | SQL buckets | `status` | `statusCutoffOnly` |
|-------------------|------------------|-------------|----------|--------------------|
| `fix` (marker 09-20, after cutoff) | newer → carve ON | 3 / 2 / 2 / 1 | CRITICAL | CRITICAL |
| `m6` (marker 09-01, before cutoff) | inert | 0 / 0 / **1** / 0 | CRITICAL | CRITICAL |
| `m7` (marker **exactly** at cutoff) | inert (`>` guard) | 0 / 0 / **1** / 0 | CRITICAL | CRITICAL |
| `m8` (marker 09-20) | newer → carve ON | 1 / **1** / 0 / 0 | **UNKNOWN** | **CRITICAL** |
| `stat` (legacy + window item) | newer → carve ON | 1 / **1** / 0 / 0 | **UNKNOWN** | **CRITICAL** |
| `nomark` (0 snapshots) | verified empty → carve OFF | 0 / 0 / 1 / 1 | CRITICAL | CRITICAL |
| `nocov` (0 snapshots, 3 items) | verified empty → carve OFF | 0 / 0 / 3 / 0 | CRITICAL | CRITICAL |

* An at/before-cutoff marker keeps `markerSource SNAPSHOT_MIN_OBSERVED` and
  `evidenceLevel SNAPSHOT_OBSERVED` (the observation is real) while the carve stays OFF and
  **zero** items leak into `beforeFirstSnapshot` — so the buckets cannot overlap.
* `statusCutoffOnly` was recomputed for every tenant from the pure rules and matched the API,
  and `statusCutoffOnly === status` whenever `beforeFirstSnapshot === 0` (an inert marker cannot
  change the verdict).
* Severity matrix asserted directly: anomaly>0 → CRITICAL; before>0 → UNKNOWN (never OK);
  unknown-only → WARN (resolved) / UNKNOWN (unresolved); empty → OK; C1/C3 any hit → CRITICAL;
  `overallStatus` = CRITICAL > WARN/UNKNOWN > OK. **Anti-downgrade**: calling
  `completedWithoutSnapshotStatusV3` with every evidence field injected (`markerSource`,
  `snapshotPopulation`, `firstObservedSnapshotAt`, `evidenceLevel`, `activationUnproven`,
  `codeDeployUnproven`, `disclosure`) returns the base verdict unchanged.
* The `SNAPSHOT_MARKER_UNVERIFIED` path has **no live trigger** (the service catches read errors
  internally), so it is covered at rule level: `buildSnapshotMarker({population:null})` →
  UNVERIFIED/`MIGRATION_ONLY`/disclosure/`carveWindow null`/classification preserved, plus the
  inconsistent shapes (non-empty population with no marker, invalid Date, negative population).

### 20.8 Tenant and branch isolation

**Tenant isolation** (`isoa` / `isob`, different marker dates): A reports `items 1`, marker
`2026-09-20T00:00:00.000Z`, population 1, `counts {2,2,1}`, sample `…-ord-open`; B reports `items 3`,
marker `2026-09-25T00:00:00.000Z`, population 1, `counts {4,4,1}`, and **every** sample id belongs to
B's own tenant. Neither tenant can see the other's rows.

**Branch isolation + tenant-wide marker** (`br`, two branches; the marker snapshot lives in b2):
`branchId` (hint) and the session `branchFilters` both narrow through the same
`o.branchId IN (...)` predicate, and the **marker stays tenant-wide** (K1) for both:

| Scope | `items` | buckets (legacy/before/anomaly/unknown) | status | `counts` | C1 |
|-------|---------|----------------------------------------|--------|----------|----|
| whole tenant | 3 | 0 / 2 / 1 / 0 | CRITICAL | `{5,4,1}` | 1 (CRITICAL) |
| `branchId = b1` | 1 | 0 / 0 / 1 / 0 | CRITICAL | `{1,1,0}` | 0 (OK) |
| `branchFilters = [b1]` | 1 | 0 / 0 / 1 / 0 | CRITICAL | `{1,1,0}` | 0 (OK) |
| `branchId = b1` + authorized `[b2]` | 1 (explicit hint wins) | — | — | — | — |
| `branchFilters = [b2]` | 2 | 0 / 2 / 0 / 0 | UNKNOWN | — | — |

Both branch scopes still observe `firstObservedSnapshotAt = 2026-09-20T00:00:00.000Z` from the other
branch's snapshot (documented K1 semantics), while every item/order/sample stays branch-local — and
the branch-local *severity* differs (CRITICAL vs UNKNOWN), i.e. the scoping is real.

**Cross-tenant data** (`x-a` / `x-b` / `x-c`): a snapshot row planted with `restaurantId = x-b` on a
real `x-a` order is (a) **excluded from the marker** (the tenant-consistency predicate), so x-a
reports `SNAPSHOT_POPULATION_EMPTY`, `population 0`, `null` marker and the verified-empty
disclosure; (b) still excluded from the C2 population (the LEFT JOIN is by `orderItemId`), so x-a's
C2 stays `items 0 / OK`; (c) reported by C3 as `SNAPSHOT_TENANT_MISMATCH 1` (BRANCH_SCOPED) with
`status CRITICAL`, `reconciled false`, `branchReconciled false`, `tenantReconciled true`, sample
`…-ord-item`. x-b (the claiming tenant) and x-c (clean) see all-zero violations and their own
markers (`09-26`, `09-27`) — a cross-tenant row influences **neither** tenant's marker nor buckets.

### 20.9 C3 (reconciliation) evidence — beyond the required list

| Scenario | Counts | Violations (>0) | Verdicts |
|----------|--------|-----------------|----------|
| `c3`, scope b2 | `{1,1,2}` | `SNAPSHOT_ORDER_MISMATCH 1`, `SNAPSHOTS_EXCEED_ORDER_ITEMS 1` (both BRANCH_SCOPED) | CRITICAL, `branchReconciled false`, `tenantReconciled true`; sample `…-ord-o2` |
| `c3`, whole tenant | `{2,2,2}` | `SNAPSHOT_ORDER_MISMATCH 1` (overshoot disappears) | CRITICAL |
| `c3w` (test-schema-only rows) | `{1,1,1}` | `ORPHAN_SNAPSHOT_ITEM 1`, `SNAPSHOT_ORDER_MISSING 1` (TENANT_WIDE) | CRITICAL, `branchReconciled true`, `tenantReconciled false`; samples `[…]` only for the whole-tenant caller, **`[]`** for a branch-scoped caller |

`violationScope()`/`partitionViolations()`/`deriveReconciliation()` were asserted directly, including
`violationScope("SOMETHING_NEW") === "TENANT_WIDE"` (unknown codes widen) and
`selectSampleOrderIds()` de-duplication/capping/tenant-wide gating. The two tenant-wide fixtures are
reachable **only** because this test schema has no FK on `orderitemcostsnapshot` (F-5); the test
removes them itself (`finally`) and re-asserts `OK` afterwards, because `cleanupRun` cannot reach a
snapshot whose `orderId` does not exist (the whole-table baseline check would catch a leak anyway).

### 20.10 Test counts and repeated runs

Command (from the project root, one file at a time, output captured to a log and the exit status read
directly — never piped):
`npx tsx --test tests/accounting/integrity.integration.test.ts > /tmp/m2-runN.log 2>&1; echo $?`

| Run | Tree | Result | Exit |
|-----|------|--------|------|
| 1 | first draft | `tests 29 / pass 0 / cancelled 29` — **test-side defect**: my own fixture reused non-tenant-scoped order labels, so `mkOrder` collided on `order` PRIMARY KEY inside `before()` | 1 |
| 2 | after the fixture-id fix | `tests 29 / pass 27 / fail 2` — **test-side expectation defects**: (a) the branch fixture's items were expected as `anomaly` instead of `beforeFirstSnapshot` (they complete inside the activation window); (b) the query-contract test expected a branch-scoped item count of 0 for a tenant whose only item sits in that branch | 1 |
| 3 | final tree | `tests 29 / pass 29 / fail 0 / cancelled 0 / skipped 0` (6.6 s) | **0** |
| 4 | final tree | `pass 29 / fail 0` | **0** |
| 5 | final tree | `pass 29 / fail 0` | **0** |
| 6 | final tree (after the whitespace/lint clean-up, i.e. the delivered artifacts) | `pass 29 / fail 0` | **0** |
| 7 | final tree (delivered artifacts) | `pass 29 / fail 0` (6.3 s) | **0** |

**Five consecutive clean 29/29 runs on the final tree (runs 3–7), exit 0 each.** No failure was
suppressed, skipped or weakened: both defect rounds were corrected in the *test* (the production
files were never touched), and the expectations were re-derived from the audited rules.

### 20.11 Cleanup verification

```
[STEP 2B.5 LEDGER] mirrored cutoff row installed and removed (deleted rows: 1)
[STEP 2B.5 CLEANUP] rows deleted: order 60, orderItem 56, orderStatusHistory 54, orderItemCostSnapshot 17,
                    restaurant 22, branch 25, user 22, customer 22, product 22, category 22, payment 1, others 0
[STEP 2B.5 CLEANUP] table counts (baseline → after): all 21 monitored tables "0 → 0"
[STEP 2B.5 CLEANUP] residual (run-scoped): all 21 counters 0
[STEP 2B.5 CLEANUP] F.5 ledger rows after run: 0
```

Baseline before the run: 49 tables in `restaurant_app_test`, every monitored business table at 0
(`restaurant/branch/user/customer/order/orderItem/orderItemCostSnapshot/orderStatusHistory/product/category/
branchProduct/stockMovement/ingredientStockMovement/payment/paymentTransaction/refund/refundItem/expense/
expenseCategory/cashierShift/auditLog`). After the run: identical. The ledger table itself is back to its
6 original rows (never treated as leaked business data), and the suite-installed row is asserted
removed both in the group `after` hook and in the suite `after` hook. Deletes are child-first via
`cleanupRun`; **no TRUNCATE and no global reset** were used.

### 20.12 Previous-suite regression results (sequential, same tree)

```
cashbook.integration.test.ts              exit 0 — pass 15 / fail 0
revenue.integration.test.ts               exit 0 — pass 19 / fail 0
refund-profitability.integration.test.ts  exit 0 — pass 21 / fail 0
pnl.integration.test.ts                   exit 0 — pass 24 / fail 0
```

Combined integration total after this phase: **15 + 19 + 21 + 24 + 29 = 108 passing**.

### 20.13 TypeScript / build / whitespace / lint results

| Check | Command | Result |
|-------|---------|--------|
| Typecheck | `npx tsc --noEmit` | ✅ exit 0, no output |
| Diff hygiene | `git diff --check` | ✅ exit 0, 0 lines |
| Untracked whitespace | `grep -cE '[[:blank:]]+$' <new files>` | ✅ 0 in `integrity.integration.test.ts`, 0 in `fixtures/accounting.ts` |
| Lint (new file) | `npx eslint tests/accounting/integrity.integration.test.ts` | ✅ exit 0 (0 errors, 0 warnings) |
| Build | `npm run build` | ✅ exit 0 — `✓ Compiled successfully in 21.9s`, the same 6 pre-existing warnings; `next-env.d.ts` reverted afterwards |
| Pre-existing M2 unit suite (regression) | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | ✅ exit 0 — pass 57 / fail 0 (the rules module is unchanged, so both layers agree) |

### 20.14 Confirmed defects and limitations (nothing hidden)

1. **F-4 (NEW, environment): the isolated test database has no F.5 ledger row.** `_prisma_migrations`
   holds 6 rows and none is `20260911143644_f5_order_item_cost_snapshot` (evidence: test 3 plus the
   audit query), while the **application** database's ledger holds it with
   `started_at 2026-09-11 16:06:57.572` / `finished_at 2026-09-11 16:06:57.831` (read-only SELECT;
   the service surfaces that literal as `2026-09-11T16:06:57.831Z`, i.e. exactly the mandated
   cutoff). Consequence: in this database the whole C2 legacy/anomaly classification degrades to
   `unknownCompletion` + `UNKNOWN`. **Production risk:** any environment provisioned by `db push` or
   restored without the ledger row will report a genuine post-cutoff snapshot gap as
   **UNKNOWN/WARN instead of CRITICAL** — the anomaly path is inert. Not fixed here (phase lock:
   no environment/production change); the suite pins both the fallback (test 3) and the resolved
   behaviour (tests 4–29) so the gap stays visible.
2. **F-5 (NEW, environment): the isolated test database is missing FK constraints.** There are **0**
   FKs on `orderitemcostsnapshot` (the application DB has 5: `branchId`, `orderId`, `orderItemId`,
   `productId`, `restaurantId`), and 55 vs 105 FK columns across the schema. Consequences: the
   TENANT_WIDE invariants `ORPHAN_SNAPSHOT_ITEM` / `SNAPSHOT_ORDER_MISSING` are **FK-impossible in
   production** but reachable here, so test 28 is explicitly labelled test-schema-only. The unique
   index on `orderItemId` exists in both, so `DUPLICATE_SNAPSHOT_PER_ITEM` remains unreachable by
   construction (duplicate inserts are rejected with `P2002`).
3. **Documented fixture maneuver:** tests 4–29 install the production ledger row (mirrored
   byte-for-byte, run-scoped id) and remove it, asserting restoration. Without it the mandated
   cutoff cannot be exercised through the real SQL at all. Test 3 asserts the as-is environment, so
   if F-4 is fixed the suite must be re-baselined there (intentionally loud, never silent).
4. **`SNAPSHOT_MARKER_UNVERIFIED` is not reachable through the live SQL** (the service swallows read
   errors), so it is asserted at rule level only.
5. **The API does not expose per-order buckets**, so per-order attribution is proven two ways:
   aggregate isolation (3/2/2/1 cannot arise from any other assignment given the known inputs) and
   bucket-for-bucket equivalence with the pure classifier over the same eight inputs.
6. **Marker-population identity** (`snapshotPopulation` == items holding a snapshot) is asserted for
   tenant-consistent tenants only; `c3w` is excluded because it deliberately holds an inconsistent
   snapshot (test 28 asserts the marker ignores it).
7. Anomaly-path CRITICAL for C2 in *this* environment is only reachable via the mirrored ledger row;
   the fallback degradation is asserted separately (see 1).
8. Extra coverage beyond the required list (C1, C3, query contract) is additive; every required item
   §5.1–§5.24 is mapped to a test (see the mapping at the top of §20).

### 20.15 Carried-forward findings

| ID | Finding | Status in this phase |
|----|---------|----------------------|
| F-1 | Test `DATABASE_URL` drift (test env pointed at the app DB) | ✅ FIXED — re-verified by test 1 (both URLs target `127.0.0.1:3308/restaurant_app_test`, `DATABASE_URL` pinned, port 3307 rejected, the test user holds no grant on `restaurant_app`) |
| F-2 | Percent-encoded credential parsing | ⏳ DEFERRED (production issue; not touched) |
| F-3 | Test-container healthcheck | ⏳ DEFERRED (container untouched; not recreated) |
| **F-4** | **Test-DB ledger lacks the F.5 row → C2 anomaly path inert** | 🆕 **OPEN — NEW**, see §20.14.1 |
| **F-5** | **Test-DB schema missing FK constraints (0 vs 5 on the snapshot table)** | 🆕 **OPEN — NEW**, see §20.14.2 |
| A-9 | `busiestHours` revenue predicate discrepancy | 🚫 **OPEN** — unchanged |
| P-19 | P&L API exposes no margin fields | ⏳ unchanged (documented in §19.14) |
| P-20 | `today` expense window vs revenue window boundary | ⏳ unchanged — needs a business-rule decision |
| P-21 | `netProfitProvisional` / `purchaseExcluded` always true | ⏳ unchanged |
| Legacy refund | Write-side/read-side COGS projection difference | ⏳ reported, not normalised (§18.6/§19.7) |

### 20.16 Updated overall progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Database topology, preflight, access recovery, isolated test container, schema, final safety verification | ✅ DONE |
| 2B.1 | Cashbook integration tests | ✅ DONE — 15/15 pass |
| 2B.2 | Revenue & Reporting integration tests | ✅ DONE — 19/19 pass |
| 2B.3 | Refund & Profitability integration tests | ✅ DONE — 21/21 pass |
| 2B.4 | P&L integration tests | ✅ DONE — 24/24 pass |
| **2B.5** | **M2 Integrity (SQL) integration tests** | **✅ DONE — 29/29 pass (5 consecutive clean runs)** |
| Final | Cross-module verification | ⏳ **NOT STARTED** (phase lock respected) |

**Integration tests implemented so far: 15 + 19 + 21 + 24 + 29 = 108 passing.**
**Production readiness remains BLOCKED** — A-9 open, F-4/F-5 newly open, F-2/F-3 deferred, and the
final cross-module verification not started.

### 20.17 Final cross-module verification readiness

| Item | Status |
|------|--------|
| READ-ONLY M2 read-model proven against real Prisma/MariaDB (C1, C2 buckets/cutoff/marker/evidence, C3 scopes, severity, samples, scope echo, validation) | ✅ READY |
| Every required coverage item §5.1–§5.24 mapped, executed and recorded (§20 header + §20.5–§20.10) | ✅ READY |
| Determinism + read-only proof (`generatedAt`-only difference; no business row written) | ✅ READY (test 25) |
| Whole-DB baseline/cleanup over 21 tables + reversible ledger fixture | ✅ READY (§20.11) |
| Four preceding suites still green sequentially | ✅ READY (§20.12) |
| `tsc` / `git diff --check` / whitespace / lint / build | ✅ ALL GREEN (§20.13) |

**Blocker for a *complete* cross-module verification:** the C2 anomaly/CRITICAL path cannot be
observed in this environment **without the ledger fixture** (F-4). Recommendation for the final
phase (NOT done here): record the F.5 migration in the isolated test database
(`prisma migrate resolve --applied 20260911143644_f5_order_item_cost_snapshot` on the test DB) so the
real cutoff resolves, then re-baseline test 3 and re-run all five suites. F-5 (missing FKs) should be
reconciled the same way if any production-shaped dependency test is attempted.

**STEP 2B.5 STOPS HERE.** The final cross-module verification was not started — awaiting review.

### 20.18 Final Git status

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the phase-start status (§20.1): the temporary probe scripts used for the audit were
removed, `next-env.d.ts` was reverted after the build, and no commit/push/merge/deploy was performed.

---

## 21. STEP 2C.1 — FINAL CROSS-MODULE EVIDENCE AUDIT

**Date:** 2026-10-14  
**Mode:** 🔒 STRICT AUDIT ONLY — no production edits, no test edits, no database mutation, no migration/schema change, no container recreation, no commit/push/merge/deploy.  
**Phase lock:** no fixes implemented; no automatic STEP 2C.2.

### 21.1 Initial Git status (start of this phase)

```
$ git rev-parse --abbrev-ref HEAD
main
$ git log -1 --oneline
e8d4aa3 fix selesai orderan
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the §20.18 status. The four M2 implementation files are still
modified-but-uncommitted (mtimes 2026-10-10 12:27–12:44) and were **not touched**
in this phase. Every pre-existing uncommitted change is preserved.

### 21.2 Existing test results (reported, NOT re-run in this phase)

| Suite | Reported | Basis |
|-------|----------|-------|
| 2B.1 Cashbook | 15/15 PASS | §16 |
| 2B.2 Revenue & Reporting | 19/19 PASS | §17 |
| 2B.3 Refund & Profitability | 21/21 PASS | §18 |
| 2B.4 P&L | 24/24 PASS | §19 |
| 2B.5 M2 Integrity SQL | 29/29 PASS (5 consecutive clean runs) | §20.10 |
| **Total integration** | **108/108** | §16–§20 |
| M2 unit (rules) | 57/57 PASS | §20.13 |

**These were NOT re-executed.** The five suites write isolated fixtures and assert
whole-table baselines, and the M2 suite installs a temporary ledger row; any run
would mutate the test database, which this read-only phase forbids. The results
above are the previously recorded evidence, reviewed for quality in §21.6 — not
re-run and not treated as re-verified.

### 21.3 Cross-module reconciliation (the five read-models)

Definitions were re-read from the source of truth in this phase:
`report.service.ts` (`reportScopeWhere`/`reportBaseWhere`/`revenueWhere`/`revenueScopeWhere`,
`revenueSetSql`/`paidRevenueSql`/`productRevenueSql`/`refundRevenueSql`),
`profitability.service.ts`, `accounting/pnl.service.ts` (+`pnl.rules.ts`, `pnl.types.ts`),
`accounting/cashbook.service.ts`, `accounting/expense.service.ts`,
`accounting/integrity.service.ts` (+`integrity.rules.ts`).

| # | Relationship | Verdict | Evidence |
|---|--------------|---------|----------|
| 1 | Eligible revenue orders | **CONSISTENT** (with 2 exceptions) | `revenueWhere`/`revenueScopeWhere` (report.service.ts:199–231) = `status != CANCELLED AND (paymentStatus = PAID OR EXISTS payment REFUNDED)`; profitability inlines the identical predicate (profitability.service.ts:76–80, 103–107); P&L delegates to profitability (P-4/P-5); Integrity C1 reuses `revenueScopeWhere` verbatim (integrity.service.ts:194–199). **Exceptions: A-9 and A-11** (two raw fragments) |
| 2 | Payment qualification | **CONSISTENT** | Payment rows PENDING/FAILED/EXPIRED/CANCELLED qualify nothing; only `paymentStatus` / an existing `REFUNDED` payment (SQL mirror at report.service.ts:533–548) |
| 3 | PaymentTransaction exclusion | **CONSISTENT** | No read-model sums `PaymentTransaction`; refunds come from the `Refund` table (`approvedRefundsSql`, profitability.service.ts:147/697). The cashier `PaymentTransaction` mirror is never a revenue/refund source |
| 4 | Refund approval and amount | **CONSISTENT** | `status = "APPROVED"` + `approvedAt ∈ range` + `Σ amount` in both revenue and profitability; PENDING/REJECTED excluded (R-8, §17 Sc8) |
| 5 | Order-date vs cash-movement-date | **INTENTIONAL DIFFERENCE** | Revenue/P&L/profitability attribute to `order.createdAt` and `refund.approvedAt`; Cashbook attributes to `payment.paidAt` / `refund.approvedAt` (cashbook.service.ts:21–22, 214–223, 294–298). A CANCELLED order's collected payment is cash-in and is flagged `onCancelledOrder` but never revenue (§17 A-5/A-6) |
| 6 | Tax / service-charge treatment | **CONSISTENT** | `netSales` = product basis `Σ(grandTotal − tax − serviceCharge) − refund share`, identical formula in the revenue summary (report.service.ts:304–320) and profitability/P&L (P-7); asserted in §17 Sc10/18 and §19 Sc8 |
| 7 | Historical COGS | **CONSISTENT** | COGS only from `status = 'SNAPSHOTTED'` snapshots (profitability.service.ts:187/237/305); the current HPP is never consulted (P-9, §18 Sc15, §19 Sc9) |
| 8 | Legacy refund projection | **CONFIRMED DISCREPANCY (documented, non-blocking)** | Write-side ledger silent for amount-only refunds; read-side applies the documented pro-rata `round2(coveredCogs × min(1, refund/grandTotal))` (R-8). Disjoint by construction; the only divergence is cost attribution when the basket ratio ≠ order average (§18.6) |
| 9 | Incomplete snapshot coverage | **CONSISTENT** | Coverage decided by status, never value; `grossProfit = null` when incomplete (profitability); P&L `netProfit = null` whenever `grossProfit = null` (pnl.rules.ts, P-13) |
| 10 | Expense recognition | **CONSISTENT** | Only the `Expense` table, `spentAt` basis, full local day (`startOfLocalDay`/`endOfLocalDay`, pnl.service.ts:34–41, 86–91); `purchaseExcluded = true` (P-14/P-16) |
| 11 | Tenant & branch scoping | **CONSISTENT** | `restaurantId` always a server/session argument; scoping via the `branchFilters` argument only; `filters.branchId` is an echoed hint (P-15, A-4). Integrity C2/C3 use the same `branchFilters` contract (integrity.service.ts:249–254) |
| 12 | M2 severity & cutoff | **CONSISTENT / INDEPENDENT** | `deriveOverallStatus` = CRITICAL ⊃ WARN/UNKNOWN ⊃ OK (integrity.rules.ts:220–231); the anomaly bucket is CRITICAL, a real pre-marker / unresolved gap is UNKNOWN, unknown-only with a resolved cutoff is WARN (rules 236–287). No financial read-model consumes M2 severity |

**Result: 9 relationships CONSISTENT, 1 INTENTIONAL DIFFERENCE, 1 documented
CONFIRMED DISCREPANCY (legacy refund projection), and 1 CONFIRMED DISCREPANCY in
the eligible-revenue definition observed through two raw sub-reports (A-9 known,
A-11 newly found — see §21.4). No relationship is INSUFFICIENT EVIDENCE.** Cashbook
and Revenue were **not** forced to equal each other within one window (they
legitimately use different date bases).

### 21.4 Finding-by-finding assessment

> "Blocks production?" is judged on financial correctness, data isolation and
> verifiability — never on the fact that a test currently passes.

#### F-1 — Test `DATABASE_URL` drift  → ✅ VERIFIED FIXED (guard design sound)
* **Evidence (re-checked):** `.env.test` now has **both** `DATABASE_URL` and `TEST_DATABASE_URL` = `127.0.0.1:3308/restaurant_app_test` (host/port/db/user inspected; password never printed). `tests/setup.ts` fails closed on `NODE_ENV=production`, a missing `TEST_DATABASE_URL`, a production-looking db name, and percent-encoded credentials, then **pins** `process.env.DATABASE_URL := TEST_DATABASE_URL` before any service/Prisma import, and is the first static import of every suite. The dedicated test user cannot see `restaurant_app` (3308: only `information_schema`, `restaurant_app_test`).
* **Financial / isolation impact:** none now; the guard prevents recurrence.
* **Blocks production:** No. **Correction:** none. **Regression risk:** none (test-only). **More tests:** no.

#### F-2 — Percent-encoded credential parsing in `src/lib/prisma.ts`  → 🚫 OPEN (production defect; deferred)
* **Evidence (re-confirmed in this phase):** `src/lib/prisma.ts` builds the driver config from `urlObj.username` / `urlObj.password` **without `decodeURIComponent`**. Measured with Node's WHATWG URL parser: `mysql://user:a+b==@h/db` → password `"a+b%3D%3D"` (the `=` becomes `%3D`; `@` → `%40`). A password containing `=`, `@`, `:`, `/`, or a space therefore reaches MariaDB still encoded → every query fails (`pool timeout`, Prisma `P2010`; the F-2 base64-style test credential hit exactly this).
* **Financial impact:** none if the production secret is URL-safe; a total outage (no query connects) if it is not.
* **Security/isolation impact:** none (fails closed by refusing to connect).
* **Blocks production:** **YES** — a latent outage class for any deployment whose `DATABASE_URL` secret contains a reserved character.
* **Minimal correction:** `decodeURIComponent(urlObj.username)` / `decodeURIComponent(urlObj.password)` in `src/lib/prisma.ts`.
* **Regression risk:** very low (one-line, comparator-free). **More tests:** a unit test over `${ENCODE}/` URL forms.

#### F-3 — Test-container healthcheck  → ⏳ DEFERRED (non-blocking)
* **Evidence:** `restaurant-mariadb-test` shows `Up 4 hours (unhealthy)`; the healthcheck calls `mysqladmin`, absent in `mariadb:11.8`. Connectivity is proven (108 tests + raw-driver probes) — the status is a false negative.
* **Financial impact:** none. **Security/isolation impact:** none (the container is fully functional; the flag is cosmetic).
* **Blocks production:** No (test infra only). **Correction:** fix the healthcheck (compose change) — requires container recreation, out of scope. **Regression risk:** none to the app; container recreation is the only risk and is deferred. **More tests:** no.

#### F-4 — Test DB lacks the F.5 migration ledger row  → 🚫 OPEN (must verify before release)
* **Evidence (read-only, this phase):** test ledger `_prisma_migrations` = **6 rows**, all stamped `2026-10-14 02:42`, last row `20260908030144_add_branch_multi_cabang` with `finished_at = NULL`; **no** `20260911143644_f5_order_item_cost_snapshot`. App DB ledger = **28 rows** and **does contain** it: `finished_exact = 2026-09-11T16:06:57.831` → exactly the mandated cutoff `2026-09-11T16:06:57.831Z`.
* **Behaviour consequence:** with the row absent `resolveLegacyCutoff()` returns `null`; C2 then reports every COMPLETED-without-snapshot item as `unknownCompletion` and the status degrades to `WARN`/`UNKNOWN` — the anomaly/CRITICAL path is inert (asserted by M2 test 3).
* **Financial impact:** in an environment provisioned without the row, a **genuine post-cutoff snapshot gap is reported as WARN instead of CRITICAL** (a silent under-severity). Money values are unaffected.
* **Security/isolation impact:** none.
* **Blocks production:** **YES — as a verifiability blocker** (production per se has the row; a `db push`/restored/non-faithful environment does not). **Minimal correction:** record the migration as applied **on the test DB only** (`prisma migrate resolve --applied 20260911143644_f5_order_item_cost_snapshot`, or a full `migrate deploy` to the test DB). **Regression risk:** low; requires re-baselining M2 test 3 (its assertion flips deliberately once the cutoff resolves). **More tests:** yes — re-run the M2 suite after parity.

#### F-5 — Test DB foreign keys differ from the application DB  → 🚫 OPEN (must verify before release)
* **Evidence (read-only, this phase):** test schema has **55** FK columns, app schema **105** (Δ = **50**); `orderitemcostsnapshot` has **0** FKs in test vs **5** in app (`branchId`, `orderId`, `orderItemId`, `productId`, `restaurantId`). `SHOW CREATE TABLE orderitemcostsnapshot` / `expense` on the test DB contain **0** `CONSTRAINT` clauses, while `prisma/schema.prisma` **declares** those 5 / 4 relations. Missing accounting-relevant constraints include the whole F.5 set, the `expense`/`expensecategory` set, `order.branchId`, `payment.branchId`, `stockmovement.*`, `ingredientstockmovement.*`, `orderitemcostsnapshot.*`. Unique indexes (incl. `orderitemcostsnapshot_orderItemId_key`) exist in both.
* **Consequence for tests:** the TENANT_WIDE invariants `ORPHAN_SNAPSHOT_ITEM` / `SNAPSHOT_ORDER_MISSING` are FK-impossible in production but reachable in the test schema (M2 test 28, explicitly labelled test-schema-only). No other fixture depends on the missing FKs (all use valid parents). `DUPLICATE_SNAPSHOT_PER_ITEM` remains unreachable in both (the unique index exists).
* **Financial impact:** none on the asserted values (reads are unaffected by missing FK *constraints*); it limits what the suite can **prove** about referential integrity / cascade delete / `ON DELETE SET NULL`.
* **Blocks production:** **YES — as a verification blocker** (the "production-shaped" guarantee is weaker than reported; §7's "schema.prisma and restaurant_app_test are in sync" is not supported by the observed DDL).
* **Minimal correction:** rebuild the isolated test schema from the real history (`prisma migrate deploy` toward the test DB, or `migrate reset` scoped to the test DB) — no application-DB change. **Regression risk:** must re-run all five suites afterwards; low but non-zero (adding FKs can reject a fixture that inserted a child before its parent). **More tests:** re-run all five; keep test 28 (still the only FK-dependent scenario).

#### F-6 — Application-DB target ambiguity / container schema drift  → 🆕 OPEN (must verify before release)
* **Evidence (read-only, this phase):** the repo's `.env` `DATABASE_URL` targets **`localhost:3306/restaurant_app`** (`USER() = root@localhost`, 49 tables, 28-row ledger, F.5 present). The task names port **3307**; the `restaurant-mariadb` container publishes `127.0.0.1:3307→3306` and its `restaurant_app` holds **43 tables** and has **no `_prisma_migrations` table at all** (`USER() = root@172.18.0.1`). So the "application DB" the app is configured to use (3306) and the docker-compose app container (3307) are **different instances with different schemas**.
* **Financial impact:** if any deployment points the app at the 3307 container, the schema is older (43 tables) and the M2 cutoff/marker cannot resolve → the entire Integrity module and possibly other accounting read-models break.
* **Security/isolation impact:** none (metadata only; no writes).
* **Blocks production:** **YES — must verify which instance is the release target.**
* **Minimal correction:** none technical here — resolve the deployment topology (docker-compose app DB vs local 3306) in a remediation phase; do not touch data. **Regression risk:** none if addressed by configuration/documentation only; changing the app's `DATABASE_URL` at deploy time must be validated before use. **More tests:** a deployment-readiness check (which DB the release actually uses).

#### A-9 — `busiestHours` uses a different revenue predicate  → 🚫 OPEN (confirmed, sub-report)
* **Evidence:** `report.service.ts:1348–1356` filters `paymentStatus = 'PAID'` only, whereas the canonical set is `PAID OR EXISTS(REFUNDED payment)`. §17 Sc11: fully-refunded 200 000 order → `Σ dailySeries.sales = 200000` but `Σ busiestHours.revenue = 0`.
* **Financial impact:** the hourly chart under-reports gross sales for refunded orders (reporting only; `netSales` is unaffected). **Blocks production:** YES (financial mis-report). **Correction:** replace the PAID-only predicate with `revenueSetSql`. **Regression risk:** low; revenue suite scenario 11 must be updated to the corrected expectation. **More tests:** assert canonical equality after the fix.

#### A-11 — `getProductReport` product rows use a different revenue predicate  → 🆕 OPEN (NEW, confirmed, sub-report)
* **Evidence (found in this audit):** `getProductReport` (report.service.ts:1742+) computes `soldWhere = revenueWhere(...)` and uses it for `unsoldProducts` and `soldOrderCount`, but its **main raw SQL rows** (1742–1805) filter `paymentStatus = 'PAID'` only. So the same report mixes two revenue sets: its `soldOrderCount` counts a fully-refunded order while its product rows exclude it, and a product of that order can be listed as **"unsold"** even though it appears in `bestSellingProducts` (Prisma, canonical). No suite exercises `getProductReport` (grep: 0 references under `tests/`), so this is previously uncovered.
* **Financial impact:** product-level `qtySold` / `grossSales` omit fully-refunded orders (units understated); the report is internally inconsistent with its own summary and with `bestSellingProducts`. Sub-report level; no cash/net effect.
* **Security/isolation impact:** none. **Blocks production:** YES (financial mis-report / contradiction between views). **Correction:** use `revenueSetSql` for the rows query (matching `soldWhere`). **Regression risk:** low. **More tests:** a revenue-suite scenario for `getProductReport` vs `bestSellingProducts` on a fully-refunded order.

#### P-19 — P&L contract has no margin field  → ⏳ unchanged (contract limitation, non-blocking)
* **Evidence:** `pnl.types.ts` defines no `margin`/`Margin` (grep = none); margins are client-side arithmetic (P-17, §19 Sc10).
* **Financial impact:** none (derived values are correct and consistent). **Security/isolation impact:** none. **Blocks production:** No. **Correction:** optional API field. **Regression risk:** low (additive field). **More tests:** no.

#### P-20 — `today` expense/revenue window boundary differs  → ⏳ unchanged (needs a business-rule decision)
* **Evidence:** expenses are bounded by the **full local day** (`startOfLocalDay`/`endOfLocalDay`, pnl.service.ts:34–41/86–91) while revenue uses the range bounds; §19 Sc18 pins `today` opex 333.33 (incl. 23:30) vs tomorrow 333.33.
* **Financial impact:** a `today` expense dated later than the revenue range end is still counted — a period-boundary presentation difference. **Security/isolation impact:** none. **Blocks production:** No (documented asymmetry) — but it is a business-rule decision. **Correction:** align windows or document the rule explicitly. **Regression risk:** medium (changing the window changes reported opex/NP; needs a product decision). **More tests:** no.

#### P-21 — Net profit remains provisional / purchases excluded  → ⏳ unchanged (intentional disclosure)
* **Evidence:** `netProfitProvisional: true`, `purchaseExcluded: true`, `expenseDataEmpty` (pnl.service.ts:165–167); `netProfit = grossProfit − opex`, `null` when GP is `null` (P-13).
* **Financial impact:** net profit excludes inventory purchases (disclosed via `purchaseExcluded`); anyone treating it as final would over/under-state. **Security/isolation impact:** none. **Blocks production:** No (disclosed). **Correction:** document; optionally expose purchase-impact. **Regression risk:** low (disclosure-only). **More tests:** no.

#### Legacy refund write-side vs read-side COGS projection  → ⏳ unchanged (documented difference)
* See relationship #8; reproducing tests preserved (§18 Sc13/14, §19 Sc15). Not a defect (disjoint bases, no double-count).
* **Financial impact:** a cost-attribution difference (e.g. 30 000 exact vs 25 000 pro-rata in the §18.6 fixture) only when the basket ratio ≠ order average. **Security/isolation impact:** none. **Blocks production:** No. **Correction:** document (no code change needed). **Regression risk:** none (documentation only). **More tests:** no.

#### D-1 (minor, documentation only) — stale comments
* `profitability.service.ts:24–25` and `profitability.types.ts:6–8` still say `sold = status != CANCELLED AND paymentStatus = PAID`, while the code uses the canonical `PAID OR EXISTS(REFUNDED)` set. Comment drift, no runtime effect. **Financial impact:** none. **Security/isolation impact:** none. **Blocks production:** No. **Correction:** fix the comments. **Regression risk:** none. **More tests:** no.

### 21.5 F-4 / F-5 schema-parity evidence (read-only)

**Instances inspected (SELECT/SHOW only; no credentials or full URLs printed):**

| Instance | Where | Tables | `_prisma_migrations` | F.5 row | FK columns | FKs on `orderitemcostsnapshot` |
|----------|-------|--------|----------------------|---------|------------|-------------------------------|
| Isolated test | `127.0.0.1:3308/restaurant_app_test` | 49 | 6 rows (last unfinished) | ❌ | 55 | 0 |
| Application (repo `.env`) | `localhost:3306/restaurant_app` | 49 | 28 rows | ✅ `2026-09-11T16:06:57.831` | 105 | 5 |
| App container (task "3307") | `127.0.0.1:3307/restaurant_app` | 43 | ❌ table missing | ❌ | n/a | n/a |

* **Why the test schema is a hybrid:** the test ledger holds only the first 6 on-disk
  migrations, the 6th `finished_at = NULL` (an interrupted/partial history), while the
  table **set** matches the current 49-table schema — yet `SHOW CREATE TABLE
  orderitemcostsnapshot`/`expense` show **0** `CONSTRAINT` clauses although
  `prisma/schema.prisma` declares those relations. A faithful `prisma db push` from the
  current schema (the method recorded in §6) would create those FK constraints. So the
  test schema is **not** a faithful replay of either `prisma db push` or `prisma
  migrate deploy`; §7's "in sync, no drift" conclusion is **not supported** by the DDL.
* **Why the F.5 ledger row is absent:** the migration was never applied (nor resolved)
  on the test DB — its history stops at migration #6. The F.5 *table* exists only
  because the schema was materialised without its constraints.
* **Accounting-relevant delta:** exactly the constraints introduced **after** migration
  #6 — the whole `orderitemcostsnapshot` F.5 set, the `expense`/`expensecategory` set,
  `order.branchId`, `payment.branchId`, `stockmovement.*`, `ingredientstockmovement.*`
  (50 FK columns). Unique indexes (incl. `orderitemcostsnapshot_orderItemId_key`) exist
  in both DBs.
* **Do M2 fixtures rely on impossible production states?** Yes, and only in the labelled
  place: M2 test 28's two TENANT_WIDE fixtures (`ORPHAN_SNAPSHOT_ITEM`,
  `SNAPSHOT_ORDER_MISSING`) need the missing FKs; they self-clean. No other suite does.
* **Do results need re-running after parity is restored?** Yes — M2 test 3 must be
  re-baselined for F-4 (its fallback assertion flips once the cutoff resolves), and all
  five suites should be re-run once F-5 parity is restored to prove no assertion
  depended on the missing constraints.
* **Can parity be restored without modifying the application DB?** Yes. Apply the full
  migration history to the **test DB only** (`prisma migrate deploy`/`migrate reset`
  scoped via `TEST_DATABASE_URL`, or a `db push` that adds the missing FKs). Because
  every monitored business table is currently at **0** rows, adding the FK constraints
  cannot hit orphan rows. No container recreation required.

### 21.6 Evidence-quality review

| Criterion | Assessment |
|-----------|------------|
| Real production read-model execution | ✅ All five suites import the real services (`getCashbook`, `createExpense`, `reportService`/`revenueWhere`/`compute*`, `approvalService` + `profitabilityService`, `getPnlReport`, `getIntegrityReport`) over real Prisma + `@prisma/adapter-mariadb` → MariaDB 11.8 |
| Mocks / stubs / skips | ✅ `grep -E '\b(mock\|sinon\|stub\|jest\.fn\|vi\.fn)\b'` → none; `grep -E '\.(skip\|todo\|only)\('` → none |
| Test counts | ✅ `it(` = 15 + 19 + 21 + 24 + 29 = **108** (matches every report) |
| Deterministic fixture amounts | ✅ Every scenario owns a calendar day / unique product id; amounts are literals (§16.4, §17.4, §18.4, §19.4, §20.5) |
| Positive **and** negative assertions | ✅ e.g. §17 Sc1–4 exclusion, §18 Sc4/6 rejections, §19 Sc5/6, §20 bucket-exclusivity plus the mandated positive fixture |
| Tenant isolation | ✅ §17 Sc14, §18 Sc19, §19 Sc21, §20 isolation tests |
| Cleanup verification | ✅ All five use `snapshotCounts`/`cleanupRun`/`findResiduals` with baseline-equality; no TRUNCATE/reset |
| Correct date basis | ✅ Order date vs approval date vs `paidAt` vs `spentAt` asserted explicitly (§17 A-6, §18 Sc9, §19 Sc17/23, §20 benchmark) |
| No assertion weakened to pass | ✅ The only run-1/run-2 failures were **test-side** expectations and were corrected **in the test**; both M2 defect rounds touched no production file (§20.10) |

**Coverage limitations (distinct from defects):**
1. The API exposes no per-order C2 buckets → M2 attribution is proven by aggregate isolation + classifier equivalence, not per-order API output.
2. `SNAPSHOT_MARKER_UNVERIFIED` is not reachable through the live SQL (rule-level only).
3. `getProductReport` (**A-11**) and the `busiestHours` predicate (**A-9**) have **no** suite coverage; `getSalesOrdersForExport` is an order listing, not a revenue figure, and does not use the canonical set (intentional, but undocumented).
4. FK-dependent behaviour (cascade delete, `ON DELETE SET NULL`) cannot be proven in the current test schema (F-5).
5. **M2 test 3 is environment-specific by design** and must be re-baselined if F-4 is fixed; the temporary F.5 ledger fixture (insert + delete, self-asserted restored) is the only way to exercise the real cutoff in this environment.

**Does any test-specific schema difference invalidate an otherwise passing scenario?**
No — the reading paths and all asserted values are unaffected by the missing FK
*constraints*; the unique indexes that matter exist. It weakens *what can be proven*
(referential integrity), not the correctness of the numeric assertions.

### 21.7 Release gap matrix

| Finding | Severity | Evidence | Financial impact | Required action | Prod blocker | Proposed phase |
|---------|----------|----------|------------------|-----------------|--------------|----------------|
| **A-9** busiestHours predicate | High | report.service.ts:1348–1356; §17 Sc11 (200000 vs 0) | Hourly revenue understated for refunded orders | Use `revenueSetSql` | **Must fix** | 2C.2 |
| **A-11** getProductReport predicate (NEW) | High | report.service.ts:1742–1805; 0 test refs | Product qty/gross omit fully-refunded orders; "unsold" vs bestSellers contradiction | Use `revenueSetSql` for rows | **Must fix** | 2C.2 |
| **F-2** encoded-credential parsing | High | src/lib/prisma.ts (no `decodeURIComponent`); Node URL probe | Total outage if secret has `= @ : /` space | `decodeURIComponent` user/pass | **Must fix** | 2C.2 |
| **F-4** missing F.5 ledger row (test env) | High | test ledger 6 rows, no F.5; app ledger has it @ 2026-09-11T16:06:57.831 | Unknown env reports a real gap as WARN, not CRITICAL | Resolve/apply migration on **test DB only**; re-baseline M2 test 3 | **Must verify** | 2C.2 |
| **F-5** missing FK constraints (test env) | Medium | 55 vs 105 FK columns; 0 vs 5 on snapshot; 0 `CONSTRAINT` in test DDL | None on reads; weakens referential-integrity proof | Rebuild test schema from history; re-run all suites | **Must verify** | 2C.2 |
| **F-6** app-DB target ambiguity (NEW) | High | `.env` → 3306 (49 tables, F.5); task 3307 container → 43 tables, no ledger | Wrong target breaks Integrity + schema | Confirm release target DB | **Must verify** | 2C.2 |
| **F-3** test healthcheck | Low | `unhealthy` (no `mysqladmin`) | None | Fix compose healthcheck | Deferred | backlog |
| **F-1** URL drift | — | `.env.test` both URLs = 3308; setup pins | None | Done | ✅ closed (verified) | — |
| **P-19** no margin field | Low | pnl.types.ts | None (client arithmetic) | Optional field / document | Non-blocking | backlog |
| **P-20** today window asymmetry | Low | pnl.service.ts:34–41/86–91; §19 Sc18 | Expense vs revenue window differ for `today` | Business-rule decision | Document | backlog |
| **P-21** provisional NP / purchases excluded | Low | pnl.service.ts:165–167 | Disclosed; not a defect | Document | Non-blocking | backlog |
| **Legacy refund projection** | Low | §18.6; disjoint bases | Cost-attribution difference only | Document | Non-blocking | backlog |
| **D-1** stale predicate comments | Trivial | profitability.service.ts:24–25; types:6–8 | None | Comment fix | Non-blocking | backlog |

### 21.8 Minimal remediation phase proposal (STEP 2C.2 — not started)

1. **F-2** — `decodeURIComponent` the username/password in `src/lib/prisma.ts` (+ a URL-form unit test).
2. **A-9 / A-11** — replace the two PAID-only raw predicates with `revenueSetSql`; add revenue-suite coverage for `getProductReport` and update Sc11's expectation.
3. **F-4 / F-5** — on the **isolated test DB only**: apply/resolve the full migration history (or `db push` to add the missing FKs), confirm 105 FK columns and the F.5 ledger row, then **re-baseline M2 test 3** and **re-run all five suites sequentially** + `tsc`/`build`.
4. **F-6** — confirm the release target database with the deployment owner (no data change).
5. Re-audit the release matrix and issue the verdict.

No application-DB mutation, no schema change to the app DB, no container recreation,
no commit/push/merge/deploy is required or proposed for any of the above in this phase.

### 21.9 Updated overall progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Topology, preflight, access recovery, isolated test container, schema, final safety | ✅ DONE |
| 2B.1 | Cashbook integration tests | ✅ DONE — 15/15 |
| 2B.2 | Revenue & Reporting integration tests | ✅ DONE — 19/19 |
| 2B.3 | Refund & Profitability integration tests | ✅ DONE — 21/21 |
| 2B.4 | P&L integration tests | ✅ DONE — 24/24 |
| 2B.5 | M2 Integrity (SQL) integration tests | ✅ DONE — 29/29 |
| **2C.1** | **Final cross-module evidence audit & release gap assessment** | **✅ DONE (this section) — audit only, no fixes** |
| Final cross-module verification (fixes + parity + rerun) | ⏳ **NOT STARTED** (phase lock respected) |

**Integration tests recorded: 15 + 19 + 21 + 24 + 29 = 108. M2 unit: 57.**

### 21.10 Release verdict

# 🚫 NOT READY FOR PRODUCTION

The read-models are internally coherent (9/12 relationships CONSISTENT) and the
108/108 + 57/57 evidence is real (production services, real SQL, deterministic
fixtures, tenant isolation, cleanup proof), **but unresolved blockers remain**:

* **Must fix:** A-9, **A-11 (new)**, F-2.
* **Must verify:** F-4, F-5, F-6 (new).
* **Documented / deferred (non-blocking):** F-3, P-19, P-20, P-21, legacy-refund projection, D-1.

No PASS is claimed here for any unexecuted check; no finding is closed merely
because a test passes. **STEP 2C.1 STOPS HERE — the full report is submitted for
review; STEP 2C.2 is NOT started.**

### 21.11 Final Git status

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the phase-start status (§21.1): the temporary read-only probe used for
this audit (`c2c1-probe.ts`) was removed, and no commit/push/merge/deploy was
performed. No production, test or schema file and no database row was modified.


---

## 22. STEP 2C.2A — DATABASE TOPOLOGY & SCHEMA PARITY PREFLIGHT

**Date:** 2026-10-14  
**Mode:** 🔒 STRICT READ-ONLY AUDIT — no production/test edits, no DB writes, no migration execution, no `db push`/`reset`, no ledger mutation, no DDL, no container recreation, no credential rotation, no integration-test execution, no commit/push/merge/deploy.  
**Phase lock:** no remediation implemented; STEP 2C.2B NOT started.

### 22.1 Initial Git status (start of this phase)

```
$ git rev-parse --abbrev-ref HEAD
main
$ git log -1 --oneline
e8d4aa3 fix selesai orderan
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to §21.1/§21.11. The four M2 files are preserved untouched.

### 22.2 Read-only audit methods

* Config read: `prisma.config.ts`, `prisma/schema.prisma`, `prisma/migrations/` (22 dirs), `docker-compose.yml`, `Dockerfile`, `Dockerfile.worker`, `next.config.ts`, `package.json`, `tests/setup.ts`, `src/lib/prisma.ts`, `.env`/`.env.test` (parsed programmatically; **credentials never printed**).
* Docker: `docker ps -a`, `docker inspect` (compose project / config-files / service labels), `docker volume ls` — read-only.
* Host: `ss -ltnp`, `ps`, `/proc/<pid>/{cwd,exe,stat,cmdline,environ}` (environ parsed and only host/port/db/user/password-length emitted), `systemctl list-units`, `systemctl --user list-units`.
* Databases: `mariadb` driver **SELECT / SHOW / `information_schema` only** — identity, `VERSION()`, `@@port`, `@@hostname`, table list, `_prisma_migrations`, FK list, unique indexes, column types/nullability. No inserts/updates/deletes; no private customer/order data read.

### 22.3 Three-instance identity matrix (read-only)

| | **A. `localhost:3306`** | **B. `127.0.0.1:3307`** | **C. `127.0.0.1:3308`** |
|---|---|---|---|
| Runtime owner | **system service `mariadb.service`** (`/usr/libexec/mariadbd`, pid 1041) — **not a container** | container `restaurant-mariadb` from **`/home/reksa/restorant-cafe2/docker-compose.yml`** (project `restorant-cafe2`), volume `restorant-cafe2_mariadb_data`, `3307→3306` | container `restaurant-mariadb-test` — **no compose labels** (created manually, `docker run`), volume `restaurant-mariadb-test_data`, `127.0.0.1:3308→3306` |
| `SELECT DATABASE()` | `restaurant_app` | `restaurant_app` | `restaurant_app_test` |
| `CURRENT_USER()` / `USER()` | `root@localhost` | `root@%` / `root@172.18.0.1` | `restaurant_test@%` / `restaurant_test@172.18.0.1` |
| `VERSION()` | **11.8.8-MariaDB** (`@@hostname webdev`) | 11.8.9-MariaDB-ubu2404 (container `8c3f38d3ecbf`) | 11.8.9-MariaDB-ubu2404 (container `bae65d9fc587`) |
| `@@port` (inner) | 3306 | 3306 | 3306 |
| Tables | **49** | **43** | **49** |
| `_prisma_migrations` | **28 rows** | **TABLE MISSING** | **6 rows** (6th `finished_at` UNFINISHED) |
| F.5 migration row | ✅ present — `2026-09-11T16:06:57.831` | ❌ (no ledger at all) | ❌ absent |
| FK columns | **105** | 96 | **55** |
| Accounting tables present | 23/23 | **20/23** (missing `expense`, `expensecategory`, `_prisma_migrations`) | 23/23 |
| Container inner hostname | host `webdev` | `8c3f38d3ecbf` | `bae65d9fc587` |

### 22.4 Verified application runtime DB mapping

| Consumer | Target | State |
|----------|--------|-------|
| **This repo's local Next.js app** | `mysql://…@localhost:3306/restaurant_app` (`.env` `DATABASE_URL`) | ⚠️ **CONFIGURED — NOT RUNTIME-VERIFIED.** No process from `/home/reksa/restorant-cafe` is running. The thing listening on **:3000** is `node server.js`, cwd **`/home/reksa/repiw-app-v1(1)`** (a **different project**, no `DATABASE_URL` in its `/proc/<pid>/environ`) |
| **Prisma CLI** (`prisma.config.ts` → `dotenv/config` → `env("DATABASE_URL")`) | `localhost:3306/restaurant_app` | ⚠️ **CONFIGURED** (deterministic from config; not executed this phase). Note: a bare `prisma migrate deploy/reset/dev` from the repo root would target **3306**, the shared host DB |
| **This repo's `docker-compose.yml`** (`app`/`worker` → `mysql:3306`; service `mysql`, container `restaurant-mysql`) | compose-internal `mysql:3306` | ⚠️ **CONFIGURED — stack NOT running.** No `restaurant-mysql`, `restaurant-nginx`, or this repo's `restaurant-app` exist; only the sibling project's exited `restaurant-app`/`restaurant-worker` |
| **Docker Compose that IS running** (`restorant-cafe2`) | internal `mariadb:3306` = host **3307**, container `restaurant-mariadb` | ✅ **VERIFIED** (compose labels + inspect) — but it is a **different project** |
| **PM2** | n/a | ⛔ **NOT APPLICABLE** — no `pm2` binary/`jlist`, no ecosystem file |
| **System services** | `mariadb.service` → **3306** | ✅ **VERIFIED** |
| **Accounting integration tests** (`.env.test` + `tests/setup.ts` pin) | `127.0.0.1:3308/restaurant_app_test` | ✅ **VERIFIED** (config + prior suite runs; test user sees only `information_schema` + `restaurant_app_test`) |
| **Any deployment runtime** | — | ❓ **UNKNOWN** — not locally verifiable; nothing in this workspace runs this repo |

### 22.5 F-6 root cause and evidence

**Root cause.** F-6 was a naming/assumption error, not a code defect: the container named
`restaurant-mariadb` on **3307** does **not** belong to this repository. `docker inspect`
shows `com.docker.compose.project = restorant-cafe2` and
`config_files = /home/reksa/restorant-cafe2/docker-compose.yml`. This repo's own
`docker-compose.yml` defines a `mysql` service (image `mysql:8.0`, container
`restaurant-mysql`, `3306:3306`) that is **not running at all**. The database this repo is
*actually configured to use* is the **shared host MariaDB on 3306** (system service
`mariadb.service`), which also hosts unrelated local databases (`airprod_test`,
`ecommerce_iot`, `tinggalklik`, `toko`, `reksa`, `prisma_migrate_shadow_db`, …).

**Evidence.** (i) compose labels above; (ii) `.env` of this repo, `restorant-cafe2/.env` and
`repiw-app-v1(1)` all resolve to `localhost:3306`; (iii) 3307 has an **older** schema
(43 tables — missing `expense`, `expensecategory`, `reservation`, `tablelayout`,
`tablelayoutitem`, and the whole `_prisma_migrations` table) and only 96 FK columns;
(iv) the running app on :3000 belongs to `/home/reksa/repiw-app-v1(1)`.

**Consequence.** "3307 = the application DB" is **false for this repo**. Any future step that
"repairs" 3307 would modify a **different project's** database. Conversely, 3306 is a
**shared** dev host, so it is **not** a safe target for destructive test setup either.

**Status:** F-6 **root-caused**; the remaining action is to confirm the real deployed target
(not locally verifiable → UNKNOWN).

### 22.6 F-4 / F-5 exact schema differences (test C vs application A)

Compared read-only: **C = 3308/restaurant_app_test** vs **A = 3306/restaurant_app** (the
schema built by the complete migration chain).

| Dimension | Result |
|-----------|--------|
| Table set | **IDENTICAL** — 49 vs 49, zero difference (`comm` empty both directions) |
| Column types / nullability | **IDENTICAL** for every compared table (`orderitemcostsnapshot`, `expense`, `order`, `orderitem`). The only delta in `information_schema.columns` is `column_key` (`MUL` present on A, absent on C) — i.e. the FK's supporting index |
| Unique constraints | Identical on the accounting tables (`orderitemcostsnapshot_orderItemId_key(orderItemId)`, `PRIMARY(id)`, `order_restaurantId_orderNumber_key`, …) |
| **Foreign keys** | **C = 55, A = 105 → 50 missing** (C ⊆ A; **zero** test-only FKs) |
| `orderitemcostsnapshot` FKs | **C = 0, A = 5** (`branchId→branch`, `orderId→order`, `orderItemId→orderitem`, `productId→product`, `restaurantId→restaurant`). `SHOW CREATE TABLE` on C has **0** `CONSTRAINT` clauses, though `schema.prisma` declares all five |
| Migration ledger | C = 6 rows (last `20260908030144_add_branch_multi_cabang` **UNFINISHED**); A = 28 rows, every on-disk migration present |
| F.5 cutoff metadata | C = **absent**; A = `2026-09-11T16:06:57.831` (the mandated cutoff) |

**The 50 missing FKs are exactly the constraints introduced *after* C's ledger stops**:
the whole F.5 set (5), `expense.*` + `expensecategory.restaurantId` (5),
`order.branchId`, `payment.branchId`, `promo.branchId`, `promousage.*`, `order.promoId`,
`stockmovement.*`, `ingredientstockmovement.*`, `ingredient.restaurantId`,
`purchase*`/`supplier`/`recipe*`/`optioningredient`/`addoningredient`/`branchingredient`/
`notification.branchId`/`productrecommendation.*`/`table.restaurantId`. Full diff captured in
`/tmp/fk-*.txt` during the audit.

**Why C is a hybrid (no `db push` equivalence assumed).** C has all 49 tables of the current
schema **and** the first 5 migrations' constraints (55 FK columns), but the 6th migration's
row is **unfinished** and its FK constraints (and every later migration's) are absent — while
the later tables themselves exist. A faithful `prisma db push` from today's `schema.prisma`
(§6's recorded method) *would* emit those `CONSTRAINT` clauses, and a faithful
`migrate deploy` would have applied all 22 migrations. C matches **neither**, so its
**provenance is uncertain / not reproducibly derived** from the repo's migration chain.

### 22.7 Migration-chain completeness assessment

* On disk: **22 migration directories**, `migration_lock.toml` `provider = "mysql"`.
* Application A: ledger **28 rows** (duplicates from retried/partial runs: `0_baseline ×2`,
  `20260910_add_product_recommendations ×2`, `20260911_add_ingredient_f1 ×4`), and **every one
  of the 22 on-disk migrations is present**. `comm` "on-disk not in A" = **empty**.
* ⇒ **The migration chain is COMPLETE; there is no missing dependency.** The §6 STOP
  condition ("if the migration chain is incomplete, STOP") is **not** triggered.
* Note (read-only): `_prisma_migrations` has **only `PRIMARY(id)`** — **no unique index on
  `migration_name`**, so duplicate migration names are permitted (A proves this). This matters
  for remediation (see M-1).

### 22.8 Safety risks

| # | Risk | Assessment |
|---|------|------------|
| R-1 | **Bare Prisma CLI targets 3306** | `prisma.config.ts` reads `DATABASE_URL` from `.env` → **3306, a shared host DB**. `npm run db:migrate` (`prisma migrate dev`), `db:push`, or a bare `prisma migrate reset` would touch it. Any test-setup command **must** override `DATABASE_URL`/`TEST_DATABASE_URL` to the isolated 3308 URL explicitly |
| R-2 | **3307 is another project** | Modifying 3307 would mutate `/home/reksa/restorant-cafe2`'s database. It must never be a target |
| R-3 | **Test schema provenance uncertain** | C is a hybrid (49 tables, 6-row ledger, 50 FKs missing). "Repairing in place" is risky: MariaDB DDL is non-transactional, and the tool that likely produced C (`db push`) is the same one that produced the gap. Re-running `db push` may add FKs but cannot reconstruct a legitimate ledger |
| **M-1 (NEW, latent)** | `resolveLegacyCutoff()` runs `SELECT … FROM _prisma_migrations WHERE migration_name = ? LIMIT 1` **without `ORDER BY`**. With exactly one F.5 row it is deterministic (current A and the current M2 mirror fixture each have one). It becomes **nondeterministic if two F.5 rows ever coexist** — which is exactly what would happen if a fresh-DB migration records a real F.5 row **and** the M2 suite also installs its mirrored row. Remediation must guarantee **exactly one** F.5 row |
| R-4 | **Fresh migrate changes the cutoff literal** | A fresh `migrate deploy` records F.5 with the **apply time (now)**, not the production literal `2026-09-11T16:06:57.831`. The mandated 8-row fixture (all completions before 2026-10-14) would then classify differently. The cutoff baseline is a **deliberate design decision**, not a side effect |

### 22.9 Recommended isolated remediation strategy

**Prefer B (fresh disposable isolated database), not A (repair in place).** Rationale: C's
provenance is uncertain and its drift is structural (missing constraints + partial ledger), so
rebuilding from the **complete migration chain** yields a schema that is *provably* equal to the
application schema (105 FK columns, full ledger, F.5 present) and is reproducible.

Concrete plan (all inside the existing **isolated test container on 3308**; no new container,
no external credentials):

1. Create a **new, empty database** on the 3308 container (e.g. `restaurant_app_test_migrated`),
   owned by the existing `restaurant_test` user. (Alternative: drop-and-recreate
   `restaurant_app_test` on the same container — both are test-only.)
2. Apply the full chain with `DATABASE_URL` **explicitly** set to the 3308 URL (never the bare
   repo `.env`): `prisma migrate deploy` (`prisma.config.ts` is honoured via `DATABASE_URL`).
3. **Cutoff handling (the F-4 decision)** — pick one, deliberately:
   * (a) *Mirror the production baseline*: apply the chain, then record **exactly one** F.5 row
     with the documented production literal `2026-09-11 16:06:57.831` (delete/replace the
     auto-applied row so only one exists — required by M-1), and **remove the M2 suite's
     mirrored-row fixture** (no longer needed). This preserves the mandated 3/2/2/1 fixture and
     mirrors production; it is a *test-baseline* claim, clearly documented as such.
   * (b) *Accept the fresh apply-time*: keep the real F.5 row, and **re-baseline** the M2
     expectations to the new cutoff (the user's mandated literal no longer applies).
   Recommendation: **(a)**, because the whole phase was specified around the production cutoff.
4. Verify parity (read-only checks): 49 tables; **105 FK columns**; `orderitemcostsnapshot` has
   its 5 FKs; ledger contains all 22 migrations; **exactly one** F.5 row; the unique indexes
   still present.
5. Update only `TEST_DATABASE_URL`/`DATABASE_URL` in the gitignored `.env.test` to the new DB
   name — **credentials unchanged**, same isolated container, same `restaurant_test` user.
6. Re-run **all five suites sequentially** and `tsc`/`build`; M2 test 3 is expected to change
   (it currently asserts the F-4 fallback).
7. **Rollback:** drop the new disposable database and restore the one-line `.env.test` value —
   the previous `restaurant_app_test` is left untouched until the new DB is proven green.

**Isolation guarantees:** only 127.0.0.1:3308 is addressed; 3306 (shared host) and 3307
(another project) are never used; no new credentials are created; the test user still cannot
see `restaurant_app`.

### 22.10 Exact next-phase implementation proposal (STEP 2C.2B — not started)

**Preconditions:** explicit approval; a saved copy of the current `.env.test`; all business
tables on 3308 at 0 rows (true today) so adding FKs cannot hit orphans.

| Step | Action | Guard |
|------|--------|-------|
| 1 | Create empty DB `restaurant_app_test_migrated` on **127.0.0.1:3308** (via the container) | explicit host+port in the command; never a bare URL |
| 2 | `DATABASE_URL=<3308 explicit> npx prisma migrate deploy` | refuse to run if the resolved URL host/port/db ≠ 127.0.0.1:3308/…_test (add a shell guard echoing the masked target) |
| 3 | Enforce exactly one F.5 row = production literal `2026-09-11 16:06:57.831` (option (a)) | `SELECT COUNT(*)` must equal 1 |
| 4 | Remove the M2 ledger-mirror fixture (test edit) and re-baseline test 3 | only the test file; four M2 production files untouched |
| 5 | Verify parity (tables/FKs/ledger/indexes) read-only | 105 FK columns; 5 on snapshot; 22 ledger rows |
| 6 | Point `.env.test` at the new DB; run all five suites sequentially + `tsc` + `build` | capture exit codes **and** counts |
| 7 | On any failure: drop the new DB, restore `.env.test`, report | no changes to 3306/3307 ever |

Files that would change: `tests/accounting/integrity.integration.test.ts` (mirror fixture +
test 3), `.env.test` (gitignored, one line), `tests/README.md` + this plan (docs). **No
production source change; no schema change to any application DB.**

**Verification of migration parity:** compare against the verified application schema A
(table sets, FK list, unique indexes, column types/nullability) using the same read-only
queries used in §22.6.

**Rollback plan:** the fresh DB is disposable → `DROP DATABASE restaurant_app_test_migrated`
on 3308 and restore `.env.test`; the prior `restaurant_app_test` is untouched.

**Explicit approval gate:** STEP 2C.2B must not begin until the reviewer approves this plan,
because it performs writes (new DB, migrations, ledger baseline) and a test edit.

### 22.11 Carried-forward findings (status in this phase)

| ID | Status |
|----|--------|
| F-1 | ✅ FIXED (verified §21.4) |
| F-2 | 🚫 OPEN (deferred; not fixed here) |
| F-3 | ⏳ DEFERRED |
| F-4 | 🚫 OPEN — root cause confirmed (no F.5 row; partial ledger) |
| F-5 | 🚫 OPEN — quantified (50 FK columns missing; test ⊆ app) |
| F-6 | 🔎 **UNDER INVESTIGATION → root-caused this phase** (3307 = sibling project; real target = shared host 3306; deployed target UNKNOWN) |
| A-9 | 🚫 OPEN (not fixed here) |
| A-11 | 🚫 OPEN (not fixed here) |
| P-19 / P-20 / P-21 | 📄 documented |
| Legacy refund projection | 📄 documented |
| D-1 | ⏳ deferred |
| **M-1 (NEW)** | 🆕 OPEN (latent: F.5 lookup `LIMIT 1` without `ORDER BY`) |

### 22.12 Final Git status

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to the phase-start status (§22.1): the temporary read-only probe (`c2c2a-probe.ts`)
was removed, `git diff --name-only` still lists only the six pre-existing tracked files (the
four M2 files + `.env.example` + `.gitignore`), and **no test file, source file, schema or
migration was modified**. No commit/push/merge/deploy was performed.

### 22.13 Updated overall progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Topology, preflight, access recovery, isolated test container, schema, final safety | ✅ DONE |
| 2B.1–2B.5 | Cashbook 15/15 · Revenue 19/19 · Refund & Profitability 21/21 · P&L 24/24 · M2 29/29 | ✅ DONE (108 total) |
| 2C.1 | Final cross-module evidence audit | ✅ DONE — NOT READY FOR PRODUCTION |
| **2C.2A** | **Database topology & schema parity preflight** | **✅ DONE (this section) — read-only** |
| 2C.2B | Remediation (fresh isolated DB + parity + rerun) | ⏳ **NOT STARTED — awaiting approval** |

**Production readiness: 🚫 NOT READY** (unchanged from §21.10; F-6 root-caused but the deployed
target is still UNKNOWN).

### 22.14 Explicit STOP / approval requirement

**STEP 2C.2A STOPS HERE.** No database, schema, ledger, container, credential, source or test
file was modified. STEP 2C.2B performs **writes** (a new test database, migrations, and a
one-row F.5 baseline), so it requires **explicit reviewer approval** before it may begin. The
approved plan is §22.10. Nothing further will run automatically.


---

## 23. STEP 2C.2B — FRESH ISOLATED TEST DATABASE & MIGRATION PARITY

**Date:** 2026-10-14  
**Mode:** authorized write — **new disposable database inside the dedicated test container (127.0.0.1:3308) only**; all other databases strictly read-only.  
**Outcome:** ⛔ **STOPPED on a migration failure** (P3018). The migration chain is **not replayable from empty** — new blocking finding **F-7**. No fake ledger row was inserted, no migration file was modified, no protected database was touched.

### 23.1 Initial Git status (start of this phase)

```
$ git branch --show-current ; git log -1 --oneline
main
e8d4aa3 fix selesai orderan
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Preserved: the four M2 files and every pre-existing change are untouched.

### 23.2 Approval evidence

* The §3 gate was presented (new DB name, target container identity, host/port, user/privileges, init method, rollback, proof of target).
* The reviewer selected **"I'll provide the 3308 root credential"** — i.e. **explicit approval** to create a new disposable database inside the dedicated test container only.
* Credential handling: the container admin credential was taken from the container's own config (and it also exists locally as the gitignored `.env.test` keys `DB_TEST_ROOT_PASSWORD` / `DB_TEST_USER_PASSWORD`). **No credential was ever printed**, and none was added to git.
* Preflight privilege fact (unchanged): the suite user `restaurant_test@%` holds only `GRANT ALL ON restaurant_app_test.*` — it **cannot** create databases or users, which is why the admin credential was required.

### 23.3 Exact target identity (proven before any write)

| Property | Value |
|----------|-------|
| Container | `restaurant-mariadb-test` |
| Image / version | `mariadb:11.8` → `11.8.9-MariaDB-ubu2404` |
| Compose labels | **none** (standalone; **not** part of `restorant-cafe2`) |
| Published port | `127.0.0.1:3308 → container 3306` (loopback only) |
| `@@hostname` (connected) | `bae65d9fc587` |
| Volume | `restaurant-mariadb-test_data` |
| Databases visible | `information_schema`, `mysql`, `performance_schema`, `restaurant_app_test`, `sys` (+ new `restaurant_app_test_v2`) |

Distinct from the host `mariadb.service` on **3306** and from `restaurant-mariadb` on **3307** (project `restorant-cafe2`). All writes in this phase went to **127.0.0.1:3308 only**.

### 23.4 Actions executed

1. **Created** `CREATE DATABASE restaurant_app_test_v2` (utf8mb4 / utf8mb4_unicode_ci) on **127.0.0.1:3308**.
2. **Created** the dedicated test user `restaurant_test_v2@%` with a generated URL-safe password and `GRANT ALL PRIVILEGES ON restaurant_app_test_v2.*`. (Credential stored only in the gitignored `.env.test` under the inert key `DISPOSABLE_TEST_V2_URL` — never printed, not used by any suite.)
3. **Ran** the schema initialization with an **explicitly scoped** environment (guard asserted `127.0.0.1:3308/restaurant_app_test_v2` before execution):

```
[guard OK] 127.0.0.1:3308/restaurant_app_test_v2  user=restaurant_test_v2  pwLen=28
DATABASE_URL=<explicit 3308 URL> npx prisma migrate deploy
```

No `migrate dev`, no `migrate reset`, no `db push`, no `--accept-data-loss`, no implicit `DATABASE_URL`, no ledger insertion, no migration-file change.

### 23.5 Migration results — FAILED (P3018)

```
Loaded Prisma config from prisma.config.ts.
Datasource "db": MySQL database "restaurant_app_test_v2" at "127.0.0.1:3308"
22 migrations found in prisma/migrations
Applying migration `0000_init_schema`                                  ✅
Applying migration `20260904_add_qris_payment_fields`                  ✅
Applying migration `20260904155600_add_rbac_shifts_approvals`          ✅
Applying migration `20260907_hardening_session_payment`               ✅
Applying migration `20260908_add_restaurant_branding`                  ✅
Applying migration `20260908030144_add_branch_multi_cabang`            ❌ P3018
Error: P3018  Migration name: 20260908030144_add_branch_multi_cabang
Database error code: 1146     Database error:
Table 'restaurant_app_test_v2.promo' doesn't exist   (query number 7)
migrate exit code = 1
```

The failed migration is recorded in the fresh ledger with `finished_at = NULL` (no fake row was written).
Fresh DB state after failure: **24 tables, 6 ledger rows (1 unfinished), 0 F.5, 42 FK columns, `promo` absent.**

### 23.6 F-7 (NEW, BLOCKING) — the migration chain is not replayable from empty

**Root cause (evidence).**
* Migration `20260908030144_add_branch_multi_cabang` (query 7) runs
  `ALTER TABLE \`promo\` ADD COLUMN \`branchId\` …` — i.e. it **requires a pre-existing `promo` table**.
* The `promo` table is only ever **created** by the *later* migration
  `20260909_add_customer_auth_promo/migration.sql` (`CREATE TABLE \`promo\` …`).
* Therefore any clean `prisma migrate deploy` from an empty database **must** fail at
  `20260908030144_add_branch_multi_cabang`. Confirmable statically: the only `CREATE TABLE `promo``
  in `prisma/migrations/**` lives in the 0909 migration, which sorts *after* the 0908 one.

**Why the application DB (3306) nevertheless has all 28 ledger rows + 105 FKs.** Its `started_at`
order shows `20260909_add_customer_auth_promo` applied **before**
`20260908030144_add_branch_multi_cabang`, and it also contains `0_baseline` rows with **no
corresponding migration directory** (`migrate resolve --applied 0_baseline`). The application
schema was built **incrementally/drifted**, not by replaying the repo's migration chain. The
`promo` table existed before the branch migration ran there.

**Consequence for the original test DB (explains F-4/F-5 precisely).** The original
`restaurant_app_test` ledger ends at the **same** migration with `finished_at = NULL` — whoever
provisioned it hit the **same P3018**, then completed the schema by a non-faithful route
(`prisma db push` per §6) that materialised the 49 tables but **not** the constraint DDL of
migrations 6+ (hence 55 FK columns and 0 FKs on `orderitemcostsnapshot`). F-4 and F-5 are
therefore **downstream symptoms of F-7**.

**Severity / impact.** F-7 is a **production/devops blocker**: a brand-new empty environment
**cannot be provisioned** by `prisma migrate deploy` (deploys, CI, staging, DR all break). It
does not change any financial value at runtime, but it invalidates the "migration chain is
COMPLETE" reading from §22.7 — the *files* are all present, but the chain is **not self-contained**.

**Minimal correction (proposed, NOT executed here).** Add a **new** corrective migration that
creates the missing base objects (at minimum `promo`, and any other pre-existing table later
migrations alter) *before* the dependent migration — or re-baseline the chain with an explicit
initial migration. Editing/renaming existing migration files is out of bounds for this phase.

### 23.7 Schema parity matrix — NOT ACHIEVED

| Dimension | Application (3306) | Original test (3308) | **Fresh v2 (FAILED)** |
|-----------|--------------------|----------------------|------------------------|
| Tables | 49 | 49 | **24** |
| Ledger rows | 28 | 6 (1 unfinished) | **6 (1 unfinished)** |
| F.5 row | ✅ `2026-09-11T16:06:57.831` | ❌ | **❌** |
| FK columns | 105 | 55 | **42** |
| `promo` table | ✅ | ✅ | **❌** |

Parity was **not** established: the migration chain cannot produce the application schema from
empty. **No financial suite was run** (per §7/§8).

### 23.8 FK / unique-constraint comparison

Not applicable to v2 (the run aborted at migration 6; only 24 tables exist). For reference from
§22.6: application = **105** FK columns incl. `orderitemcostsnapshot` (5) and the unique
`orderitemcostsnapshot_orderItemId_key`; original test = 55 FK columns, **0** FKs on
`orderitemcostsnapshot`, same unique index. The fresh DB is additionally missing `promo` and
every table created by migrations 7–22.

### 23.9 Migration ledger / F.5 assessment

| DB | Ledger | F.5 | Note |
|----|--------|-----|------|
| Application (3306) | 28 rows (5 with `finished_at = NULL`, incl. historical `0_baseline`/`add_ingredient_f1` retries) | 1 row, `2026-09-11T16:06:57.831` | production cutoff literal; **unchanged** |
| Original test (3308) | 6 rows, **1 unfinished** (`…add_branch_multi_cabang`) | 0 | **unchanged** (protected) |
| Fresh v2 (3308) | 6 rows, **1 unfinished** (same migration, real failure) | 0 | failed artifact |

### 23.10 M2 cutoff implications

* `resolveLegacyCutoff()` reads `_prisma_migrations.finished_at` for the F.5 migration with
  **`LIMIT 1` and no `ORDER BY`** (**M-1**). In the fresh DB there is **no** F.5 row at all, and
  the original test DB has none either, so `cutoff = null` and C2 degrades to
  `unknownCompletion` exactly as M2 test 3 asserts today.
* A fresh `migrate deploy` **would not** reproduce the production cutoff literal anyway (its F.5
  `finished_at` would be the apply time) — so **C. Runtime-dependent cutoff parity is inherently
  unachievable by replay**, independent of F-7. Confirmed and explicitly **not manufactured**:
  no genuine migration timestamp was replaced.
* Exactly one eligible F.5 row would be the requirement once parity is achieved; the deterministic
  `ORDER BY` fix belongs to a separate production remediation phase (do **not** modify the four M2
  files here — untouched).
* Existing M2 fixtures **do** need re-baselining once a real F.5 row exists (test 3 flips), but
  that work is deferred to the approved test-bootstrap phase (§23.11).

### 23.11 Test migration plan (PROPOSED — not executed)

Because F-7 blocks the `migrate deploy` route, the parity strategy must change. Proposed for the
next approved phase (no suite was switched, none was run):

1. **Decide the parity source.** Either
   * **(P-1) Repair the chain** with a new corrective migration so `migrate deploy` works from
     empty (best long-term — it also unblocks production provisioning), then redo the fresh DB; or
   * **(P-2) Materialise from `schema.prisma`** (`db push`, source of truth) to obtain the
     105-FK schema, accepting that no legitimate migration ledger is produced, and handle the
     cutoff baseline separately (as the original test DB did).
   Recommendation: **P-1** (fixes a real production defect) then **P-2 only if P-1 is deferred**.
2. **Additive, fail-closed test-bootstrap changes (to be proposed in that phase, not now):**
   * `tests/setup.ts` — keep the fail-closed checks; add an **allow-list** so `DATABASE_URL` is
     pinned only to a database whose name **starts with `restaurant_app_test`** on **port 3308**,
     and **hard-reject** hosts `3306`/`3307` (defence against the F-6 topology trap).
   * `.env.test` / `.env.test.example` — add the v2 URL/keys as placeholders; `.env.test` stays
     gitignored.
   * M2 integration fixture — once one genuine F.5 row exists, remove the mirrored-row install
     (M-1) and re-baseline test 3 to the **real** cutoff.
   * `tests/fixtures/accounting.ts` / `tests/README.md` — document the new target.
3. **Re-run** all five suites sequentially + `tsc` + `build` only after the bootstrap change is
   approved. **No expected financial value may be rewritten to make a suite pass.**

### 23.12 Original-database preservation evidence

Read-only re-verification after the writes (all values match the §22.3 / phase-start numbers):

| DB | Tables | Ledger | F.5 | FK cols | Verdict |
|----|--------|--------|-----|---------|---------|
| Original test `restaurant_app_test` (3308) | 49 | 6 (1 unfinished) | ❌ | 55 | ✅ **unchanged** |
| Application/shared (3306, `@@hostname webdev`) | 49 | 28 | ✅ `2026-09-11T16:06:57.831` | 105 | ✅ **untouched** |
| Project `restorant-cafe2` (3307) | 43 | (no ledger) | n/a | 96 | ✅ **untouched** |

No business data was written to 3306 or 3307; the only schema mutations in this phase were
`restaurant_app_test_v2` and its dedicated user, both on **3308**.

### 23.13 Rollback plan

* **Failed artifact:** `DROP DATABASE restaurant_app_test_v2; DROP USER 'restaurant_test_v2'@'%';`
  on **127.0.0.1:3308** (never 3306/3307). Its credential is the inert `DISPOSABLE_TEST_V2_URL`
  key in the gitignored `.env.test` (remove that line on rollback).
* The **original** `restaurant_app_test` is untouched and needs no rollback.
* No container, migration file, source file, or production database is affected by rollback.

### 23.14 Carried-forward findings (status in this phase)

| ID | Status |
|----|--------|
| F-1 | ✅ FIXED |
| F-2 | 🚫 OPEN |
| F-3 | ⏳ DEFERRED |
| F-4 | 🚫 OPEN — now explained as a symptom of **F-7** |
| F-5 | 🚫 OPEN — 55 vs 105 FK columns; symptom of **F-7** |
| F-6 | 🔎 root-caused (§22.5); deployed target still UNKNOWN |
| **F-7 (NEW)** | 🆕 **OPEN — BLOCKING**: migration chain not replayable from empty (P3018; `promo` created by a later migration) |
| A-9 / A-11 | 🚫 OPEN (untouched) |
| P-19 / P-20 / P-21 / legacy refund / D-1 | 📄 documented / deferred |
| M-1 | 🆕 OPEN (F.5 lookup `LIMIT 1` without `ORDER BY`) |

### 23.15 Updated progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Topology, preflight, access recovery, isolated test container, schema, final safety | ✅ DONE |
| 2B.1–2B.5 | Cashbook 15 · Revenue 19 · Refund/Profitability 21 · P&L 24 · M2 29 | ✅ DONE (108) |
| 2C.1 | Final cross-module evidence audit | ✅ DONE — NOT READY FOR PRODUCTION |
| 2C.2A | Topology & schema parity preflight (read-only) | ✅ DONE |
| **2C.2B** | **Fresh isolated test DB & migration parity** | ⛔ **STOPPED — P3018; F-7 (blocking) found; parity not achieved** |
| 2C.2C | Remediation of **F-7** + fresh DB + parity + rerun | ⏳ **NOT STARTED — awaiting approval** |

**Production readiness: 🚫 NOT READY** (F-7 **new blocking** finding added).

### 23.16 Final Git status

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to §23.1. The temporary scripts (`c2c2b-init.ts`, `c2c2b-verify.ts`) were removed; the only
non-git change is the gitignored `.env.test` key `DISPOSABLE_TEST_V2_URL`. No commit/push/merge/deploy.

### 23.17 Explicit STOP and next approval requirement

**STEP 2C.2B STOPS HERE.** The approved write (new DB + dedicated user on 3308) was performed, but
schema initialization **failed** as mandated, so the phase halts on **F-7**. Nothing further runs
automatically. The next phase must be approved explicitly and should first decide the **P-1 vs P-2**
parity route (§23.11); the failed `restaurant_app_test_v2` can be dropped via §23.13 or retained as
evidence, at the reviewer's discretion.


---

## 24. STEP 2C.2C — F-7 MIGRATION REPAIR STRATEGY AUDIT

**Date:** 2026-10-14  
**Mode:** 🔒 STRICT AUDIT ONLY — no migration repair, no database write, no DDL, no `migrate deploy/dev/reset`, no `db push`, no `migrate resolve`, no file edits, no container recreation, no credential change, no commit.  
**Outcome:** root cause pinned to **two** ordering defects; recommendation = **Option A (minimal compatible rewrite of the two historical migrations)**. Nothing implemented.

### 24.1 Initial Git status (start of this phase)

```
$ git branch --show-current ; git log -1 --oneline
main
e8d4aa3 fix selesai orderan
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

The four M2 files and every pre-existing change are preserved. **Audit methods (read-only):** file reads, `grep`, a static dependency-graph script (temp, deleted), `sha256` computation vs the app ledger, and one read-only `prisma migrate status` against the failed v2 ledger to obtain the authoritative apply order. **No DDL/DML was executed.**

### 24.2 Exact root cause (F-7)

Prisma applies migrations in **directory-name order** (the docs say "lexicographic"; empirically the order is locale/punctuation-aware). The authoritative order was taken from `prisma migrate status` (16 pending) combined with the 2C.2B deploy log (first 6):

| # | Migration | # | Migration |
|---|-----------|---|-----------|
| 0 | `0000_init_schema` | 11 | `20260911_add_recipe_bom` |
| 1 | `20260904_add_qris_payment_fields` | 12 | `20260911120000_add_promousage_branch_id` |
| 2 | `20260904155600_add_rbac_shifts_approvals` | 13 | `20260911130000_add_stock_branchproduct` |
| 3 | `20260907_hardening_session_payment` | 14 | `20260911140000_add_purchasing_inventory_foundation` |
| 4 | `20260908_add_restaurant_branding` | 15 | `20260911143644_f5_order_item_cost_snapshot` |
| **5** | **`20260908030144_add_branch_multi_cabang` ← FAILS** | 16 | `20260912_add_branchproduct_costing_mode` |
| 6 | `20260908040000_table_unique_per_branch` | 17 | `20260913_add_addon_option_bom` |
| 7 | `20260909_add_customer_auth_promo` *(creates `promo`)* | 18 | `20260913_add_refund_item_allocation` |
| 8 | `20260910_add_product_recommendations` | 19 | `20260915_add_reservation` |
| 9 | `20260911_add_ingredient_f1` | 20 | `20260920_add_floor_layout` |
| **10** | **`20260911_add_ingredient_purchasing_wac` ← FAILS NEXT** | 21 | `20261009_add_expense_management` |

The defect is **mixed-length timestamp prefixes**: names like `20260908030144_…` (14-digit) and `20260911…` sort *before* `20260909_…` / `20260911140000_…` respectively, so two "later-dated" migrations run before the migrations that create their dependencies. The chain therefore cannot be replayed from empty.

### 24.3 Complete migration dependency audit (static, whole chain)

Method: for every migration in the order above, every `ALTER TABLE`/`CREATE INDEX`/`DROP`/FK `REFERENCES` target was checked against the set of tables created so far (a table created in the *same* file is not a blocker). Result — **exactly two genuine cross-file blockers**:

| # | Migration | Offending statement(s) | Depends on | Created by | Verdict |
|---|-----------|------------------------|------------|------------|---------|
| 5 | `20260908030144_add_branch_multi_cabang` | L20 `ALTER TABLE promo ADD COLUMN branchId`; L97 `CREATE INDEX promo_branchId_idx`; L136 `ADD CONSTRAINT promo_branchId_fkey` | `promo` | `20260909_add_customer_auth_promo` (step 7) | **BLOCKER** |
| 10 | `20260911_add_ingredient_purchasing_wac` | `CREATE TABLE purchaseingredient (… CONSTRAINT purchaseingredient_purchaseId_fkey FOREIGN KEY (purchaseId) REFERENCES purchase(id) …)` | `purchase` | `20260911140000_add_purchasing_inventory_foundation` (step 14) | **BLOCKER** |

Everything else checked clean:
* **ALTER-before-CREATE:** none beyond the two above (all other altered tables are created in `0000_init_schema` or by an earlier migration in the same batch).
* **FK-before-referenced-table:** only `purchase` above (all other FKs reference tables created earlier or in the same file).
* **Index-before-column / index-before-table:** none remaining.
* **DROP/RENAME depending on history:** the single `DROP INDEX table_restaurantId_number_key` (step 6) is **valid** — that index *is* created by `0000_init_schema:migration.sql:46`. (My analyzer initially flagged it; case-insensitive grep proved it a false positive, corrected here.) No `RENAME`, `DROP TABLE`, `DROP COLUMN` anywhere.
* **Data migrations:** **none** (no `INSERT`/`UPDATE`/`DELETE`/`REPLACE`).
* **Non-portable/conditional SQL:** **none** (no `DELIMITER`, triggers, procedures, functions, `PREPARE`/`EXECUTE`).
* **Manual-order dependency:** the two blockers are exactly that.

**No blockers exist after step 10** — once `promo` and `purchase` exist, the remaining migrations (11–21) have no unmet dependency.

### 24.4 Existing-database compatibility audit

Read-only; nothing was modified.

| Database | Migration state | Impact of a migration-history change |
|----------|-----------------|--------------------------------------|
| **Host MariaDB 3306 (`restaurant_app`)** | 22/22 on-disk applied; **all 22 sha256 checksums match the files**; 28 ledger rows (duplicates + 2 `0_baseline` rows with **no** local file); 5 historical `finished_at = NULL` retries | Already has both migrations applied. Editing them changes only their checksums → `migrate deploy` **warns but continues** (see §24.7); **no DDL, no data loss**. Pre-existing drift (`0_baseline`) already present. |
| **Project 3307 (`restorant-cafe2`)** | schema 43 tables; **no `_prisma_migrations`** | Not managed by this repo's migrations; unaffected by edits. Must never be a migrate target. |
| **Original test DB `restaurant_app_test` (3308)** | 6 rows, migration #5 **FAILED** (`finished_at NULL`) | Cannot accept new migrations until the failed row is resolved (`--rolled-back`) or the DB is rebuilt; protected — untouched. |
| **Failed `restaurant_app_test_v2` (3308)** | same failed row | Same recovery needed; a *new* empty DB avoids it entirely. |
| **Deployed production DB** | **UNKNOWN** (not reachable) | Must be assumed to have the same 22 applied (like 3306) → checksum warnings only, no schema change. Verify before any deploy. |

Checksum facts verified: Prisma's checksum = **sha256 hex of `migration.sql`** (22/22 equality with the app ledger proves the algorithm and confirms **no drift today**).

### 24.5 Repair option comparison

| Criterion | **A. Compatible rewrite of the two historical migrations** (relocate the dependency-dependent statements to the migration that creates the table; keep names) | **B. New baseline / squashed migration for fresh installs** (delete history, `000000000000_squashed`, `migrate resolve --applied`) | **C. Other Prisma-7 mechanisms** (resolve/`db execute`/rename) |
|---|---|---|---|
| Files changed | 2 `migration.sql` (move statements between the two pairs) | **all 22 deleted** + 1 new baseline | rename dirs or resolve only |
| Fresh install works | ✅ chain replays cleanly | ✅ single baseline | ❌ resolve doesn't help fresh; rename requires resolve per DB |
| Existing DB safe | ✅ schema/data untouched; predictable | ⚠️ needs `migrate resolve` on every env; ledger keeps orphan names | ⚠️ rename → new pending migration would run & fail unless resolved |
| Historical migrations edited | **Yes** (`promo`/`purchaseingredient` statements relocated; end state identical) | Deleted | Renamed or untouched |
| Checksum mismatch possible | **Yes — exactly 2 persistent warnings** on existing DBs | Yes (baseline) + orphan-name drift | Yes |
| `migrate resolve` needed | **No** | **Yes**, on every existing DB | Yes |
| Baseline needed | No | Yes | No |
| F.5 treatment | **Preserved** (name/timestamp untouched → cutoff metadata intact) | **Lost on fresh installs** (baseline has no F.5 row; service looks for that exact name) → cutoff permanently unresolved | Preserved only if untouched |
| Rollback | `git checkout` the 2 files (trivial; DBs never changed) | Restore 22 files + reconcile ledger (hard) | Hard (renames/resolve) |
| Data-loss risk | **None** (no DDL executed anywhere) | None if done exactly right; history loss | Low–medium |
| Pros | minimal, surgical, preserves F.5, no resolve, no data risk | single clean baseline; fresh installs trivially fast | — |
| Cons | 2 persistent checksum warnings; editing applied migrations is "not recommended" by Prisma | **destroys F.5 cutoff on fresh envs**; large rewrite; resolve on every env; orphan `0_baseline`-style drift | doesn't fix fresh provisioning; extra resolve steps |

**Explicitly rejected as solutions** (per the phase rules): a *corrective migration added after the failing one* (fresh deploys still stop **before** reaching it), and `db push`/`migrate diff`+`db execute` (materialise a schema but produce **no valid migration ledger** — not a chain repair).

### 24.6 Recommended strategy and justification

**Recommend Option A.** It is the only option that fixes fresh provisioning **without** breaking existing databases or the F.5 cutoff metadata:

1. **`20260908030144_add_branch_multi_cabang`** — remove the three `promo` statements (L20 `ADD COLUMN`, L97 `CREATE INDEX`, L136 `ADD CONSTRAINT`) and **move them verbatim into `20260909_add_customer_auth_promo`** (step 7) immediately after `CREATE TABLE promo`. Re-verified statically: `branch` is created **by migration 5 itself** (`migration.sql:32`), so relocating the block forward to step 7 leaves both parents (`promo` created in the same statement group, `branch` from step 5) present — `promo_branchId_fkey → branch` still resolves, and the `promo.branchId` column/index land **before** the FK as required.
2. **`20260911_add_ingredient_purchasing_wac`** — remove the `CREATE TABLE purchaseingredient` block (with its two FKs) and **move it verbatim into `20260911140000_add_purchasing_inventory_foundation`** (step 14) after `CREATE TABLE purchase`; re-verified statically: `purchase` is created only there (`migration.sql:21`, alongside `purchaseitem`), and `purchaseingredient` is referenced **nowhere** outside its own migration (zero matches across all 22 directories), so no other migration is affected.

Nothing is renamed, no statement is rewritten, and the **end schema is byte-for-byte identical** — so existing databases experience only a checksum warning, never DDL or data change. The F.5 migration name/timestamp is untouched, so the cutoff mechanism survives.

### 24.7 Checksum and migration-history risks

* Editing the two files changes their sha256; existing DBs hold the old value → **persistent** `migrate deploy`/`migrate status` warning: *"The following migrations have been modified since they were applied"* (contradicts Prisma's general advice "do not edit applied migrations"). **`prisma migrate deploy` warns and continues** (per the official v7 "About migration histories" doc: *"Prisma Migrate will always warn you … and continue to warn you each time you run the command"*); it does **not** fail. However **`prisma migrate dev` would refuse** (and prompt a reset) — so `migrate dev` must **not** be run against existing databases after this change.
* **Rejected mitigation:** updating `_prisma_migrations.checksum` on existing DBs to silence the warning — that is ledger manipulation (fake history) and is forbidden.
* Pre-existing, unrelated drift: the app ledger already contains **2 `0_baseline`** rows with no local file. This is not caused by us but will also surface as a "missing locally" warning.
* Fresh DBs are unaffected by all of the above (their checksums match the edited files exactly).

### 24.8 F.5 cutoff implications (three distinct notions)

| Notion | Achievable by Option A? | Notes |
|--------|------------------------|-------|
| **A. Schema parity** (105 FKs, unique indexes, column types) | ✅ **Yes** — a fixed chain migrates to the same schema as 3306 (to be proven in the rehearsal) | the actual F-5 fix |
| **B. Migration-history parity** (same applied **name set**) | ✅ **Yes** for the 22 named migrations | existing DBs additionally carry legacy duplicates + `0_baseline`; "parity" = same set of migration names, **not** identical row counts |
| **C. Runtime-dependent F.5 cutoff parity** (`finished_at = 2026-09-11T16:06:57.831`) | ❌ **No** — a replay records F.5 with the **apply time** | must be handled deliberately (mirror the production literal as a *test-baseline* claim, or accept the apply time and re-baseline the M2 fixture). **M-1** (`LIMIT 1` without `ORDER BY`) still requires exactly **one** F.5 row. |

### 24.9 Fresh provisioning rehearsal plan (for the next approved phase)

PHASE A (prep) → PHASE B (fresh rehearsal) → PHASE C (parity verify) → PHASE D (test-env migration) → PHASE E (rerun suites) → PHASE F (production defect remediation), each with a gate:

* **PHASE A — Migration repair preparation.** Back up the 2 files + record their sha256; produce the diff; **no DB touch**. *Gate:* approval to edit the 2 files. *STOP if* any other cross-file dependency is discovered.
* **PHASE B — Fresh disposable DB rehearsal.** Create a **new** empty DB on **3308 only** (e.g. `restaurant_app_test_v3`) and run `DATABASE_URL=<explicit 3308> prisma migrate deploy`. *PASS:* 22/22 applied, exit 0. *STOP if* any migration fails (preserve the error; do not resolve/fake).
* **PHASE C — Schema/FK parity verification.** Read-only compare v3 vs the application schema: 49 tables, **105 FK columns**, 5 FKs on `orderitemcostsnapshot`, unique indexes, column types/nullability, ledger = 22 names. *STOP if* any delta.
* **PHASE D — Isolated integration-test migration.** Apply the approved additive bootstrap changes (allow-list port 3308, hard-reject 3306/3307; env keys; M2 mirror-row removal + test-3 re-baseline; cutoff decision per §24.8). *Gate:* approval of the bootstrap diff.
* **PHASE E — Rerun 108 integration + 57 M2 unit tests** sequentially, capturing exit codes and counts.
* **PHASE F — Production financial defect remediation** (A-9, A-11, F-2) **only after** DB safety is proven.

### 24.10 Rollback and STOP conditions

* **Rollback:** Option A touches only 2 files → `git checkout -- prisma/migrations/<the two dirs>` restores the exact prior state; **no database was changed**, so no DB rollback is needed. The rehearsal DB (v3) is disposable → `DROP DATABASE restaurant_app_test_v3` on 3308.
* **STOP conditions:** any migration failure in rehearsal; any schema delta in PHASE C; any need to insert/fake ledger rows; any proposal to run `migrate dev` against an existing DB; any doubt about the deployed (UNKNOWN) target.

### 24.11 Updated progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Topology, preflight, access recovery, isolated test container, schema, final safety | ✅ DONE |
| 2B.1–2B.5 | Cashbook 15 · Revenue 19 · Refund/Profitability 21 · P&L 24 · M2 29 | ✅ DONE (108) |
| 2C.1 | Final cross-module evidence audit | ✅ DONE — NOT READY |
| 2C.2A | Topology & schema parity preflight | ✅ DONE |
| 2C.2B | Fresh isolated test DB & migration parity | ⛔ STOPPED — P3018; F-7 found |
| **2C.2C** | **F-7 migration repair strategy audit** | **✅ DONE (this section) — audit only; Option A recommended** |
| 2C.2D | Implement Option A + PHASE A–C rehearsal | ⏳ **NOT STARTED — awaiting approval** |

### 24.12 Final Git status

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

Identical to §24.1. Temp audit scripts (`c2c2c-depgraph.ts`, `c2c2c-checksum.ts`) were removed; no migration file, source file, or database was modified. No commit/push/merge/deploy.

### 24.13 Explicit approval required before implementation

**STEP 2C.2C STOPS HERE — audit only.** Nothing was repaired: no migration file edited, no `db push`, no `migrate resolve`, no DDL, no database write, and `restaurant_app_test_v2` was **not** dropped. Implementation of **Option A** (and the PHASE A–F plan in §24.9) requires **explicit reviewer approval**, and PHASE A must begin with the file backup + diff in §24.9 before any edit.



---

## 25. STEP 2C.2D — F-7 MIGRATION REPAIR PATCH PREPARATION

**Date:** 2026-10-14  
**Mode:** 🔒 LOCAL PATCH ONLY — no database access, no migration execution, no `db push`/`reset`/`dev`, no `migrate resolve`, no ledger modification, no test-DB creation/deletion, no container recreation, no source/test edits outside the approved migration patch, no production M2 change, no commit.  
**Outcome:** **Option A applied locally** to **4** migration files (uncommitted working-tree change). Fully static verification passes. **Fresh-DB replay is NOT proven** — it requires the next approval gate (§25.10/§25.13).

### 25.1 Initial Git status (start of this phase)

```
$ git branch --show-current ; git log -1 --oneline
main
e8d4aa3 fix selesai orderan
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

15 entries — identical to §24.1/§23.1. All four M2 files and every pre-existing change preserved; the migration tree was **clean** at HEAD `e8d4aa3` before the patch (which is what makes `git restore` a valid rollback, §25.9).

### 25.2 Approval evidence

* §24 recommended **Option A** as the candidate repair; this phase's directive ordered "prepare **Option A only**".
* The §2 **pre-edit safety gate** was presented *before any write* with all seven required items: the 4 exact files, the original SHA-256 values, the SQL blocks to relocate, their source → destination migrations, the schema-equivalence argument, the historical-checksum consequence, and the rollback procedure (plus byte-for-byte backups already stored outside `prisma/migrations`).
* The reviewer then answered **"Approve — write the 4 files now"**. Only after that answer were the four files written.
* Scope discipline actually respected: **no migration directory renamed**, **no statement rewritten** (comments only, plus one relocated block each), **`schema.prisma` untouched**, **no migration history modified in any database**, and **no database was contacted at any point in this phase** — the entire phase is filesystem-only.

### 25.3 Original checksums (pre-edit; each verified byte-identical to `git HEAD`)

| Migration | Original SHA-256 |
|---|---|
| `20260908030144_add_branch_multi_cabang` | `7348b5db51fddef2da96fac1056ca72eddba073d97ab5e1198db6127d2c940e0` |
| `20260909_add_customer_auth_promo` | `0a9f59304a609c17c48c54b8a0eaee3371bdd2e20eb592d403abb04bac8a0b0b` |
| `20260911_add_ingredient_purchasing_wac` | `4f286cdc429c2443429cb7a037f1a803e329fd0916fe4b2fc6761955d5e3b2c5` |
| `20260911140000_add_purchasing_inventory_foundation` | `112aca03238800ae1032c0f0d755273ea8eb7360e21016e1f390981a8718b5dd` |

### 25.4 Backups created (outside `prisma/migrations`)

Backup root: **`/home/reksa/restorant-cafe-f7-backup-20261014/`** (outside the repository, so the git status is not polluted)

| Path | Contents |
|---|---|
| `originals/<dir>/migration.sql` | byte-for-byte copies of the 4 files as they were before the patch |
| `ORIGINAL_SHA256.txt` | the four pre-edit hashes in `sha256sum` format |
| `patched-tree/` | full 22-directory tree with the patch applied (the staged artifact that was reviewed) |
| `diffs/<dir>.orig.sql`, `<dir>.new.sql`, `<dir>.diff` | exact `diff -u` before/after for each of the 4 files |

Verification: `cmp -s` on all four backup↔repo pairs **OK**, and each backup was additionally checked **byte-identical to `git show HEAD:…`** (`=== 0. backups verified byte-identical to git HEAD (4 files) = OK`).

> **Accuracy correction to §24.5/§24.6:** those sections said "2 files" change and that rollback is `git checkout` of "the 2 files". Each relocation has a **source and a destination**, so Option A touches **4** files. Rollback must cover all four (§25.9).

### 25.5 Exact files changed

```
 prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql        |  9 --------
 prisma/migrations/20260909_add_customer_auth_promo/migration.sql             | 17 +++++++++++++-
 prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql | 19 +++++++++++++
 prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql       | 25 +++++++----------------
 4 files changed, 41 insertions(+), 29 deletions(-)
```

New SHA-256 (post-patch):

| Migration | New SHA-256 |
|---|---|
| `20260908030144_add_branch_multi_cabang` | `97ee89d5410467386546ea656b42a3c545f70e859bcde54ef786e1f1304462d6` |
| `20260909_add_customer_auth_promo` | `019b42ed36c739a9b6d800c24c5cef548263df34e2fee555c333b8e6882641e1` |
| `20260911_add_ingredient_purchasing_wac` | `fac529c73bcf008cab9c8c1f75d1a37b3bd12be87abf72e0da28ebb8a39ea969` |
| `20260911140000_add_purchasing_inventory_foundation` | `47365a5cdbaf4a131aab686dceacd83a90c1557a544ece8dc739cc9ee8a6f840` |

The live files were checked **equal to the reviewed `patched-tree`** copy (`live == staged patched-tree ? YES`) — what was approved is exactly what was written. One incidental byte-level change: `20260909_add_customer_auth_promo/migration.sql` originally had **no trailing newline**; it now ends with one (POSIX text file). No statement is affected.

### 25.6 SQL relocation diff (exact, `git diff -- prisma/migrations`)

```diff
diff --git a/prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql b/prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
@@ -16,9 +16,6 @@ ALTER TABLE `order` ADD COLUMN `branchId` VARCHAR(191) NULL;
 -- AlterTable
 ALTER TABLE `payment` ADD COLUMN `branchId` VARCHAR(191) NULL;
 
--- AlterTable
-ALTER TABLE `promo` ADD COLUMN `branchId` VARCHAR(191) NULL;
-
 -- AlterTable
 ALTER TABLE `refund` ADD COLUMN `branchId` VARCHAR(191) NULL;
 
@@ -93,9 +90,6 @@ CREATE INDEX `order_branchId_idx` ON `order`(`branchId`);
 CREATE INDEX `payment_branchId_idx` ON `payment`(`branchId`);
 
--- CreateIndex
-CREATE INDEX `promo_branchId_idx` ON `promo`(`branchId`);
-
 -- CreateIndex
 CREATE INDEX `refund_branchId_idx` ON `refund`(`branchId`);
 
@@ -132,8 +126,5 @@ ALTER TABLE `order` ADD CONSTRAINT `order_branchId_fkey` FOREIGN KEY (`branchId`
 ALTER TABLE `payment` ADD CONSTRAINT `payment_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
 
--- AddForeignKey
-ALTER TABLE `promo` ADD CONSTRAINT `promo_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
-
 -- AddForeignKey
 ALTER TABLE `notification` ADD CONSTRAINT `notification_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
diff --git a/prisma/migrations/20260909_add_customer_auth_promo/migration.sql b/prisma/migrations/20260909_add_customer_auth_promo/migration.sql
@@ -88,4 +88,19 @@ ALTER TABLE `order`
     FOREIGN KEY (`promoId`) REFERENCES `promo`(`id`)
-    ON DELETE SET NULL ON UPDATE CASCADE;
\ No newline at end of file
+    ON DELETE SET NULL ON UPDATE CASCADE;
+
+-- ------------------------------------------------------------
+-- 5. Promo <=> Branch (RELOCATED from 20260908030144_add_branch_multi_cabang by the
+--    F-7 repair: that migration ran before `promo` existed. `promo` is created in
+--    section 2 above and `branch` in 20260908030144 (applied earlier), so the
+--    column -> index -> foreign key order below is now fully satisfiable.)
+-- ------------------------------------------------------------
+-- AlterTable
+ALTER TABLE `promo` ADD COLUMN `branchId` VARCHAR(191) NULL;
+
+-- CreateIndex
+CREATE INDEX `promo_branchId_idx` ON `promo`(`branchId`);
+
+-- AddForeignKey
+ALTER TABLE `promo` ADD CONSTRAINT `promo_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
diff --git a/prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql b/prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
@@ -104,3 +104,22 @@ ALTER TABLE `stockmovement` ADD CONSTRAINT `stockmovement_productId_fkey` FOREIG
 ALTER TABLE `stockmovement` ADD CONSTRAINT `stockmovement_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
 
+-- CreateTable (RELOCATED verbatim from 20260911_add_ingredient_purchasing_wac by the
+-- F-7 repair: it ran before its parent table `purchase` existed. `purchase` is created
+-- above and `ingredient` by 20260911_add_ingredient_f1 (applied earlier).)
+CREATE TABLE `purchaseingredient` (
+  `id` VARCHAR(191) NOT NULL,
+  `purchaseId` VARCHAR(191) NOT NULL,
+  `ingredientId` VARCHAR(191) NOT NULL,
+  `quantity` DECIMAL(18,3) NOT NULL,
+  `unit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL,
+  `unitCost` DECIMAL(12,2) NOT NULL,
+  `lineTotal` DECIMAL(12,2) NOT NULL,
+  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
+
+  PRIMARY KEY (`id`),
+  INDEX `purchaseingredient_purchaseId_idx` (`purchaseId`),
+  INDEX `purchaseingredient_ingredientId_idx` (`ingredientId`),
+  CONSTRAINT `purchaseingredient_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
+  CONSTRAINT `purchaseingredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
+) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
diff --git a/prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql b/prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
@@ -1,25 +1,12 @@
 -- Phase F.2: Ingredient Purchasing + WAC
 -- Additive migration — no destructive changes
 
--- 1. New table: purchaseingredient
-CREATE TABLE `purchaseingredient` (
-  `id` VARCHAR(191) NOT NULL,
-  `purchaseId` VARCHAR(191) NOT NULL,
-  `ingredientId` VARCHAR(191) NOT NULL,
-  `quantity` DECIMAL(18,3) NOT NULL,
-  `unit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL,
-  `unitCost` DECIMAL(12,2) NOT NULL,
-  `lineTotal` DECIMAL(12,2) NOT NULL,
-  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
-
-  PRIMARY KEY (`id`),
-  INDEX `purchaseingredient_purchaseId_idx` (`purchaseId`),
-  INDEX `purchaseingredient_ingredientId_idx` (`ingredientId`),
-  CONSTRAINT `purchaseingredient_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
-  CONSTRAINT `purchaseingredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
-) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-
--- 2. Add cost fields to BranchIngredient
+-- 1. Add cost fields to BranchIngredient
+--    NOTE (F-7 repair): `purchaseingredient` used to be created here, before its
+--    parent table `purchase` existed (created later by
+--    20260911140000_add_purchasing_inventory_foundation), which made an empty-DB
+--    replay fail with errno 1146. Its CREATE TABLE was relocated verbatim to that
+--    migration; the SQL below is unchanged.
 ALTER TABLE `branchingredient`
   ADD COLUMN `averageCost` DECIMAL(12,2) NULL,
   ADD COLUMN `lastPurchaseCost` DECIMAL(12,2) NULL;
```

Reading of the diff: the three `promo` statements leave step 5 and are appended to step 7 (the migration that creates `promo`); the `CREATE TABLE purchaseingredient` block leaves step 10 and is appended to step 14 (the migration that creates `purchase`). Nothing else in any of the 22 migrations is touched — confirmed below byte-wise.

### 25.7 Static dependency verification (post-apply, read-only)

| Required check | Method | Result |
|---|---|---|
| All 22 migration directories retain their names | `readdir` of the live tree vs the authoritative order list | **22 = 22, names match = YES** |
| Only the approved historical migration files changed | sha256 of all 22 live files vs `git show HEAD:…` | exactly **4** differ, and they are the approved set |
| Live files == the reviewed staged tree | sha256 vs `patched-tree/` | **YES** |
| No SQL statement lost or duplicated | comment-stripped, whitespace-normalised, `;`-split **multiset over all 22 files** | **167 → 167, 0 differing** |
| Parent tables exist before their dependent statements | order-faithful simulation in the §24.2 apply order | **4 blockers before → 0 after** |
| No additional dependency blockers appear | same simulation, plus `unclassified statements` counter | **blockers = 0, unclassified = 0** |
| Final intended schema remains equivalent | identical statement multiset (order-only change); parser registered the same objects | **48 tables / 158 index names** (48 = 49 tables on 3306 minus `_prisma_migrations`) |
| Backup and rollback available | `cmp -s` backup↔repo OK; backups == `git HEAD` | **OK** (§25.4, §25.9) |
| `git diff --check` passes | `git diff --check ; echo $?` | **clean (exit 0)** |
| No trailing whitespace on added lines | added-line scan | **none** |
| `migration_lock.toml` untouched | presence + unmodified status | present, unmodified |

The BEFORE list is the exact blocker set (4 statements): `ALTER TABLE promo ADD branchId`, `CREATE INDEX promo_branchId_idx`, `promo_branchId_fkey` (all in `20260908030144`) and `CREATE TABLE purchaseingredient … FK -> purchase` (in `20260911_add_ingredient_purchasing_wac`). §24.2 counted **2 blocking migrations**; this simulator counts **4 blocking statements** — a counting difference, not a discrepancy.

**Replay status: NOT EXECUTED — therefore no PASS is claimed.** No `migrate deploy`, and deliberately **no `prisma migrate diff --from-migrations`** (it requires a shadow database, i.e. writes — forbidden in this phase). `tsc`/`build` were likewise not run: this phase changed no TypeScript and deliberately did not touch the test/financial suites.

### 25.8 Historical checksum impact

* The 4 modified files no longer match the checksums recorded in any existing database's `_prisma_migrations` → `prisma migrate deploy` and `migrate status` will report **"migrations have been modified since they were applied"** and keep warning on every run. Per Prisma 7, `deploy` **warns and continues**; it does not fail.
* **Existing databases must not receive automatic migration-history updates.** No `migrate dev` (it refuses / proposes a reset on drifted history), no `migrate resolve`, and no `UPDATE _prisma_migrations SET checksum = …` — silencing a warning by rewriting the ledger is falsified history and stays forbidden.
* **Fresh installation and existing-database compatibility require separate verification.** Fresh: the 22 on-disk files are self-consistent, so a new DB sees no warning and (per §25.7) should replay cleanly. Existing: warning-only, schema and data unchanged, because the patch relocates statements between migrations without altering the end state.
* **Production deployment target remains UNKNOWN.** It must not be assumed safe: before any deployment its `_prisma_migrations` must be inspected **read-only** to confirm all 22 migrations are applied. If it is *not* fully applied, or if `0_baseline`-style drift exists beyond what 3306 shows, deployment planning must be redone before touching production.
* The pre-existing, unrelated `0_baseline` drift already present on 3306 is **not** created or changed by this patch.
* **Patch scope check:** 41 insertions / 29 deletions, all inside the 4 approved files, and every changed line is either one of the two relocated blocks or an explanatory comment. Nothing beyond the approved relocation was required — so the "STOP and request review" trigger in §5 did not fire.

### 25.9 Rollback instructions

No database was written, so rollback is filesystem-only. Two verified, independent, equivalent paths:

```bash
# A. git (the 4 files were clean at HEAD e8d4aa3 before the patch)
git restore \
  prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql \
  prisma/migrations/20260909_add_customer_auth_promo/migration.sql \
  prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql \
  prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
# verify: git status --porcelain prisma/  -> empty ; sha256sum as in §25.3

# B. byte-for-byte backups
for d in 20260908030144_add_branch_multi_cabang 20260909_add_customer_auth_promo \
         20260911_add_ingredient_purchasing_wac 20260911140000_add_purchasing_inventory_foundation; do
  cp "/home/reksa/restorant-cafe-f7-backup-20261014/originals/$d/migration.sql" "prisma/migrations/$d/migration.sql"
done
```

Rollback does **not** require—and must not use—`git stash`, `git checkout -f`, `migrate resolve`, or any ledger edit; those would drag in unrelated M2 working-tree changes or falsify migration history. After rollback, F-7 returns to its §23/§24 state (fresh replay fails at step 5).

### 25.10 Fresh v3 rehearsal proposal (STEP 2C.2E — ⛔ NOT started, needs approval)

* **Approval gate:** explicit reviewer approval before any database object is created.
* **Target:** a **new** empty database `restaurant_app_test_v3` on **port 3308 only** (standalone test container `restaurant-mariadb-test`) — never **3306** (host app DB) and never **3307** (other project). The bootstrap will assert host/port/database first and echo the masked target, exactly as in §23.3.
* **Command:** `DATABASE_URL=<explicit 3308 / v3> npx prisma migrate deploy`. **Expect:** 22/22 applied, exit 0. Any non-zero exit → **STOP**, preserve the error, no `migrate resolve`, no ledger insert, no retry hacks.
* **Parity verification (read-only):** 48 app tables (`+_prisma_migrations` = 49), **105 FK columns**, `promo` and `purchaseingredient` both present, `promo.branchId` nullable, `promo_branchId_idx` present, `promo_branchId_fkey` with `ON DELETE SET NULL`, unique constraints (`promo_restaurantId_code_key`, `branch_restaurantId_code_key`, …), and a ledger of exactly **22** rows with `finished_at` non-null.
* **F.5 cutoff:** the replay stamps F.5 with the **apply time**, not the production literal `2026-09-11T16:06:57.831`. Per §24.8 this must be an explicit, documented choice (adopt the v3 value as the test baseline, or mirror the production literal as a test-baseline claim). **M-1** (`resolveLegacyCutoff()` `LIMIT 1` with no `ORDER BY`) still requires exactly **one** F.5 row.
* **After parity:** PHASE D (isolated test-env bootstrap diff) → PHASE E (rerun 108 integration + 57 M2 unit tests, capturing exit codes) → PHASE F (production defect remediation A-9/A-11/F-2) **only after** DB safety is proven.
* `restaurant_app_test_v2` is **retained as evidence** this phase; its drop command stays in §23.13.

#### 25.10.1 Recovery reads performed this phase, and test-suite coupling found

Recovery sources read for this phase: §22–§24 of this document, all 22 migration directories, `prisma/schema.prisma` (`Promo`, `PromoUsage`, `Purchase`, `PurchaseIngredient`, `Branch`, `BranchIngredient`), `tests/README.md`, `tests/setup.ts`, `.env.test.example`. Two of them carry consequences the rehearsal must respect:

* **The F.5 ledger row will now exist after a successful replay** (with an **apply-time** `finished_at`) → `resolveLegacyCutoff()` resolves a cutoff and the F-4 symptom disappears. Two test-suite consequences: (a) M2 **test 3**, which asserts the *unresolved* fallback, must be re-baselined — `tests/README.md` already warns it "fails loudly rather than silently"; (b) the `describe` in tests 4–29 that installs **one** reversible ledger row *mirroring the production row* and asserts restoration to a pre-install state must be reworked, because the pre-install state is no longer "no F.5 row" and a second row with the same migration name would collide.
* **`tests/README.md:309` documents `prisma migrate resolve --applied …f5_order_item_cost_snapshot` as the fix path** for the missing cutoff on the test DB. Option A **supersedes that workaround** — a plain `migrate deploy` replay produces the row. `migrate resolve` remains forbidden in this programme and must not be used to shortcut parity.
* **The port guard is per-suite, not in the bootstrap.** `tests/setup.ts` rejects production database *names* (`restaurant_app`, `production`, `main`, `app`), requires `TEST_DATABASE_URL`, forbids percent-encoded credentials, and pins `DATABASE_URL` — but it asserts **no port allow-list**. The `TEST_DB_EXPECTED_PORT ?? "3308"` assertion is duplicated inside all five suites (`cashbook.integration.test.ts:325`, `revenue…:400`, `refund-profitability…:380`, `pnl…:468`, `integrity…:805`). PHASE D's "allow-list 3308, hard-reject 3306/3307" therefore has to be **added to the bootstrap**, not assumed to exist.
* `.env.test` (gitignored) is **unchanged** this phase: same active `TEST_DATABASE_URL`/`DATABASE_URL` (3308 / `restaurant_app_test`) plus the inert, unread `DISPOSABLE_TEST_V2_URL` line recorded in §23.4.

### 25.11 Updated progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Topology, preflight, access recovery, isolated test container, schema, final safety | ✅ DONE |
| 2B.1–2B.5 | Cashbook 15 · Revenue 19 · Refund/Profitability 21 · P&L 24 · M2 29 | ✅ DONE (108) |
| 2C.1 | Final cross-module evidence audit | ✅ DONE — NOT READY |
| 2C.2A | Topology & schema parity preflight | ✅ DONE |
| 2C.2B | Fresh isolated test DB & migration parity | ⛔ STOPPED — P3018; F-7 found |
| 2C.2C | F-7 migration repair strategy audit | ✅ DONE — Option A recommended |
| **2C.2D** | **F-7 migration repair patch preparation** | **✅ DONE — Option A applied locally to 4 files (uncommitted); static verification 0 blockers; 167↔167 statements; replay NOT executed** |
| 2C.2E | Fresh `restaurant_app_test_v3` rehearsal + schema/FK parity | ⏳ **NOT STARTED — awaiting approval** |

### 25.12 Final Git status

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

19 entries = the 15 baseline entries of §25.1 **plus the 4 approved migration files**. The four M2 files and every pre-existing change are still preserved and untouched. Temporary scripts (`c2c2d-patch.ts`, `c2c2d-verify.ts`) were removed; the only artefact outside git is the backup directory `/home/reksa/restorant-cafe-f7-backup-20261014/`. `git diff --check` clean. No commit / push / merge / deploy.

### 25.13 STOP / next approval gate

**STEP 2C.2D STOPS HERE.**

* Applied: Option A, locally, in **4** uncommitted migration files; fully reversible with the commands in §25.9.
* Not done, deliberately: no database access of any kind, no `migrate deploy/dev/reset`, no `db push`, no `migrate resolve`, no ledger edit, no test-DB creation/deletion, no container recreation, no `restaurant_app_test_v2` drop, no credential change, no source/test edits outside the patch, no production M2 change, no commit.

**F-7 is now repaired in code but still unproven at runtime.** Production readiness remains **🚫 NOT READY FOR PRODUCTION** (F-7 unverified, plus A-9, A-11, F-2, F-4/F-5/F-6 verification outstanding). STEP 2C.2E — the fresh `restaurant_app_test_v3` rehearsal on **3308 only** (§25.10) — must not start without explicit approval.


---

## 26. STEP 2C.2E — FRESH MIGRATION REPLAY & SCHEMA PARITY

**Date:** 2026-10-14  
**Mode:** 🔒 ISOLATED DATABASE REHEARSAL ONLY — all writes confined to the **3308** test container, and within it exclusively to a **new** `restaurant_app_test_v3` database. No `migrate dev/reset`, no `db push`, no `migrate resolve`, no ledger rows written by hand, no container recreation, no credential rotation outside the new v3 user, no integration-test execution, no commit.  
**Outcome:** ✅ **F-7 REPLAY PASSED — 22/22 migrations applied on a brand-new empty database, `prisma migrate deploy` exit code 0.** Structural parity with the 3306 application reference is **exact** on tables, columns, primary keys, foreign keys, referential rules, indexes, unique constraints and constraint names. **F-4 is resolved.** One 5-table collation delta was found and traced to the **reference side**. The F.5 row now genuinely exists with an **apply-time** value, so F-5 *cutoff* parity is **not** achieved — that remains a deliberate decision (§26.10), not a defect.

### 26.1 Initial Git status (start of this phase)

```
$ git branch --show-current ; git log -1 --oneline
main
e8d4aa3 fix selesai orderan
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

19 entries — identical to §25.1. The four M2 production files and every pre-existing change are preserved; the 4-file Option A migration patch from §25 is still applied and uncommitted. **This phase created no file in the repository** (scripts and logs live in `/tmp`).

### 26.2 Approval evidence

* The eight-point **database safety gate** (§3 of the phase) was executed in full and its results presented *before* any write — container identity, host→container mapping, v3 non-existence, patch/checksum match, effective Prisma target, masked target, planned operations and rollback.
* The gate **fired and aborted once**, exactly as designed: the compose-ownership assertion compared against the string `<no value>`, but `docker inspect --format` renders an absent label as an **empty string** here. The guard stopped the run **before** `CREATE DATABASE`, so **nothing was created**. The assertion was corrected to "must carry **no** `com.docker.compose.*` label" and the block re-run.
* Only after the reviewer answered **"Approve — run the v3 replay"** were the database, the user and the replay created/executed.
* Scope actually respected: writes went only to `restaurant_app_test_v3`; the active `TEST_DATABASE_URL`/`DATABASE_URL` were **never** switched to v3; no migration file, source file or M2 file was modified; `restaurant_app_test_v2` was **not** dropped.

### 26.3 Exact target identity (proven before any write)

| Check | Result |
|---|---|
| Container | `restaurant-mariadb-test`, id `bae65d9fc587…`, image `mariadb:11.8`, inner hostname `bae65d9fc587`, **0 restarts** |
| Port mapping | `{"3306/tcp":[{"HostIp":"127.0.0.1","HostPort":"3308"}]}` — binds **127.0.0.1:3308 only** |
| Ownership | labels contain **no** `com.docker.compose.*` key → standalone (`docker run`), unlike `restaurant-mariadb` on 3307 which carries compose labels |
| Protected neighbours | **3306** = host system service `mariadb.service` (no container binds it); **3307** = container `restaurant-mariadb` of project `restorant-cafe2` |
| `restaurant_app_test_v3` before | **absent** (`SHOW DATABASES` → only `restaurant_app_test`, `restaurant_app_test_v2`) |
| Migration patch | the 4 files hash `97ee89d5…`, `019b42ed…`, `fac529c7…`, `47365a5c…` = §25.5 exactly; only those 4 differ from `HEAD` |
| Charset choice | v3 created `CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci` to mirror the 3306 database default, so the comparison is not confounded by a DB-level default |
| **Effective Prisma datasource** | `prisma.config.ts → env("DATABASE_URL") → mysql://root:***@localhost:3306/restaurant_app` — i.e. the **protected** host app DB (risk R-1). Therefore every command carried an explicit override; **no bare Prisma CLI invocation was run** |
| Masked target used | `mysql://restaurant_test_v3:***@127.0.0.1:3308/restaurant_app_test_v3` |

### 26.4 Operations executed (no other target was ever addressed)

```
1. guards: container id/image, exact port mapping, no compose labels, v3 absent   → all pass
2. CREATE DATABASE `restaurant_app_test_v3` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
3. CREATE USER 'restaurant_test_v3'@'%' IDENTIFIED BY '<32-byte random hex>';      -- NEW user only
4. GRANT ALL PRIVILEGES ON `restaurant_app_test_v3`.* TO 'restaurant_test_v3'@'%';
5. credential stored ONLY as an inert `DISPOSABLE_TEST_V3_URL` line in gitignored .env.test
   (same pattern as §23.4; never printed, never referenced by tests/setup.ts)
6. DATABASE_URL=<v3 url> npx prisma migrate deploy        # URL injected into the child's ENVIRONMENT,
                                                          # never into any argv
```

The replay used `/tmp/c2c2e-replay.mjs`, which re-asserts scheme/host/port/database before spawning Prisma and aborts otherwise; it also strips `TEST_DATABASE_URL` so the suites' pin can never interfere. Prisma's own output confirms the resolved target: `Datasource "db": MySQL database "restaurant_app_test_v3" at "127.0.0.1:3308"`.

Post-create verification: v3 = **0 tables**, and the new user's `SHOW DATABASES` returns only `information_schema` + `restaurant_app_test_v3` (least privilege confirmed). The pre-existing users `restaurant_test@%` and `restaurant_test_v2@%` were left untouched.

### 26.5 Migration replay results and exit code

```
[RESULT] migrate deploy exit code = 0
22 migrations found in prisma/migrations
… All migrations have been successfully applied.
```

The **empirically observed** apply order (this supersedes the earlier inference from `migrate status` and **matches §24.2 exactly**):

| # | Migration | # | Migration |
|---|---|---|---|
| 1 | `0000_init_schema` | 12 | `20260911_add_recipe_bom` |
| 2 | `20260904_add_qris_payment_fields` | 13 | `20260911120000_add_promousage_branch_id` |
| 3 | `20260904155600_add_rbac_shifts_approvals` | 14 | `20260911130000_add_stock_branchproduct` |
| 4 | `20260907_hardening_session_payment` | 15 | `20260911140000_add_purchasing_inventory_foundation` |
| 5 | `20260908_add_restaurant_branding` | 16 | `20260911143644_f5_order_item_cost_snapshot` |
| 6 | `20260908030144_add_branch_multi_cabang` | 17 | `20260912_add_branchproduct_costing_mode` |
| 7 | `20260908040000_table_unique_per_branch` | 18 | `20260913_add_addon_option_bom` |
| 8 | `20260909_add_customer_auth_promo` | 19 | `20260913_add_refund_item_allocation` |
| 9 | `20260910_add_product_recommendations` | 20 | `20260915_add_reservation` |
| 10 | `20260911_add_ingredient_f1` | 21 | `20260920_add_floor_layout` |
| 11 | `20260911_add_ingredient_purchasing_wac` | 22 | `20261009_add_expense_management` |

Steps 6 and 11 — the two migrations that previously failed with `P3018` / errno 1146 — now complete because their dependencies (`promo` at step 8, `purchase` at step 15) are no longer referenced from a position that precedes their creation.

### 26.6 F-7 verdict

**F-7 = FIXED AND PROVEN AT RUNTIME.** A genuinely empty database on the isolated test container now provisions end-to-end from the migration chain with **exit code 0**, and the resulting schema is structurally equal to the application reference (§26.7). The remediation was the §25 Option A relocation of two dependency blocks; nothing else was required — no corrective migration after the failure, no `db push`, no `migrate resolve`, no ledger invention.

### 26.7 Schema parity matrix — V3 (fresh replay) vs A (`3306/restaurant_app`)

Read-only comparison of `information_schema` on both servers (`/tmp/c2c2e-parity.mjs`, log `/tmp/c2c2e-parity.log`).

| Dimension | V3 | A (reference) | Difference |
|---|---|---|---|
| Tables | 49 | 49 | **none** (set comparison both directions empty) |
| Columns (type, nullability, default, extra, `column_key`) | 499 records | 499 records | **0 differing records** |
| Primary keys | 49 | 49 | **none** |
| Foreign-key columns | **105** | **105** | **none** (reference `105` matched exactly, not forced) |
| Referential rules (`UPDATE_RULE`/`DELETE_RULE` per FK) | 105 | 105 | **0 differing** |
| Index rows (`STATISTICS`: name, uniqueness, seq, column, sub-part, type) | 289 | 289 | **0 differing** |
| Unique table-constraints | 30 | 30 | **0 differing**, names identical |
| Constraint names | — | — | identical throughout (§26.8) |
| Accounting-related tables | 22 of 23 probed | 22 of 23 probed | **none** — the one probed name absent from both (`cashbookentry`) is simply not a table in this schema (probe-list artifact) |
| `orderitemcostsnapshot` FK definitions | **5** | 5 | **none** |
| Migration ledger rows | 22 | 28 (incl. historical duplicates) | expected (§26.9) |
| F.5 row | present, apply-time | present, production literal | **not comparable by design** (§26.10) |
| Table collation | 49 × `utf8mb4_unicode_ci` | 44 × `utf8mb4_unicode_ci` + **5 × `utf8mb4_uca1400_ai_ci`** | **5 tables differ** — see F-8 |

**The single delta — 5 tables' collation — is a reference-side artifact, not a replay defect.** The five tables are `auditlog`, `notification`, `orderitem`, `paymenttransaction`, `whatsappmessage`. They are created by migrations that **explicitly state** `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` (`0000_init_schema` ×4, `20260904155600_add_rbac_shifts_approvals` ×1), so **V3 is exactly what the migration chain mandates**, while the existing 3306 database holds them at the server's default `utf8mb4_uca1400_ai_ci`. That is consistent with §22's finding that A was built incrementally (it carries `0_baseline` rows with no local file) rather than by replaying this chain.

> **F-8 (NEW, non-blocking, reference-side):** the existing 3306 database deviates from the migration chain on 5 tables' collation. A newly provisioned environment (v3, and any future staging/production provisioned by `migrate deploy`) will therefore **not be collation-identical** to today's 3306 database. Both collations are `utf8mb4`; the practical risk is mixed-collation comparison errors if the two are ever joined or replicated into one server. It does not affect F-7/F-4 and it is not caused by this programme. Decide separately whether to normalise 3306 or to accept the divergence.

### 26.8 FK / index / unique-constraint comparison (explicit)

* **Foreign keys:** 105 on both, identical by `constraint_name | child.column -> parent.column | position`, and identical rules (105 `REFERENTIAL_CONSTRAINTS` rows match). Zero test-only and zero reference-only FKs — the F-4 "50 missing FK columns" gap is **closed** (v1 had 55, v3 has 105).
* **`orderitemcostsnapshot`** (F-4's worst case: v1 had **0** FKs): V3 has all **5** —
  `orderitemcostsnapshot_branchId_fkey` (`branchId→branch.id`), `..._orderId_fkey` (`orderId→order.id`), `..._orderItemId_fkey` (`orderItemId→orderitem.id`), `..._productId_fkey` (`productId→product.id`), `..._restaurantId_fkey` (`restaurantId→restaurant.id`).
* **Indexes:** 289 `STATISTICS` rows on both with zero differences (name, uniqueness flag, sequence, column, sub-part, index type) — including the FK-supporting indexes that were absent in v1.
* **Unique constraints:** 30 on both, and the `table | constraint_name` sets are identical (this covers constraint **names** as well as columns). Primary-key sets identical (49).
* **Migration names/checksums** are verified separately in §26.9.

### 26.9 Migration ledger verification

| Check | Result |
|---|---|
| V3 ledger rows | **22** |
| Rows that are unfinished or rolled back | **0** |
| Ledger name set == the 22 on-disk migrations | **true** |
| `checksum` column == `sha256(migration.sql)` for every row | **true** (all 22) |
| V3 vs A per-migration checksums | **18 match / 4 differ / 0 absent** |
| Which 4 differ | `20260908030144_add_branch_multi_cabang`, `20260909_add_customer_auth_promo`, `20260911_add_ingredient_purchasing_wac`, `20260911140000_add_purchasing_inventory_foundation` — **exactly** the 4 files patched in §25 |
| F.5 ledger checksum | `f4234f863da460f16677b2002011e8ab905d040acfcc8a47aa363c7f859e9428` in **both** A and V3, and equal to the on-disk file's sha256 → the F.5 file is unmodified |
| Failed / unapplied rows | none |

This is the §24.7/§25.8 prediction **measured**: a fresh database matches the patched files exactly (no warnings), while pre-existing databases agree on all 18 untouched migrations and diverge only on the 4 deliberately edited ones. No ledger row was inserted, edited or deleted by this phase beyond what `migrate deploy` itself records.

### 26.10 F.5 apply-time assessment (genuine row, nothing rewritten)

The replay's own F.5 row, read directly from v3:

| Field | Value |
|---|---|
| `migration_name` | `20260911143644_f5_order_item_cost_snapshot` |
| `checksum` | `f4234f863da460f16677b2002011e8ab905d040acfcc8a47aa363c7f859e9428` |
| `started_at` (raw) | `2026-10-14 07:52:58.188` |
| `finished_at` (raw) | `2026-10-14 07:52:58.220` |
| `applied_steps_count` | 1 |
| **matching F.5 rows** | **exactly 1** (M-1's determinism precondition is satisfied) |

Reference row in A: `finished_at = 2026-09-11 16:06:57.831` (1 row, same checksum).

**Difference from the historical production cutoff — and an important timezone caveat.** Both values are stored as naive `DATETIME` in each server's own `SYSTEM` timezone, and those timezones differ: the 3308 test container's clock reads `2026-10-14 07:54:18` while the host reads `2026-10-14 14:54:19` at the same moment, i.e. the container runs **UTC** and the host runs **UTC+07:00**.

* production literal `2026-09-11 16:06:57.831` (+07:00) = **`2026-09-11T09:06:57.831Z`**
* v3 apply time `2026-10-14 07:52:58.220` (UTC) = **`2026-10-14T07:52:58.220Z`**
* **absolute delta = 32 days 22 h 46 m 0.389 s** (naive-literal delta, if the offsets are ignored: 32 d 15 h 46 m 0.389 s)

Consequences, recorded rather than papered over:

1. `finished_at` was **not** rewritten to reproduce production history, and no mirrored ledger fixture was installed — as instructed.
2. Because the replay stamps F.5 with the apply time, **the F-4 symptom disappears**: `resolveLegacyCutoff()` now resolves a real cutoff in v3, and every "unknownCompletion" degradation caused by the *missing* row goes away.
3. **F-5 remains "cutoff parity: NOT ACHIEVED"** and is now a *choice*, not a defect: adopt the v3 replay value as the test baseline, or make the fixture cutoff-relative (§26.12). **M-1 stays OPEN** as a latent item (`resolveLegacyCutoff()` still lacks `ORDER BY`; today v3 and A each hold exactly one F.5 row, so it is deterministic).
4. **M-2 (NEW, informational):** because `finished_at` is a naive local-time literal, the same row denotes different UTC instants depending on the reading server's timezone. Any cross-environment comparison of cutoffs must normalise explicitly. Note the M2 suite's own constant `CUTOFF = new Date("2026-09-11T16:06:57.831Z")` treats the naive literal as **UTC**, which coincides with the stored production instant only under the test container's UTC clock; production (host +07:00) resolves that same literal to `09:06:57.831Z`. Both environments are *internally* consistent (cutoff and completion timestamps are read by the same server), so this is a normalisation caveat, not a misclassification bug.

### 26.11 Original-database preservation evidence (read-only)

| Target | Before this phase (baseline §22.3 / §23) | After | Verdict |
|---|---|---|---|
| **3306 host `restaurant_app`** | 49 tables / 105 FK / 28 ledger rows / F.5 `2026-09-11 16:06:57.831` | 49 / 105 / 28 / F.5 1 row, same literal | **UNCHANGED** |
| **3308 `restaurant_app_test` (v1)** | 49 tables / 55 FK / 6 ledger rows | 49 / 55 / 6 | **UNCHANGED** |
| **3308 `restaurant_app_test_v2`** | 24 tables / 42 FK / 6 ledger rows | 24 / 42 / 6 | **UNCHANGED** (not dropped) |
| **3308 `restaurant_app_test_v3`** | did not exist | 49 tables / 105 FK / 22 ledger rows | **new — created this phase** |
| **3307 `restorant-cafe2`** | 43 tables / 96 FK / no ledger (per §22) | **not re-readable**: no root credential for that project's container exists in this workspace (both probe attempts returned `ERROR 1045 Access denied`, i.e. **no statement executed**) | **no write possible or attempted** |

No credentials were printed; no business rows were read (only `information_schema`, `mysql.user` names, and `_prisma_migrations` metadata).

Additional non-interference evidence: both containers were re-inspected after the work and are the **same instances** as at phase start — `restaurant-mariadb-test` id `bae65d9fc587…` started `2026-10-14T02:16:18Z` with `RestartCount=0`, `restaurant-mariadb` id `8c3f38d3ecbf…` started `2026-10-13T14:30:46Z` with `RestartCount=0`. **No container was created, recreated, restarted or stopped.**

### 26.12 Test migration proposal (PLAN ONLY — nothing applied, no test edited, active URLs unchanged)

**Not done in this phase, deliberately:** `TEST_DATABASE_URL`/`DATABASE_URL` were **not** switched to v3, no integration test was executed, and no file under `tests/` or `src/` was modified. The following is the exact follow-up plan, derived from what §26.7–§26.10 proved and from the current test code.

**Order matters — each step is a separate approval gate.**

1. **Centralise the 3308 allow-list in `tests/setup.ts`.** Today the port pin is *duplicated per suite* (`assert.equal(EXPECTED_TEST_DB.port, process.env.TEST_DB_EXPECTED_PORT ?? "3308")` in `cashbook.integration.test.ts:325`, `revenue…:400`, `refund-profitability…:380`, `pnl…:468`, `integrity…:805`) while the bootstrap itself asserts **no** port allow-list — it only rejects production *names* (`restaurant_app`, `production`, `main`, `app`). Move the assertion into the bootstrap so every consumer inherits it.
2. **Hard-reject 3306 and 3307** in the same bootstrap: fail closed when the resolved `TEST_DATABASE_URL` port is not 3308 (or not `TEST_DB_EXPECTED_PORT` when explicitly set), and additionally reject the known non-test endpoints (`localhost:3306`, `127.0.0.1:3307`). Keep the existing guards (no `NODE_ENV=production`, `TEST_DATABASE_URL` required, no percent-encoded credentials, `DATABASE_URL` pinned to the test URL).
3. **Re-baseline M2 test 3.** Its premise is now false: it asserts `_prisma_migrations` contains **zero** rows for `20260911143644_f5_order_item_cost_snapshot` (`[F-4]`), and that every one of the 8 fixture items degrades to `unknownCompletion` with `check.cutoff = { appliedAt: null, resolved: false, codeDeployUnproven: true }`. Against a replayed database that row **exists** (1 row, apply-time). Adaptation that preserves the rule coverage **without weakening any assertion**:
   * keep a test that pins the **unresolved-cutoff fallback** (`resolved:false`, all items `unknownCompletion`, `statusCutoffOnly: "UNKNOWN"`, overall `WARN`) — but drive it from the **rules/unit layer** (where the cutoff can be `null`) instead of from a deliberately broken environment;
   * convert the integration slot to the **resolved-cutoff** path (real row), asserting the same invariants that no longer depend on a missing row (`markerSource`, `firstObservedSnapshotAt`, `snapshotPopulation`, `evidenceLevel`, `disclosure`, `activationUnproven`, `sampleOrderIds`, `assertBucketPartition`).
4. **Rework the mirrored F.5 ledger fixture** (`installCutoffLedger()` / `removeCutoffLedger()`, `LEDGER_ID`, `CUTOFF_LITERAL`). It was needed *because* the row was absent. Note its own safety behaviour: `installCutoffLedger()` returns early when a row already exists, and `removeCutoffLedger()` only deletes rows **it** installed — so against v3 it will **not** clobber or delete the genuine row. What **will** fail is the `before()` assertion `ledger[0].finishedAt.toISOString() === CUTOFF_ISO`, because the genuine row is the apply time. Required change: **delete the mirror install/removal** and make the suite read the **genuine** cutoff from the database; keep an assertion that exactly **one** F.5 row exists and that it is **unchanged** after the run (this still protects M-1's determinism precondition).
5. **Preserve the eight-row numerical classification fixture.** Keep `check.items == 8` and `check.orders == 8` and the complete bucket partition as the numeric identity of the fixture. What changes is the *clock* it is expressed against. Today the constants are absolute: `CUTOFF = 2026-09-11T16:06:57.831Z`, `MARKER = 2026-09-20T00:00:00.000Z` (the marker is **9 days after** the old cutoff, which is what makes the "marker strictly newer than the cutoff" deployment-window carve reachable), `BEFORE_CUTOFF = 2026-09-01T00:00:00.000Z`. With the genuine apply-time cutoff (`2026-10-14T07:52:58.220Z`), **the marker is now ~24 days *older* than the cutoff**, so the carve can no longer trigger and the expected classifications necessarily change.
   *Required adaptation (business rules untouched):* express the fixture **relative to the resolved cutoff** — e.g. `BEFORE_CUTOFF = cutoff − 10 d`, `MARKER = cutoff + 9 d`, keeping the exact relations `BEFORE_CUTOFF < CUTOFF < MARKER` and the same offsets the fixture used before. Every assertion shape (`buckets()`, `statusCutoffOnly`, sample ids, severities, disclosure, `assertBucketPartition`) stays as-is; only the dates become cutoff-relative. This is an adaptation of *fixture data*, **not** a weakening of the M2 business rules.
   *Explicitly out of scope:* rewriting the F.5 `finished_at` to the production literal, or installing a mirrored row, to avoid this adaptation. Both are forbidden by the phase and were not done.
   *Honest caveat:* the **exact** expected bucket/severity values after adaptation must be **derived when the suite is actually run** in the next phase — this report deliberately does not assert them, because that would be an unverified claim.
6. **Run all five suites sequentially** against v3, capturing real exit codes and the per-suite pass counts: Cashbook (15), Revenue (19), Refund/Profitability (21), P&L (24), M2 Integrity (29) = **108 tests**. Sequential, never parallel (they share one database).
7. **Rerun the 57 M2 unit tests** (`src/services/accounting/integrity.unit.test.ts`) — these are pure-rule tests and must pass unchanged; any failure there is a genuine regression, not a fixture artifact.
8. **Revalidate cleanup and tenant isolation**: `cleanupRun()` + `findResiduals()` must leave **zero** residual rows, the v3 database must end the run with exactly the rows the suite expects (and **one** unchanged F.5 ledger row), and the tenant-scoping assertions must hold.
9. **Then** PHASE F (production defect remediation A-9, A-11, F-2) — and only after the above passes.

### 26.13 Rollback plan

This phase's footprint is one database, one user and two inert env lines; the migration patch from §25 is untouched.

```bash
# 1. drop the disposable rehearsal database and its dedicated user (3308 container ONLY)
docker exec restaurant-mariadb-test sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb -u root -e \
   "DROP DATABASE IF EXISTS \`restaurant_app_test_v3\`; DROP USER IF EXISTS '\''restaurant_test_v3'\''@'\''%'\'';"'

# 2. remove the inert credential lines
#    (.env.test: DISPOSABLE_TEST_V3_URL  — added this phase)
#    (.env.test: DISPOSABLE_TEST_V2_URL  — kept from §23.4)

# 3. verify nothing else changed
docker exec restaurant-mariadb-test sh -c \
  'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb -u root -N -B -e "SHOW DATABASES;"'
```

No reverse-migration is needed (replay is additive to an isolated DB), and no rollback touches 3306, 3307, v1 or v2. Rolling back the **migration patch** itself is unaffected by this phase and remains the §25.9 procedure. `restaurant_app_test_v2` is still retained as evidence (§23.13) and was not dropped.

### 26.14 Carried-forward findings (status after this phase)

| ID | Finding | Status now |
|---|---|---|
| **F-7** | Migration chain not replayable from an empty DB | ✅ **FIXED & PROVEN** — 22/22, exit 0, structural parity (§26.5–§26.7) |
| **F-4** | Test DB missing 50 FK columns / partial ledger | ✅ **RESOLVED by construction** — v3 has 105/105 FK, 22/22 ledger, 0 unfinished; `orderitemcostsnapshot` 5/5 |
| **F-5** | Cutoff metadata parity (production literal vs replay) | ❌ **NOT ACHIEVED, by design** — apply-time value only; needs the §26.12 decision. Not a defect. |
| **F-8 (NEW)** | 3306 deviates from the chain on 5 tables' collation; fresh envs are not collation-identical to it | ⚠️ open, non-blocking, reference-side (§26.7) |
| **M-1** | `resolveLegacyCutoff()` `LIMIT 1` without `ORDER BY` | ⚠️ still **OPEN**; precondition satisfied (exactly 1 F.5 row in both v3 and A) |
| **M-2 (NEW)** | `finished_at` is a naive local literal → timezone-dependent instant across environments | ℹ️ informational (§26.10) |
| **F-6** | Deployed/production database UNKNOWN | ❓ unchanged — out of scope here; still must be confirmed before any deploy |
| **A-9, A-11, F-2** | Production financial defects | ⛔ **UNTOUCHED** — PHASE F, gated behind the §26.12 work |
| **R-1** | Bare Prisma CLI targets the shared host DB on 3306 | ⚠️ **confirmed live** (§26.3) and mitigated by explicit overrides this phase |

### 26.15 Updated progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Topology, preflight, access recovery, isolated test container, schema, final safety | ✅ DONE |
| 2B.1–2B.5 | Cashbook 15 · Revenue 19 · Refund/Profitability 21 · P&L 24 · M2 29 | ✅ DONE (108/108 as last run) |
| 2B.5 unit | 57 M2 unit tests | ✅ DONE (57/57 as last run) |
| 2C.1 | Final cross-module evidence audit | ✅ DONE — NOT READY |
| 2C.2A | Topology & schema parity preflight | ✅ DONE |
| 2C.2B | Fresh isolated test DB & migration parity | ⛔ STOPPED — P3018; F-7 found |
| 2C.2C | F-7 migration repair strategy audit | ✅ DONE — Option A recommended |
| 2C.2D | F-7 migration repair patch preparation | ✅ DONE — Option A applied (4 files, uncommitted) |
| **2C.2E** | **Fresh migration replay & schema parity** | **✅ DONE — 22/22 applied, exit 0; F-7 fixed & proven; F-4 resolved; parity exact except 5 collation deltas (reference-side); F-5 cutoff not achieved by design** |
| 2C.2F | Test-env migration (3308 allow-list, M2 test-3 re-baseline, genuine-cutoff fixture) + rerun 108 + 57 | ⏳ **NOT STARTED — awaiting approval** |

### 26.16 Final Git status

```
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

`git status --porcelain=v1 | wc -l` = **19** — byte-identical to §26.1 (and §25.1). `git diff --check` **clean**. Inside `prisma/migrations` only the four §25 patched files differ from `HEAD`. The only artefacts outside git are the §25 backup directory and three `/tmp` files (`c2c2e-replay.mjs`, `c2c2e-parity.mjs`, logs) plus the inert `DISPOSABLE_TEST_V3_URL` line in gitignored `.env.test`. No commit / push / merge / deploy.

### 26.17 STOP / next approval gate

**STEP 2C.2E STOPS HERE.** Summary of what is now true and what is still not:

* **Proven:** the patched chain provisions a brand-new empty database end-to-end (22/22, exit 0); the result is structurally identical to the application reference on tables, columns, PKs, FKs, referential rules, indexes, unique constraints and constraint names; the ledger is self-consistent and matches the files; the F.5 row exists exactly once with a genuine apply-time value.
* **Not proven / not done:** no integration test was executed, so **no claim is made about the 108 tests or the 57 unit tests in this phase**; the F.5 *cutoff* literal was not reproduced and must be decided; the 5 collation deltas on 3306 are un-resolved (F-8); M-1 and M-2 remain open; the deployed/production target is still UNKNOWN; A-9, A-11 and F-2 are untouched.
* **Production readiness remains 🚫 NOT READY FOR PRODUCTION.**

Next phase (**2C.2F** — §26.12) requires **explicit approval** and must not start automatically. It is the first phase that edits test sources and the first that may switch the active test URL to v3.

---

## 27. STEP 2C.2F — TEST ENVIRONMENT V3 MIGRATION & FULL REGRESSION

**Mode:** test infrastructure + test code only. No production Accounting code, no schema change, no migration edit, no migration execution (no `db push` / `reset` / `resolve`), no ledger fabrication, no v1/v2 deletion, no container recreation, no application-DB write, no commit/push/merge/deploy.

### 27.1 Initial Git status (start of this phase)

```
$ git status --porcelain=v1 | wc -l
19
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

19 entries — byte-identical to §26.16 (and §26.1). Nothing was reverted, stashed or restored. All pre-existing modifications were preserved untouched (verified again at §27.16).

### 27.2 Approval evidence

The implementation plan (files to change, assumptions tied to the v1 database, M2 test-3 re-baseline, the genuine F.5 `finished_at`, timezone handling, the eight-row fixture adaptation, rollback strategy, execution order and failure policy) was presented in full **before any edit**, and the operator replied:

> **“Approve — implement then run the full regression”**

No file was modified before that approval. The plan is §4 of the phase brief and matches §26.12 steps 1–8.

### 27.3 Exact files changed (9 files — no `src/**`, no migration, no config)

| # | File | Change |
|---|------|--------|
| 1 | `tests/setup.ts` | **NEW §2 approved-target guard** (fail-closed) + exported `assertLiveTestTarget()` |
| 2 | `.env.test` (gitignored, never committed) | Active `TEST_DATABASE_URL` / `DATABASE_URL` repointed to the v3 URL; v1/v2 URLs kept as inert `LEGACY_TEST_V1_URL` / `DISPOSABLE_TEST_V2_URL` lines for a two-line rollback |
| 3 | `.env.test.example` | Rewritten for the v3 shape — **no secrets**, only `<password>` placeholders |
| 4 | `tests/README.md` | New “Test target (STEP 2C.2F)” table, env table corrected, guard documented as items 6–8, “Cutoff ledger fixture” section replaced by “Genuine F.5 cutoff”, “Adding New Tests” now requires the live guard call |
| 5 | `tests/accounting/integrity.integration.test.ts` | Mirrored-ledger workflow **deleted**; genuine cutoff resolved read-only; fixture instants made cutoff-relative (`at()`); test 3 re-baselined to the **resolved** path; test 1 grant assertion re-pointed at `EXPECTED_TEST_DB.name`; a stale `assert.equal(ledger.length, 0)` leftover removed; `ledger.length === 1` asserted before/after; **new `createIncoherentSnapshot()` FK-disabled fixture writer** (§27.6); `_test` identity predicate widened; `assertLiveTestTarget` imported and called |
| 6–9 | `tests/accounting/{cashbook,revenue,refund-profitability,pnl}.integration.test.ts` | Import `assertLiveTestTarget`, call it in the safety test, `identity.db.endsWith("_test")` → `identity.db.includes("_test")` |

Identity-predicate lines actually changed: cashbook `319`, revenue `396`, refund-profitability `379`, pnl `468`, integrity `853` (the five suites).

**Not touched:** all of `src/**` (including the four M2 implementation files), all of `prisma/**` (including the four §25-patched migration files), `prisma.config.ts`, `.env`, `package.json`, `tsconfig.json`, `next.config.ts`, `docker-compose.yml`.

### 27.4 Centralised safety guard (`tests/setup.ts`)

The enforcement now lives **in the bootstrap**, before any Prisma client can exist, instead of being duplicated per suite:

* `APPROVED_TEST_TARGET = { scheme: "mysql:", host: "127.0.0.1", port: "3308", database: "restaurant_app_test_v3", user: "restaurant_test_v3" }` — both effective URLs must parse to **exactly** this.
* `PROTECTED_PORTS = [3306, 3307]` and `PROTECTED_DATABASES = [restaurant_app, restaurant_app_test, restaurant_app_test_v2, production, main, app]` are rejected **by name and by port**.
* Missing / empty / malformed / disagreeing URL pairs are a **refusal**, never a warning; `localhost` is refused on purpose (it can resolve to `::1` or another daemon).
* `assertLiveTestTarget(prisma)` — the live half — runs `SELECT DATABASE(), USER(), @@hostname, @@port, VERSION()`, requires the approved database name, the dedicated account and a MariaDB server. `@@port` is deliberately **not** asserted: inside the container the server always listens on 3306, and the host-side mapping was already enforced from the URL. This is a centralised exported helper because the test runner does not support top-level `await` (probed and confirmed first).
* **Credentials are never printed** — the bootstrap logs host / database / username only, and `SHOW GRANTS` output is never echoed (the `USAGE` row contains a password hash).
* The guard was **behaviourally probed** against a case matrix before it was trusted: 1 accepted target (v3) and **9 refusals** (v1, v2, `restaurant_app`, `production`, `main`, 3306, 3307, `localhost`, missing/ambiguous pair) — see §27.6 note.

### 27.5 V3 database identity (proven live, read-only)

| Fact | Value |
|------|-------|
| Host-side URL | `127.0.0.1:3308` → container `restaurant-mariadb-test` (3308→3306/tcp) |
| Database | `restaurant_app_test_v3` |
| Dedicated user | `restaurant_test_v3` (live `USER()` = `restaurant_test_v3@172.18.0.1`) |
| Server | `11.8.9-MariaDB-ubu2404` |
| Tables | **49** |
| Migration ledger rows | **22** (was 6 on v1) |
| F.5 ledger rows | **1** — `20260911143644_f5_order_item_cost_snapshot` |
| Business rows before/after the whole phase | **0 / 0** (all 48 id-bearing tables empty) |

The container listing (read-only) at phase start: `restaurant-mariadb-test 127.0.0.1:3308->3306/tcp`, `restaurant-mariadb 0.0.0.0:3307->3306/tcp`, `restaurant-phpmyadmin`, `restaurant-redis`. No container was created, stopped, recreated or reconfigured.

### 27.6 M2 fixture changes (and the one genuine failure this phase hit)

1. **Mirrored ledger fixture deleted.** `installCutoffLedger()` / `removeCutoffLedger()` / `LEDGER_ID` / `CUTOFF_LITERAL` and the `describe` that wrapped tests 4–29 are gone; the ledger is now only ever **read**. `before()` asserts exactly **one** F.5 row and resolves the cutoff from it; `after()` asserts the row is **still exactly one and unchanged** (`[M-1]` determinism precondition kept).
2. **Test 3 re-baselined** from the degraded environment gap to the **resolved** path: `cutoff = { migration: 20260911143644_f5_order_item_cost_snapshot, appliedAt: <ledger finished_at>, resolved: true, codeDeployUnproven: true }`, `items 8`, `orders 8`, `buckets {legacy 3, before 2, anomaly 2, unknown 1}`, `statusCutoffOnly CRITICAL`, `markerSource SNAPSHOT_MIN_OBSERVED`, `snapshotPopulation 1`, `evidenceLevel SNAPSHOT_OBSERVED`, `disclosure null`, 5 sample order ids. **The unresolved-cutoff contract is not lost**: it stays pinned in the rules layer (`integrity.unit.test.ts`: “NEVER guesses when the cutoff is unresolved”, `buildCutoffEvidence({resolved:false})`, `E5 — unresolved cutoff is UNKNOWN and overall WARN`) — none of the four M2 files was modified to make anything pass.
3. **Fixtures are cutoff-relative.** `REF_*` constants document the original reference clock (`REF_CUTOFF = 2026-09-11T16:06:57.831Z`, marker 9 days later — the relation that makes the carve reachable); every fixture instant is now `at(ref) = CUTOFF + (ref − REF_CUTOFF)` in **milliseconds**, so `mand-5 == cutoff`, `mand-7 == marker`, `marker ± 1 ms` stay exact in any server timezone.
4. **One-line environment predicate per suite:** `identity.db.endsWith("_test")` → `identity.db.includes("_test")` (`restaurant_app_test_v3` does not end in `_test`). This is an environment-shape assertion, not a business rule; the authoritative checks are `identity.db === EXPECTED_TEST_DB.name` (exact v3 name) plus the new centralised live guard.
5. **Test 1 grant assertion re-pointed** from the literal `` `restaurant_app_test` `` to `` ` ${EXPECTED_TEST_DB.name} ` `` (the v3 user holds ALL only on `restaurant_app_test_v3`); the negative assertion (no grant on the application database) is unchanged. A stale leftover assertion (`ledger.length === 0`, “the suite-installed ledger row must be removed”) was **deleted** — it contradicted the genuine-row invariant and could only ever have passed with the mirror in place.
6. **`[F-5]` FK-parity failure and its fix — preserved verbatim, classified as fixture+environment.** On v3 (FK parity with the application DB, unlike the v1 hybrid) the two deliberately incoherent C3 test-28 rows are rejected by the database:

```
prisma:error
Invalid `prisma.orderItemCostSnapshot.create()` invocation in
/home/reksa/restorant-cafe/tests/fixtures/accounting.ts:524:38
Foreign key constraint violated on the fields: (`orderItemId`)
```

   Consequence of the throw inside the file-level `before()`: `exit=1`, `tests 29 · pass 0 · fail 0 · cancelled 29` (`”test did not finish before its parent and was cancelled”`), with only the run-scoped cleanup still executing. **Classification: fixture + environment, never production logic** — `ORPHAN_SNAPSHOT_ITEM` / `SNAPSHOT_ORDER_MISSING` exist to detect rows written *before* the F.5 constraints existed, so no normal write path can create them once FK parity holds (the same reason `[F-5]` was recorded in §21.5). Fix, with **no assertion weakened and no production file touched:** a new `createIncoherentSnapshot()` helper writes those two rows on a **dedicated short-lived connection** that sets `SESSION FOREIGN_KEY_CHECKS = 0` for that single `INSERT`, restores it and closes the connection in `finally` — the Prisma pool is never touched, so no pooled session can be left unconstrained. DATETIME columns are written as naive UTC literals, matching the Prisma driver adapter’s own representation, so the rows read back with the exact instant the other fixtures were given. After the fix: **29/29 pass, exit 0**.
7. The suite header, the C3 fixture comment and test 28’s comment were updated to state this explicitly instead of claiming the schema “has no FK”.

### 27.7 Genuine cutoff and timezone treatment

* Genuine cutoff, as read through the **same Prisma connection that writes the fixtures**: `2026-10-14T07:52:58.220Z` (logged by the suite: `[M2 CUTOFF] genuine _prisma_migrations.finished_at → …`, marker `2026-10-22T15:46:00.389Z`, i.e. +8.328 days ≈ the original 9-day marker relation).
* **Live M-2 evidence** — the same stored naive literal is read differently by the two client paths in this environment:

| Reader | Value returned for the identical stored `DATETIME(3)` |
|--------|-------------------------------------------------------|
| Prisma driver adapter (used by the service **and** the suite) | `2026-10-14T07:52:58.220Z` (naive literal taken as UTC) |
| raw `mariadb` driver (used only for out-of-band evidence reads) | `2026-10-14T00:52:58.220Z` (naive literal re-interpreted in the host’s UTC+07:00) |

  The 7-hour delta is exactly the host offset, confirming `finished_at` is a **naive local literal** (M-2). This is precisely why the suite **never compares the cutoff against a literal**: it reads the value through Prisma and derives every fixture instant from that `Date` by millisecond offsets, so cutoff, fixtures and the service share one clock and the boundary equalities are exact regardless of server timezone. The §26.10 value `2026-10-14T07:52:58.220Z` is therefore **not** rewritten, mirrored or fabricated — F-5 remains **NOT ACHIEVED by design** and still needs its decision.
* **M-1** stays open but its precondition is asserted, not assumed: exactly one F.5 row before and after every suite (two independent assertions).
* **No STOP was triggered** under §6: production cutoff semantics were **not** reinterpreted, and no boundary was redefined.

### 27.8 Eight-row numerical fixture results (unchanged classification)

| Quantity | Expected | Observed |
|----------|----------|----------|
| `items` / `orders` | 8 / 8 | **8 / 8** |
| `legacyExpected` | 3 | **3** |
| `beforeFirstSnapshot` | 2 | **2** |
| `anomaly` | 2 | **2** |
| `unknownCompletion` | 1 | **1** |
| `statusCutoffOnly` | `CRITICAL` | **`CRITICAL`** |
| overall status (fixture tenant) | `CRITICAL` | **`CRITICAL`** |
| marker | tenant-wide `MIN(snapshot.completedAt)` | **`2026-10-22T15:46:00.389Z`** (`SNAPSHOT_MIN_OBSERVED`, population 1) |
| bucket partition | always partitions `items` | **holds** (test 3, 4, 19, 20) |

Test 3 and test 4 (the SQL aggregation) both pass, and test 21 proves the pure classifier reproduces the SQL buckets bucket-for-bucket.

### 27.9 Five integration-suite results (sequential, real exit codes)

Run **one file at a time** (each suite asserts whole-table baselines, so parallel files would corrupt the measurement), at `2026-10-14T15:17:33+07:00`, with `NODE_ENV=test`:

| # | Suite | Previous baseline | Result | exit | pass | fail | cancelled | skipped |
|---|-------|-------------------|--------|------|------|------|-----------|---------|
| 1 | Cashbook | 15 | ✅ | **0** | **15** | 0 | 0 | 0 |
| 2 | Revenue & Reporting | 19 | ✅ | **0** | **19** | 0 | 0 | 0 |
| 3 | Refund & Profitability | 21 | ✅ | **0** | **21** | 0 | 0 | 0 |
| 4 | P&L | 24 | ✅ | **0** | **24** | 0 | 0 | 0 |
| 5 | M2 Integrity | 29 | ✅ | **0** | **29** | 0 | 0 | 0 |
| | **Total** | **108** | ✅ | — | **108** | **0** | **0** | **0** |

Every suite's own cleanup hook reported `baseline → after` identical on all 21 monitored tables (all `0 → 0`), residual `0` everywhere, and the M2 suite reported `F.5 ledger rows after run: 1`. Counts are the runner's own `ℹ tests/pass/fail/cancelled/skipped` summary lines, not estimates, and no result was reused from a previous phase.

**Methodology note (reported because it affects evidence, not because it changes a result):** the first attempt was launched as a backgrounded script; the harness tore down the process group while `m2int` was mid-run, so that attempt produced `cancel 29 / exit 1` and left **run-scoped residue** (2 restaurants + their children, prefix `m2int-mv7tzw6n-dxcz-497773`) because the suite's `after()` never ran. The residue was removed with the suite's **own** `cleanupRun()` + `findResiduals()` helper (deleted `restaurant 2 · branch 2 · user 2 · customer 2 · order 2 · orderItem 2 · product 2 · category 2`, residual **0**) — no `TRUNCATE`, no global reset, nothing outside those 8 rows. The full six-suite sweep was then re-run from a clean state **in one sequential pass** with the results above, and the DB-level before/after snapshot confirms zero residue (§27.11).

### 27.10 M2 unit-suite results

| Suite | Previous baseline | Result | exit | pass | fail | skipped |
|-------|-------------------|--------|------|------|------|---------|
| `src/services/accounting/integrity.unit.test.ts` | 57 | ✅ | **0** | **57** | 0 | 0 |

Passed **unchanged** — the file is byte-identical to the state it had before this phase (mtime `2026-10-10 12:44`, §27.13).

### 27.11 Cleanup verification (no residual test data)

| Check | Before the sweep | After the sweep |
|-------|------------------|-----------------|
| Database | `restaurant_app_test_v3` | `restaurant_app_test_v3` |
| Tables with an `id` column | 48 | 48 |
| Total business rows | **0** | **0** |
| Non-zero tables | **none** | **none** |
| Migration ledger rows | **22** | **22** |
| F.5 `finished_at` | `2026-10-14 07:52:58.220` | **identical** (no rewrite) |

Additional proof inside each suite: `cleanupRun()` + `findResiduals()` in `after()`, `afterCounts deepEqual baseline` on 21 tables per suite, and an explicit scan of every table for run-prefixed ids (the only residue found in the whole phase was the harness-kill residue described in §27.9, removed with the same helper and re-verified as 0). **No `TRUNCATE`, no reset, no `DELETE` without a run prefix.**

### 27.12 Tenant and branch isolation

All isolation scenarios ran and passed on v3: Cashbook 11 (tenant) and 12 (`authorizedBranches`), Revenue 14–15, Refund & Profitability 19–20, P&L 21–22, and M2 22 (one tenant never leaks into another), 23 (branch scoping enforced while the marker stays tenant-wide), 27 (branch-scoped C3 invariants) and 28 (tenant-wide invariants reported tenant-wide, never leaked as branch samples — including the branch-filtered caller receiving an **empty** sample list while still seeing the tenant-wide verdict). `IntegrityQuerySchema` still refuses a client-supplied `restaurantId` (M2 test 29).

### 27.13 TypeScript / build / lint / whitespace

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | **exit 0** (`tsconfig.json` includes `**/*.ts`, so all nine changed files are type-checked) |
| Production build | `npm run build` | **exit 0** — Next.js 16.3.3, all routes compiled, no error. Side effect: the build **regenerated** the tracked, generated `next-env.d.ts` (rewrote the two `./.next/dev/types/*` imports to `./.next/types/*`, mtime `15:18:52`); it was restored to `HEAD` afterwards, so the working tree is back to the phase-start state (§27.16). The project was not re-built after the restore — the restore only reverts an auto-generated reference file, never the source |
| Lint (phase-touched files) | `npx eslint tests/setup.ts tests/accounting/{integrity,cashbook,revenue,refund-profitability}.integration.test.ts` | **exit 0** — clean |
| Lint (project-wide) | `npm run lint` (bare) | exit 1 — **245 pre-existing problems** (106 errors / 139 warnings) in files this phase did not touch (`tests/fixtures/accounting.ts` 28, `scripts/*` 44, `src/**` app pages …). The single warning in a phase-touched file is `pnl.integration.test.ts:1389 'today' is assigned a value but never used` — in test 18, written in an earlier phase, not on any line this phase edited |
| Diff hygiene | `git diff --check` | **exit 0** |
| Test-file whitespace | trailing spaces / tabs / CRLF under `tests/` | **0 / 0 / 0** files |
| M2 production files | mtime + hash | untouched — `integrity.rules.ts`, `integrity.service.ts`, `integrity.types.ts`, `integrity.unit.test.ts` all still `2026-10-10` |
| Patched migration files | mtime | untouched — the four §25 files still `2026-10-14 14:29:37`, i.e. **before** this phase's first edit (`15:08`), and `git status` lists exactly the same four |

### 27.14 Carried-forward findings (status after this phase)

| Finding | Status after 2C.2F |
|---------|--------------------|
| **F-7** migration chain | ✅ fixed & proven (§26) — re-confirmed by a full green regression on the replay-provisioned DB |
| **F-4** test-DB hybrid | ✅ **RESOLVED and now exercised** — v3 has 105/105 FK, 22/22 ledger rows, and the genuine F.5 row; M2 test 3 now proves the resolved-cutoff path against it |
| **F-5** cutoff literal | ❌ **NOT ACHIEVED, by design** — apply-time only; still needs the §26.12 decision. Not a defect |
| **F-8** 5-table collation drift (reference-side) | ⚠️ open, non-blocking, untouched |
| **M-1** `LIMIT 1` without `ORDER BY` | ⚠️ **OPEN** — precondition now asserted before and after every run (exactly one F.5 row), so the shortfall is documented rather than silent |
| **M-2** naive `finished_at` → timezone-dependent instant | ℹ️ informational, **now with live cross-driver evidence** (§27.7: 7-hour delta between the Prisma adapter and the raw driver) — the suite is immune because it never compares against a literal |
| **F-6** deployed/production target | ❓ **UNKNOWN** — unchanged, out of scope here, must be confirmed before any deploy |
| **A-9, A-11, F-2** | ⛔ **UNTOUCHED** — production financial defects, still `Must fix` |
| **NEW (recorded)** | The C3 tenant-wide invariant rows are no longer reachable through any normal write path now that FK parity holds; the suite reproduces the historical condition explicitly with a documented, single-statement, FK-disabled fixture writer (§27.6). If the invariants are ever meant to be reachable in production, that is a **schema/design question**, not a test question |
| **NEW (recorded)** | The v1 `[F-4]`/`[F-5]` hybrid DB (`restaurant_app_test`) and the failed v2 DB remain preserved **read-only** as evidence; the active target is v3 only |

### 27.15 Updated progress tracker

| Phase | Description | Status |
|-------|-------------|--------|
| 2A.1–2A.5-F | Topology, preflight, access recovery, isolated test container, schema, final safety | ✅ DONE |
| 2B.1–2B.5 | Cashbook 15 · Revenue 19 · Refund/Profitability 21 · P&L 24 · M2 29 | ✅ DONE — re-run green on v3 this phase |
| 2B.5 unit | 57 M2 unit tests | ✅ DONE — re-run green this phase |
| 2C.1 | Final cross-module evidence audit | ✅ DONE — NOT READY |
| 2C.2A | Topology & schema parity preflight | ✅ DONE |
| 2C.2B | Fresh isolated test DB & migration parity | ⛔ STOPPED — P3018; F-7 found |
| 2C.2C | F-7 migration repair strategy audit | ✅ DONE — Option A recommended |
| 2C.2D | F-7 migration repair patch preparation | ✅ DONE — Option A applied (4 files, uncommitted) |
| 2C.2E | Fresh migration replay & schema parity | ✅ DONE — 22/22 applied, exit 0; F-7 fixed & proven; F-4 resolved |
| **2C.2F** | **Test environment v3 migration & full regression** | **✅ DONE — active target v3 behind a centralised fail-closed guard; M2 re-baselined on the genuine cutoff; 108/108 integration + 57/57 unit pass (exit 0); tsc 0 · build 0 · diff-check clean; v1/v2 preserved** |

### 27.16 Final Git status

```
$ git status --porcelain=v1 | wc -l
19
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

**19 entries — identical set to §27.1** (`.env.test.example` is already listed as `?? .env.test.example`; `tests/` is untracked as a whole, so its internal edits do not add entries; `.env.test` is gitignored and does not appear). No commit, push, merge or deploy. Only the files listed in §27.3 were written, and only inside `tests/`, `.env.test` and `.env.test.example`; `git diff --check` is clean and the four M2 production files and four patched migrations are byte-unchanged (mtime evidence in §27.13).

The only entry that ever appeared beyond this set was the auto-generated `next-env.d.ts`, which `npm run build` rewrote: to keep the tree identical to the phase start it was restored with `git checkout HEAD -- next-env.d.ts`, and the final `git status --porcelain next-env.d.ts` is **empty** (verified after the restore).

### 27.17 STOP / next approval gate

**STEP 2C.2F STOPS HERE.** What is now true:

* the only write-capable integration-test target is `127.0.0.1:3308/restaurant_app_test_v3`, enforced in `tests/setup.ts` **before any Prisma client exists** and additionally proven live per suite;
* the M2 suite runs against the **genuine** F.5 ledger row — no mirrored row, no fabricated `finished_at`, cutoff-relative fixtures, unresolved-cutoff contract preserved in the rules layer;
* **108/108** integration tests and **57/57** unit tests pass on v3 with real exit code **0**, no skips and no weakened assertions; `tsc`, `build`, `git diff --check` and whitespace checks are clean;
* v3, v1 and v2 databases and all four containers are preserved; **zero** residual test rows; ledger 22 rows before and after; the F.5 row unchanged.

What is still **not** true:

* **F-5** (production cutoff literal) is still undecided — this phase explicitly did **not** reproduce or rewrite it; **M-1**, **M-2**, **F-8** remain open; **F-6** (deployed target) is still UNKNOWN; **A-9**, **A-11** and **F-2** remain untouched and are still release blockers.
* **Production readiness remains 🚫 NOT READY FOR PRODUCTION.**

**No further phase is started.** A-9 / A-11 / F-2 remediation, the F-5 decision, and any commit/push/deploy each require **explicit approval** and must not begin automatically.

---

## 28. STEP 2C.3A — REPORTING PREDICATE CONSISTENCY AUDIT

**Mode:** STRICT AUDIT ONLY — **no production code edit, no test edit, no database write, no migration/schema edit, no M2 production-file change, no test-infrastructure change, no lint cleanup, no commit/push/merge/deploy.** Every statement below is either a code citation (file:line) or an already-reported result; **no check from a previous phase is claimed as rerun here**, and no query was executed against any database in this phase.

**Scope:** the two known discrepancies A-9 and A-11, plus a sweep for further instances of the same defect class inside the reporting domain. Roadmap numbering is LOCKED: this is 2C.3A, the fix belongs to 2C.3B.

### 28.1 Initial Git status (start of this phase)

```
$ git status --porcelain=v1 | wc -l
19
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

19 entries — identical to the end of STEP 2C.2F (§27.16). Nothing was reverted, stashed or restored; all pre-existing modifications are preserved.

### 28.2 Root cause — A-9 (`busiestHours`)

**Site:** `src/services/report/report.service.ts`, inside `getSalesReport` (L1241), the hourly raw-SQL block at **L1342–L1357**; the defective predicate is **L1354**.

```sql
-- L1352-1355 (verbatim)
AND `status` <> 'CANCELLED'
AND `paymentStatus` = 'PAID'
```

**Why that is wrong here:** this is the ONLY sub-report in `getSalesReport` that hand-rolls the collected half of the revenue set instead of composing the canonical fragment that already exists in the same file (`revenueSetSql`, L545; `paidRevenueSql`, L532 — introduced by PHASE 9B-F4 exactly to stop this class of copy). The two lines are semantically `paymentStatus = 'PAID'` **only**, so an order that was collected and then **fully refunded** is dropped even though the canonical rule keeps it in the revenue set.

**Mechanism (Order↔Payment relationship):** on refund approval, `approval.service.ts` marks the collected payments `REFUNDED` and, when `netPaid ≤ MONEY_EPSILON`, writes the order mirror to `paymentStatus = "UNPAID"` (L502–L528: `data: { paymentStatus: netPaid > MONEY_EPSILON ? "PAID" : "UNPAID" }`). A fully refunded order therefore has `Order.paymentStatus = 'UNPAID'` **and** `Payment.status = 'REFUNDED'` — precisely the state the canonical `OR EXISTS (REFUNDED payment)` half exists to catch, and precisely the state the PAID-only line misses. Partially refunded orders stay `PAID`, so they were never affected.

**Blast radius:** only `busiestHours` (`revenue`, `orders`). Its sibling inside the same function — `dailySeries` (L1365–L1390) — already inlines the canonical `OR EXISTS` predicate, so the two SQL sub-reports disagree with each other in the same response (L1544–L1556). Reproduced by an existing test: revenue suite scenario 11 asserts `Σ dailySeries.sales === 200000` while `Σ busiestHours.revenue === 0` for the same fully-refunded order (see §28.10 item 4).

**Exposure surface (route-level, checked this phase):** `GET /api/reports/sales` (L75) returns the report object, so `busiestHours` is visible in the JSON/UI hourly chart. The sales **CSV export** does **not** carry it — `GET /api/reports/sales/export` reads `getSalesOrdersForExport` (L67), an order listing. A-9 is therefore a **UI/JSON-only** under-count, not a downloaded-document defect.

**Root cause in one line:** a hand-written predicate that was not derived from `revenueSetSql` (= predicate drift), not a business-rule disagreement — the rule itself is correct and unchanged.

### 28.3 Root cause — A-11 (`getProductReport`)

**Site:** `getProductReport` (L1742). The main product rows raw-SQL block is **L1774–L1809**; the defective predicate is **L1798**.

```sql
-- L1796-1799 (verbatim)
AND o.`status` <> 'CANCELLED'
AND o.`paymentStatus` = 'PAID'
```

**Why that is wrong here:** the SAME method computes `soldWhere = revenueWhere(restaurantId, range, branchFilters, filters)` (L1758 — the canonical Prisma predicate) and then uses it for **two** other figures in the same response:

* `unsoldProducts` — `orderItems: { none: { order: { is: soldWhere } } }` (L1840);
* `soldOrderCount` — `prisma.order.count({ where: soldWhere })` (L1852), which becomes `summary.orderCount` (L1903).

while `products` / `summary.qtySold` / `summary.grossSales` / `summary.netSales` come from the **PAID-only** raw rows. One report, two revenue sets in one payload.

**Exact, user-visible consequences** (API surface: `GET /api/reports/products`, `/export`):

1. **Internal contradiction.** For a window whose only sale is a fully refunded order: `summary.orderCount` = 1 (canonical) while `summary.soldProductCount` = 0, `qtySold` = 0, `grossSales` = 0, `netSales` = 0, and `products` = [] — “one sold order, no products”.
2. **Silent omission (stronger than a mislabel).** Because `unsoldProducts` is derived from the canonical `soldWhere`, a product whose ONLY sales in the period are on fully-refunded orders has `orderItems.none(order ∈ soldWhere) === false`, so it is **not** in `unsoldProducts`; and because the raw rows exclude it, it is **not** in `products` either. It therefore disappears from the product view entirely. **Correction to §21.4:** the earlier wording (“can be listed as *unsold*”) is inaccurate — the real failure mode is omission from *both* lists, which is why this is a `Must fix` rather than a labelling nit.
3. **Cross-report contradiction.** `getSalesReport().bestSellingProducts` (Prisma, canonical, L1321–L1336) CAN list that product while `getProductReport().products` cannot — the same product is a best seller in one report and absent in another.
4. **It reaches a downloaded document.** `GET /api/reports/products/export` (L73, L99) maps `report.products` straight into the CSV rows, so the understated product table is exported to a file, while the route’s own header comment (L28–L30) documents the same wrong rule: *“same aggregation and revenue semantics as GET /api/reports/products (**PAID +** non-cancelled only, …)”*. That stale comment is documentation drift and must be corrected in 2C.3B together with the predicate (docs-only line, no behaviour).

**Root cause in one line:** same defect class as A-9 — a raw fragment written against `paymentStatus = 'PAID'` instead of the canonical `revenueSetSql` (L545), left behind when the Prisma halves of the method were migrated to `revenueWhere`.

### 28.4 Predicate consumer inventory (whole reporting domain)

**Canonical definitions (single source of truth, unchanged by this audit):**

| Layer | Symbol | Line | Predicate |
|-------|--------|------|-----------|
| Prisma (date-bounded) | `revenueWhere` | L199 | `restaurantId` + branch + `status != CANCELLED` + `createdAt ∈ range` + `OR[paymentStatus = PAID, payments.some(REFUNDED)]` (+ orderType / paymentMethod / status filters) |
| Prisma (date-free) | `revenueScopeWhere` | L220 | the same revenue set without the `createdAt` bound (refund attribution by `approvedAt`) |
| Prisma base | `reportScopeWhere` / `reportBaseWhere` / `reportActivityWhere` | L131 / L154 / L170 | non-revenue scope helpers (`reportActivityWhere` = activity/status-bucket basis, by design) |
| SQL | `paidRevenueSql(alias)` | L532 | `(alias.paymentStatus = 'PAID' OR EXISTS REFUNDED payment)` |
| SQL | **`revenueSetSql(alias)`** | **L545** | `alias.status <> 'CANCELLED' AND paidRevenueSql(alias)` — **the fragment the three defects should have used** |
| SQL | `productRevenueSql` / `refundRevenueSql` / `approvedRefundsSql` / `aliasBranchSql` | L551 / L560 / L578 / L596 | canonical money math (all defined in the same file, all private) |

**Every consumer, classified:**

| # | Consumer | File:line | Basis | Verdict |
|---|----------|-----------|-------|---------|
| 1 | `getSalesReport` summary/orderType/bestSellers/bestCategories (Prisma) | report.service.ts L1250–L1340 | `revenueWhere` | ✅ canonical |
| 2 | `getSalesReport` **busiestHours** (raw SQL) | L1342–L1357 (line **1354**) | `paymentStatus = 'PAID'` | ❌ **A-9 drift** |
| 3 | `getSalesReport` dailySeries (raw SQL) | L1365–L1390 | inline `OR EXISTS REFUNDED` | ✅ correct value, ⚠️ hand-rolled copy |
| 4 | `getSalesReport` refundRevenue | L1391–L1405 → `computeRefundRevenue` | `revenueSetSql` via L274 | ✅ canonical |
| 5 | **`getProductReport` products/summary rows** (raw SQL) | L1774–L1809 (line **1798**) | `paymentStatus = 'PAID'` | ❌ **A-11 drift** |
| 6 | `getProductReport` `unsoldProducts` + `soldOrderCount` | L1840 / L1852 | `revenueWhere` | ✅ canonical (⇒ contradicts #5) |
| 7 | `getMultiOutletReport` orderRows (per-branch totals) | L2377–L2405 | inline `OR EXISTS REFUNDED` | ✅ correct value, ⚠️ hand-rolled copy |
| 8 | `getMultiOutletReport` itemRows | L2408–L2425 | inline `OR EXISTS REFUNDED` | ✅ correct value, ⚠️ hand-rolled copy |
| 9 | `getMultiOutletReport` **orderTypeRows** (per-branch order-type breakdown) | L2462–L2481 (line **2479**) | `paymentStatus = 'PAID'` | ❌ **A-12 — NEW drift (found in this audit)**; also exported by `GET /api/reports/multi-outlet/export` (L94–L105), where `orderType.*.amount` sits in the **same CSV row** as `totalSales` and therefore does not add up to it |
| 10 | `getMultiOutletReport` productRows (best seller per branch) | L2484–L2509 | inline `OR EXISTS REFUNDED` | ✅ correct value, ⚠️ hand-rolled copy |
| 11 | `getMultiOutletReport` refundRevenue | L2510 → `computeRefundRevenue` | `revenueSetSql` | ✅ canonical |
| 12 | `getSalesReport` promo performance | L1564–L1590 | `revenueWhere` (`soldWhere` + `promoId`) | ✅ canonical |
| 13 | `computeRefundRevenue` (net sales / P&L / profitability) | L274–L340 | `revenueSetSql` | ✅ canonical |
| 14 | `computeCustomerRevenue` (customer report + reservation export) | L382–L460 | `revenueSetSql` (both halves) | ✅ canonical |
| 15 | `getCustomerReport` revenue columns | L2803–L2830 | `paidRevenueSql("o")` | ✅ canonical |
| 16 | `getCustomerReport` activity columns / first-order / reservation counts | L2790–L2860 | activity basis (`status != CANCELLED`), not revenue figures | ✅ by design (N/A) |
| 17 | `getReservationReport` funnel `paid` | L3153–L3166 | `revenueSetSql("o")` | ✅ canonical |
| 18 | `getReservationsForExport` net revenue | L3433–L3460 | `revenueSetSql` + `refundRevenueSql` | ✅ canonical |
| 19 | `getPaymentReport` / `getPaymentsForExport` | L2095 / L2243 | **payment ledger** (`Payment.status` filter + `order.status != CANCELLED`) | ✅ by design (money collected, not the revenue set) — documented in-code L2119–L2124, L2263–L2267 |
| 20 | `getShiftSalesReport` | L1946–L2000 | payment ledger per shift, `status = PAID`, `order.status != CANCELLED` | ✅ by design |
| 21 | `getSalesOrdersForExport` | L1680–L1720 | **activity listing** (`status != CANCELLED`, optional `filters.status`) — no revenue figure | ✅ by design, ⚠️ **undocumented** (§28.14) |
| 22 | `getPurchaseReport` / `getInventoryReport` | L724 / L1024 | procurement & stock | ✅ N/A (not order revenue) |
| 23 | `getDashboardStats` (dashboard revenue card) | order.service.ts L2035–L2048 | `revenueWhere` | ✅ canonical |
| 24 | `getIntegrityReport` C1 (M2) | integrity.service.ts L187 | `revenueScopeWhere` | ✅ canonical |
| 25 | P&L read-model | pnl.service.ts → profitability | delegates | ✅ canonical |
| 26 | `getProfitabilitySummary` (Prisma + SQL) | profitability.service.ts L94–L116, L262–L272 | inline canonical (`soldScopeWhere` / `itemWhere` / refund-per-branch) | ✅ correct value, ⚠️ hand-rolled copy (other file) |
| 27 | Menu engineering branch qty + uncosted statuses | menu-engineering.service.ts L340–L352, L375–L385 | inline `OR EXISTS REFUNDED` | ✅ correct value, ⚠️ hand-rolled copy (other file) |
| 28 | `getCashbook` | cashbook.service.ts | **cash-movement dates** (paidAt / approvedAt / spentAt) | ✅ by design (different basis by contract) |
| 29 | Cashier-sales ledger | cashier-sales.service.ts L181–L205 | payment ledger + `order.status != CANCELLED` | ✅ by design |

**Result of the sweep:** exactly **three** raw fragments use the PAID-only predicate — A-9 (L1354), A-11 (L1798) and the newly found **A-12** (L2479). **Six** additional sites duplicate the canonical predicate inline (items #3, #7, #8, #10, #26, #27) — correct in value today, but they are exactly the copy-paste pattern that produced A-9/A-11/A-12 (PHASE 9B-F4 consolidated five such copies in this file; these six are its leftovers). No other reporting-domain consumer redefines revenue.

### 28.5 Expected accounting semantics (the rule the fix must satisfy)

The canonical revenue set is **unchanged** and is not up for negotiation in 2C.3B:

```
revenue set =  order.restaurantId = tenant
           AND  order in branch scope (authorization-resolved branchFilters)
           AND  order.status <> 'CANCELLED'
           AND  ( order.paymentStatus = 'PAID'
                  OR EXISTS payment p: p.orderId = order.id AND p.status = 'REFUNDED' )
           AND  order.createdAt in [range.start, range.end]        -- gross side
refund side  =  refund.status = 'APPROVED' AND refund.approvedAt in range
                over the DATE-FREE revenue set (revenueScopeWhere)
```

| Case | Order mirror | Payment rows | In the revenue set? | Expected in EVERY sub-report |
|------|--------------|--------------|---------------------|------------------------------|
| Fully paid | `PAID` | one/more `PAID` | ✅ | counted in all three drifted views |
| Fully refunded | `UNPAID` (mirror reset) | `REFUNDED` | ✅ (kept so revenue is *reversed*, not dropped) | counted in all three; its revenue is reversed by `computeRefundRevenue`, never silently removed |
| Partially refunded | `PAID` | `PAID` (+ negative `PaymentTransaction` mirror) | ✅ | counted in all three |
| Unpaid | `UNPAID`/`PENDING` | none / `PENDING` / `FAILED` / `EXPIRED` | ❌ | excluded from all three |
| Cancelled | any | any | ❌ (`status <> 'CANCELLED'` first) | excluded from all three |
| Stale mirror: `PAID` payment but order mirror `UNPAID`, no refund | `UNPAID` | `PAID` | ❌ | excluded from all three (the ORDER mirror is authoritative — the point the existing suite pins) |
| Multiple `PaymentTransaction` rows | — | mirrors only | qualifier unchanged | none of the three may double-count (all three aggregate `order`/`orderitem`, never payments) |

Aggregation currency: `grandTotal` for hourly/branch/order-type revenue; `productRevenue = grandTotal − tax − serviceCharge` for `netSales`; day/hour grouping on the stored `createdAt` (the existing local-time basis, unchanged).

### 28.6 Minimal files requiring changes (STEP 2C.3B)

**Required — 1 production file, 3 lines, no new symbol:**

| # | File | Line | Change |
|---|------|------|--------|
| 1 | `src/services/report/report.service.ts` | **1354** (A-9) | replace `AND \`status\` <> 'CANCELLED' AND \`paymentStatus\` = 'PAID'` with `${revenueSetSql("\`order\`")}` (spacing normalised to `AND ${revenueSetSql("\`order\`")}`) |
| 2 | `src/services/report/report.service.ts` | **1798** (A-11) | replace the two lines with `${revenueSetSql("o")}` |
| 3 | `src/services/report/report.service.ts` | **2479** (A-12) | replace the two lines with `${revenueSetSql("o")}` |

No signature change, no new export, no new query, no schema change. Both fragments are already in scope (same module, defined at L545) and are already used by eight other call sites in the same file.

**Required, documentation-only (1 line, no behaviour):**

| # | File | Line | Change |
|---|------|------|--------|
| 4 | `src/app/api/reports/products/export/route.ts` | 28–30 (header comment) | the stale “**PAID +** non-cancelled only” wording must be corrected to the canonical revenue set; this is a comment edit only, and leaving it would re-document the defect after the fix |

**Test files (2C.3B, required):** `tests/accounting/revenue.integration.test.ts` — update scenario 11's A-9 expectation and add `getProductReport` / `getMultiOutletReport` scenarios (§28.7). Optionally `tests/README.md` (document the new coverage + retire the “known discrepancies” note).

**Decision required from the owner (NOT included in the 3-line fix):** whether 2C.3B should also collapse the six inline duplicates to `revenueSetSql` / `revenueWhere` (#3, #7, #8, #10, #26, #27 in §28.4). It is behaviour-neutral in principle, but it touches `profitability.service.ts` and `menu-engineering.service.ts` (outside the reporting file) and would enlarge the diff; recommendation: **yes, but as a separate, clearly-labelled commit inside 2C.3B or deferred to 2C.7 (code quality)** — see §28.10 item 7.

### 28.7 Regression test matrix (expectations only — no test is written in this phase)

All rows assume one tenant, one branch (all ten are re-runnable and tenant/branch scoped). `R$` = the report being asserted.

| # | Fixture | `getSalesReport` (A-9) | `getProductReport` (A-11) | `getMultiOutletReport` (A-12) |
|---|---------|------------------------|---------------------------|-------------------------------|
| 1 | Fully paid order (grandTotal 100 000, tax 10 000, 2 items) | `totalSales` 100 000 · `Σ dailySeries.sales` 100 000 · **`Σ busiestHours.revenue` 100 000** · `paidOrders` 1 | `products` contains both items · `qtySold` 2 · `grossSales` 60 000 (Σ item totalPrice) · `orderCount` 1 · product **not** in `unsoldProducts` | branch `orders` 1 · `totalSales` 100 000 · `orderType.<T>.count` 1, `.amount` 100 000 |
| 2 | Fully refunded order (200 000, all payments `REFUNDED`, mirror `UNPAID`) | `totalSales` 200 000 · `netSales` 0 · `totalRefund` 200 000 · `Σ dailySeries.sales` 200 000 · **`Σ busiestHours.revenue` 200 000 (was 0 — this is the A-9 assertion that flips)** | item present · `qtySold`/`grossSales` include it · `summary.orderCount` 1 · `soldProductCount` ≥ 1 (no longer 0-vs-1 contradiction) | branch `totalSales` 200 000 · **`Σ orderType[x].amount` 200 000** (equals branch total — the A-12 assertion) |
| 3 | Partially refunded order (collected 100 000, approved refund 30 000) | `totalSales` 100 000 · `netSales` 70 000 (product basis) · hourly includes it once | item counted once · `orderCount` 1 | branch total and order-type breakdown both include it once, amounts equal |
| 4 | Unpaid order (no payment) | absent from `totalSales`, `dailySeries`, `busiestHours`; present only in `totalOrders` (activity) | absent from `products`; if its product has no other sales → present in `unsoldProducts` **only if** the catalog product is active (canonical `soldWhere` excludes it) | absent from branch `orders`/`totalSales`/`orderType`; still in the branch list with zeros |
| 5 | Cancelled order with a `PAID` payment | excluded from every revenue figure (incl. hourly) | excluded | excluded |
| 6 | `PAID` payment with stale `UNPAID` order mirror, no refund | excluded from every revenue figure (order mirror authoritative) — hourly must agree with the Prisma aggregate | excluded from `products` and counted as unsold if active | excluded |
| 7 | Split tender / multiple `PaymentTransaction` rows on one order | counted once in `paidOrders`, hourly `orders` 1, revenue = one `grandTotal` | `orderCount` 1, `qtySold` not multiplied | `orders` 1 per branch |
| 8 | Tenant isolation (tenant B holds an identical fully-refunded order) | tenant A's three views must equal the single-tenant expectations exactly (row 2) | same | same |
| 9 | Branch isolation (`branchFilters` = branch 1; branch 2 holds an identical fully-refunded order; + an out-of-scope `branchId` attempt) | all three views scoped to branch 1; `authorizedBranches` unchanged | same | only branch 1 in `outlets`; branch 2's rows absent |
| 10 | Empty period | `totalSales` 0 · `busiestHours` `[]` · `dailySeries` densified zeros | `products` `[]` · `summary` zeros · all active catalog products in `unsoldProducts` | every branch present with zeros; `orderType` all zero |

**Invariants every row must also satisfy (the tests that make this class of bug impossible to reintroduce):**

1. `Σ dailySeries.sales === summary.totalSales === Σ busiestHours.revenue` (raw SQL hourly = raw SQL daily = Prisma aggregate) — extend the existing test 18, whose fixture (`s18d` = `UNPAID` mirror + `REFUNDED` payment) already makes the three disagree today.
2. `Σ busiestHours.orders === summary.paidOrders` (same revenue set, order count not item count).
3. `getProductReport().summary.orderCount === getSalesReport().summary.paidOrders` for the same window.
4. `Σ outlets[].orderType[x].amount === outlets[].totalSales` per branch (A-12).
5. `getProductReport().products` product set ⊇ every product in `getSalesReport().bestSellingProducts` for the same window (A-11 cross-report contradiction).
6. No product may be absent from both `products` and `unsoldProducts` (row 2’s silent-omission regression guard).

**Existing coverage that must change (deliberate, not a weakening):** revenue suite scenario 11 currently asserts `Σ busiestHours.revenue === 0` — that assertion *pins the defect*, and 2C.3B must flip it to `200000` while keeping every other expectation in the test. `getProductReport` and `getMultiOutletReport` have **zero** references under `tests/` today, so their scenarios are net-new coverage.

### 28.8 Security and tenant impact

* **Tenant isolation: unaffected.** All three defective queries already carry `restaurantId = <ctx tenant>`; the fix composes a predicate that only *adds* an `OR EXISTS` against `payment` joined by `pm.orderId = <alias>.id` — no cross-tenant join path is introduced (a `payment` row referenced this way belongs to the same order, hence the same tenant).
* **Branch authorization: unaffected.** The three queries keep `${branchFragment(...)}` / `AND o.branchId IN (...)`; the fix does not touch branch scoping. This is an environment/authorization predicate resolved server-side from the session, and it stays authoritative.
* **Blast radius is strictly *more* rows in three read-only aggregates** — no new data is exposed beyond what the same report already returns for the same order (its own product, its own branch, its own hour). No PII, no cost/HPP data, no cross-scope sample ids.
* **No authorization/validation surface change:** no route signature, no query schema, no CSV column change.

### 28.9 Database and migration impact

**None.** All three sites are read-only `SELECT`s over existing columns (`order.paymentStatus`, `order.status`, `payment.status`, `payment.orderId` + the existing `payment_orderId_idx`/`order_restaurantId_createdAt` style indexes). No new column, index, constraint, backfill or data repair; no migration file is touched; nothing needs to run against 3306/3307/3308. The fix cannot change stored data and does not require the F-5/F-6/F-8 questions to be resolved first. (Note: correctness of the *numbers* still depends on the data being consistent with §28.5 — e.g. an order whose mirror was never reset while its payments are `REFUNDED` is handled by the canonical rule’s `OR EXISTS` half, which is exactly why the rule is written that way.)

### 28.10 Implementation plan for STEP 2C.3B (FIX A-9/A-11 + REGRESSION — not started)

1. **Snapshot the three predicate lines** (copy L1352–L1356, L1796–L1800, L2477–L2481 into the phase report) so the change is auditable and rollback is exact.
2. **Apply the 3-line fix** in `src/services/report/report.service.ts` only: `busiestHours` L1354 → `${revenueSetSql("\`order\`")}`; product rows L1798 → `${revenueSetSql("o")}`; multi-outlet order-type L2479 → `${revenueSetSql("o")}`. Do **not** touch `revenueWhere` / `revenueSetSql` / `paidRevenueSql` themselves, and do not change any threshold, severity or money formula. Correct the stale `PAID +` wording in the products-export route comment (§28.6 #4) in the same step — comment only.
3. **Type-check** (`npx tsc --noEmit`) and **build** before running tests.
4. **Update the existing expectations that pin the defect** — revenue suite scenario 11: `Σ busiestHours.revenue` `0 → 200000` (and add the same-day `Σ busiestHours.orders === 1` companion assertion). Extend test 18 (the mixed-window canonical-vs-SQL test) to assert `busiestHours` alongside `dailySeries`, since its fixture already contains the `UNPAID`-mirror + `REFUNDED`-payment order that today makes them disagree.
5. **Add net-new scenarios** for the three views using §28.7 rows 1–10 + invariants 1–6, in the revenue suite (same fixtures/factories already in use: `mkOrder`, `mkPayment`, `mkRefund`, `D.<day>`, `sales()`, `range()`); add a `getProductReport` helper and a `getMultiOutletReport` helper to that suite. Tenancy/branch cases reuse the existing isolation helpers.
6. **Run the regression:** revenue suite (baseline 19 → ≥19, sequentially), then the other four integration suites (15/21/24/29) — they consume the same service and must stay green — then the M2 unit suite (57). Capture real exit codes and pass counts; any failure is preserved and classified before any further edit.
7. **Optional, only if the owner approves in the 2C.3B plan:** collapse the six remaining inline duplicates (§28.4 #3/#7/#8/#10 in `report.service.ts`, #26 in `profitability.service.ts`, #27 in `menu-engineering.service.ts`) to the canonical fragments. Behaviour-neutral in principle; if approved it must be a separate labelled step inside the same phase with its own before/after evidence, or deferred to 2C.7.
8. **Report** §29 with: the three-line diff, per-scenario results, the invariant assertions, exit codes, and an explicit statement that no other predicate changed.
9. **Explicitly out of scope for 2C.3B:** any change to the canonical revenue definition, any change to refund math, `/api/reports/sales` shape, cashbook/payment-ledger semantics (§28.4 #19–#21), and anything belonging to 2C.4–2C.9.

### 28.11 Risks and rollback

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| A previously-passing assertion flips (scenario 11 is the known one) | Certain | Low | Expected and enumerated in §28.10 item 4; the flip is the fix’s purpose, and every other expectation in the test is preserved |
| A fully-refunded order now appears in three more views → different totals for tenants with refunds | Certain (by design) | Low–Medium | Intended: those views join the revenue set the summary already used; the change makes views *consistent*, not the revenue larger (a fully refunded order adds revenue **and** an equal refund, `netSales` unchanged) |
| Hidden dependence on the old (wrong) numbers | Possible | Low | Grep shows the three views are used only by `getSalesReport`, `getProductReport`, `getMultiOutletReport` and their API/export routes; no test asserts them except scenario 11 |
| Performance: the added `OR EXISTS (… payment …)` per row | Very low | Low | The canonical fragment is already used by eight call sites in the same file over the same tables (incl. the daily series in the same request), and `payment(orderId, status)` is indexed |
| `filters.paymentMethod` interaction | Low | Info | The method sub-filter requires a `PAID` payment of that method; the canonical Prisma predicate behaves identically (`payments.some({ method, status: PAID })`), so no new inconsistency is created — but a fully-refunded order is excluded by a method filter in both layers (consistent, documented, unchanged) |
| Scope creep into unrelated predicate copies | Medium if unmanaged | Low | §28.10 item 7 keeps it a separate, approved step |

**Rollback:** revert three SQL fragments in one file (the pre-change lines are captured verbatim in §28.10 item 1 and in §28.2/§28.3). No data, schema, migration or config exists to undo; the change is read-only and cannot corrupt state.

### 28.12 Updated master roadmap tracker

| Phase | Scope | Status |
|-------|-------|--------|
| **2C.3A** | **Audit A-9/A-11 reporting consistency** | **✅ DONE (this phase) — 3 drift sites (A-9 L1354, A-11 L1798, **A-12 NEW** L2479), 6 duplication sites, root causes traced, 10-row test matrix + invariants prepared; no code/test/DB change** |
| 2C.3B | Fix A-9/A-11 (+ A-12) + regression | ⏳ **NOT STARTED — awaiting approval** |
| 2C.4 | F-2 database connection | ⏳ not started |
| 2C.5 | F-5 / M-1 / M-2 cutoff | ⏳ not started |
| 2C.6 | F-6 / F-8 / migration compatibility | ⏳ not started |
| 2C.7 | Code quality + lint | ⏳ not started |
| 2C.8 | Full regression + UAT | ⏳ not started |
| 2C.9 | Production release | ⏳ not started *(blocked: nothing below is green yet)* |

Verified baseline carried forward **unchanged and NOT rerun in this phase:** migration replay 22/22 · accounting integration 108/108 · M2 unit 57/57 · TypeScript PASS · production build PASS (all as reported in §26–§27).

### 28.13 Final Git status

```
$ git status --porcelain=v1 | wc -l
19
$ git status --porcelain=v1
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? tests/
```

**19 entries — byte-identical to §28.1** (`.env.test` is gitignored, `tests/` remains a single untracked entry). This audit changed **one** file: `ACCOUNTING-INTEGRATION-TEST-PLAN.md` (this section). No production file, no test file, no migration, no config, no database was written. No commit, push, merge or deploy.

### 28.14 Explicit STOP and approval gate

**STEP 2C.3A STOPS HERE — audit findings only.**

**Confirmed:** A-9 and A-11 are **predicate drift**, not business-rule disagreements. The canonical rule (`revenueWhere` / `revenueSetSql`) is correct and untouched; three raw SQL fragments were never migrated to it — `busiestHours` (`report.service.ts:1354`), `getProductReport` product rows (`:1798`), and **a new third instance** in `getMultiOutletReport`’s per-branch order-type breakdown (`:2479`, recorded here as **A-12**). Six further sites duplicate the canonical predicate inline (correct today, drift-prone). The fix is **3 lines in one file**, no schema, no migration, no data change, no security/isolation change.

**Corrections to earlier documentation (recorded, not silently changed):**

* §21.4’s A-11 wording (“can be listed as *unsold*”) is **inaccurate** — the real failure mode is omission from *both* `products` and `unsoldProducts` (§28.3 item 2).
* §21.1’s “two exceptions” becomes **three** (A-9, A-11, A-12).
* `getSalesOrdersForExport` is an activity listing with no revenue figure and no canonical set (intentional but previously undocumented) — §28.4 #21.

**Not started, awaiting explicit approval:** STEP 2C.3B (the fix + regression), the optional duplication cleanup (§28.10 item 7), and everything from 2C.4 onward. **Production readiness remains 🚫 NOT READY FOR PRODUCTION.**
