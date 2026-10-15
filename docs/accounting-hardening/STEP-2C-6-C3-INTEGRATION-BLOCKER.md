# STEP 2C.6 — C3 INTEGRATION BLOCKER (AP-C3-COMMIT NOT EXERCISED)

**Subphase of 2C.6 · mode: AUTHORISED DB TEST RUN · C3 NOT STAGED, NOT COMMITTED · NO FIX APPLIED**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD | `7dc2496a6a10ffa5c5ad268f769601389d2d7cba` (C2) — unchanged |
| Branch | `main` |
| Authorisations used | **AP-C3-DB-TEST** (target + container start) · **AP-C3-COMMIT (conditional)** |
| Verdict | ❌ **BLOCKED — NO COMMIT** (conditional-commit condition 2 not met) |

> **What was done.** The approved test container was started, the live target identity was verified, and the
> unit + integration suites were run against it. **No source, test, assertion, guard or historical report was
> modified**; nothing was staged or committed; 3306/3307 were never contacted; the application `.env` was untouched.

---

## 1. Authorisation scope actually exercised

| Allowed by AP-C3-DB-TEST | Used? |
|---|---|
| Start the existing `restaurant-mariadb-test` container | ✅ (`docker start`, existing container only — no recreate, no volume op) |
| Verify database identity before testing | ✅ (read-only `SELECT`) |
| Run the accounting integration suites + F-2 live regression | ✅ |
| Test-data operations on disposable v3 only, via existing mechanisms | ✅ (existing suites' own fixtures/cleanup) |
| Clean up only data created by this run | ✅ (suite cleanup; residual **0**) |

Not done (not permitted): recreate/remove container or volume, migration/reset/truncate/schema mutation, 3306/3307
access, `.env` edits, v1/v2 use, test/assertion edits to force a PASS.

---

## 2. Target identity verification (before any test) — **PASS**

Read-only probe against the target (credentials never printed):

```
host target   : 127.0.0.1:3308/restaurant_app_test_v3 user=restaurant_test_v3
live identity : {"db":"restaurant_app_test_v3","usr":"restaurant_test_v3@172.18.0.1","srvPort":"3306","ver":"11.8.9-MariaDB-ubu2404"}
live counts   : tables=49 ledgerRows=22 finishedRows=22 unfinishedOrRolledBack=0
identity checks: host_port_is_3308=OK host_is_127_0_0_1=OK active_vars_agree=OK live_db_is_v3=OK
                 live_user_is_dedicated=OK is_mariadb_11_8=OK not_legacy_v1_v2=OK
IDENTITY VERDICT: PASS (exit 0)
```

`@@port` is `3306` **inside** the container by design (the host binding is 3308) — matching the documented
convention in `tests/setup.ts`, which deliberately does not assert the in-container port. `.env.test` references
`127.0.0.1:3308` only (both active vars), never 3306/3307.
Container state: `restaurant-mariadb-test | mariadb:11.8 | Up | 127.0.0.1:3308->3306/tcp`.
`RestartCount=0` (the container was **not** restarted, so the v3 volume is untouched).

**Healthcheck observation (not a DB fault).** `docker inspect` reports `Health=unhealthy, FailingStreak=32`, but the
health log shows `/bin/sh: 1: mysqladmin: not found` (exit **127**) — the image's healthcheck is
`mysqladmin ping -h localhost` and that binary is **absent from the image**. The database itself is fully functional:
identity verified, 49 tables, and every connecting suite passed. This is a **broken healthcheck definition**, recorded
for the release gate, and it did not affect the test results.

---

## 3. Gate results — actual exit codes

| # | Gate | Command | Expected | **Actual** | Result |
|---|---|---|---|---|---|
| 1 | Target identity | read-only probe | PASS | **exit 0** | ✅ |
| 2 | F-2 unit | `npx tsx --test src/lib/database-url.unit.test.ts` | 24/24 | **exit 0** — pass 24, fail 0 | ✅ |
| 3 | M2 unit | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | 78/78 | **exit 0** — pass 78, fail 0 | ✅ |
| 4 | TypeScript | `npx tsc --noEmit` | exit 0 | **exit 0** | ✅ |
| 5 | Migration preflight | `npm run db:preflight` | 22/22 | **exit 0** — PASS | ✅ |
| 6 | Fingerprint 13/13 | `sha256sum` vs C3 readiness §3 | match | **13/13 EXACT MATCH** | ✅ |
| 7 | F-2 live regression | `npx tsx --test tests/database-connection.integration.test.ts` | 4/4 | **exit 0** — pass 4, fail 0 | ✅ |
| 8 | cashbook | `npx tsx --test tests/accounting/cashbook.integration.test.ts` | pass | **exit 1 — pass 14, fail 1** | ❌ |
| 9 | revenue | `npx tsx --test tests/accounting/revenue.integration.test.ts` | pass | **exit 0** — pass 21, fail 0 | ✅ |
| 10 | refund-profitability | `npx tsx --test tests/accounting/refund-profitability.integration.test.ts` | pass | **exit 1 — pass 20, fail 1** | ❌ |
| 11 | pnl | `npx tsx --test tests/accounting/pnl.integration.test.ts` | pass | **exit 0** — pass 24, fail 0 | ✅ |
| 12 | integrity (live) | `npx tsx --test tests/accounting/integrity.integration.test.ts` | pass | **exit 0** — pass 30, fail 0 | ✅ |

**Totals: 98 pass / 2 fail** across the accounting suites (110 + the 4 F-2 live). Both failures reproduce
**deterministically** (cashbook re-run: 14/15, fail 1, identical assertion).

### Exact failures

```
✖ 10. a refund is dated by approvedAt (not createdAt)
  tests/accounting/cashbook.integration.test.ts:751
  AssertionError: a refund's createdAt is not a cash movement
  1 !== 0   (actual 1, expected 0)

✖ 10. the PaymentTransaction mirror is not counted again as refund impact
  tests/accounting/refund-profitability.integration.test.ts:1059
  AssertionError: the Refund row is counted once
  350000 !== 40000   (actual 350000, expected 40000)
```

---

## 4. Root-cause analysis

### 4.1 What is ruled out (measured evidence)

| Candidate | Evidence | Verdict |
|---|---|---|
| Introduced by **C1 / C1B** | those commits touched only 4 migration SQL files and the `tools/` guard + `package.json`/`README.md`; no runtime module used by these suites | **ruled out** |
| Introduced by **C2** | every C2 file was last modified **2026-10-14 15:51–16:46**, i.e. **before** the 2C.5 green run (report written 17:04); all four implicated services (`cashbook.service.ts`, `profitability.service.ts`, `cashier-sales.service.ts`, `report.service.ts`) are **clean vs HEAD** | **ruled out** |
| Test drift since the green run | the failing test files' mtimes are **2026-10-14 15:10 / 15:10:07** — again **before** the 17:04 green run | **ruled out** |
| Residual/leftover data | live snapshot after the runs: `order=0 payment=0 refund=0 expense=0 user=0 branch=0 restaurant=0 product=0`; each suite's own cleanup reports **0 residual** | **ruled out** |
| DB structure/identity drift | identity PASS; 49 tables; 22 ledger rows, all finished, 0 unfinished/rolled back | **ruled out** |

Note on my own earlier probe: a transient `errno 1146` on `refundItem` was **my query's fault** (this database has
`lower_case_table_names=0`, real names are `refund`, `refunditem`, `paymenttransaction`, …). It is **not** a DB defect.

### 4.2 Leading root cause — a **calendar-dependent isolation defect in the C3 test fixtures**

Both failures are the same shape: *a row created by an earlier test in the same file is visible in a
hardcoded-2026-10-15 report window on 2026-10-15.*

* The fixture helpers write approval timestamps with **`new Date()`** (e.g. `approvedAt: new Date()` in
  `tests/fixtures/accounting.ts:186,217`) — i.e. **today**.
* The failing assertions query a **hardcoded** date: the profitability test calls `profit("2026-10-15")`, and the
  cashbook test filters `dateFrom/dateTo = D.oct15 = "2026-10-15"`.
* On 2026-10-14 (the last green run) the `2026-10-15` window was **empty**, so both suites passed.
  On **2026-10-15** (today) that window now contains every row earlier tests stamped with `new Date()`
  → the cashbook sees **1** movement it does not own, and the profitability report sums **350000** of refund
  impact instead of its own **40000**.
* This also explains why the failures are confined to refund/date attribution and why the other three suites
  (which use fixed historical dates or ledger-based assertions) still pass.

**Class:** a **time-bomb in the test suite** (calendar-dependent test-isolation), not a product-code regression and
not a database fault. **Status:** leading hypothesis, strongly supported by the mtime/cleanliness evidence and the
`new Date()` vs hardcoded-window construction — but **not yet proven case-by-case** (that would require running a
targeted, evidence-only reproduction, or reading the remaining helper defaults in detail).

### 4.3 Consequence for the project

* **C3's integration acceptance is NOT satisfied.** The conditional AP-C3-COMMIT requires *all* accounting suites to
  PASS; condition 2 failed, so the commit is **not authorised** and was **not** performed.
* The 2C.5 record "accounting integration **111/111**" is **not contradicted** — it was measured on 2026-10-14, when
  the `2026-10-15` window was still in the future.
* Fixing this needs an owner decision, because the fix territory is **test files** (which this checkpoint is forbidden
  to edit) and possibly the fixture date defaults.

---

## 5. Risks

| ID | Risk | Severity |
|---|---|---|
| B-1 | Committing C3 now would freeze a test suite that cannot pass on its own fixture dates | High |
| B-2 | The same calendar-dependent pattern may exist in other suites/fixtures (only two surfaced) | Medium |
| B-3 | Any fix touches test files/assertions — explicitly outside this checkpoint's authority | Medium |
| B-4 | The test container is now **running** (started under AP-C3-DB-TEST); it was `Exited` before | Low |
| B-6 | The container's healthcheck can never pass (`mysqladmin` missing from the image → exit 127) | Low |
| B-5 | The 111/111 historical figure must not be re-quoted as a fresh PASS | Medium |

---

## 6. Verdict and next approval gate

### ❌ BLOCKED — NO COMMIT

* All **pre-staging gates PASS** (identity · F-2 unit 24/24 · M2 unit 78/78 · `tsc` 0 · preflight 22/22 ·
  fingerprint 13/13 · F-2 live 4/4), and three of five accounting suites PASS
  (revenue 21/21 · pnl 24/24 · integrity 30/30).
* **Two suites FAIL** — cashbook (14/15) and refund-profitability (20/21) — on refund date attribution, with the
  leading root cause being a **calendar-dependent test-isolation defect**, not a code or DB regression.
* Therefore: **nothing staged, no commit**, and per the dependency rule **C4 FINAL READINESS was not started**.
* No automatic repair was attempted, as instructed.

| Gate | Status |
|---|---|
| **AP-C3-COMMIT (conditional)** | ⏸ **NOT EXERCISED** — condition 2 (all accounting suites PASS) failed |
| **New decision needed** | how to proceed on the two failing suites (fix tests/fixtures under a new approval, or accept a documented test-side defect) |
| AP-C4-COMMIT | ⏸ blocked (needs C3 committed) |
| AP-3 / AP-B2 / AP-B3 / AP-4 / AP-2 | ⏸ still open |

**STOP.** No staging, no commit, no test edit, no migration, no deployment, no STEP 2C.7.

---

## Appendix A — Commands and real exit codes

| # | Command | Exit |
|---|---|---|
| 1 | `docker ps -a --filter name=restaurant-mariadb-test` (pre-state) | 0 (Exited (0)) |
| 2 | `docker start restaurant-mariadb-test` | **0** |
| 3 | TCP wait on `127.0.0.1:3308` | 0 (ready in 1 s) |
| 4 | identity probe (read-only `SELECT … DATABASE()/USER()/VERSION()`, counts) | **0** (PASS) |
| 5 | `npx tsx --test src/lib/database-url.unit.test.ts` (`PIPESTATUS`) | **0** (24/24) |
| 6 | `npx tsx --test src/services/accounting/integrity.unit.test.ts` (`PIPESTATUS`) | **0** (78/78) |
| 7 | `npx tsc --noEmit` | **0** |
| 8 | `npm run db:preflight` (`PIPESTATUS`) | **0** (PASS 22/22) |
| 9 | `sha256sum` × 13 + sorted diff vs readiness fingerprint | **0** (13/13 match) |
| 10 | `npx tsx --test tests/database-connection.integration.test.ts` | **0** (4/4) |
| 11 | `npx tsx --test tests/accounting/cashbook.integration.test.ts` | **1** (14/15) |
| 12 | `npx tsx --test tests/accounting/revenue.integration.test.ts` | **0** (21/21) |
| 13 | `npx tsx --test tests/accounting/refund-profitability.integration.test.ts` | **1** (20/21) |
| 14 | `npx tsx --test tests/accounting/pnl.integration.test.ts` | **0** (24/24) |
| 15 | `npx tsx --test tests/accounting/integrity.integration.test.ts` | **0** (30/30) |
| 16 | cashbook re-run (determinism) | **1** (14/15, same assertion) |
| 17 | residual-data snapshot (read-only) | 0 (all 0) |
| 18 | timezone facts (read-only) | 0 (`system_time_zone=UTC`, session `SYSTEM`, process `+0700`) |
| 19 | mtime evidence for C2 source + test files | 0 (all predate the green run) |
