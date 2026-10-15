# STEP 2C.6 — C3 FINAL READINESS VERIFICATION

**Subphase of 2C.6 · mode: READ-ONLY STATIC READINESS · C3 NOT STAGED, NOT COMMITTED · NO DATABASE CONTACT**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD | `7dc2496a6a10ffa5c5ad268f769601389d2d7cba` (C2) |
| Branch | `main` |
| Predecessors | C1 `350afec` · C1B `cd3d849` · C2 `7dc2496` — **CLOSED; not re-audited, not amended** |
| Inputs (read-only) | `ROADMAP.md`, `EXECUTION-STATE.md`, `STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md` (§6), `STEP-2C-6-C2-COMMIT-EXECUTION.md`, `tests/README.md`, `STEP-2C-5-CUTOFF-FINALIZATION.md` §18, `STEP-2C-4-DATABASE-CONNECTION.md` §20, `STEP-2C-6-C1A-MIGRATION-ORDERING-AUDIT.md` |
| Verdict | ⚠️ **C3 STATIC READINESS PASS — DATABASE INTEGRATION PENDING APPROVAL** |

> **Scope.** Verification only. **No** staging, commit, push, merge/rebase, amend, reset/restore/stash, **no database
> connection of any kind** (3306/3307/3308 untouched — no `SELECT`, no client, no migration), no test data created or
> deleted, no migration/replay, no `db:deploy`, no `db:baseline:update`, no A4, no deployment, no STEP 2C.7. No source,
> test, guard or historical report was edited. The only writes are this report, a short ROADMAP update and
> `EXECUTION-STATE.md`.
>
> **Missing evidence note.** No standalone C3-specific audit report exists in `docs/accounting-hardening/`; the C3
> boundary is defined by `STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md` §6 and the test documentation in `tests/README.md`.
> That gap is recorded here rather than papered over with a substitute report.

---

## 1. Initial Git state `[Measured]`

| Item | Value |
|---|---|
| `git branch --show-current` | `main` |
| `git rev-parse HEAD` | `7dc2496a6a10ffa5c5ad268f769601389d2d7cba` |
| `git log --oneline -4` | `7dc2496` (C2) · `cd3d849` (C1B) · `350afec` (C1) · `e8d4aa3` |
| Index (staged) | **empty** (0) |
| Stash | **empty** (0) |
| `git diff --check` | **exit 0** |
| `git status --porcelain=v1 -uall` | **41** entries (4 modified + 37 untracked) |

---

## 2. Exact C3 boundary — 13 paths `[Measured]`

```
.gitignore                                                      M   +1/−0
.env.test.example                                              ??  (new)
src/services/accounting/integrity.unit.test.ts                  M   +848/−1
src/lib/database-url.unit.test.ts                              ??  (new)
tests/README.md                                                ??  (new)
tests/setup.ts                                                 ??  (new)
tests/fixtures/accounting.ts                                   ??  (new)
tests/accounting/cashbook.integration.test.ts                  ??  (new)
tests/accounting/revenue.integration.test.ts                   ??  (new)
tests/accounting/refund-profitability.integration.test.ts      ??  (new)
tests/accounting/pnl.integration.test.ts                       ??  (new)
tests/accounting/integrity.integration.test.ts                 ??  (new)
tests/database-connection.integration.test.ts                  ??  (new)
```

| Check | Result |
|---|---|
| All 13 paths available | **13 / 13 present, 0 missing** ✅ |
| Allowlist duplicates | **13 distinct of 13** ✅ |
| Diffstat vs the FINAL COMMIT BOUNDARY AUDIT §6 | `.gitignore` **+1/−0** ✓ and `integrity.unit.test.ts` **+848/−1** ✓ (the other 11 are new files) ✅ |
| C3 ∩ C2 (committed source) | **NONE** ✅ |
| C3 ∩ C4 | **NONE** ✅ |
| C3 ∩ HELD | **NONE** ✅ |
| C3 ∩ EXCLUDE (`next-env.d.ts`, `.kate-swp`) | **NONE** ✅ |
| C3 ∩ C1B (committed) | **NONE** ✅ |
| Unclassified working-tree paths | **NONE** ✅ |
| C2 boundary still dirty | **NONE** (all 11 committed and clean) ✅ |

Expected commit stat if approved: **13 files** (11 new + 2 modified).

---

## 3. SHA256 fingerprint — 13/13 recorded `[Measured]`

```
1eff42edbe9e06ee3b9cfc6ed56e347fe002d171cab300b18c20dda841e0dc0b  .gitignore
4a8359b302f483f688b0b90645bd53e74a07e93858787c02dbe5c356cad351f4  .env.test.example
256353d49ccd9d61e7b14bdcfedcee36e5c93cc2e0e78439029090f984f87baf  src/services/accounting/integrity.unit.test.ts
0ecbd4a1c5592721c9a85a846f0c7fdf2d9dd6cc6337982f21e3d8c4b05929e2  src/lib/database-url.unit.test.ts
bc95229817dc6aca6f59c3006f739e510495748478bd436507628a4a691009b6  tests/README.md
d3f9410b43fd25162e2d2f63fb0d353aace0e83dfea87af33bfb9f4d14537e1b  tests/setup.ts
78f9efe0c24ed649ed322a5f98f79bea737419479cd0c5f22b5609b1a1002375  tests/fixtures/accounting.ts
3c42d3dfd14a5c0a375bba69a0b2973b8367e53c1bc7f402224c19f4289cc460  tests/accounting/cashbook.integration.test.ts
1425e5de9e28a872c986f09452117e0cfd95686c51de0618639f41e162fa8af0  tests/accounting/revenue.integration.test.ts
93cb1b47fb1e056b4c09f0bdd6c98c082c76395789f7d33d1b267a2bb4014648  tests/accounting/refund-profitability.integration.test.ts
7ce5c60d8fee0870045ef037d98dceb25281eee23a9b6c602dcfdbd3010530dd  tests/accounting/pnl.integration.test.ts
c8a0d3c4a51847a8bb3d704a542a7d2d063ef1da7c49e13bcb524d583057bcf4  tests/accounting/integrity.integration.test.ts
97eac4273fc726ba39028fb5d2ee18dcb8047790bd629da083cdab86aa5d34d9  tests/database-connection.integration.test.ts
```

This is the fingerprint the C3 commit gate must reproduce for **both** the working tree and the staged blobs.

---

## 4. Content checks `[Measured]` / `[Code]`

| # | Check | Result |
|---|---|---|
| 1 | `.gitignore` carries only the accepted change | `git diff -- .gitignore` = a single hunk adding **`.env.test`** (+1/−0) — no guard negation, no unrelated entry ✅ |
| 2 | `.env.test.example` carries **no real credential** | all DSNs use the literal placeholder `<password>`; the file is a template telling the operator to copy it to the gitignored `.env.test`. No literal secret anywhere ✅ |
| 3 | Secret scan over all 13 C3 files | only benign hits: synthetic unit fixtures (`"simplepassword"`, `"pa/ss-word"`, `app_user`) and runtime reads (`decodeURIComponent(url.password)`, `approvedTest.password`) ✅ |
| 4 | `tests/setup.ts` still **fail-closed** | `APPROVED_TEST_TARGET` = `mysql:` / `127.0.0.1` / `3308` / `restaurant_app_test_v3` / `restaurant_test_v3`; the guard runs **at import** (so a new consumer cannot skip it) and **throws** (never warns) on: missing/empty value; non-`mysql:` scheme; **protected databases** (`restaurant_app`, `restaurant_app_test`, `restaurant_app_test_v2`, `production`, `main`, `app`); **protected ports 3306/3307**; host ≠ `127.0.0.1` (`localhost` explicitly rejected); port ≠ 3308; database ≠ v3; user ≠ the dedicated account; and when `TEST_DATABASE_URL` and `DATABASE_URL` **disagree** ✅ |
| 5 | Protected databases cannot be used by tests | rejected **by name and by port** before any client is created; `DATABASE_URL` is then pinned to the test DSN (with a warning if it differed) **before** any Prisma import ✅ |
| 6 | Live identity guard present | `assertLiveTestTarget()` asserts live `DATABASE()` = `restaurant_app_test_v3`, `USER()` starts with `restaurant_test_v3@`, and `VERSION()` matches `MariaDB` ✅ |
| 7 | Committed C2 source unchanged by C3 | all **11** C2 files: `sha256(git show HEAD:<path>)` == working-tree sha256 → **IDENTICAL** ✅ |
| 8 | Migration SQL + Prisma schema unchanged | `git status -- prisma/` → nothing; `git diff HEAD -- prisma/migrations prisma/schema.prisma` → **empty** ✅ |

---

## 5. Safe verification results `[Measured]` — actual exit codes

| # | Command | Expected | **Actual** | Result |
|---|---|---|---|---|
| V1 | `npx tsx --test src/lib/database-url.unit.test.ts` | 24/24 | **exit 0** — tests 24, pass 24, fail 0 | ✅ |
| V2 | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | 78/78 | **exit 0** — tests 78, pass 78, fail 0 | ✅ |
| V3 | `npx tsc --noEmit` | exit 0 | **exit 0** | ✅ |
| V4 | `npm run db:preflight` | 22/22 PASS | **exit 0** — 22 on disk / 22 in baseline | ✅ |
| V5 | `git diff --check` | exit 0 | **exit 0** | ✅ |

V1/V2 and V4 were piped through `tail`; each tested command's status was captured explicitly via
`${PIPESTATUS[0]}` (**0**). Both unit suites are DB-free (no `tests/setup.ts` import, no connection).

---

## 6. Database safety and the pending integration gate `[Measured]`

**No database connection was opened in this checkpoint.** The accounting integration suites and the live F-2
regression were **not** run.

| Item | Value |
|---|---|
| Historical approved target `[Recorded]` | container `restaurant-mariadb-test` · port **3308** · `restaurant_app_test_v3` · user `restaurant_test_v3` |
| **Current container state** (read-only `docker ps -a`; **no DB connection**) | `restaurant-mariadb-test | mariadb:11.8 | status=**Exited (0)** 2 hours ago | ports=(none)` |
| Host listeners (read-only `ss -ltn`) | **3306** and **3307** listening (the two protected databases, untouched); **3308 NOT listening** |
| Integration verification | ⏳ **PENDING TARGET APPROVAL — and the target is currently stopped** |
| Historical counts (NOT fresh) | accounting integration **111/111** (2C.5 §18) · F-2 live **4/4** (2C.4 §20) |

**Consequence:** even if a database-target approval were granted now, the suites could not run: the test container is
**exited** and port 3308 is not bound. Starting that container is an **environment mutation**, so it is **not**
performed here and is called out as an explicit item in the approval request (§9).

3306 (shared application DB) and 3307 (sibling project) remain **PROTECTED**: no write, reset, replay, truncate or
migration; the application `.env` was not modified.

---

## 7. Missing verification (honest gap list)

| Item | Status |
|---|---|
| `tests/accounting/{cashbook,revenue,refund-profitability,pnl,integrity}.integration.test.ts` | **not run** — requires a DB-target approval **and** a running 3308 target |
| `tests/database-connection.integration.test.ts` (live F-2 regression, 4/4 historical) | **not run** — same requirement |
| `npm run build` | not run (avoid generated-file drift); last build is **historical** evidence only |
| A4 committed-tree replay | **prepared-only** — needs AP-3 |
| No standalone C3 audit report exists | recorded as missing evidence (see the scope note) |

---

## 8. Risks

| ID | Risk | Severity | Note |
|---|---|---|---|
| C3R-1 | Integration acceptance for C3 is **unproven** in this session | Medium | static readiness is PASS; the suites need an approval **and** a live target |
| C3R-2 | The test container is **stopped** | Medium | starting it is an environment mutation needing owner authorisation; until then no integration run is possible |
| C3R-3 | Committing C3 alone leaves the integration suites historically, not freshly, evidenced | Medium | acceptable only if explicitly accepted by the owner at the AP-C3-COMMIT gate |
| C3R-4 | `tests/setup.ts` pins `process.env.DATABASE_URL` at import | Low | by design; it is the mechanism that prevents integration tests touching the application DB |
| C3R-5 | The `.env.test` file (gitignored) holds the real password | Low | only the `<password>`-placeholder `*.example` template is in C3 — verified (§4 item 2) |
| C3R-6 | A broad `git add` would sweep in the 20 C4, 6 HELD and 2 EXCLUDE entries | High if executed | path-explicit staging remains mandatory |

---

## 9. Commit readiness verdict and remaining approvals

### ⚠️ C3 STATIC READINESS PASS — DATABASE INTEGRATION PENDING APPROVAL

The 13-file boundary is present, complete, disjoint, fingerprint-recorded, secret-free, still fail-closed, and all
five safe checks PASS. **C3 is not staged and not committed**, and the integration half of C3 acceptance is
**not** claimed.

Two separate decisions are required, and **neither is implied by the other**:

| Gate | What is requested | Status |
|---|---|---|
| **AP-C3-COMMIT** | authorise **one** commit of the exact 13 paths (path-explicit) | ⏸ **OPEN — blocks staging** |
| **Database-target approval** | explicit authorisation naming the target (port **3308**, `restaurant_app_test_v3`, user `restaurant_test_v3`) **plus** authorisation to **start the `restaurant-mariadb-test` container** so the suites can run | ⏸ **OPEN — blocks integration verification** |
| **AP-C4-COMMIT** | C4 documentation commit (manifest to be built after C3 is committed) | ⏸ not yet requested |
| **AP-3** | A4 committed-tree replay (target must be disposable and named) | ⏸ open |
| AP-B2 / AP-B3 / AP-4 / AP-2 | `.kate-swp` · `next-env.d.ts` · collation follow-up · HELD files | ⏸ open |

**STOP.** No staging, no commit, no database contact, no container start, no migration. Awaiting the owner's explicit
decision on the two open gates above.

---

## Appendix A — Commands executed and real exit codes

| # | Command | Exit |
|---|---|---|
| 1 | `git branch --show-current` · `git rev-parse HEAD` · `git log --oneline -4` | 0 |
| 2 | `git diff --cached --name-only` · `git stash list` · `git diff --check` · `git status --porcelain=v1 -uall` | 0 / 0 / **0** / 0 (41) |
| 3 | 13-path existence + `stat -c %s` + `git status --porcelain` + `git diff --numstat` | 0 |
| 4 | `git diff -- .gitignore` · `cat .env.test.example` · secret-pattern grep across the 13 files | 0 |
| 5 | `sha256sum` × 13 | 0 |
| 6 | C2 blob-vs-working-tree `sha256` × 11 | 0 (all IDENTICAL) |
| 7 | `git status -- prisma/` · `git diff HEAD -- prisma/migrations prisma/schema.prisma` | 0 (both empty) |
| 8 | `npx tsx --test src/lib/database-url.unit.test.ts` (`PIPESTATUS`) | **0** (24/24) |
| 9 | `npx tsx --test src/services/accounting/integrity.unit.test.ts` (`PIPESTATUS`) | **0** (78/78) |
| 10 | `npx tsc --noEmit` | **0** |
| 11 | `npm run db:preflight` (`PIPESTATUS`) | **0** (PASS 22/22) |
| 12 | `git diff --check` | **0** |
| 13 | boundary classification (41 paths) | 0 (**NONE** unclassified) |
| 14 | `docker ps -a --filter name=restaurant-mariadb-test` (**container state only — no DB connection**) | 0 (Exited (0)) |
| 15 | `ss -ltn \| grep 3306/3307/3308` (**read-only socket listing**) | 0 (3306/3307 listening; 3308 absent) |

**Not run (prohibited or not authorised):** any database connection, the accounting integration suites, the live F-2
regression, test-data creation/deletion, migrations, A4, `db:deploy`, `db:baseline:update`, `npm run build`,
`git add`/`commit`/`push`/`reset`/`restore`/`stash`/`merge`/`rebase`/`amend`, deployment, STEP 2C.7.
