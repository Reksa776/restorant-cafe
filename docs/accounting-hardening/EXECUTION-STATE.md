# EXECUTION-STATE — Accounting Hardening (continuation file)

> **Purpose.** A small, single-source continuation file so a new agent session can resume without re-auditing.
> It is **not** a substitute for the phase reports. Keep it short; link to reports for detail.
> Master prompt: “MASTER EXECUTION — ACCOUNTING HARDENING”. Historical reports are **read-only**.

| | |
|---|---|
| Last updated | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| Branch | `main` |
| Last verified HEAD | `4550d28a9213c06de39f332ae2c07bc2a0cab5f9` (C3) |
| Index / stash | empty / empty (`git diff --check` exit 0) |

## Current checkpoint

**C3 SCOPED TEST FIX + CONDITIONAL COMMIT (AP-C3-TEST-FIX → AP-C3-COMMIT) — DONE; RESULT: ✅ ALL TESTS PASS, C3 COMMITTED.**
Report: [`STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md`](./STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md).
C3 is **closed**; **C4 FINAL READINESS** has been prepared (exact manifest + report, see
[`STEP-2C-6-C4-FINAL-READINESS.md`](./STEP-2C-6-C4-FINAL-READINESS.md)) and is **STOPPED before staging**, because
**AP-C4-COMMIT has not been granted**.

## Resolved blocker (was: C3 integration failures)

| Suite | Before | After |
|---|---|---|
| `tests/accounting/cashbook.integration.test.ts` | **14/15** (exit 1) — line 751 `1 !== 0` | **15/15** (exit 0) |
| `tests/accounting/refund-profitability.integration.test.ts` | **20/21** (exit 1) — line 1059 `350000 !== 40000` | **21/21** (exit 0) |

**Proven root cause** (replaces the earlier “leading hypothesis”): a **run-date leak** in the C3 tests, not a product or
database fault. (a) Cashbook **test 3** settles a payment through the **real** `PaymentService.markCashierPaymentPaid`,
which stamps `paidAt = new Date()`; the suite cleans only in `after()`, so that movement survived into test 10, which
asserts a **hardcoded** `2026-10-15` window is empty — true only while the run date is not 2026-10-15. (b) The
profitability suite had the same shape: seven `const createdAt = new Date()` fixtures plus `decideRefund`'s
`approvedAt = now` put 310000 of foreign refund impact into test 10's `profit("2026-10-15")`.
`tests/fixtures/accounting.ts` was **investigated and cleared** — its `createFullRefund`/`createLegacyRefund` use
`new Date()` but have **zero call sites** (`tests/README.md:416-418` calls them obsolete); it is byte-identical.

**Fix (test-only, 2 of the 13 C3 paths):** cashbook `D.oct3`/`T.oct3` + test 3 relocates the live stamp onto that
dedicated day (documented FIXTURE MANEUVER, the technique `pnl.integration.test.ts` already uses); the profitability
suite gained `pinRefundDay()`/`pinTo`, all **10** clock-derived fixture timestamps became per-test dedicated days
(Oct 1/3/4/5/6/7/8/9/11/14) and **9** approvals were relocated onto them. No expected value, window, skip, `.only`,
suppression or product-code line was changed.

## Completed checkpoints / phases

| Phase | Status | Evidence |
|---|---|---|
| STEP 2C.3A / 2C.3B / 2C.4 / 2C.5 | ✅ complete | respective reports |
| STEP 2C.6 audit + F-6/F-8 | ✅ complete (audit) | `STEP-2C-6-MIGRATION-COMPATIBILITY.md` |
| C1 — F-7 migration repair | ✅ **COMMITTED `350afec`** | `STEP-2C-6-C1-COMMIT-EXECUTION.md` |
| C1B — migration preflight guard | ✅ **COMMITTED `cd3d849`** | `STEP-2C-6-C1B-COMMIT-EXECUTION.md` |
| C2 — accounting source boundary (11) | ✅ **COMMITTED `7dc2496`** | `STEP-2C-6-C2-COMMIT-EXECUTION.md` |
| C3 — tests + test infra (13) | ✅ **COMMITTED `4550d28`** | `STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md` |
| C4 — documentation & reports (dynamic) | ⏸ **READY — NOT STAGED** (needs **AP-C4-COMMIT**) | `STEP-2C-6-C4-FINAL-READINESS.md` |
| A4 — committed-tree replay | ⏸ prepared-only | — |
| STEP 2C.7 / 2C.8 / 2C.9 | ⏳ not started | — |

## Commit history (baseline)

```
4550d28  test(accounting): add isolated accounting regression coverage                       (C3)
7dc2496  feat(accounting): correct F-2 credential parsing and canonical revenue predicates   (C2)
cd3d849  chore(migrations): add fail-closed migration preflight guard                        (C1B)
350afec  fix(migrations): correct historical F7 dependency ordering                          (C1)
e8d4aa3  fix selesai orderan
```

## Commit boundaries (source of truth: FINAL COMMIT BOUNDARY AUDIT + later reports)

* **C1** (4) `350afec` · **C1B** (5) `cd3d849` · **C2** (11) `7dc2496` · **C3** (13) `4550d28` — **CLOSED, never amend.**
* **C3 fingerprint (updated, as committed):** **13/13** — 2 entries changed vs the old recorded values
  (`cashbook.integration.test.ts` `f54c4e8b…`, `refund-profitability.integration.test.ts` `cd22ec6d…`), the other 11
  byte-identical. The old fingerprint stands as history in `STEP-2C-6-C3-FINAL-READINESS.md` §3.
* **C4** (dynamic; **24 paths** as measured by the C4 readiness report) — `docs/accounting-hardening/*.md` except the
  `.kate-swp`, **plus** `ACCOUNTING-INTEGRATION-TEST-PLAN.md`, `ACCOUNTING-M2-SOLUTION-PROPOSAL.md`, **plus** the C4
  readiness report itself. Stage **path-explicitly** only (`git add docs/` is forbidden — it would sweep in `.kate-swp`).
  Manifest + SHA256 fingerprint are frozen in `STEP-2C-6-C4-FINAL-READINESS.md`.
* **HELD** (6): `.env.example`, 4 × `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`.
* **EXCLUDE** (2): `next-env.d.ts`, `…GUARD-IMPLEMENTATION.md.kate-swp` (do **not** delete).

## Tests — last verified, with exit codes (2026-10-15, live v3, post-fix)

| Suite | Result | Exit |
|---|---|---|
| `tests/accounting/cashbook.integration.test.ts` | **15/15** | **0** |
| `tests/accounting/refund-profitability.integration.test.ts` | **21/21** | **0** |
| `tests/accounting/revenue.integration.test.ts` | **21/21** | **0** |
| `tests/accounting/pnl.integration.test.ts` | **24/24** | **0** |
| `tests/accounting/integrity.integration.test.ts` | **30/30** | **0** |
| `tests/database-connection.integration.test.ts` (F-2 live) | **4/4** | **0** |
| `src/lib/database-url.unit.test.ts` (F-2 unit, DB-free) | **24/24** | **0** |
| `src/services/accounting/integrity.unit.test.ts` (M2 unit, DB-free) | **78/78** | **0** |
| `npx tsc --noEmit` | clean | **0** |
| `npm run db:preflight` | PASS 22/22 | **0** |
| `tests/migration-ordering.unit.test.ts` (C1B guard) | 23/23 | 0 |
| `npm run build` | pass — **historical only** | — |

**Accounting total: 111/111 PASS.** Date-independence regression: the two repaired suites also pass with the process’s
local calendar day shifted (`TZ=Etc/GMT+12` → local 2026-10-14) — the fix does not depend on today’s date.

## Database safety

* **3306** shared application DB and **3307** sibling project: **PROTECTED**, never contacted.
* **3308** `restaurant_app_test_v3`: used under **AP-C3-DB-TEST**; identity **PASS** before any test
  (`restaurant_app_test_v3` / `restaurant_test_v3@…` / MariaDB 11.8.9 / 49 tables / 22 ledger rows, 0 unfinished);
  only existing suites' own fixtures/cleanup touched it; **residual 0** across all 19 monitored tables; no
  migration/reset/truncate/drop; application `.env` untouched.
* The `restaurant-mariadb-test` container is **currently running** (it was `Exited` before this subphase) —
  stop it explicitly if the owner wants the previous state restored. `RestartCount=0`, no volume op.
* **Known environment issue (not repaired, by directive):** the container’s healthcheck calls `mysqladmin`, which the
  image does not ship (`exit 127`), so Docker reports `unhealthy` although the DB is fully functional. TCP readiness +
  live identity are the verification evidence.

## Approval gates

| Gate | Decision | Status |
|---|---|---|
| AP-C1 / AP-C1B-commit / AP-C2 | commit C1 / C1B / C2 | ✅ CLOSED — `350afec` / `cd3d849` / `7dc2496` |
| AP-C3-DB-TEST | target + container start + suites | ✅ USED |
| AP-C3-TEST-FIX | prove + fix the two failing suites | ✅ USED — root cause proven, test-only fix |
| AP-C3-COMMIT (conditional) | commit the 13 C3 files | ✅ **EXERCISED** — condition 2 now met; `4550d28` |
| **AP-C4-COMMIT** | stage + commit the C4 documentation manifest | ⏸ **OPEN — the current blocker** |
| AP-3 | A4 replay (disposable named target) | ⏸ open |
| AP-B2 / AP-B3 / AP-4 / AP-2 | `.kate-swp` · `next-env.d.ts` · collation follow-up · HELD | ⏸ open |

## Next exact action

1. **Owner grants AP-C4-COMMIT** → path-explicit stage the exact C4 manifest from
   `STEP-2C-6-C4-FINAL-READINESS.md` (never `git add docs/`), replay the staged-set + staged-blob fingerprint gates,
   `git diff --cached --check`, then exactly one commit (suggested message in that report).
2. **Only then** A4 pre-execution readiness → **AP-3** → A4 → FINAL STEP 2C.6 REPORT.
3. Do **not** start STEP 2C.7; do not touch Order/Payment/Cashier/QRIS business rules; never `--amend` a closed
   boundary (C1/C1B/C2/C3).
