# Accounting Hardening — Roadmap (LOCKED)

**Project:** `/home/reksa/restorant-cafe`
**Policy (from STEP 2C.3B onward):** `ACCOUNTING-INTEGRATION-TEST-PLAN.md` is a **legacy archive** (read-only).
Each phase gets its own report under `docs/accounting-hardening/`. Nothing is appended to the archive.

## Phase sequence — do not renumber, merge or skip

| Step | Scope | Status | Report |
|------|-------|--------|--------|
| **2C.3A** | Audit A-9 / A-11 reporting consistency | ✅ **COMPLETE** | [`STEP-2C-3A-REPORTING-AUDIT.md`](./STEP-2C-3A-REPORTING-AUDIT.md) (from archive §28) |
| **2C.3B** | Fix A-9 / A-11 (+A-12) reporting predicates + focused regression | ✅ **COMPLETE** | [`STEP-2C-3B-REPORTING-FIX.md`](./STEP-2C-3B-REPORTING-FIX.md) |
| **2C.4** | F-2 database connection | ✅ **COMPLETE** (audit + fix + regression) | [`STEP-2C-4-DATABASE-CONNECTION.md`](./STEP-2C-4-DATABASE-CONNECTION.md) |
| **2C.5** | F-5 / M-1 / M-2 cutoff | ✅ **COMPLETE** (audit + approved implementation + regression) | [`STEP-2C-5-CUTOFF-FINALIZATION.md`](./STEP-2C-5-CUTOFF-FINALIZATION.md) (Part I audit/gate + Part II implementation) |
| **2C.6** | F-6 / F-8 / migration compatibility | ✅ **CLOSED 2026-10-15** — audit accepted (F-6 / F-8, release gate, F-8 A+D documented) and the phase carried through C1 → C1B → C2 → C3 → C4 → A4; final closure: [`STEP-2C-6-FINAL-CLOSURE.md`](./STEP-2C-6-FINAL-CLOSURE.md) | [`STEP-2C-6-MIGRATION-COMPATIBILITY.md`](./STEP-2C-6-MIGRATION-COMPATIBILITY.md) (Part I audit + Part II limited follow-up) |
| **2C.6-C1** | F-7 commit readiness (4 migration relocations) | 🔎 **AUDIT ONLY — C1 READY, NOT COMMITTED**: exact 4-file boundary proven, statement-preserving (44≡44, 16≡16), dependency order verified, nothing staged; awaiting **AP-1** | [`STEP-2C-6-C1-COMMIT-READINESS.md`](./STEP-2C-6-C1-COMMIT-READINESS.md) |
| **2C.6-C1A** | Migration ordering & commit safety audit | 🔎 **READ-ONLY AUDIT — C1 STILL READY, STILL ON HOLD**: ordering mechanism read from Prisma source (`localeCompare`), 22/22 ledger≡mechanism, HEAD **2** forward-refs → fixed tree **0**, 44≡44/16≡16, checksums 4/4; awaiting **AP-1** (new AP-4/AP-5) | [`STEP-2C-6-C1A-MIGRATION-ORDERING-AUDIT.md`](./STEP-2C-6-C1A-MIGRATION-ORDERING-AUDIT.md) |
| **2C.6-C1B** | Migration runner safety guard (design) | 🧭 **DESIGN ONLY — NO IMPLEMENTATION**: static fail-closed preflight (ICU canary + `localeCompare` order ≡ versioned baseline + 22 checksums) before `migrate deploy`; recommendation is a tracked `tools/` guard **not** the gitignored `scripts/`; awaiting **AP-C1B-1…5** | [`STEP-2C-6-C1B-RUNNER-GUARD-DESIGN.md`](./STEP-2C-6-C1B-RUNNER-GUARD-DESIGN.md) |
| **2C.6-C1B-I** | Migration runner safety guard (implementation) | ✅ **IMPLEMENTED & VERIFIED — C1 STILL ON HOLD**: `tools/preflight-migrations.mjs` + frozen baseline (22 order + 22 sha256) + `db:preflight` / `db:deploy` (`&&`) / `db:baseline:update`; **23/23** unit tests, `tsc` / build / `git diff --check` exit **0**; no bypass, Prisma-version mismatch **hard fail**; awaiting **AP-C1B-6** | [`STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md`](./STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md) |
| **2C.6-C1B-FA** | Guard final acceptance verification | ✅ **ACCEPTED — C1 STILL ON HOLD**: artifacts exist & committable, baseline **22 order / 22 checksum / 0 mismatch**, `db:deploy` = `preflight && deploy`, **F8 hard fail**, **no bypass**, `--update` gated + never automatic; guard tests **23/23** + preflight **PASS**; index empty, `git diff --check` **0**; awaiting **AP-C1B-6** | [`STEP-2C-6-C1B-FINAL-ACCEPTANCE.md`](./STEP-2C-6-C1B-FINAL-ACCEPTANCE.md) |
| **2C.6-FBA** | Final commit boundary audit | 🔎 **READ-ONLY — boundaries clean, nothing staged**: C1=4 · C1B=5 · C2=11 · C3=13 · C4=14 (path-explicit) · HELD=6 · EXCLUDE=2 (`next-env.d.ts` + foreign `.kate-swp`); **hard edge C1 → C1B** (baseline holds WT F-7 checksums); sequence `C1 → C1B → C2 → C3 → C4 → A4`; awaiting **AP-B1…AP-B4** | [`STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md`](./STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md) |
| **2C.6-C1-EXEC** | C1 controlled commit execution | ✅ **C1 COMMITTED — `350afec`** (parent `e8d4aa3`, 1 commit ahead): exactly the 4 F-7 migration SQL, **+41/−29**, statement-preserving **44≡44 / 16≡16**, staged-set gate 9/9 PASS incl. `diff --cached --check` 0; index empty again, C1B/C2/C3/C4/HELD preserved, `.kate-swp`/`next-env.d.ts` excluded; **C1B commit NOT yet authorised** | [`STEP-2C-6-C1-COMMIT-EXECUTION.md`](./STEP-2C-6-C1-COMMIT-EXECUTION.md) |
| **2C.6-C1B-PC** | C1B final pre-commit verification | 🔎 **READ-ONLY — C1B READY, NOT COMMITTED**: guard re-verified against the **committed** C1 tree — baseline 22 order / 22 checksum / **0 mismatch** (committed blobs), four F-7 = expected = committed = on-disk = baseline, `db:preflight` **PASS**, guard tests **23/23**, `tsc` / `git diff --check` exit **0**; boundary = **exactly 5 files**, no drift (sizes 24114/3851/20027); awaiting **AP-C1B-commit** | [`STEP-2C-6-C1B-FINAL-PRECOMMIT-VERIFICATION.md`](./STEP-2C-6-C1B-FINAL-PRECOMMIT-VERIFICATION.md) |
| **2C.6-C1B-EXEC** | C1B controlled commit execution | ✅ **C1B COMMITTED — `cd3d849`** (parent `350afec`, 1 commit ahead): exactly the **5** C1B files, staged path-explicitly, `5 files changed, 1303 insertions(+), 2 deletions(-)`; gates all PASS (`db:preflight` 22/22, guard tests **23/23**, `tsc`/`--cached --check` exit **0**); index empty again, `db:preflight` **PASS** vs the **committed** baseline, four F-7 **4/4** intact, C2/C3/C4/HELD/EXCLUDE preserved; **C2/C3/C4 commit NOT authorised** | [`STEP-2C-6-C1B-COMMIT-EXECUTION.md`](./STEP-2C-6-C1B-COMMIT-EXECUTION.md) |
| **2C.6-C2** | Accounting source boundary readiness (Checkpoint 1) | ✅ **C2 COMMITTED — `7dc2496`** (readiness was read-only “C2 READY, NOT COMMITTED”): exact **11-file** boundary present, disjoint from C3/C4/HELD/EXCLUDE, **no drift** (10/10 recorded diffstats match + SHA256 fingerprint); fresh checks PASS — F-2 unit **24/24**, M2 unit **78/78**, `tsc` **0**, eslint **0 errors** (2 pre-existing warnings), `diff --check` **0**; AP-C2 subsequently granted and executed (`7dc2496`) | [`STEP-2C-6-C2-FINAL-READINESS.md`](./STEP-2C-6-C2-FINAL-READINESS.md) |
| **2C.6-C2-EXEC** | C2 controlled commit execution | ✅ **C2 COMMITTED — `7dc2496`** (parent `cd3d849`, 1 commit ahead): exactly the **11** C2 files, staged path-explicitly, `11 files changed, 819 insertions(+), 80 deletions(-)`; SHA256 fingerprint 11/11 (working tree **and** staged blobs); gates PASS (`db:preflight` 22/22, F-2 unit 24/24, M2 unit 78/78, `tsc`/`--cached --check`/`diff --check` exit **0**); index empty again, C3/C4/HELD/EXCLUDE preserved, migration SQL + schema untouched; **C3/C4 commit NOT authorised** | [`STEP-2C-6-C2-COMMIT-EXECUTION.md`](./STEP-2C-6-C2-COMMIT-EXECUTION.md) |
| **2C.6-C3** | Accounting test boundary readiness (Checkpoint 2) | ⚠️ **STATIC READINESS PASS — INTEGRATION PENDING APPROVAL**: exact **13-file** boundary present, disjoint from C2/C4/HELD/EXCLUDE, fingerprint **13/13** recorded; `.gitignore` = accepted `+.env.test` only; `.env.test.example` **no real credential**; `tests/setup.ts` still **fail-closed** (protected DBs 3306/3307 rejected by name+port); C2 source byte-identical; safe checks PASS — F-2 **24/24**, M2 **78/78**, `tsc` **0**, preflight **22/22**, `diff --check` **0**; **3308 target container is STOPPED**; awaiting **AP-C3-COMMIT** + **database-target approval** | [`STEP-2C-6-C3-FINAL-READINESS.md`](./STEP-2C-6-C3-FINAL-READINESS.md) |
| **2C.6-C3-DB** | C3 authorised DB test run (AP-C3-DB-TEST) | ❌ **BLOCKED — NO COMMIT**: container started, identity **PASS** (v3 · 49 tables · 22 ledger rows); F-2 unit **24/24**, M2 unit **78/78**, F-2 live **4/4**, `tsc` **0**, preflight **22/22**, fingerprint **13/13**; accounting suites **98 pass / 2 fail** — cashbook **14/15** and refund-profitability **20/21** fail on refund date attribution (leading cause: **calendar-dependent test isolation** — fixtures stamp `new Date()` = 2026-10-15 while tests query a hardcoded `2026-10-15` window); C1/C1B/C2 + test drift + residual data + DB drift all **ruled out**; conditional AP-C3-COMMIT **not exercised** | [`STEP-2C-6-C3-INTEGRATION-BLOCKER.md`](./STEP-2C-6-C3-INTEGRATION-BLOCKER.md) |
| **2C.6-C3-FIX** | C3 scoped test isolation fix (AP-C3-TEST-FIX) | ✅ **ROOT CAUSE PROVEN + FIXED (test-only)**: cashbook test 3 kept a production-stamped `paidAt = now` movement that landed in test 10's hardcoded `2026-10-15` control window (test 10 now runs on that exact day and passes); refund-profitability pinned 10 `new Date()` fixtures to dedicated days + relocated 9 service-stamped `approvedAt` values onto them; **111/111 accounting + F-2 live 4/4, all exit 0**, residual 0, date-independence regression PASS | [`STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md`](./STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md) |
| **2C.6-C3-EXEC** | C3 controlled commit execution (conditional AP-C3-COMMIT) | ✅ **C3 COMMITTED — `4550d28`** (parent `7dc2496`, 1 commit ahead): exactly the **13** C3 paths, path-explicit, fingerprint **13/13** recomputed (2 entries changed, 11 byte-identical); `A/M` only, no 14th file; post-commit parent/paths/blob-fingerprint/index/stash/boundaries all PASS; `tsc` **0**, `db:preflight` **22/22**; **C4 commit NOT authorised** | [`STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md`](./STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md) |
| **2C.6-C4-EXEC** | C4 controlled documentation commit (AP-C4-COMMIT) | ✅ **C4 COMMITTED — `eb313bb`** (parent `4550d28`, 1 commit ahead): exactly the **24**-path manifest, path-explicit, all `A`, `12592 insertions(+)`; classified worktree reconciled to **32** = 24 C4 + 6 HELD + 2 EXCLUDE; staged-set + staged-blob fingerprint (23 recorded + entry 24 blob `f75c0dc4…`) PASS; `git diff --cached --check` **waived by owner** for the frozen-document class (48 legacy-archive Markdown flags + 1 historical EOF blank; **0** flags from new content); post-commit parent/paths/blobs/index/stash/HELD/EXCLUDE/source all PASS | [`STEP-2C-6-C4-COMMIT-EXECUTION.md`](./STEP-2C-6-C4-COMMIT-EXECUTION.md) |
| **2C.6-A4-PRE** | A4 committed-tree replay — pre-execution readiness | ⚠️ **READY — NOT EXECUTED, NO DATABASE CONTACT**: HEAD `eb313bb`; static `db:preflight` **PASS 22/22 exit 0**; independent **22/22 checksums, 0 mismatch, order ≡ baseline**; new disposable target `restaurant_app_test_v4` designed; exact replay commands + 7 safety gates + cleanup/recovery + rollback + expected outputs documented; known broken healthcheck recorded; **awaiting AP-3** | [`STEP-2C-6-A4-PRE-EXECUTION-READINESS.md`](./STEP-2C-6-A4-PRE-EXECUTION-READINESS.md) |
| **2C.6-A4-EXEC** | A4 committed-tree replay execution (AP-3 conditional) | ✅ **REPLAY SUCCESS — STEP 2C.6 EXECUTION COMPLETE**: HEAD `eb313bb` unchanged; new disposable `restaurant_app_test_v4` (3308, `utf8mb4_uca1400_ai_ci`, dedicated `restaurant_test_v4@%` user, credential inert in `.env.test`); guard PASS (tree identity, port/db, protected 3306/3307, Prisma 7.10.0) with `DATABASE_URL` in the **child env** only; `migrate deploy` **exit 0**, **22/22 applied in baseline order**; **49** tables (set ≡ v3), ledger **22/22/0/0**, checksums **22/22**, F.5 once, **0** business rows; **v3 unmodified** (49 / 22-22-0 / last applied 2026-10-14); 3306/3307 never contacted; v4 left as read-only evidence; no push/commit/2C.7 | [`STEP-2C-6-A4-EXECUTION.md`](./STEP-2C-6-A4-EXECUTION.md) |
| **2C.6-CLOSURE** | STEP 2C.6 final closure (AP-FINAL) | ✅ **CLOSED — READY TO ENTER STEP 2C.7**: evidence chain C1 `350afec` → C1B `cd3d849` → C2 `7dc2496` → C3 `4550d28` → C4 `eb313bb` → A4 verified; DB-free re-checks PASS (`db:preflight` 22/22 exit **0**, independent checksums 22/22 **0 mismatch**, `git diff --check` **0**, `--cached --check` **0**, secret scan clean, 25-report inventory); A4 **not** re-run; C4 whitespace **waiver** + broken healthcheck recorded as exception/limitation; **no production-readiness claim**; no commit/push; next gate **AP-2C7** | [`STEP-2C-6-FINAL-CLOSURE.md`](./STEP-2C-6-FINAL-CLOSURE.md) |
| **2C.6-DOC-COMMIT** | Close-out documentation commit (AP-DOC-COMMIT) | ✅ **COMMITTED `4729a43`** (parent `eb313bb`): message `docs(accounting): close step 2c6 execution evidence` (verbatim, no footer), **exactly the 6** post-C4 paths (`4 A` + `2 M`, +894/−62), staged path-explicit; 22 historical reports **byte-identical**; index/stash empty; HELD 6 / EXCLUDE 2 preserved; no push | `git show 4729a43` |
| **2C.7** | Code quality + lint triage | ✅ **READ-ONLY AUDIT DONE (AP-2C7-READONLY)** — full `eslint .`: **106 errors / 139 warnings / 8 autofixable** (534 files, exit **1**); `tsc --noEmit` **exit 0**; ownership src 127 / scripts 91 / tests 27; **27 findings blame to C3** (`tests/fixtures/accounting.ts` + `pnl.integration.test.ts`); accounting core **0 errors**; no `--fix` run, no source/config change; ⏸ **fix batches L1–L6 awaited approval** | [`STEP-2C-7-LINT-READINESS.md`](./STEP-2C-7-LINT-READINESS.md) |
| **2C.7-FULL** | Full code quality & lint resolution (AP-2C7-FULL) | ❌ **BLOCKED — NO COMMIT**: feasibility analysis before any edit → **180** findings fixable within the engineering rules (82 files), **16** fixable with behaviour review (8 files), **49** `react-hooks/set-state-in-effect` **errors cannot be resolved** without behaviour drift or an architecture change — error-level rule from the Next 16 preset (`eslint-plugin-react-hooks@7.1.1`), all 49 sites **pre-existing** (0 introduced by C1–C4; commit dates 2026-09-02→2026-10-10), **0** in `src/services/**` or `tests/**`; no rule disabled/downgraded, **no config change, no source file modified** (source tree byte-identical to HEAD); lint still **106e/139w exit 1**; `tsc` **0**, `db:preflight` **0**; **no commit**; needs an owner decision: **A** architecture phase (Server Components/data library + component test harness), **B** owner lint-policy ruling, or **C** partial cleanup of the 196 with the 49 as an accepted exception | [`STEP-2C-7-FULL-EXECUTION.md`](./STEP-2C-7-FULL-EXECUTION.md) |
| **2C.7-RESOLUTION** | Scoped resolution of the 196 fixable findings (AP-2C7-RESOLUTION, owner **option C**) | ✅ **COMMITTED `9666042a2185983e91f2d53e89e49de0cfe83f6e`** — message `refactor: resolve scoped step 2c7 lint debt`: **196 / 196** non-exception findings resolved (245 → **49**), **0 new findings**, `eslint .` **49 (49e/0w) exit 1** with the per-file exception inventory **byte-identical** to the baseline (42 files / 49 locations, all `react-hooks/set-state-in-effect`); no config/severity/file-exclusion change, no rule disabled, no suppression added, no schema/migration/business-rule change; `tsc` **0**, `db:preflight` **PASS 22/22**, `git diff --check` **0**, `npm run build` **exit 0**; regression **F-2 unit 24/24, M2 unit 78/78, F-2 live 4/4, accounting 111/111** (all exit 0) on the approved `3308/v3` target only; browser pass deferred to 2C.8 (documented limitation) | [`STEP-2C-7-RESOLUTION.md`](./STEP-2C-7-RESOLUTION.md) |
| 2C.8 | Full regression + UAT | ⏳ NOT STARTED | — |
| 2C.9 | Production release | ⏳ NOT STARTED | — |

## Verified baseline — carried forward

| Check | Result | Where verified |
|-------|--------|----------------|
| Migration replay (fresh v3) | 22/22 applied, exit 0 | archive §26 (STEP 2C.2E) |
| Accounting integration suites | 108/108 pass, exit 0 | archive §27 (STEP 2C.2F) |
| M2 unit suite | 57/57 pass, exit 0 | archive §27 (STEP 2C.2F) |
| TypeScript (`tsc --noEmit`) | pass | archive §27 (STEP 2C.2F); re-run in 2C.3B — exit 0 |
| Production build | pass | archive §27 (STEP 2C.2F); re-run in 2C.3B — exit 0 |
| Accounting integration suites | **110/110** pass, exit 0 | `STEP-2C-3B-REPORTING-FIX.md` §5 (108 baseline + the 2 new A-11/A-12 tests) |
| M2 unit suite | **57/57** pass, exit 0 | `STEP-2C-3B-REPORTING-FIX.md` §5 |
| F-2 unit suite (new) | **24/24** pass, exit 0 | `STEP-2C-4-DATABASE-CONNECTION.md` §20 |
| F-2 live regression (new) | **4/4** pass, exit 0 | `STEP-2C-4-DATABASE-CONNECTION.md` §20 |
| Accounting integration suites | **110/110** pass, exit 0 (re-run) | `STEP-2C-4-DATABASE-CONNECTION.md` §20 |
| M2 unit suite | **57/57** pass, exit 0 (re-run) | `STEP-2C-4-DATABASE-CONNECTION.md` §20 |
| TypeScript / build / `git diff --check` / eslint (changed files) | exit 0 each | `STEP-2C-4-DATABASE-CONNECTION.md` §20 |
| Accounting integration suites | **111/111** pass, exit 0 | `STEP-2C-5-CUTOFF-FINALIZATION.md` §18 (110 baseline + the new M2 case 30) |
| Accounting integration suites (re-run, live v3) | **111/111** pass, exit 0 — cashbook **15/15** · refund-profitability **21/21** · revenue **21/21** · pnl **24/24** · integrity **30/30**; F-2 live **4/4** | `STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md` §6 (2026-10-15) |
| M2 unit suite | **78/78** pass, exit 0 | `STEP-2C-5-CUTOFF-FINALIZATION.md` §18 (57 baseline + 21 new cutoff cases) |
| F-2 unit / live suites | **24/24** + **4/4** pass, exit 0 (re-run) | `STEP-2C-5-CUTOFF-FINALIZATION.md` §18 |
| TypeScript / build / `git diff --check` / eslint (changed files) | exit 0 each (re-run) | `STEP-2C-5-CUTOFF-FINALIZATION.md` §18 |

Baselines are **not** re-claimed by later phases unless that phase re-runs them and says so.

## Test target (locked)

`127.0.0.1:3308/restaurant_app_test_v3` only, enforced fail-closed by `tests/setup.ts`
(exact host/port/database/user, protected names and ports 3306/3307 rejected, live
`SELECT DATABASE()` identity per suite). **No writes to 3306 / 3307 / v1 / v2.**

## 2C.4 status

Phase **COMPLETE**. Approved scope A1-A5 implemented; `src/lib/database-url.ts` decodes credentials
exactly once, `src/lib/prisma.ts` / `prisma/seed.ts` / the three diagnostic scripts use it, and the
new unit + live suites cover the F-2 matrix with a mutation check. Initial Git working tree was
**22 entries** (`git status --porcelain`, HEAD `e8d4aa3`, branch `main`); it was **29** at exit (see that
report's §23). Database
snapshots before and after the verification sweep were identical (49 tables, 22 applied migrations,
0 business rows). See [`STEP-2C-4-DATABASE-CONNECTION.md`](./STEP-2C-4-DATABASE-CONNECTION.md).

## 2C.5 status

Phase **COMPLETE** (audit Part I + approved implementation/regression Part II, A1-A5 granted). Initial Git
working tree: **29 entries** (`git status --porcelain`, HEAD `e8d4aa3`, branch `main`) — identical to the
2C.4 exit state — and **29 entries** at exit (the changes landed inside already-modified/untracked entries).

* **F-5** resolved by **policy + documentation only**: v3 (`127.0.0.1:3308/restaurant_app_test_v3`) is the
  canonical isolated test baseline, published in `tests/README.md` and already enforced fail-closed by
  `tests/setup.ts`; v1/v2 stay retired read-only evidence and remain rejected by the guard. No database was
  dropped, modified or migrated and **no** historical migration metadata was fabricated.
* **M-1** fixed: `resolveLegacyCutoff()` no longer uses `LIMIT 1` over an unordered result. Every ledger row is
  read and the pure `selectLegacyCutoff()` applies eligibility (`finished_at IS NOT NULL AND rolled_back_at IS
  NULL`), a deterministic order (`finished_at ASC, id ASC`) and explicit 0/1/≥2 cardinality handling.
  `started_at` is never a fallback.
* **M1-R** (≥2 eligible rows): the **earliest** eligible apply instant is used and the ambiguity is **disclosed**
  (`cutoffDisclosure` / `LEGACY_CUTOFF_AMBIGUOUS`) instead of being treated as proven — additive, nullable,
  display-only, and never an input to any severity rule (§20 of the report).
* **M-2** fixed: the naive `DATETIME(3)` literal is interpreted **explicitly as UTC** by
  `parseNaiveUtcDateTime()` (the proven v3 convention — Prisma's reading is correct, the raw `mariadb`
  driver's is off by the process offset and must never supply a cutoff). The v3 cutoff is **value-identical**
  (`2026-10-14T07:52:58.220Z`); nothing was rewritten, mirrored, `CONVERT_TZ`-ed or back-filled, and no
  application-wide timezone setting changed.
* Verification: **111/111** accounting integration (incl. the new live M2 case 30), **78/78** M2 unit
  (57 baseline + 21 new), F-2 **24/24** + **4/4**, `tsc`/build/`git diff --check`/eslint(changed) exit **0**,
  project-wide eslint unchanged at **245**. Database before/after: 49 tables, 22 applied migrations, the F.5
  row byte-identical, 0 business rows. No commit/push/merge/deploy; **2C.6 not started**.

## 2C.6 status

Phase **IN PROGRESS — AUDIT COMPLETE (Part I) + APPROVED LIMITED FOLLOW-UP (Part II)**. Part I was a strict
read-only audit; Part II executed **only** the approved decisions A1–A7 and produced no production code, test,
schema or migration change. **No commit, no push, no deploy, no migration command, no DDL and no ledger write
in either part.** Initial Git working tree: **29 entries** (`git status --porcelain`, HEAD `e8d4aa3`, branch
`main`) — identical to the 2C.5 exit state — and **29 entries** at exit (both written files sit inside the
already-untracked `docs/` entry). `git diff --check` exit **0**.

**Part II results (approved units A1–A7):**

* **A6 — v3 target recovered.** `restaurant-mariadb-test` identity was proven *before* the start on every axis
  (same container id `bae65d9fc587…`, same image `mariadb:11.8`, same hostname, same `127.0.0.1:3308` binding,
  **same persistent volume** `restaurant-mariadb-test_data` → `/var/lib/mysql`, **no** compose labels, clean
  `ExitCode=0` / no OOM, `RestartCount=0`) and only then was the **same** container started. No pull, run,
  recreate, reset, remove, prune or volume deletion; 3307/phpMyAdmin/redis untouched.
* **v3 read-only integrity (14 checks, `SELECT`/`SHOW` only):** 49 tables · **49 × `utf8mb4_unicode_ci`** ·
  22 ledger rows · 0 unfinished · 0 rolled-back · **exactly 1 eligible F.5 row** (checksum `f4234f86…`,
  `finished_at 2026-10-14 07:52:58.220` — byte-identical to the 2C.2E record) · **22/22** ledger checksums =
  on-disk sha256 · 105 FK columns · the five F-8 tables all `utf8mb4_unicode_ci` · **0 non-ledger rows across
  all 49 tables**. v1 (49/55/6) and v2 (24/42/6) re-measured and **unchanged**. **The 3308 target is ACTIVE
  again**, so 2C.8 is unblocked (pending its own approval).
* **A3 — commit manifest prepared, nothing staged.** All **29 entries / 42 files** classified by the six requested
  categories — F-7 relocation **4** · accounting+F-2 source **11** · integration/unit tests **8** · test
  infrastructure **5** · reports+ROADMAP **8** · unrelated/suspicious **6** = **42 files** — with an include/hold
  verdict and a reason per file, plus a proposed 4-commit sequence in which **C1 (the 4-file F-7 relocation) is
  release-critical**. The four files' sha256 are unchanged from the audited state, and the relocation is
  re-proved statement-preserving (44≡44, 16≡16, lost `[]`, added `[]`). **Held back:** `.env.example`
  (pre-programme, masks a placeholder) and the pre-programme `HERMES-*` / `INVENTORY-DESIGN-REVIEW.md` audits.
  Secret scan over all 42 files: **no credential present**.
* **A5 — F-8 finalised as documentation + verification only.** The five existing collations are kept **as they
  are** (no `ALTER TABLE`/`CONVERT TO`); the deploy-time `P5`/`P6` checks and a targeted read-only 1267 probe are
  the escalation trigger, and normalisation stays gated on real evidence + backup + release window.
* **Release gate (report §13):** separate procedures for **existing** vs **fresh** databases, mandatory
  operator-verified target identity, restore-tested backup, ledger inventory, checksum reconciliation (expect
  **exactly 4** differences, and up to 4 more on a pre-`f835e13` environment), `migrate deploy` with an explicit
  URL as the only allowed command, post-checks, 8 STOP conditions and a recovery procedure. **`migrate deploy`
  exit 0 is explicitly NOT accepted as proof of schema compatibility** — a structural comparison is required.
  Two legitimate drift options (accept / revert) and two prohibited ones (`resolve`, ledger `UPDATE`).

* **F-6 (target identification):** the consumer/target matrix is established by direct configuration evidence
  (local app → 3306; integration tests → fail-closed pinned to 3308/v3 — the container had exited cleanly at
  `2026-10-14T10:06:31Z` and was **restarted under A6 and verified read-only** in Part II, so the target is
  **ACTIVE** again; Prisma CLI → 3306, i.e. risk
  **R-1 confirmed by config**; Docker Compose → its own internal `mysql` service, stack not running, **no image
  runs a migration**; PM2/README document the VPS flow but no PM2/ecosystem/env file exists here). **3306 is
  NOT concluded to be the production target** — the deployed target stays **UNKNOWN** and is closed by an
  operator-run read-only pack (report §4).
* **F-6 (checksum compatibility):** exactly **4** of 22 migration files differ from `HEAD`, and only by the F-7
  statement relocation (statement multisets per moved pair are **identical**: 44≡44 and 16≡16) — the metadata
  change is not a schema change. Fresh DB: 22/22 checksums match (no warning). Existing DB (3306): 18 match /
  4 differ, **no DDL / no data change**. Behaviour measured from the installed **Prisma 7.10.0** CLI:
  `migrate deploy` never calls `diagnoseMigrationHistory` (engine `ApplyMigrationsOutput` carries only
  `appliedMigrationNames`) → silent for already-applied migrations; `migrate status` exits 1 for the
  **pre-existing** `0_baseline` unpersisted rows; **`migrate dev` may propose a RESET and is forbidden** on any
  applied DB. **New blocking finding (CK-1): the F-7 fix is still uncommitted**, so a deployment built from
  `HEAD` would still fail at migration 6 (P3018/errno 1146).
* **F-8 (collation):** 3306 carries **5 tables** (`auditlog`, `notification`, `orderitem`, `paymenttransaction`,
  `whatsappmessage`) at MariaDB 11.8's default `utf8mb4_uca1400_ai_ci` while the chain **always** mandated
  `utf8mb4_unicode_ci` (the explicit `COLLATE` has existed unchanged since commit `5eb8231`; no
  charset-altering DDL exists anywhere). So the deviation is **reference-side, not a replay defect**, and the
  mechanism that created those five tables on 3306 is **UNKNOWN** (3306 was built incrementally — `0_baseline`
  rows). FKs are unaffected in practice (105 FKs coexist with the mix), the unique index is ASCII-only; the real
  residual risk is **error 1267 on mixed-collation comparisons inside 3306**, which this read-only audit could
  not test. Recommendation: **document + verify (A+D)**; normalising 3306 (**B**) only if a real 1267 is observed
  and only with a verified backup and release window; changing the chain (**C**) rejected.
* **Not done / not claimed:** no test was run in either part and **no suite result is claimed by 2C.6** (the
  111/78/F-2 counts stay as the 2C.5 historical baseline); live verification of `migrate deploy` behaviour on a
  disposable DB (U6, now partly reduced by CLI-code evidence + the sanctioned §13.2 E6 no-op run), production
  ledger / collation reads (U1–U3), the 1267 probe (U4) and the provenance of the 5 tables (U5) remain open;
  **U9 (new): the earlier stoppage of the v3 container was caused by something outside this programme and its
  cause is unrecorded**; 2C.7–2C.9 untouched. Part I's seven approval questions are in report §9, and Part II's
  follow-up approvals (C1 commit authorisation first) are in report §17.

## 2C.6-C1 status

Sub-gate of 2C.6 (2C.6 is **not** re-opened). **AUDIT ONLY:** no `git add`, no commit, no push, no migration command,
no schema/SQL edit, no production contact, no A4 replay, no 2C.7. Initial tree: **29 entries**, HEAD `e8d4aa3`,
branch `main`, index empty, stash 0, `git diff --check` exit **0**.

* **C1 = exactly 4 files** — the four `prisma/migrations/*/migration.sql` of `20260908030144_add_branch_multi_cabang`,
  `20260909_add_customer_auth_promo`, `20260911_add_ingredient_purchasing_wac` and
  `20260911140000_add_purchasing_inventory_foundation` → **+41 / −29**, relocation only (plus 2 comment blocks and one
  restored trailing newline). Path-explicit staging only — never `git add .`.
* **Statement-preserving:** **44 ≡ 44** and **16 ≡ 16**, lost `[]`, added `[]`. Working-tree sha256 of all four equals
  the **v3 ledger** checksums (`97ee89d5…`, `019b42ed…`, `fac529c7…`, `47365a5c…`) — the audited artefact is the
  commit candidate.
* **Order-dependent, and proven:** Prisma applies all `20260911_*` folders **before** `20260911120000…/20260911140000…`;
  under that real order `branch`, `promo`, `purchase` and `ingredient` all exist before the relocated blocks. The
  2C.2E rehearsal replayed the fixed tree **22/22, exit 0**. Do **not** reason about this chain with plain `ls | sort`
  order — it is the wrong order for this chain.
* **Checksum drift is metadata-only:** fresh/v3 = 22/22 match; a pre-fix existing DB would show **18 match / 4 differ** —
  accepted and documented per environment, **never** reconciled by rewriting `_prisma_migrations` or `migrate resolve`.
* **Not in C1:** accounting + F-2 source (C2), tests/test-infra (C3), `docs/**` (C4), and **HELD** — `.env.example`,
  the four `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`.
* **Blocker:** **AP-1 — explicit approval to commit C1** (decision A3 withheld it). C1 stays release-critical: without
  it, any environment provisioned from `HEAD` still fails at migration 11 (P3018 / errno 1146).
* Detail, exact diff, commands and STOP conditions:
  [`STEP-2C-6-C1-COMMIT-READINESS.md`](./STEP-2C-6-C1-COMMIT-READINESS.md).

## 2C.6-C1A status

Sub-gate of 2C.6-C1 (**read-only**: no `git add`/commit/push/reset/stash, no migration command, no schema/SQL edit,
no A4 replay, no 2C.7). Re-audit **audit-only**, `restaurant_app_test_v3` via **read-only `SELECT`** on 3308 only.

* **Ordering mechanism found in source, not inferred:** `node_modules/prisma/build/cli.js` sorts migration
directories with `u.sort((p,f) => p.path.localeCompare(f.path))` (ICU collation, **not** byte order) and hands that
  list to `engine.applyMigrations({migrationsList})`; the engine is not the sorter. Reproducing the same
  `localeCompare` over the 22 names matches the v3 ledger apply order **22/22**; plain `ls | sort` differs at
  **12 of 22** positions.
* **F-7 proven quantitatively by a static dependency graph** (22 files, 48 tables): **HEAD = 2 forward references**
  (`branch_multi_cabang → promo`, `ingredient_purchasing_wac → purchase`) versus the **fixed tree = 0**. HEAD is
  broken under byte order too (**1**), so it is broken under every collation; the fixed tree's only residual
  byte-order failure is **1** (`purchasing_inventory_foundation → ingredient`).
* **Re-confirmed unchanged:** statement preservation **44 ≡ 44 / 16 ≡ 16**, lost 0, added 0; working-tree sha256
  **4/4 = v3 ledger** and **4/4 ≠ HEAD** (the checksum is a byte hash, so added comments/newline change it).
* **Deploy vs status:** `migrate deploy` calls `applyMigrations()` only — it never calls
  `diagnoseMigrationHistory`; `migrate status` does. So the 18/4 checksum drift is surfaced by `status`, not acted
  on by `deploy` (engine-internal behaviour remains **UNKNOWN**).
* **No hidden dependency remains** beyond the ordering mechanism itself: 0 orphan references, no data migrations,
  and the single `DROP INDEX` is satisfied by `0000_init_schema`.
* **New caveat (not a blocker):** C1's correctness is coupled to the runner's collation (tested across 6 locales;
  residual risk is a no-ICU Node). Recorded, **not** fixed (A2 freeze).
* **Blocker unchanged: AP-1 — approval to commit C1** (C1 stays release-critical). New open items: **AP-4**
  (whether to open a follow-up removing the collation dependency) and **AP-5** (formal drift acceptance).
* Detail: [`STEP-2C-6-C1A-MIGRATION-ORDERING-AUDIT.md`](./STEP-2C-6-C1A-MIGRATION-ORDERING-AUDIT.md).

## 2C.6-C1B status

Sub-gate of 2C.6-C1 (**design only**: no script written, no source/`package.json`/README/migration change, no
`prisma` command, no DB contact, no commit). Status: **DESIGN COMPLETE — awaiting approval to implement.**

* **Root cause (reused from C1A, not re-audited):** Prisma 7.10.0 orders migrations with JS `localeCompare`
  (ICU/CLDR) in `prisma/build/cli.js`; this chain mixes 8- vs 14-digit prefixes (12/22 positions differ from byte
  order) and carries one cross-migration FK (`purchaseingredient → ingredient`). Fresh-provisioning correctness is
  therefore a property of the **runtime**, not the tree — a silent `P3018`/errno-1146 failure on a no-ICU Node.
* **Proposed control:** a **static, fail-closed preflight** — ICU canary (`"a_".localeCompare("a0") < 0`) +
  effective order (`readdir` + `sort(localeCompare)`) ≡ a **versioned baseline manifest** + sha256 of **all 22**
  `migration.sql` — run before `prisma migrate deploy`. No DB, no ledger, no SQL, **no duplicated migration
  engine**, no Prisma-internal change, no SQL/name change.
* **Files to add later:** `tools/preflight-migrations.mjs`, `tools/migration-order.baseline.json`,
  `tests/migration-ordering.unit.test.ts`; scripts `db:preflight`/`db:deploy` in `package.json`; README release note.
  Measured foot-gun: `.gitignore` `/scripts/*` ignores new files **and** subdirs → guard belongs in `tools/`.
* **Impact:** fresh DB → PASS applies 22/22, FAIL blocks **before** any DDL (no partial schema, no failed ledger
  row); existing DB → PASS is a no-op, FAIL blocks a no-op (fail-closed by design; **never** bypass with
  `migrate resolve`/ledger writes).
* **Blocker:** **AP-C1B-1…AP-C1B-5** (architecture / file set / Prisma-version policy / bypass policy /
  authorise implementation). **C1 stays on HOLD (AP-1)**; the guard is complementary to C1 and to A4, not a replacement.
* Detail: [`STEP-2C-6-C1B-RUNNER-GUARD-DESIGN.md`](./STEP-2C-6-C1B-RUNNER-GUARD-DESIGN.md).

## 2C.6-C1B-I status

Implementation of the C1B design (guard only). **Status: IMPLEMENTED & VERIFIED — awaiting AP-C1B-6.**

* **New:** `tools/preflight-migrations.mjs` (static fail-closed preflight), `tools/migration-order.baseline.json`
  (`schemaVersion 1`, `prismaVersion 7.10.0`, 22-name order, 22 sha256), `tests/migration-ordering.unit.test.ts`.
* **Changed:** `package.json` (`db:preflight`, `db:deploy` = `preflight && prisma migrate deploy`, `db:baseline:update`),
  `README.md` (preflight section + VPS note + the documented **unguarded** paths). `db:migrate`/`db:push` unchanged.
* **Checks:** `db:preflight` **PASS** on the real tree (22/22, all checksums identical); unit tests **23/23, 0 fail**;
  `npx tsc --noEmit` **0**; `npm run build` **0**; `git diff --check` **0**. `db:deploy` was **not** run.
* **Enforced:** F1 canary, F2 order, F3/F4 set, F5 checksum (incl. newline), F6 baseline, F7 non-empty,
  **F8 Prisma-version hard fail**; **no bypass flag** (test E2); `--update` is explicit and refuses when the canary
  fails (E1); a failing preflight never rewrites the baseline (T16b). Topology: no DB, no ledger, no SQL, only
  `node:` built-ins.
* **Unguarded paths (documented, not changed):** manual `npx prisma migrate deploy`, `db:migrate`, `db:push`, and the
  Docker images/compose (which run **no** migration step).
* **Blocker:** **AP-C1B-6** (accept the implementation). **C1 stays on HOLD (AP-1)**; A4 prepared-only; 2C.7 not started.
* Detail: [`STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md`](./STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md).

## 2C.6-C1B-FA status

Read-only final acceptance of the C1B guard. **Status: ACCEPTED — awaiting AP-C1B-6.**

* **Artifacts:** `tools/preflight-migrations.mjs`, `tools/migration-order.baseline.json`,
  `tests/migration-ordering.unit.test.ts` exist and are **not** gitignored (unlike new files under `scripts/`).
* **Baseline:** re-hashed independently — 22 order entries, 22 checksums, 22 on-disk dirs, **0 mismatch**.
* **Enforced:** `db:deploy` = `preflight && prisma migrate deploy`; **F8 Prisma-version mismatch = hard fail**;
  **no bypass flag/env**; `--update` explicit + canary-gated + never triggered automatically; preflight path
  **writes nothing**.
* **`next-env.d.ts`:** changed **only** by `npm run build` (`.next/dev/types` → `.next/types`); **excluded** from any
  guard commit (a path-explicit staging list is mandatory).
* **Re-verified:** guard tests **23/23 (0 fail)**, exit 0; `npm run db:preflight` **PASS**, exit 0; index **empty**,
  stash 0, `git diff --check` **0**. No migration / `db:deploy` / rebuild / integration suite was run.
* **Blocker:** **AP-C1B-6** (accept the guard) and **AP-1** (**commit C1 — still WITHHELD**). A4 prepared-only; 2C.7 not started.
* Detail: [`STEP-2C-6-C1B-FINAL-ACCEPTANCE.md`](./STEP-2C-6-C1B-FINAL-ACCEPTANCE.md).

## 2C.6-FBA status

Final commit-boundary audit (read-only; no staging/commit). **Status: AUDIT COMPLETE — awaiting AP-B1…AP-B4.**

* **Boundaries:** C1 = 4 migration SQL · C1B = 5 (`tools/*`, guard test, `package.json`, `README.md`) · C2 = 11
  (accounting/F-2 source, incl. `src/lib/database-url.ts`) · C3 = 13 (tests + `.gitignore`/`.env.test.example`) ·
  C4 = 14 docs/reports (staged **path-explicit**, `git add docs/` forbidden) · HELD = 6 · EXCLUDE = 2.
* **No partial/hunk staging needed** — every modified file has a single-purpose diff. One path-scoping rule: `docs/`.
* **Hard dependency C1 → C1B:** the guard baseline stores the **working-tree** F-7 checksums (4/4 = WT, 0/4 = HEAD),
  so C1B-before-C1 makes `db:preflight` fail (F5) and risk re-freezing pre-fix content. Edge **C2 → C3** likewise hard.
* **Sequence:** `C1 → C1B → C2 → C3 → C4` then A4 (A4 only from a committed tree; **not** authorised).
* **New UNKNOWN (STOP if staged):** `docs/accounting-hardening/.STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md.kate-swp`
  (foreign Kate swap file, 3.29 MB) — excluded, owner decision pending; `next-env.d.ts` excluded (build byproduct).
* **Blocker:** **AP-1** (commit C1 — still WITHHELD) + **AP-B1…AP-B4**. Index empty, stash 0, `git diff --check` **0**.
* Detail: [`STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md`](./STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md).

## 2C.6-C1-EXEC status

C1 controlled commit execution (AP-1 approved). **Status: C1 COMMITTED — awaiting the next approval.**

* **Commit `350afeca8bcee528152b1f2883dc4e91e5708e83`** on `main`, parent `e8d4aa3` (exactly 1 commit ahead),
  message `fix(migrations): correct historical F7 dependency ordering` (verbatim).
* **Exactly 4 files** — the F-7 migration SQL — `4 files changed, 41 insertions(+), 29 deletions(-)`; staged
  path-explicit only; no rename, no schema change, no guard/README/package.json/docs/tests staged.
* **Statement preservation re-verified against the index:** PB1 **44 ≡ 44**, PB2 **16 ≡ 16**, lost `[]`, added `[]`.
* **Post-commit:** index **empty**, stash 0, `git diff --check` **0**, `porcelain` 29 / `-uall` 51; C1B/C2/C3/C4/HELD all
  intact; `next-env.d.ts` uncommitted; `.kate-swp` untracked and still on disk.
* **Guard baseline now matches the committed blobs** (4/4 OK) — the audit's hard edge **C1 → C1B** is satisfied.
* **Blocker:** **C1B commit not yet authorised** (AP-C1B-commit); AP-C2/AP-C3/AP-C4 open; C1B accepted & closed.
* Detail: [`STEP-2C-6-C1-COMMIT-EXECUTION.md`](./STEP-2C-6-C1-COMMIT-EXECUTION.md).

## 2C.6-C1B-PC status

Final pre-commit verification of the C1B guard, **read-only**, against the now-committed C1 tree (`350afec`).
**Status: READY FOR OWNER COMMIT APPROVAL — nothing staged; the C1B commit is NOT authorised.**

* **Git gate:** branch `main`, HEAD exactly `350afec…`, index **0**, stash **0**, `git diff --check` **0**; C1 = exactly the 4 migration SQL.
* **Baseline valid for the committed tree:** `schemaVersion 1`, Prisma **7.10.0**, **22** order / **22** dirs / **22** checksums, re-hashed from `git show HEAD:<path>` — **0 missing, 0 extra, 0 mismatch**; the four F-7 = expected = committed = on-disk = baseline. `baseline:update` **not** run.
* **Runs:** `db:preflight` **PASS** (22/22, no DB, no migration, no baseline write) · guard tests **23/23, 0 fail** · `tsc --noEmit` **0** · `git diff --check` **0**. `npm run build` not re-run (acceptance evidence reused).
* **Boundary = exactly 5 files** (`tools/preflight-migrations.mjs`, `tools/migration-order.baseline.json`, `tests/migration-ordering.unit.test.ts`, `package.json`, `README.md`); `package.json` adds only `db:preflight` / `db:deploy` (= `preflight && prisma migrate deploy`) / `db:baseline:update`; no new dependency, no bypass flag/env, `--update` explicit + canary-gated. **No drift** vs the accepted implementation (24114 / 3851 / 20027 bytes).
* **Exclusions intact:** `next-env.d.ts`, the foreign `.kate-swp` (still on disk, not deleted), `.env.example`, `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`, and all C2/C3/C4 changes stay **outside** C1B; all 52 working-tree paths classified, **0 unclassified**.
* **Blocker:** **AP-C1B-commit** (authorise the 5-file, path-explicit C1B commit). No commit/staging was performed.
* Detail: [`STEP-2C-6-C1B-FINAL-PRECOMMIT-VERIFICATION.md`](./STEP-2C-6-C1B-FINAL-PRECOMMIT-VERIFICATION.md).

## 2C.6-C1B-EXEC status

C1B controlled commit execution (AP-C1B-commit approved). **Status: C1B COMMITTED — awaiting the next approval.**

* **Commit `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`** on `main`, parent `350afeca8bcee528152b1f2883dc4e91e5708e83`
  (exactly 1 commit ahead), message `chore(migrations): add fail-closed migration preflight guard` (verbatim).
* **Exactly 5 files** — `tools/preflight-migrations.mjs`, `tools/migration-order.baseline.json`,
  `tests/migration-ordering.unit.test.ts`, `package.json`, `README.md` — `5 files changed, 1303 insertions(+), 2 deletions(-)`;
  path-explicit staging only; no rename, no deletion, no migration SQL, no schema, no accounting source, no docs/report.
* **Gates:** pre-staging PASS · functional PASS (`db:preflight` **22/22**, guard tests **23/23 / 0 fail**, `tsc` **0**) ·
  staged-set PASS (set identical to the allowlist, `{A,M}` only, `--cached --check` **0**) · exclusion PASS (14 excluded paths, none staged).
* **Post-commit:** index **empty**, stash **0**, `git diff --check` **0**, `porcelain -uall` **48**; the five files **tracked & clean**;
  `db:preflight` **PASS** against the **committed** baseline; four F-7 checksums **4/4 match** (all 22 committed blobs vs baseline: **0 mismatch**).
* **Boundaries preserved:** C2 11 · C3 13 · C4 16 · HELD 6 · EXCLUDE 2 — 0 unclassified; `.kate-swp` still on disk (not deleted).
* **Blocker:** **C2/C3/C4 commits not authorised** (AP-C2/AP-C3/AP-C4); AP-B2 (`.kate-swp`) / AP-B3 (`next-env.d.ts`) open;
  A4 stays prepared-only (AP-3); STEP 2C.7 not started.
* Detail: [`STEP-2C-6-C1B-COMMIT-EXECUTION.md`](./STEP-2C-6-C1B-COMMIT-EXECUTION.md).

## 2C.6-C2 status

Checkpoint 1 of the master execution prompt: final readiness verification of the accounting-source boundary.
**Status: READY FOR OWNER COMMIT APPROVAL — nothing staged.**

* **Boundary:** exactly **11 files** (F-2 `src/lib/database-url.ts` + its 4 call sites; A-9/A-11/A-12
  `src/services/report/report.service.ts` + the export-route note; M-1/M-2 `integrity.{rules,service,types}.ts`).
  Present 11/11, **disjoint** from C3/C4/HELD/EXCLUDE and from the committed C1B; **0** unclassified paths.
* **No drift:** all 10 recorded diffstats match the FINAL COMMIT BOUNDARY AUDIT exactly (e.g. `rules` +367/−4,
  `service` +186/−30, `types` +104/−13, `report.service` +13/−7) and the accepted symbols/call sites are confirmed
  in the source; SHA256 of all 11 recorded in the report. Expected commit stat: **11 files, +819/−80**.
* **Fresh verification (real exit codes):** F-2 unit **24/24** · M2 unit **78/78** · `tsc --noEmit` **0** ·
  `eslint` (11 files) **0 errors / 2 pre-existing warnings** · `git diff --check` **0**. Both unit suites are DB-free.
* **Not verified here:** the 5 accounting integration suites + the F-2 live regression need a port-3308 target
  approval (C3 checkpoint); their 111/111 and 4/4 counts remain **historical**, not fresh.
* **Blocker:** **AP-C2** (authorise the 11-file path-explicit C2 commit). Continuation state:
  [`EXECUTION-STATE.md`](./EXECUTION-STATE.md).
* Detail: [`STEP-2C-6-C2-FINAL-READINESS.md`](./STEP-2C-6-C2-FINAL-READINESS.md).

## 2C.6-C2-EXEC status

C2 controlled commit execution (AP-C2 approved). **Status: C2 COMMITTED — awaiting the next approval.**

* **Commit `7dc2496a6a10ffa5c5ad268f769601389d2d7cba`** on `main`, parent `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`
  (exactly 1 commit ahead), message `feat(accounting): correct F-2 credential parsing and canonical revenue predicates` (verbatim).
* **Exactly 11 files** (`{A, M}` only) — `11 files changed, 819 insertions(+), 80 deletions(-)`; path-explicit staging only;
  staged-blob SHA256 **11/11** identical to the readiness fingerprint; no C3/C4/HELD/EXCLUDE, no `.env*`, no migration SQL, no schema, no report.
* **Gates:** pre-staging PASS · SHA256 fingerprint PASS (working tree 11/11) · functional PASS (`db:preflight` **22/22**,
  F-2 unit **24/24**, M2 unit **78/78**, `tsc` **0**, `diff --check` **0**) · staged-set PASS (set identical, stat exactly +819/−80,
  `--cached --check` **0**) · staged-blob fingerprint PASS · exclusion PASS.
* **Post-commit:** HEAD one above `cd3d849` · index **empty** · stash **0** · `diff --check` **0** · committed-blob fingerprint **11/11** ·
  `tsc --noEmit` **0** · `db:preflight` **PASS** · C3 13 / C4 19 / HELD 6 / EXCLUDE 2 preserved (0 unclassified) ·
  `prisma/migrations/**` and `prisma/schema.prisma` untouched.
* **Blocker:** **C3 commit not authorised** (AP-C3), and C3's integration suites need a separate explicit database-target approval.
* Detail: [`STEP-2C-6-C2-COMMIT-EXECUTION.md`](./STEP-2C-6-C2-COMMIT-EXECUTION.md); continuation state: [`EXECUTION-STATE.md`](./EXECUTION-STATE.md).

## 2C.6-C3 status

Checkpoint 2 of the master execution prompt: static readiness of the accounting test + test-infrastructure boundary.
**Status: STATIC READINESS PASS — DATABASE INTEGRATION PENDING APPROVAL. Nothing staged; no database contact.**

* **Boundary:** exactly **13 files** — `.gitignore` (+1/−0 = `.env.test` only), `.env.test.example` (new),
  `src/services/accounting/integrity.unit.test.ts` (+848/−1), `src/lib/database-url.unit.test.ts`,
  `tests/README.md`, `tests/setup.ts`, `tests/fixtures/accounting.ts`, the five `tests/accounting/*.integration.test.ts`,
  `tests/database-connection.integration.test.ts`. Present **13/13**, diffstats match FBA §6, **disjoint** from
  C2/C4/HELD/EXCLUDE, 0 unclassified. SHA256 fingerprint **13/13** recorded for the commit gate.
* **Safety:** `tests/setup.ts` remains **fail-closed** (rejects protected names *and* ports 3306/3307, non-`mysql:` scheme,
  `localhost`, any non-v3 target, and a disagreeing `TEST_DATABASE_URL`/`DATABASE_URL` pair; live `DATABASE()`/`USER()`/`VERSION()`
  identity asserted); `.env.test.example` holds only `<password>` placeholders (secret scan clean); the committed C2 source is
  byte-identical; migration SQL and `prisma/schema.prisma` unchanged.
* **Fresh safe verification:** F-2 unit **24/24** · M2 unit **78/78** · `tsc --noEmit` **0** · `db:preflight` **PASS 22/22** · `git diff --check` **0**.
* **Not verified:** the 5 accounting integration suites and the live F-2 regression — no database contact was made.
  Historical counts (111/111, 4/4) are **not** claimed as fresh. **The `restaurant-mariadb-test` container is currently
  `Exited (0)`** and port 3308 is not listening, so the suites cannot run until it is started (an environment mutation
  needing owner authorisation).
* **Blockers:** **AP-C3-COMMIT** (staging/commit) and a separate **database-target approval** (target + container start).
* Detail: [`STEP-2C-6-C3-FINAL-READINESS.md`](./STEP-2C-6-C3-FINAL-READINESS.md); continuation state: [`EXECUTION-STATE.md`](./EXECUTION-STATE.md).

## 2C.6-C3-DB status

Authorised C3 database test run (AP-C3-DB-TEST) + the conditional AP-C3-COMMIT gate.
**Status: BLOCKED — NO COMMIT.** Nothing staged; **no fix was applied**; C4 FINAL READINESS was **not** started.

* **Used authorisations:** started the existing `restaurant-mariadb-test` container (no recreate/volume op), verified the
  target identity read-only, ran the suites, and cleaned only run-created data (residual **0**).
  **Never contacted 3306/3307**; application `.env` untouched.
* **Identity PASS:** `127.0.0.1:3308/restaurant_app_test_v3` as `restaurant_test_v3@…`, MariaDB **11.8.9**, 49 tables,
  22 ledger rows, 0 unfinished/rolled back (`@@port=3306` inside the container is the documented convention).
* **Gates PASS:** F-2 unit **24/24** · M2 unit **78/78** · `tsc` **0** · `db:preflight` **22/22** · fingerprint **13/13** ·
  F-2 live regression **4/4** · revenue **21/21** · pnl **24/24** · live integrity **30/30**.
* **FAIL:** cashbook **14/15** (`tests/accounting/cashbook.integration.test.ts:751` — 1 ≠ 0, "a refund's createdAt is not a
  cash movement") and refund-profitability **20/21** (`…refund-profitability.integration.test.ts:1059` — 350000 ≠ 40000,
  "the Refund row is counted once"). Both reproduce deterministically.
* **Root cause (leading, evidence-backed):** a **calendar-dependent isolation defect in the C3 test fixtures** — helpers
  stamp approvals with `new Date()` (**today = 2026-10-15**) while the failing tests query a **hardcoded** `"2026-10-15"`
  window, so that window is no longer empty. On 2026-10-14 it was future-dated and empty → the run was green. Ruled out by
  measurement: C1/C1B/C2 content (all C2 files predate the 17:04 green run and are clean vs HEAD), test drift (test file
  mtimes predate the green run), residual data (all monitored tables 0), DB structure/identity drift. Not a product-code or
  database fault.
* **Consequence:** the conditional AP-C3-COMMIT's condition 2 (all accounting suites PASS) is unmet → **C3 cannot be
  committed as-is**; the 2C.5 “111/111” figure is historical and **not** contradicted (it was measured on 2026-10-14).
* **Blocker:** a **new owner decision** on the two failing suites (authorise a test/fixture fix, or formally accept a
  documented test-side calendar defect). The test container is currently **running** (was `Exited`).
* Detail: [`STEP-2C-6-C3-INTEGRATION-BLOCKER.md`](./STEP-2C-6-C3-INTEGRATION-BLOCKER.md); continuation state: [`EXECUTION-STATE.md`](./EXECUTION-STATE.md).

## 2C.6-C3-FIX + 2C.6-C3-EXEC status

Scoped repair of the two blockers recorded by 2C.6-C3-DB, then the conditional C3 commit.
**Status: C3 COMMITTED — awaiting the next approval. Nothing pushed; A4/2C.7 untouched.**

* **Proven root causes (not hypotheses).** (a) Cashbook test 3 settles a payment through the **real**
  `PaymentService.markCashierPaymentPaid`, which stamps `paidAt = new Date()`; the suites clean only in `after()`, so that
  movement stayed for test 10, which asserts a **hardcoded** `2026-10-15` window is empty — true only while the run date
  is not 2026-10-15. (b) The profitability suite had the same shape with seven `const createdAt = new Date()` fixtures +
  `decideRefund`'s `approvedAt = now`, adding 310000 of foreign refund impact to test 10's `profit("2026-10-15")`.
  `tests/fixtures/accounting.ts` was **investigated and cleared** (its `createFullRefund`/`createLegacyRefund` use
  `new Date()` but have zero call sites — documented obsolete in `tests/README.md:416-418`).
* **Fix (test-only, 2 of the 13 C3 paths):** cashbook gained `D.oct3`/`T.oct3` and test 3 now relocates the live stamp onto
  that dedicated day (documented FIXTURE MANEUVER — the same technique `pnl.integration.test.ts` already uses) before
  asserting on it; the profitability suite gained `pinRefundDay()` + `pinTo`, replaced **all 10** clock-derived fixture
  timestamps with per-test dedicated days (Oct 1/3/4/5/6/7/8/9/11/14) and relocated **9** approvals onto them. **No**
  expected value, window, skip, `.only`, suppression or product-code line changed.
* **Verification (real exit codes, `pipefail`):** cashbook **15/15**, refund-profitability **21/21**, revenue **21/21**,
  pnl **24/24**, live integrity **30/30**, F-2 live **4/4**, F-2 unit **24/24**, M2 unit **78/78**, `tsc` **0**,
  `db:preflight` **22/22**, `git diff --check` **0** — **111/111** accounting; residual **0**; identity **PASS**.
* **Date-independence regression:** both repaired suites pass on local **2026-10-15** (the day that made the unfixed code
  fail) and on local 2026-10-14 (`TZ=Etc/GMT+12`) — the failures are not merely hidden by today's date.
* **Commit:** `4550d28a9213c06de39f332ae2c07bc2a0cab5f9`, parent `7dc2496a…`, message
  `test(accounting): add isolated accounting regression coverage`; 13 paths, `A/M` only, staged-set + staged-blob
  fingerprint **13/13** MATCH, index/stash empty after, C4/HELD/EXCLUDE preserved, `prisma/` untouched.
* **Blocker:** **AP-C4-COMMIT** (C4 manifest staging/commit) — C4 FINAL READINESS was prepared, nothing staged.
* Detail: [`STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md`](./STEP-2C-6-C3-TEST-FIX-AND-COMMIT.md); continuation state: [`EXECUTION-STATE.md`](./EXECUTION-STATE.md).

## 2C.6-C4-EXEC + A4-PRE status

C4 documentation archive committed under **AP-C4-COMMIT**; A4 readiness prepared but **not executed**.
**Status: C4 CLOSED — awaiting AP-3. Nothing pushed; STEP 2C.7 untouched.**

* **Commit `eb313bb13d2670b45a2aeb73a7b370d554931321`** on `main`, parent `4550d28a…` (exactly 1 commit ahead), message
  `docs(accounting): consolidate hardening evidence and roadmap` (verbatim). **24 files, all `A`, +12592/−0**; path-explicit
  staging only; no source/test/guard/migration/schema, no `.env*`, no HELD/EXCLUDE path.
* **Classification reconciled:** worktree = **32 entries** = 24 C4 + 6 HELD + 2 EXCLUDE. The readiness report's earlier “31”
  was measured **before the report itself existed** (23 + 6 + 2) → documentation counting artifact only; **manifest unchanged**,
  0 ambiguous/missing/unclassified paths.
* **Fingerprint:** entries 1–23 verified **23/23** on the working tree, the **staged blobs** and the **committed blobs**;
  entry 24 (the manifest-bearing report) carries no self-hash — its **staged blob `f75c0dc4…`** is the recorded proof and the
  committed blob reproduces it exactly. All **20** historical paths byte-identical to the pre-session snapshot.
* **Waived gate (recorded):** `git diff --cached --check` exits **2** with **49** flags, **all** inside two frozen documents
  (legacy archive: 48 Markdown hard-break trailing spaces; 2C.5 report: 1 EOF blank line) — **0** from newly authored content.
  Exit 0 would have required editing frozen historical reports; the owner ruled **waive for this class, then commit**. The one
  flag that was ours (readiness report EOF blank) was fixed and re-gated before the commit.
* **Post-commit:** parent correct · exactly 24 paths, no 25th · committed blobs == staged blobs (24/24) · index/stash empty ·
  `git diff --check` **0** · HELD 6 / EXCLUDE 2 preserved · `prisma/`, `src/`, `tests/`, `tools/` untouched · worktree reduced
  to exactly the 8 HELD/EXCLUDE entries.
* **A4 readiness (not executed):** static `npm run db:preflight` **PASS exit 0** (22 on disk / 22 baseline, Prisma 7.10.0,
  ICU 78.3) and an independent **22/22 checksum / order ≡ baseline** verification; replay target `restaurant_app_test_v4` on the
  same 3308 container; exact guarded commands (`DATABASE_URL` in the child env only — risk **R-1** neutralised), 7 safety gates,
  STOP conditions, expected outputs, cleanup/recovery and rollback documented. **No database contact, no `migrate deploy`.**
* **Blocker:** **AP-3** (A4 replay execution). AP-C4 ≠ AP-3. Two reports of this subphase
  (`STEP-2C-6-C4-COMMIT-EXECUTION.md`, `STEP-2C-6-A4-PRE-EXECUTION-READINESS.md`) plus the ROADMAP/EXECUTION-STATE updates are
  **intentionally uncommitted** — no second commit was made for them.

## Production readiness

🚫 **NOT READY FOR PRODUCTION.** **A-9 / A-11 / A-12** are **FIXED and covered** (2C.3B); **F-2 is
FIXED, regression-covered and mutation-verified** (2C.4). Open blockers: **F-6 / F-8 — audited by 2C.6 but
NOT resolved** (the audit produced findings and options; the decisions are behind the §9 approval gate, and
**CK-1: the F-7 migration repair is still uncommitted**); the six hand-rolled canonical-predicate duplicates
(2C.7 candidate). **F-5, M-1 and M-2 are closed** by 2C.5, and the stale `tests/README.md` F-2 note
(a 2C.4 follow-up) is corrected there. The approved v3 test target is **ACTIVE again** (restarted under A6 and
re-verified read-only in Part II), so 2C.8 is no longer blocked by infrastructure — only by its own approval
gate. The release remains blocked by **CK-1: the F-7 migration repair is still uncommitted**, and by the
operator-side target verification that A1 authorised but which no phase can perform from this workspace.
No commit, push, merge or deploy until 2C.9 is explicitly approved.

## Phase rules (apply to every step)

- One phase at a time; each requires explicit approval before it starts.
- No unrelated refactoring, no global lint cleanup, no schema/migration edits, no M2
  production-file changes (unless the phase explicitly says otherwise).
- Tests run sequentially against v3; real exit codes and pass counts are recorded.
- If a phase would need a change to the canonical business rule, it STOPS and asks.

## 2C.3B authorization (granted)

Minimal fix of the three confirmed predicate-drift sites in
`src/services/report/report.service.ts` (A-9 `busiestHours`, A-11 `getProductReport`
product aggregation, A-12 `getMultiOutletReport` order-type breakdown) reusing
`revenueSetSql`, plus the stale comment in
`src/app/api/reports/products/export/route.ts`. Canonical revenue eligibility and refund
mathematics are **frozen**. Optional six-site duplication cleanup is **out of scope**.
