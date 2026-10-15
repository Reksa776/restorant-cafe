# EXECUTION-STATE — Accounting Hardening (continuation file)

> **Purpose.** A small, single-source continuation file so a new agent session can resume without re-auditing.
> It is **not** a substitute for the phase reports. Keep it short; link to reports for detail.
> Master prompt: “MASTER EXECUTION — ACCOUNTING HARDENING”. Historical reports are **read-only**.

| | |
|---|---|
| Last updated | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| Branch | `main` |
| Last verified HEAD | `eb313bb13d2670b45a2aeb73a7b370d554931321` (C4) |
| Index / stash | empty / empty (`git diff --check` exit 0) |
| Worktree | **14 entries** = 6 HELD + 2 EXCLUDE + **6 intentionally-uncommitted post-C4 docs** (0 unclassified) |

## Current checkpoint

**STEP 2C.6 — CLOSED; VERDICT: ✅ STEP 2C.6 CLOSED — READY TO ENTER STEP 2C.7.**
Closure report: [`STEP-2C-6-FINAL-CLOSURE.md`](./STEP-2C-6-FINAL-CLOSURE.md). Chain C1 `350afec` → C1B `cd3d849` →
C2 `7dc2496` → C3 `4550d28` → C4 `eb313bb` → **A4 replay** (exit 0, 22/22, 49 tables, ledger 22/22/0, checksums 22/22,
0 business rows, v3 unmodified, 3306/3307 never contacted). Closure re-ran **DB-free only** (`db:preflight` **exit 0**,
static checksums 22/22 **0 mismatch**, `git diff --check` **0**, `--cached --check` **0**, secret scan clean, 25-report
inventory); **A4 was not re-run**; C4 whitespace **waiver** + broken healthcheck recorded as exception/limitation; **no
production-readiness claim**; no commit, no push.

**NEXT CHECKPOINT: `STEP 2C.7 — CODE QUALITY / LINT TRIAGE`** (needs **AP-2C7**; **not started** in this session).

## Resolved: C3 blocker (historical record)

| Suite | Before (2026-10-15 morning) | After (fix) |
|---|---|---|
| `tests/accounting/cashbook.integration.test.ts` | **14/15** (exit 1) — line 751 `1 !== 0` | **15/15** (exit 0) |
| `tests/accounting/refund-profitability.integration.test.ts` | **20/21** (exit 1) — line 1059 `350000 !== 40000` | **21/21** (exit 0) |

Root cause (proven): a **run-date leak in the tests**, not a product/DB fault — cashbook test 3 kept a live-stamped
`paidAt = now` movement that landed in test 10's hardcoded `2026-10-15` control window; the profitability suite had 10
clock-derived fixture timestamps + 9 service-stamped `approvedAt` values. Fix = test-only (2 of 13 C3 paths): `D.oct3`/`T.oct3`
+ per-test dedicated days + `pinRefundDay()`. `tests/fixtures/accounting.ts` was investigated and cleared (zero call sites).
C3 committed as `4550d28`; details in [`STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md`](./STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md).

## Completed checkpoints / phases

| Phase | Status | Evidence |
|---|---|---|
| STEP 2C.3A / 2C.3B / 2C.4 / 2C.5 | ✅ complete | respective reports |
| STEP 2C.6 audit + F-6/F-8 | ✅ complete (audit) | `STEP-2C-6-MIGRATION-COMPATIBILITY.md` |
| C1 — F-7 migration repair (4) | ✅ **COMMITTED `350afec`** | `STEP-2C-6-C1-COMMIT-EXECUTION.md` |
| C1B — migration preflight guard (5) | ✅ **COMMITTED `cd3d849`** | `STEP-2C-6-C1B-COMMIT-EXECUTION.md` |
| C2 — accounting source boundary (11) | ✅ **COMMITTED `7dc2496`** | `STEP-2C-6-C2-COMMIT-EXECUTION.md` |
| C3 — tests + test infra (13) | ✅ **COMMITTED `4550d28`** | `STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md` |
| C4 — documentation & reports (24) | ✅ **COMMITTED `eb313bb`** | `STEP-2C-6-C4-COMMIT-EXECUTION.md` |
| A4 — committed-tree replay | ✅ **EXECUTED — REPLAY SUCCESS (exit 0)** | `STEP-2C-6-A4-EXECUTION.md` |
| **2C.6 FINAL CLOSURE (AP-FINAL)** | ✅ **STEP 2C.6 CLOSED** — evidence verified, DB-free re-checks PASS | `STEP-2C-6-FINAL-CLOSURE.md` |
| **STEP 2C.7 — CODE QUALITY / LINT TRIAGE** | ⏳ **NEXT — NOT STARTED** (needs **AP-2C7**) | — |
| STEP 2C.8 / 2C.9 | ⏳ not started | — |

## Commit history (baseline)

```
eb313bb  docs(accounting): consolidate hardening evidence and roadmap                       (C4)
4550d28  test(accounting): add isolated accounting regression coverage                       (C3)
7dc2496  feat(accounting): correct F-2 credential parsing and canonical revenue predicates   (C2)
cd3d849  chore(migrations): add fail-closed migration preflight guard                        (C1B)
350afec  fix(migrations): correct historical F7 dependency ordering                          (C1)
e8d4aa3  fix selesai orderan
```

## Commit boundaries (source of truth: FINAL COMMIT BOUNDARY AUDIT + later reports)

* **C1** (4) `350afec` · **C1B** (5) `cd3d849` · **C2** (11) `7dc2496` · **C3** (13) `4550d28` · **C4** (24) `eb313bb` —
  **ALL CLOSED; never amend.**
* **C4 manifest = 24 paths** (frozen in `STEP-2C-6-C4-FINAL-READINESS.md` §2): the two `ACCOUNTING-*.md`, the 21
  `docs/accounting-hardening/*.md` reports, plus the C4 readiness report itself. Commit shape: **24 A, +12592/−0**.
* **Classification reconciliation:** worktree = **32** = 24 C4 + 6 HELD + 2 EXCLUDE. The readiness report's earlier “31” was
  measured **before the report existed** (23 + 6 + 2) — documentation artifact only, manifest unchanged.
* **C4 fingerprint:** entries 1–23 **23/23** on working tree, staged blobs and committed blobs; entry 24 (the manifest-bearing
  report) has **no self-hash** — its staged/committed blob **`f75c0dc403edc2a6b45ad1d4f1fba8291a853ed58986cfb41e2ad7e62baab2a5`**
  is the recorded proof. All 20 historical paths byte-identical to the pre-session snapshot.
* **Recorded gate waiver (C4 only):** `git diff --cached --check` = **exit 2**, **49** flags, all inside two **frozen**
  documents (legacy archive 48 Markdown hard-break trailing spaces; 2C.5 report 1 EOF blank line); **0** from new content.
  Owner ruled **“waive for this class, then commit”**. Not a precedent — C1/C1B/C2/C3 all passed with exit 0.
* **HELD** (6): `.env.example`, 4 × `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`.
* **EXCLUDE** (2): `next-env.d.ts`, `…GUARD-IMPLEMENTATION.md.kate-swp` (do **not** delete).
* **Uncommitted by design (post-C4 reports):** `STEP-2C-6-C4-COMMIT-EXECUTION.md`,
  `STEP-2C-6-A4-PRE-EXECUTION-READINESS.md`, and the `ROADMAP.md` / `EXECUTION-STATE.md` updates — **no second commit** was made.

## Tests — last verified, with exit codes (2026-10-15, live v3, post-fix)

| Suite | Result | Exit |
|---|---|---|
| `tests/accounting/cashbook.integration.test.ts` | **15/15** | **0** |
| `tests/accounting/refund-profitability.integration.test.ts` | **21/21** | **0** |
| `tests/accounting/revenue.integration.test.ts` | **21/21** | **0** |
| `tests/accounting/pnl.integration.test.ts` | **24/24** | **0** |
| `tests/accounting/integrity.integration.test.ts` | **30/30** | **0** |
| `tests/database-connection.integration.test.ts` (F-2 live) | **4/4** | **0** |
| `src/lib/database-url.unit.test.ts` (F-2 unit) | **24/24** | **0** |
| `src/services/accounting/integrity.unit.test.ts` (M2 unit) | **78/78** | **0** |
| `npx tsc --noEmit` | clean | **0** |
| `npm run db:preflight` | PASS 22/22 | **0** |
| `tests/migration-ordering.unit.test.ts` (C1B guard) | 23/23 | 0 |
| `npm run build` | pass — **historical only** | — |

**Accounting total 111/111 PASS.** Date-independence regression passed under a shifted local calendar day.

## A4 execution result (measured — 2026-10-15, `STEP-2C-6-A4-EXECUTION.md`)

* Replay `npx prisma migrate deploy` against the disposable **`restaurant_app_test_v4`** (3308): **exit 0**, `22 migrations
  found`, all applied **in frozen baseline order** (`firstDiff=none`), window 08:24:31→08:24:36.
* Verified: **49** tables (set ≡ v3), ledger **22 / 22 finished / 0 unfinished / 0 rolled-back**, checksums **22/22** ≡
  on-disk `sha256`, F.5 row once, **0 business rows** in all 48 non-ledger tables, `lower_case_table_names=0`.
* Guard (2C.2E §26.4 shape): tree identity + scheme/host/port/database + protected ports + Prisma 7.10.0 asserted before
  spawning; `DATABASE_URL` injected into the **child environment**, `TEST_DATABASE_URL` stripped (neutralises **R-1**).
* **v3 unmodified**; **3306/3307 never contacted**; repo untouched (HEAD/index/worktree unchanged); v4 kept as read-only
  evidence (§8 C1–C5 honoured, no destructive cleanup).

* Static: `npm run db:preflight` **PASS 22/22 exit 0** (Prisma 7.10.0 = baseline, Node v24.21.0, ICU 78.3);
  independent verification **22/22 checksums, 0 mismatch, order ≡ baseline**, on-disk dirs 22.
* Target design: **new** `restaurant_app_test_v4` on the same `restaurant-mariadb-test` container (3308),
  `utf8mb4_uca1400_ai_ci`, dedicated `restaurant_test_v4@%` user, credential inert in gitignored `.env.test`.
* Guard requirement (**R-1**): `prisma.config.ts` resolves `DATABASE_URL` → **3306** by default, so every A4 command must
  override it explicitly and the guard must abort unless the resolved target is exactly `127.0.0.1:3308/restaurant_app_test_v4`.
* Expected: `migrate deploy` **exit 0**, `22 migrations found`, all applied; then **49 tables**, ledger **22/22 finished,
  0 unfinished**, F.5 row once, checksums 22/22, **0 business rows**.

## Database safety

* **3306** (host app DB) and **3307** (sibling project) — **PROTECTED**, never contacted.
* **3308/v3** — used under AP-C3-DB-TEST; identity PASS; residual **0**; no migration/reset/truncate/drop; `.env` untouched.
* **3308/v4** — **CREATED & REPLAYED under AP-3** (exit 0): 49 tables, ledger 22/22/0, 0 business rows; kept as
  read-only evidence; credential only as an inert `DISPOSABLE_TEST_V4_URL` line in the gitignored `.env.test` (active
  `TEST_DATABASE_URL` still v3).
* The `restaurant-mariadb-test` container is **running** (`Up`, `RestartCount=0`, volume `restaurant-mariadb-test_data`);
  it was `Exited(0)` before the C3 run — stop it on request, never `rm`.
* **Known environment issue:** the container's healthcheck calls `mysqladmin`, absent from the image
  (`exit 127`) → Docker reports `unhealthy` although the DB is fully functional. Not repaired (by directive);
  TCP readiness + live identity are the evidence instead.

## Approval gates

| Gate | Decision | Status |
|---|---|---|
| AP-C1 / AP-C1B-commit / AP-C2 | commit C1 / C1B / C2 | ✅ CLOSED — `350afec` / `cd3d849` / `7dc2496` |
| AP-C3-DB-TEST / AP-C3-TEST-FIX / AP-C3-COMMIT | run, fix, commit C3 | ✅ CLOSED — `4550d28`, 111/111 |
| AP-C4-COMMIT + the whitespace waiver | commit C4 (24 paths) | ✅ CLOSED — `eb313bb` |
| **AP-3** | A4 committed-tree replay (new disposable `restaurant_app_test_v4`) | ✅ CLOSED (conditional) — replay **exit 0**, `STEP-2C-6-A4-EXECUTION.md` |
| **AP-FINAL** | STEP 2C.6 final closure | ✅ **CLOSED** — `STEP-2C-6-FINAL-CLOSURE.md` |
| **AP-DOC-COMMIT** | one follow-up commit for the **6** uncommitted post-C4 docs | ⏸ open (nothing staged) |
| **AP-2C7** | authorise **STEP 2C.7 — CODE QUALITY / LINT TRIAGE** | ⏸ **OPEN — the current gate** |
| AP-B2 / AP-B3 / AP-4 / AP-2 | `.kate-swp` · `next-env.d.ts` · collation follow-up · HELD | ⏸ open |

## Next exact action

1. **Owner grants AP-2C7** → open **`STEP 2C.7 — CODE QUALITY / LINT TRIAGE`**: start read-only (full eslint inventory +
   `tsc --noEmit` + triage of the 2 known warnings), then propose a scoped fix plan for approval **before** any code change.
2. **Optional, separate:** **AP-DOC-COMMIT** to version-control the **6** uncommitted post-C4 docs
   (`C4-COMMIT-EXECUTION`, `A4-PRE-EXECUTION-READINESS`, `A4-EXECUTION`, `FINAL-CLOSURE`, `ROADMAP`, `EXECUTION-STATE`).
3. Never `--amend` a closed boundary; keep the test target at v3 for suites; never contact 3306/3307; drop
   `restaurant_app_test_v4` only on explicit owner instruction.
