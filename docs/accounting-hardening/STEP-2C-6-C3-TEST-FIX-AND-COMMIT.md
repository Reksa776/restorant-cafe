# STEP 2C.6 — C3 SCOPED TEST ISOLATION FIX & CONTROLLED COMMIT

**Subphase of 2C.6 · mode: AUTHORISED TEST-ONLY FIX + CONDITIONAL COMMIT EXECUTED**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| Branch | `main` |
| HEAD before | `7dc2496a6a10ffa5c5ad268f769601389d2d7cba` (C2) |
| **HEAD after** | **`4550d28a9213c06de39f332ae2c07bc2a0cab5f9` (C3)** |
| Authorisations used | **AP-C3-TEST-FIX** (prove + fix the two failures) · **AP-C3-COMMIT (conditional)** — now **exercised** · **AP-C3-DB-TEST** (reusable disposable target) |
| Verdict | ✅ **ALL TESTS PASS — EXACT 13-FILE COMMIT — C3 CLOSED** |

> **What was done.** The two C3 integration failures recorded in `STEP-2C-6-C3-INTEGRATION-BLOCKER.md` were traced to a
> proven root cause, repaired **inside the test boundary only**, re-verified against the live disposable target, and
> committed as exactly one commit of exactly the 13 allowlisted paths. **No product code, no migration, no schema, no
> assertion value and no historical report was changed.** Nothing was pushed; A4, STEP 2C.7 and deployment are untouched.

---

## 1. Authorisation scope actually exercised

| Allowed by AP-C3-TEST-FIX / AP-C3-COMMIT | Used? |
|---|---|
| Investigate the two failing suites + `tests/fixtures/accounting.ts` | ✅ |
| Prove the root cause before changing anything | ✅ (§2 — traced to the responsible test + the exact production stamp) |
| Minimal test-only fix | ✅ (§3 — 2 files, both inside the 13-file C3 boundary) |
| Reuse `127.0.0.1:3308/restaurant_app_test_v3` for identity + integration + fixture ops + cleanup | ✅ |
| Fingerprint: record the change, recompute, keep 11 C2 sources byte-identical | ✅ (§8) |
| One controlled commit if **all** §4 checks pass | ✅ (§9–§10) |

Not done (not permitted, not needed): product-code change, schema/migration change, container recreate, volume/schema
mutation, `db:deploy`, 3306/3307 contact, `.env` edit, `--amend`, hook bypass, second commit, broad staging, push, A4.

---

## 2. Root cause — proven, with the responsible line in each suite

Both failures are the **same defect class**: *a row whose timestamp is produced by production code as “now” is left
behind by an earlier test in the same file, and a later test asserts a **hardcoded** `2026-10-15` window that is only
empty while the run date is not 2026-10-15.* The suites snapshot once in `before()` and clean once in `after()`, so
there is no per-test isolation.

### 2.1 Cashbook — `1 !== 0` at `cashbook.integration.test.ts:751`

| Step | Evidence |
|---|---|
| **Leaking row** | Test **3** (“a duplicate collection callback does not double count”) creates a payment with `status: "UNPAID", paidAt: null` and settles it through the **real** `PaymentService.markCashierPaymentPaid`, which stamps `paidAt: new Date()` — `src/services/payment/payment.service.ts:735` |
| **Why it passed** | Test 3 reads the stamp dynamically (`localDateOnly(stored.paidAt ?? stored.createdAt)`) — correct, but it *is* today |
| **Why test 10 failed** | Test 10 asserts `cb({ dateFrom: D.oct15, dateTo: D.oct15 }).total === 0` (“a refund’s createdAt is not a cash movement”). On 2026-10-15 the run date **equals** the hardcoded control window, so test 3’s movement sits in it → `total = 1` |
| **Previous run** | On 2026-10-14 the same row was dated Oct 14 → the Oct-15 window was empty → green |
| **Reproduction** | Failed deterministically twice on 2026-10-15 (blocker run + re-run), identical assertion |

### 2.2 Refund-profitability — `350000 !== 40000` at `refund-profitability.integration.test.ts:1059`

Same leak, larger surface: **seven** earlier tests built orders/payments from `const createdAt = new Date()` and approved
refunds through the **real** `approvalService.decideRefund`, which stamps `approvedAt = now`. Test 10 then calls
`profit("2026-10-15")` (hardcoded) and asserts `totalRefund === 40000` — on 2026-10-15 that window already held the
earlier tests’ approvals: `350000 − 40000 = 310000` of foreign refund impact (their orders would equally have broken the
following `netSales === 60000` assertion).

### 2.3 Ruled out — including the file I was asked to investigate

| Candidate | Evidence | Verdict |
|---|---|---|
| `tests/fixtures/accounting.ts` | its `createFullRefund` / `createLegacyRefund` helpers **do** use `approvedAt: new Date()` (lines 186, 217) but have **zero call sites** — `tests/README.md:416–418` documents them as predating the working fixtures and FK-incomplete | **not a cause**; left byte-identical |
| Product code | the only `now` stamps involved (`paidAt`, `approvedAt`) are the *correct* documented behaviour of the settlement/approval services | **not a defect**; untouched |
| C1 / C1B / C2 content | C1/C1B only added migration SQL + the `tools/` guard; every C2 file is byte-identical to HEAD (§8) | **ruled out** |
| Residual data | every suite’s own cleanup closed `0 → 0`; post-run probe: **all 19 monitored tables = 0**, ledger 22/22 | **ruled out** |
| DB identity/structure | identity PASS, 49 tables, 22 ledger rows all finished | **ruled out** |
| Assertion values | no expected value was edited in either suite | **n/a** |

---

## 3. The fix — test-only, 2 of the 13 C3 files

### 3.1 `tests/accounting/cashbook.integration.test.ts`

| Change | Reason |
|---|---|
| `D.oct3 = "2026-10-03"`, `T.oct3 = at(2026, 10, 3, 10, 0)` | a dedicated, otherwise-unused calendar day for the one live-stamped movement |
| Test 3 now asserts the settlement really stamped a cash date (`stored.paidAt instanceof Date`), then **relocates** it onto `T.oct3` via `prisma.payment.update` and asserts on `D.oct3` explicitly | the production stamp must stay `now`; the fixture timestamp must not. This is the **FIXTURE MANEUVER** the P&L suite already documents (write-side effects produced by real services, then the date relocated so the read window is deterministic) |
| New assertions: pinned day is deterministic, exactly one movement on it, its `date` equals `T.oct3.toISOString()` | strictly stronger than before; test 10’s `oct15.total === 0` is **unchanged** |

`new Date()` remaining in this file: **2** — the *guarded* control windows in tests 7 and 8
(`if (today !== D.oct7)` / `!== D.oct8`). They assert absence of items that belong to other days, are skipped when the
run date collides with their own day, and cannot fail on any date; the leaking row they were implicitly relying on is gone.

### 3.2 `tests/accounting/refund-profitability.integration.test.ts`

| Change | Reason |
|---|---|
| New `pinRefundDay(refundId, day)` + optional `pinTo` on `mkApprovedRefundViaService` | one documented, reusable relocation point (`approvedAt = day + 1h`, `createdAt = day`) instead of scattering ad-hoc updates |
| **10 ×** `const createdAt = new Date()` → explicit dedicated days `Oct 1, 3, 4, 5, 6, 7, 8, 9, 11, 14` (one per test) | no fixture row may ever be dated on the run date; every day is disjoint from every hardcoded window in the suite (Oct 2/12/13/15/17–22/24–27) |
| **9** service-stamped approvals relocated (3 inline + 6 via `pinTo`) | keeps each report’s order window and approval window on the *same* dedicated day, exactly as the previous “everything is today” coincidence did |

`new Date()` remaining in this file: **0**.

**No skip, no `.only`, no suppression, no coverage reduction, no changed expected value, no product-code edit.**

---

## 4. Before / after behaviour

| | Before | After |
|---|---|---|
| Cashbook test 10 (`1 !== 0`) | FAIL on 2026-10-15 (test 3’s live-stamped movement in the Oct-15 window) | **PASS**, deterministic on any run date |
| Refund test 10 (`350000 !== 40000`) | FAIL on 2026-10-15 (7 earlier tests’ `now`-dated orders/approvals) | **PASS**, deterministic on any run date |
| Run-date dependence | both suites partially driven by `new Date()` fixtures/expectations | `new Date()`-derived **fixture/expectation timestamps: 0** in the profitability suite, 0 in the cashbook suite (2 guarded, date-safe controls remain) |
| Accounting semantics asserted | unchanged | **unchanged** — same rules: refusal dated by `approvedAt`, expense by `spentAt`, payment by `paidAt`, refund impact attributed to the approval day, order revenue to the order day |
| Test counts | 15 / 21 | **15 / 21** (no test added or removed) |

---

## 5. Why the accounting assertions remain valid

* The **write side is still production code**: refund requests, approvals, settlement, mirrors and frozen COGS are all
  produced by the real services; only the *calendar day* of the inserted row is pinned — the same technique already
  accepted in `tests/accounting/pnl.integration.test.ts` (§header, lines 33–38).
* Each report window is still the **same window as before**: `localDateOnly(createdAt)` where the test was dynamic, and
  the untouched hardcoded windows (Oct 2/12/13/15/17–22/24/27) where it was fixed.
* The specific invariants the two failing tests protect are **still asserted verbatim**: “a refund’s `createdAt` is not a
  cash movement”, “the Refund row is counted once”, plus the mirror/one-movement checks around them.
* Pinning makes the suites *stricter about isolation*: no test can now borrow another test’s `now`-dated rows.

---

## 6. Required verification — actual exit codes

| # | Gate | Command | **Actual** | Result |
|---|---|---|---|---|
| 0 | Target identity (before any test) | read-only probe on `127.0.0.1:3308` | **exit 0** — `restaurant_app_test_v3`, `restaurant_test_v3@…`, MariaDB 11.8.9, all 7 identity checks OK | ✅ |
| 1 | **cashbook** | `npx tsx --test tests/accounting/cashbook.integration.test.ts` | **exit 0** — tests 15, pass 15, fail 0 | ✅ |
| 2 | **refund-profitability** | `npx tsx --test tests/accounting/refund-profitability.integration.test.ts` | **exit 0** — tests 21, pass 21, fail 0 | ✅ |
| 3 | revenue | `npx tsx --test tests/accounting/revenue.integration.test.ts` | **exit 0** — pass 21, fail 0 | ✅ |
| 4 | P&L | `npx tsx --test tests/accounting/pnl.integration.test.ts` | **exit 0** — pass 24, fail 0 | ✅ |
| 5 | integrity (live) | `npx tsx --test tests/accounting/integrity.integration.test.ts` | **exit 0** — pass 30, fail 0 | ✅ |
| 6 | F-2 live regression | `npx tsx --test tests/database-connection.integration.test.ts` | **exit 0** — pass 4, fail 0 | ✅ |
| 7 | F-2 unit | `npx tsx --test src/lib/database-url.unit.test.ts` | **exit 0** — pass 24, fail 0 | ✅ |
| 8 | M2 unit | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | **exit 0** — pass 78, fail 0 | ✅ |
| 9 | TypeScript | `npx tsc --noEmit` | **exit 0** | ✅ |
| 10 | Migration preflight | `npm run db:preflight` | **exit 0** — 22 on disk / 22 in baseline, PASS | ✅ |
| 11 | Whitespace | `git diff --check` · `git diff --cached --check` | **exit 0** · **exit 0** | ✅ |

**Accounting suites: 111 pass / 0 fail** (15+21+21+24+30) plus **4/4** F-2 live. Exit codes were captured with
`${PIPESTATUS[0]}` behind `set -o pipefail`, so a filtered summary can never mask a non-zero exit.

### Cleanup — 0 residual

```
[STEP 2B.1 CLEANUP] residual (run-scoped): all 21 counters 0   |  tables: 0 → 0 (every table)
[STEP 2B.3 CLEANUP] residual (run-scoped): all 21 counters 0   |  tables: 0 → 0 (every table)
independent probe : restaurant/branch/user/customer/order/orderitem/…/auditlog = 0, ledger_rows=22, TOTAL_RESIDUAL=0
```

---

## 7. Targeted date-independence regression

The fix must not pass merely because *today* is a convenient day, so the two repaired suites were re-run with the
process’s **local calendar day shifted** (no system-clock change):

| Local calendar day of the process | cashbook | refund-profitability |
|---|---|---|
| **2026-10-15** (host WIB — the day that made the *unfixed* code fail) | **15/15, exit 0** | **21/21, exit 0** |
| 2026-10-14 (`TZ=Etc/GMT+12`) | **15/15, exit 0** | **21/21, exit 0** |
| 2026-10-15 (`TZ=UTC`, different offset) | **15/15, exit 0** | **21/21, exit 0** |

Combined with the static result that **no fixture or expectation timestamp is derived from the clock** in either suite,
this demonstrates the assertions no longer depend on the execution date. The strongest single datapoint is the first row:
the previously deterministic failures now pass **on the very date that produced them**.

---

## 8. Updated SHA256 fingerprint — 13/13 recomputed

Exactly **two** entries changed; the other **11 are byte-identical** to the values recorded in
`STEP-2C-6-C3-FINAL-READINESS.md` §3.

```
1eff42edbe9e06ee3b9cfc6ed56e347fe002d171cab300b18c20dda841e0dc0b  .gitignore
4a8359b302f483f688b0b90645bd53e74a07e93858787c02dbe5c356cad351f4  .env.test.example
256353d49ccd9d61e7b14bdcfedcee36e5c93cc2e0e78439029090f984f87baf  src/services/accounting/integrity.unit.test.ts
0ecbd4a1c5592721c9a85a846f0c7fdf2d9dd6cc6337982f21e3d8c4b05929e2  src/lib/database-url.unit.test.ts
bc95229817dc6aca6f59c3006f739e510495748478bd436507628a4a691009b6  tests/README.md
d3f9410b43fd25162e2d2f63fb0d353aace0e83dfea87af33bfb9f4d14537e1b  tests/setup.ts
78f9efe0c24ed649ed322a5f98f79bea737419479cd0c5f22b5609b1a1002375  tests/fixtures/accounting.ts
f54c4e8b6df232c029cb9f6a614ed8817c8503e48d8fc5bfcb8e686ef90ec29c  tests/accounting/cashbook.integration.test.ts          ← CHANGED (was 3c42d3df…)
1425e5de9e28a872c986f09452117e0cfd95686c51de0618639f41e162fa8af0  tests/accounting/revenue.integration.test.ts
cd22ec6d29e758182b402e37b9a71e5b802b00a24f7a727c956d2d024281765c  tests/accounting/refund-profitability.integration.test.ts ← CHANGED (was 93cb1b47…)
7ce5c60d8fee0870045ef037d98dceb25281eee23a9b6c602dcfdbd3010530dd  tests/accounting/pnl.integration.test.ts
c8a0d3c4a51847a8bb3d704a542a7d2d063ef1da7c49e13bcb524d583057bcf4  tests/accounting/integrity.integration.test.ts
97eac4273fc726ba39028fb5d2ee18dcb8047790bd629da083cdab86aa5d34d9  tests/database-connection.integration.test.ts
```

| Check | Result |
|---|---|
| 13 paths present, 13 distinct | ✅ |
| Changed entries | **2** (`changed_count=4` = 2 removed + 2 added lines in the comparison) |
| All **11** C2 committed files byte-identical to HEAD (`git show HEAD:<p>`) | ✅ `C2_CHANGED_COUNT=0` |
| `prisma/migrations` + `prisma/schema.prisma` | ✅ 0 changes (`git status -- prisma/` empty; `git diff HEAD~1 HEAD -- prisma/` empty) |
| C4 / HELD / EXCLUDE content pulled in | ✅ none |
| Historical readiness report rewritten | ✅ **no** — the old fingerprint stands as history; this report carries the new one |

---

## 9. Staged-set verification (conditional commit, step by step)

| # | Gate | Result |
|---|---|---|
| 1 | Branch `main`, expected HEAD `7dc2496a…` | ✅ |
| 2 | Index `0`, stash `0` **before** staging | ✅ |
| 3 | Path-explicit `git add` of exactly the 13 C3 paths (no `git add docs/`, no `-A`) | ✅ `staged_count=13` |
| 4 | Staged set == exact C3 allowlist | ✅ 13/13, order-insensitive `comm` diff empty, `extra=0`, `missing=0` |
| 5 | Staged-blob SHA256 == the new 13/13 fingerprint | ✅ **MATCH** (`git show :<path>` for each) |
| 6 | `git diff --cached --name-status` only `A`/`M` | ✅ `non_A_M=0` (11 A + 2 M) |
| 7 | No 14th file | ✅ |
| 8 | `git diff --cached --check` | ✅ exit 0 |
| 9 | Staged diff reviewed | ✅ 13 files, `11906 insertions(+), 1 deletion(-)` (the single deletion is inside `integrity.unit.test.ts`, pre-existing C3 content) |
| 10 | Exactly one commit | ✅ |

---

## 10. The commit and post-commit verification

```
4550d28a9213c06de39f332ae2c07bc2a0cab5f9
test(accounting): add isolated accounting regression coverage
parent 7dc2496a6a10ffa5c5ad268f769601389d2d7cba
```

| Post-commit check | Result |
|---|---|
| Parent = `7dc2496a…`; exactly one new commit (`rev-list --count HEAD~1..HEAD` = 1) | ✅ |
| Exactly **13** committed paths, equal to the allowlist (`extra=0`, `missing=0`) | ✅ |
| Committed blob fingerprint 13/13 == new fingerprint | ✅ **MATCH** |
| Index empty, stash empty | ✅ |
| Name-status `A`/`M` only (11 A + 2 M) | ✅ |
| C4 / HELD / EXCLUDE preserved and still uncommitted (28 untracked + 2 modified left in the tree) | ✅ |
| Migration SQL + Prisma schema unchanged | ✅ |
| `npx tsc --noEmit` on the committed tree | ✅ exit 0 |
| `npm run db:preflight` on the committed tree | ✅ exit 0 — 22/22 PASS |
| No `--amend`, no hook bypass, no push, no second commit | ✅ |

Untracked/modified left in the worktree **by design**: `?? ACCOUNTING-INTEGRATION-TEST-PLAN.md`, `?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md`, `?? docs/accounting-hardening/**` (the C4 archive incl. this report), `M .env.example` (HELD, owner decision pending), `M next-env.d.ts` (EXCLUDE), `?? HERMES-*.md` (4, HELD), `?? INVENTORY-DESIGN-REVIEW.md` (HELD), `?? .STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md.kate-swp` (UNKNOWN, EXCLUDE).

---

## 11. Database identity and cleanup

```
host target   : 127.0.0.1:3308/restaurant_app_test_v3 user=restaurant_test_v3
live identity : {"db":"restaurant_app_test_v3","usr":"restaurant_test_v3@172.18.0.1","ver":"11.8.9-MariaDB-ubu2404"}
identity checks: host_port_is_3308=OK host_is_127_0_0_1=OK active_vars_agree=OK live_db_is_v3=OK
                 live_user_is_dedicated=OK is_mariadb_11_8=OK no_unfinished_migration=OK
IDENTITY VERDICT: PASS (exit 0)
```

The container was only **started** (existing container, `RestartCount=0`, no recreate, no volume operation); `3306`/`3307`
were never contacted (`.env.test` references `3308` only); the application `.env` was untouched; every write was
run-scoped test data; each suite’s own cleanup reported `0 → 0` and the independent probe found **0 residual rows** in all
19 monitored tables with the 22-row migration ledger intact.

---

## 12. Healthcheck limitation (recorded, not repaired)

`docker inspect` still reports `Health=unhealthy`; the health log shows `/bin/sh: 1: mysqladmin: not found` (**exit 127**) —
the image’s healthcheck calls a binary the image does not ship. This is a **broken healthcheck definition, not a database
fault**: identity PASS, 49 tables, 22/22 ledger rows and every connecting suite green. Per the directive it is **not**
repaired in this task; Docker/container configuration was left untouched. TCP readiness + live identity are used as the
verification evidence instead.

---

## 13. Regression risk

| Risk | Assessment |
|---|---|
| A pinned day collides with another test’s window | **Checked**: the 10 dedicated days are disjoint from every hardcoded window in the suite (Oct 2/12/13/15/17–22/24–27) and every report read is either product-filtered or on its own day |
| Pinned day collides with the run date | **Not possible**: pinning removes the dependency instead of moving it — the suites pass on local Oct 14 *and* Oct 15 (§7) |
| A future test reintroduces a `now`-dated fixture | **Bounded**: both suites now carry the maneuver note, and any new `new Date()` fixture in these files would re-open the same class of leak — a review point, not a latent failure today |
| Weakened assertions | **None**: no expected value, window, or invariant changed; test 3 gained assertions |
| Product behaviour changed | **None**: no `src/` file touched; all 11 C2 sources byte-identical (§8) |
| Data/schema side effects | **None**: read-only identity probes, run-scoped writes, 0 residual, 22/22 ledger, 0 prisma diffs |
| Historical evidence integrity | **Preserved**: prior reports are read-only; the superseded fingerprint is explicitly labelled in §8 |

**Residual limitation:** the pin assumes the two remaining guarded `new Date()` control windows in the cashbook suite keep
their current (date-safe) shape. They were analysed and shown unable to fail on any date; a stricter future cleanup could
make them explicit too. This is recorded rather than silently changed.

---

## 14. Next checkpoint — C4 FINAL READINESS

C3 is **CLOSED**. The programme moves to **C4 FINAL READINESS** (documentation & reports archive): build the exact C4
manifest from the current working tree and the accepted boundary (`STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md` §7, extended
by the reports written since), produce the C4 readiness report, and **STOP before staging** — **AP-C4-COMMIT has not been
granted**. Not in scope: A4, push, deployment, STEP 2C.7.
