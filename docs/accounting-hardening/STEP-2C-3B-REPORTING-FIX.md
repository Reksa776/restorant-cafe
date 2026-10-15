# STEP 2C.3B — Reporting Predicate Consistency FIX (A-9 / A-11 / A-12)

**Status:** ✅ COMPLETE — fix applied, focused regression added, full suite sweep green
**Mode:** minimal, authorized fix only — canonical revenue eligibility and refund mathematics **frozen**

## 1. Scope and authorization

Approved scope (implementation + focused regression):

| Allowed | Done |
|---------|------|
| The three confirmed predicate-drift sites in `src/services/report/report.service.ts` | ✅ A-9, A-11, A-12 |
| Reuse the existing canonical `revenueSetSql` helper | ✅ (no new predicate, no new symbol) |
| Correct the stale comment in `src/app/api/reports/products/export/route.ts` | ✅ comment only |
| Update assertions that intentionally pinned the old A-9 behaviour | ✅ test 11 (+ test 18 hardening) |
| Add focused coverage for A-11 and A-12 | ✅ tests 19 and 20 |
| Optional six-site duplication cleanup | ⛔ **not done** (explicitly out of scope) |

**Frozen / untouched:** `revenueWhere`, `revenueScopeWhere`, `revenueSetSql`, `paidRevenueSql`,
`productRevenueSql`, `refundRevenueSql`, `approvedRefundsSql`, `computeRefundRevenue`,
`computeCustomerRevenue`, all refund/cancellation rules, all money formulas, prices, severities and
API contracts. No schema or migration change. No M2 production file touched. No test-infrastructure
change (`tests/setup.ts` guard untouched). No commit/push/merge/deploy.

## 2. Git status

| Moment | Entries | Composition |
|--------|---------|-------------|
| Phase start | **19** | identical to the archive §28.13 baseline |
| Phase end | **22** | + `src/services/report/report.service.ts`, + `src/app/api/reports/products/export/route.ts` (the two authorized files), + `?? docs/` (this directory) |

Everything else (4 §25 migrations, 4 M2 files, `.env.example`, `.gitignore`, the 8 untracked docs,
`.env.test.example`, `tests/`) is unchanged from phase start. `git diff --check` **exit 0**.
`next-env.d.ts` was rewritten by the mandated `npm run build` and **restored to HEAD** afterwards.

## 3. The fix (production)

`src/services/report/report.service.ts` — three sites, each replacing a hand-written PAID-only pair
with the canonical fragment that already existed in the same module:

| Site | Before | After | Current line |
|------|--------|-------|--------------|
| **A-9** `busiestHours` (hourly raw SQL) | `AND \`status\` <> 'CANCELLED'` + `AND \`paymentStatus\` = 'PAID'` | `AND ${revenueSetSql("\`order\`")}` | **1355** |
| **A-11** `getProductReport` product rows | `AND o.\`status\` <> 'CANCELLED'` + `AND o.\`paymentStatus\` = 'PAID'` | `AND ${revenueSetSql("o")}` | **1802** |
| **A-12** `getMultiOutletReport` order-type rows | `AND o.\`status\` <> 'CANCELLED'` + `AND o.\`paymentStatus\` = 'PAID'` | `AND ${revenueSetSql("o")}` | **2485** |

Diff: 2 files, **17 insertions / 10 deletions** — the six replaced lines plus a short explanatory
JS comment above each site (outside the SQL template) so the drift cannot silently return.

`src/app/api/reports/products/export/route.ts` (comment only): the header no longer documents
“(PAID + non-cancelled only)”; it now states the canonical revenue set composed from
`revenueSetSql`, matching the code directly below it.

> **Note on the first attempt:** the explanatory comments were initially placed *inside* the SQL
> template literals, which broke the template (backticks) and would also have emitted invalid SQL.
> `tsc --noEmit` caught it immediately (`TS1005`); the comments were moved outside the templates and
> `tsc` returned to exit 0. No query ever ran in that state.

## 4. Regression coverage

`tests/accounting/revenue.integration.test.ts` (suite baseline **19 → 21** tests):

| Change | Detail |
|--------|--------|
| Test 11 (A-9 pin) | `Σ busiestHours.revenue` **0 → 200000** for the fully-refunded order, plus `orders === 1` and `hourly === summary.totalSales`. The old value deliberately pinned the defect. |
| Test 18 (canonical vs SQL) | added the hourly checks next to the daily ones. Its fixture already contained the disagreeing case (order mirror `UNPAID` + `REFUNDED` payment) and read **40 000 / 2** before the fix. |
| **Test 19 (new, A-11)** | full 10-case matrix in one window: fully paid, fully refunded, partially refunded, unpaid, cancelled-with-PAID-payment, stale `UNPAID` mirror with a PAID payment, split tender + two `PaymentTransaction` rows, and tenant B holding the same shape. Asserts `summary.orderCount = 5`, `soldProductCount = 3`, `qtySold = 7`, `grossSales = 94 000 = sales.totalSales`, per-product rows (A 3/30 000, B 3/60 000, **C 1/4 000 — sold only on a refunded order**), product C absent from `unsoldProducts` (never in both lists), every `bestSellingProducts` entry present, and that tenant B sees only its own refunded order (9 000). |
| Test 16 (empty period) | extended so matrix row 10 covers all three views, not just the sales report: `getProductReport` returns zeroed summary + `products: []` + the whole active catalog (A/B/C) as `unsoldProducts`, and every `getMultiOutletReport` outlet is zeroed with a still-adding-up order-type breakdown. |
| **Test 20 (new, A-12)** | per-branch order-type breakdown: paid DINE_IN 50 000 + fully refunded TAKEAWAY 20 000 → `Σ orderType.amount === totalSales` (70 000); excluded unpaid / cancelled / stale-mirror orders never reach `orders`, `totalSales` or the breakdown; summary totals (3 orders / 82 000 / net 62 000); branch scoping (`[BR_A1]`, `[BR_A2]`, and a foreign tenant's branch id → `outlets []`); A-9 cross-check on the same data (hourly = daily = 70 000, net 50 000). |

New day windows **oct22 / oct23** were used on purpose: the existing test 16 asserts oct20–oct21 is
empty, so reusing that window would have made the new fixtures collide with an existing contract.

### 4.1 Mutation check — the new tests actually detect the defect

With the service temporarily reverted to `HEAD` (PAID-only) and everything else identical:

```
ℹ tests 21 · pass 17 · fail 4 · exit 1
✖ 11. a full refund nets the order to zero                      actual 0        expected 200000
✖ 18. Prisma revenueWhere and the SQL predicates agree           actual 40000    expected 60000
✖ 19. the product report aggregates the canonical revenue set    actual 2        expected 3        (soldProductCount — product C missing)
✖ 20. the multi-outlet order-type breakdown …                    TAKEAWAY {0,0}  expected {1,20000}
```

The fixed service was then restored (md5 `f0c85f2e9369f85d457c106000d5e3bc`, verified against the
backup copy) and the suite returned to 21/21. This proves the assertions are not vacuous and that
each of A-9, A-11 and A-12 is individually covered.

## 5. Regression results (sequential, isolated v3 only)

`NODE_ENV=test`, one file at a time, `2026-10-14T15:52+07:00`, real exit codes:

| # | Suite | Previous baseline | Result | exit | pass | fail | skipped |
|---|-------|-------------------|--------|------|------|------|---------|
| 1 | Cashbook | 15 | ✅ | **0** | **15** | 0 | 0 |
| 2 | Revenue & Reporting | 19 | ✅ | **0** | **21** | 0 | 0 |
| 3 | Refund & Profitability | 21 | ✅ | **0** | **21** | 0 | 0 |
| 4 | P&L | 24 | ✅ | **0** | **24** | 0 | 0 |
| 5 | M2 Integrity | 29 | ✅ | **0** | **29** | 0 | 0 |
| | **Integration total** | 108 | ✅ | — | **110** | **0** | **0** |
| 6 | M2 unit (`integrity.unit.test.ts`) | 57 | ✅ | **0** | **57** | 0 | 0 |

The 108 → 110 delta is exactly the two new tests; no existing test was weakened, skipped or
removed. (Test 16 gained assertions without changing the count.) After the last test edit the
revenue suite was re-run on its own: **21/21, exit 0**, and `tsc --noEmit` **exit 0**.

## 6. Cleanup, tenant isolation and branch isolation

| Check | Evidence |
|-------|----------|
| Database-level before/after | identical: 48 id-bearing tables, **22** ledger rows, F.5 `finished_at` unchanged (`2026-10-14 07:52:58.220`), **0** business rows, **no** non-zero table |
| Per-suite cleanup | each suite's own `cleanupRun()` / `findResiduals()` + `afterCounts deepEqual baseline` passed (all `0 → 0` on the 21 monitored tables) |
| Tenant isolation | existing tests 14/15 still green; new test 19 verifies tenant B sees only its own fully-refunded order (1 order, 9 000) while tenant A's figures are unchanged |
| Branch isolation | existing tests 15 plus new test 20: explicit `[BR_A1]` / `[BR_A2]` scopes return only that branch, and a **foreign tenant's branch id returns `outlets: []`** (no leak, no widening) |
| No foreign writes | only `127.0.0.1:3308/restaurant_app_test_v3` was addressed (fail-closed guard active); nothing written to 3306, 3307, v1 or v2 |

## 7. Static verification

| Check | Command | Result |
|-------|---------|--------|
| TypeScript | `npx tsc --noEmit` | **exit 0** (also caught and fixed the template-literal mistake, §3) |
| Production build | `npm run build` | **exit 0** (Next 16.3.3, all routes). Side effect: regenerated the tracked `next-env.d.ts` → **restored to HEAD**, so the working tree matches the phase start plus the two intended files |
| Lint, phase-touched files | `npx eslint src/services/report/report.service.ts src/app/api/reports/products/export/route.ts tests/accounting/revenue.integration.test.ts` | **exit 0** — 0 errors; 2 warnings (`reportActivityWhere`, `orderFragment` unused) which are **pre-existing** (each occurs exactly once — the definition only — in both `HEAD` and the working copy) |
| Lint, whole project (debt baseline) | `npm run lint` | exit 1 with **245 problems (106 errors / 139 warnings)** — byte-identical to the count measured before this phase (§27.13), i.e. **zero new lint problems introduced** |
| Diff hygiene | `git diff --check` | **exit 0** |
| Whitespace | trailing / tabs / CRLF on the three changed files | **0 / 0 / 0** |

## 8. Restriction compliance

| Restriction | Status |
|-------------|--------|
| No unrelated refactoring | ✅ only the 3 sites + 1 comment |
| No M2 production-file changes | ✅ mtimes unchanged (`2026-10-10`), no diff |
| No migration/schema edits | ✅ `prisma/` untouched this phase |
| No test-infrastructure changes | ✅ `tests/setup.ts`, `tests/fixtures/*` untouched |
| No writes to 3306/3307/v1/v2 | ✅ v3 only |
| No global lint cleanup | ✅ 245 pre-existing problems left as-is |
| No commit/push/merge/deploy | ✅ |
| Stop after 2C.3B | ✅ 2C.4 not started |

## 9. Open blockers after this phase

| ID | Status |
|----|--------|
| **A-9 / A-11 / A-12** | ✅ **FIXED and covered** (tests 11, 18, 19, 20; mutation-verified) |
| Six hand-rolled canonical-predicate duplicates | ⚠️ open by instruction (out of scope) — candidates for 2C.7 |
| **F-2** database connection | ⏳ 2C.4 |
| **F-5 / M-1 / M-2** cutoff | ⏳ 2C.5 |
| **F-6 / F-8** migration compatibility | ⏳ 2C.6 |
| Production readiness | 🚫 **NOT READY FOR PRODUCTION** |

## 10. Next phase

**2C.4 — F-2 database connection** (not started; requires explicit approval).

## 11. Artifacts

- Fixed: `src/services/report/report.service.ts`, `src/app/api/reports/products/export/route.ts`
- Tests: `tests/accounting/revenue.integration.test.ts` (1651 lines, 21 tests)
- Reports: `docs/accounting-hardening/ROADMAP.md`, `STEP-2C-3A-REPORTING-AUDIT.md`, this file
- Logs/evidence (outside the repo): `/tmp/c23b-logs/*` (per-suite logs + summary + DB before/after),
  `/tmp/c23b-revenue-prefix.log` (mutation run)
