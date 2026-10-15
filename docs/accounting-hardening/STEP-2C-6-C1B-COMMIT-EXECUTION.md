# STEP 2C.6-C1B — CONTROLLED COMMIT EXECUTION

**Subphase of 2C.6-C1B · mode: STRICT CONTROLLED COMMIT (five-file allowlist) · AP-C1B-commit APPROVED**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| Pre-commit HEAD | `350afeca8bcee528152b1f2883dc4e91e5708e83` |
| **Commit** | **`cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`** |
| Parent | `350afeca8bcee528152b1f2883dc4e91e5708e83` (exactly 1 commit ahead) |
| Message | `chore(migrations): add fail-closed migration preflight guard` (verbatim) |
| Branch | `main` |
| Inputs (read-only) | `ROADMAP.md`, `STEP-2C-6-C1B-FINAL-ACCEPTANCE.md`, `STEP-2C-6-C1B-FINAL-PRECOMMIT-VERIFICATION.md`, `STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md`, `STEP-2C-6-C1-COMMIT-EXECUTION.md` |
| Verdict | ✅ **C1B CONTROLLED COMMIT SUCCESS** |

> **Scope.** Exactly one commit containing exactly the five C1B files, staged path-explicitly. **No** push, merge,
> rebase, amend, broad staging, reset/restore/stash, migration execution/replay, database contact, `db:deploy`,
> `db:baseline:update`, A4, deployment, C2/C3/C4 commit, HELD/EXCLUDE edit, or STEP 2C.7. No file was fixed
> automatically. The only writes after the commit are this new report and a short ROADMAP update.

---

## 1. Owner approval scope

| Item | Value |
|---|---|
| Approval | **AP-C1B-commit = APPROVED (explicit)** |
| Covered by the approval | **one** commit containing **exactly five** C1B files (allowlist §5) |
| **Not** covered | push · migration execution · database contact · A4 · C2/C3/C4 commits · HELD/EXCLUDE changes · deployment · STEP 2C.7 |
| Re-use | the accepted final-verification evidence was used; **no** implementation or architecture audit was repeated |

---

## 2. Initial HEAD and Git state `[Measured]`

| Item | Value |
|---|---|
| `git branch --show-current` | `main` |
| `git rev-parse HEAD` | `350afeca8bcee528152b1f2883dc4e91e5708e83` |
| `git diff --cached --name-only` | **empty** (index 0) |
| `git stash list` | **empty** (stash 0) |
| `git diff --check` | **exit 0** |
| `git status --porcelain=v1` (short) | **29** |
| `git status --porcelain=v1 -uall` | **53** (16 modified + 37 untracked) |

The `-uall` figure is 53 rather than the 52 recorded during the pre-commit verification because this programme's
own `STEP-2C-6-C1B-FINAL-PRECOMMIT-VERIFICATION.md` was created after that measurement. It is **not** used as a gate.

---

## 3. Pre-staging gate — **PASS**

| Requirement | Measured | Result |
|---|---|---|
| Branch `main` | `main` | ✅ |
| HEAD exactly `350afec…` | `350afeca8bcee528152b1f2883dc4e91e5708e83` | ✅ |
| Index empty | 0 | ✅ |
| Stash empty | 0 | ✅ |
| `git diff --check` exit 0 | **0** | ✅ |
| C1 four migration SQL committed & unchanged | all four `committed` + `unchanged` (no `git status` entry under `prisma/migrations/`) | ✅ |
| Five C1B files available, no drift vs final acceptance | present with **24114 / 3851 / 20027** bytes = the accepted values | ✅ |

---

## 4. Functional gate and actual exit codes — **PASS**

| # | Command | Expected | **Actual exit** | Observed |
|---|---|---|---|---|
| F1 | `npm run db:preflight` | exit 0, 22/22 | **0** | `[preflight] migrations: 22 on disk, 22 in baseline` · `PASS — effective order matches the baseline and every checksum is identical.` |
| F2 | `npx tsx --test tests/migration-ordering.unit.test.ts` | exit 0, 23/23 | **0** | `ℹ tests 23 · ℹ pass 23 · ℹ fail 0 · ℹ cancelled 0 · ℹ skipped 0 · duration_ms 4077` |
| F3 | `npx tsc --noEmit` | exit 0 | **0** | no diagnostics |

F2's output was piped through `tail`; the tested command's status was preserved explicitly via
`${PIPESTATUS[0]}` and read **0** (a `tail` exit is not accepted as the result).

**Not run (prohibited / not authorised):** `npm run db:deploy`, `npm run db:baseline:update`,
`prisma migrate deploy`, `prisma migrate dev`, `npm run build`. The earlier build acceptance remains
**historical** evidence and is **not** claimed as a fresh run.

---

## 5. Exact staged-set comparison — **PASS**

Staging was path-explicit (one `git add -- <five paths>`; **no** `git add .` / `-A` / `-u`, **no** `git commit -a`).

```
README.md
package.json
tests/migration-ordering.unit.test.ts
tools/migration-order.baseline.json
tools/preflight-migrations.mjs
```

| Check | Result |
|---|---|
| Exactly 5 paths | **5** ✅ |
| Missing vs allowlist | **0** ✅ |
| Extra vs allowlist | **0** ✅ |
| Set identical to the allowlist | **true** ✅ |
| `name-status` codes | **{A, M}** only — `R` (rename) absent, `D` (delete) absent ✅ |
| Staged deletions / renames | **NONE** ✅ |
| Files from C2/C3/C4/HELD/EXCLUDE | **none** ✅ |

```
M   README.md
M   package.json
A   tests/migration-ordering.unit.test.ts
A   tools/migration-order.baseline.json
A   tools/preflight-migrations.mjs
```

---

## 6. Staged diff verification (content, not just filenames) — **PASS**

| Check | Command / method | Result |
|---|---|---|
| Whitespace / conflict markers | `git diff --cached --check` | **exit 0** ✅ |
| Staged stat | `git diff --cached --stat` | `5 files changed, 1303 insertions(+), 2 deletions(-)` — README 46, package.json 3, guard test 518, baseline 63, guard 675 ✅ |
| `package.json` adds only the three accepted scripts | staged blob vs `HEAD` blob, JSON compare | new: `db:preflight`, `db:deploy`, `db:baseline:update`; removed: **NONE**; `dependencies`/`devDependencies` **unchanged**; top-level keys delta **[]** ✅ |
| `db:deploy` shape | staged `scripts.db:deploy` | `node tools/preflight-migrations.mjs && prisma migrate deploy` — preflight first ✅ |
| `README.md` carries only migration-guard docs | `git diff --cached -- README.md` hunks | **2** hunks — `@@ -58,9 +58,49 @@` (Database / preflight) and `@@ -124,7 +164,9 @@` (Production VPS); both guard-related ✅ |
| Guard has no database contact | staged blob token scan | `prisma/client`, `adapter`, `mariadb`, `mysql`, `DATABASE_URL`, `createConnection`, `fetch(`, `http(s)://`, `execSync`, `spawn`, `process.env.` → **NONE** ✅ |
| Guard imports Node built-ins only | staged blob imports | `node:crypto`, `node:fs`, `node:path`, `node:url` ✅ |
| Guard has no bypass | comment-stripped scan (`/* */` **and** `//`) | `--force`/`--skip`/`--bypass`/`--ignore`/`--no-verify` → **0 occurrences**; the strings exist **only** inside the block comment at line 46 (`* NO BYPASS: v1 intentionally has no --force / --skip flag.`); executable flag cases are `--project-root`, `--migrations-dir`, `--baseline`, `--json`, `--update`, `--help`, `-h` ✅ |
| Guard writes only under `--update` | staged blob write sites | `mkdirSync`/`writeFileSync` only at lines **623–624**, inside the `if (args.update)` branch (canary → `return 1` precedes it) ✅ |
| Baseline still 22/22 | staged baseline blob | `schemaVersion 1` · `prismaVersion 7.10.0` · order **22** · checksums **22**; vs the committed migration blobs → **22 checked, 0 mismatch** ✅ |
| Staged content == working tree | sha256 of `:<path>` vs on-disk file | **IDENTICAL** for all five (guard 24114 B, baseline 3851 B, test 20027 B) ✅ |
| No accounting source / schema / migration SQL | staged path scan | `src/**`, `prisma/**`, `scripts/**`, `docs/**` → **none**; `prisma/schema.prisma` **not staged** ✅ |
| No unexpected change vs final acceptance | sizes + inspected regions | **no drift** ✅ |

---

## 7. Exclusion gate — **PASS**

All of the following were checked against `git diff --cached --name-only` and are **not staged**:

| Path | Staged? |
|---|---|
| `next-env.d.ts` | no ✅ |
| `docs/accounting-hardening/.STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md.kate-swp` | no ✅ (still on disk, **not deleted**) |
| `.env.example` | no ✅ |
| `HERMES-ACCOUNTING-CONFLICT-AUDIT.md` · `HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md` · `HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md` · `HERMES-PROJECT-AUDIT.md` | no ✅ |
| `INVENTORY-DESIGN-REVIEW.md` | no ✅ |
| `prisma/seed.ts`, `src/lib/prisma.ts` (C2), `.gitignore`, `.env.test.example` (C3) | no ✅ |
| `ACCOUNTING-INTEGRATION-TEST-PLAN.md`, `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` | no ✅ — kept at the **FINAL COMMIT BOUNDARY AUDIT** classification (**C4**), **not** part of C1B |

All C2, C3, C4 and HELD files remain **outside** the commit. Nothing else was deleted or cleaned.

---

## 8. Commit execution and hash

No non-sample Git hooks exist in `.git/hooks/`, so no hook was bypassed or fired. Exactly one commit was created:

```
$ git commit -m "chore(migrations): add fail-closed migration preflight guard"
[main cd3d849] chore(migrations): add fail-closed migration preflight guard
 5 files changed, 1303 insertions(+), 2 deletions(-)
 create mode 100644 tests/migration-ordering.unit.test.ts
 create mode 100644 tools/migration-order.baseline.json
 create mode 100644 tools/preflight-migrations.mjs
exit 0
```

**Commit `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`** — parent `350afeca8bcee528152b1f2883dc4e91e5708e83`.

---

## 9. Exact committed file list `[Measured]`

```
$ git diff-tree --no-commit-id --name-status -r HEAD
M   README.md
M   package.json
A   tests/migration-ordering.unit.test.ts
A   tools/migration-order.baseline.json
A   tools/preflight-migrations.mjs
```

Exactly **five** paths — the allowlist — and nothing else.

---

## 10. Post-commit verification — **PASS**

| # | Check | Measured | Result |
|---|---|---|---|
| 1 | HEAD one commit above `350afec…` | HEAD `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`, `HEAD^` = `350afeca8bcee528152b1f2883dc4e91e5708e83` | ✅ |
| 2 | Commit contains exactly the five allowlist files | `diff-tree` → 5 paths, `{A, M}` only | ✅ |
| 3 | No additional path | **none** | ✅ |
| 4 | Index empty again | `git diff --cached --name-only` → **0** | ✅ |
| 5 | Stash still empty | **0** | ✅ |
| 6 | C2/C3/C4/HELD/EXCLUDE preserved | C2 11/11 · C3 13/13 · C4 16/16 · HELD 6/6 · EXCLUDE 2/2 — **0 unclassified** | ✅ |
| 7 | Four committed F-7 checksums still match the baseline | `97ee89d5…`, `019b42ed…`, `fac529c7…`, `47365a5c…` → **4/4 match**; all **22** committed migration blobs vs committed baseline → **0 mismatch** | ✅ |
| 8 | No report or ROADMAP committed | `git ls-tree -r HEAD` grep for `COMMIT-EXECUTION` / `PRECOMMIT-VERIFICATION` / `FINAL-ACCEPTANCE` / `BOUNDARY-AUDIT` / `ROADMAP` → **0**; no `prisma/migrations` path in the commit → **0** | ✅ |
| 9 | `npm run db:preflight` re-run against the **committed** baseline | **exit 0** — `PASS`, 22 on disk / 22 in baseline, every checksum identical | ✅ |
| 10 | The five files are now tracked and clean | all five `tracked` + `clean` | ✅ |

Other state after the commit `[Measured]`: `git diff --check` **exit 0**;
`git status --porcelain=v1 -uall` = **48** (14 modified + 34 untracked) — i.e. 53 − 5, matching the five newly
committed paths; short porcelain = **30**. No anomaly was found, so no amend, reset, restore or corrective commit
was performed.

---

## 11. Preservation of other boundaries `[Measured]`

| Boundary | Expected | Present after commit | Result |
|---|---|---|---|
| **C1B** | 5 | now **committed** → 0 dirty | ✅ |
| C2 — accounting / F-2 source | 11 | 11 | ✅ |
| C3 — tests + test infra | 13 | 13 | ✅ |
| C4 — docs/reports (incl. the two `ACCOUNTING-*.md` per FBA) | 16 | 16 | ✅ |
| HELD — `.env.example`, 4 × `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md` | 6 | 6 | ✅ |
| EXCLUDE — `next-env.d.ts`, `.kate-swp` | 2 | 2 | ✅ |
| Unclassified working-tree paths | 0 | **NONE** | ✅ |
| Declared-but-absent | 0 | only the five **now committed** C1B paths | ✅ |

No file was lost, renamed or altered by the commit process; `.kate-swp` is still present on disk.

---

## 12. Report and ROADMAP impact

* **New report:** `docs/accounting-hardening/STEP-2C-6-C1B-COMMIT-EXECUTION.md` (this file), created **after** the
  commit — it is **not** part of the C1B commit and was **not** added retroactively (§8 of the brief).
* **ROADMAP:** updated briefly — one status row, one short section, and a link to this report. **Uncommitted.**
* **No second commit** was made to include this documentation; reports and the ROADMAP remain untracked working-tree
  changes belonging to the C4 docs boundary.
* All earlier reports remain **read-only archives**, unmodified.

---

## 13. Remaining risks and approval gates

| ID | Risk / decision | Severity | Status |
|---|---|---|---|
| R-1 | A hand-typed `npx prisma migrate deploy` still bypasses the guard | Medium | documented in `README.md`; only `db:deploy` is guarded |
| R-2 | The guard replicates the CLI's one-line comparator (Prisma's loader is not exported) | Medium | bounded by the frozen `prismaVersion` + **F8 hard fail** (fail-closed, never silent) |
| R-3 | The baseline goes stale when a migration is added/edited | Medium | explicit `--update` + review; fails closed with an explicit remedy |
| R-4 | No CI exists → the gate runs only where `db:preflight`/`db:deploy` is invoked | Medium | documented; the guard is now **tracked** in `tools/` |
| R-5 | T9/T10 simulate small-/no-ICU via a `localeCompare` preload, not a real binary | Low | recorded limitation |
| R-6 | The guard can only refuse a drifted runtime, not repair it | Low | intended |
| R-7 | `next-env.d.ts` build drift will resurface | Low | excluded from commits; auto-regenerated |
| R-8 | Future commits must keep using path-explicit staging | High if ignored | the uncommitted C2/C3/C4/HELD tree is still present; `git add .` would sweep it in |

| Gate | Decision | Status |
|---|---|---|
| **AP-C1B-commit** | Authorise the five-file C1B commit | ✅ **EXECUTED — `cd3d849`** |
| AP-C2 / AP-C3 / AP-C4 | Authorise the C2 / C3 / C4 commits | ⏸ open |
| AP-B2 | Decide the foreign `.kate-swp` (delete vs `.gitignore`) — left in place | ⏸ open |
| AP-B3 | Decide `next-env.d.ts` (leave uncommitted vs restore) — left modified | ⏸ open |
| AP-4 | Whether to open a follow-up removing the collation dependency (C1A §11.2) | ⏸ open |
| AP-3 | A4 (committed-tree replay) stays **prepared-only** (now unblocked in principle by C1 + C1B) | ⏸ open |
| AP-2 | HELD files (`.env.example`, `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`) | ⏸ open |

**Disclosed deviation.** The commit message was used **verbatim** as instructed — no trailer/footer line was
appended — because the owner supplied the exact `git commit -m "…"` command for a tightly scoped controlled commit.
(This mirrors the same disclosure recorded for the C1 commit.)

---

## 14. Final verdict

### ✅ C1B CONTROLLED COMMIT SUCCESS

* Commit **`cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`** on `main`, parent `350afeca8bcee528152b1f2883dc4e91e5708e83`,
  exactly **one** commit ahead.
* **Exactly five** files — `README.md`, `package.json`, `tests/migration-ordering.unit.test.ts`,
  `tools/migration-order.baseline.json`, `tools/preflight-migrations.mjs` — `5 files changed, 1303 insertions(+), 2 deletions(-)`.
  Staged path-explicitly only; no rename, no deletion, no migration SQL, no schema, no accounting source, no docs/report.
* Pre-staging, functional (`db:preflight` 22/22 · guard tests 23/23 · `tsc` 0) and staged-set gates all **PASS**.
* Post-commit: index **empty**, stash **0**, `git diff --check` **0**, `db:preflight` **PASS** against the
  **committed** baseline, the five files **tracked and clean**, the four F-7 checksums **4/4** intact
  (all 22 committed blobs vs baseline: **0 mismatch**).
* All C2/C3/C4/HELD/EXCLUDE boundaries preserved; nothing lost or altered.

**STOP.** No push, no migration, no database contact, no A4, no C2/C3/C4 commit, no deployment, no STEP 2C.7.
Awaiting the owner's next explicit approval.

---

## Appendix A — Commands executed and real exit codes

| # | Command | Exit |
|---|---|---|
| 1 | `git branch --show-current` · `git rev-parse HEAD` · `git status --porcelain=v1 -uall` | 0 |
| 2 | `git diff --cached --name-only` · `git stash list` | 0 (empty / empty) |
| 3 | `git diff --check` | **0** |
| 4 | C1 committed-and-unchanged probe (4 paths, `ls-tree` + `status`) | 0 |
| 5 | C1B artifact presence + `stat -c %s` (24114 / 3851 / 20027) | 0 |
| 6 | `npm run db:preflight` | **0** (PASS 22/22) |
| 7 | `npx tsx --test tests/migration-ordering.unit.test.ts` (status via `${PIPESTATUS[0]}`) | **0** (23/23, 0 fail) |
| 8 | `npx tsc --noEmit` | **0** |
| 9 | `git add -- <five paths>` | 0 |
| 10 | `git diff --cached --name-only` / `--name-status` / `--stat` / `--check` | 0 / 0 / 0 / **0** |
| 11 | staged-blob content scan (`window`, sha256, comment-stripped flag scan, baseline re-hash) | 0 |
| 12 | exclusion probe over 14 excluded paths | 0 (none staged) |
| 13 | `git commit -m "chore(migrations): add fail-closed migration preflight guard"` | **0** |
| 14 | `git rev-parse HEAD` · `HEAD^` · `git log -1 --format=fuller` · `git diff-tree …` | 0 |
| 15 | `git diff --cached --name-only` · `git stash list` · `git diff --check` · `git status --porcelain=v1 -uall` | 0 / 0 / **0** / 0 |
| 16 | `git ls-tree -r --name-only HEAD` greps (report/ROADMAP/migration SQL absent) | 0 (**grep exit 1** = no match, as required) |
| 17 | `npm run db:preflight` (post-commit) | **0** (PASS 22/22) |
| 18 | F-7 + all-22 committed-blob re-hash vs committed baseline | 0 (0 mismatch) |
| 19 | boundary preservation classification (48 paths) | 0 (`NONE` unclassified) |

**Not run (prohibited or unauthorised):** `git push`, merge/rebase, `--amend`, `git reset`, `git restore`,
`git stash`, broad staging (`git add .` / `-A` / `-u`, `git commit -a`), `npm run db:deploy`,
`npm run db:baseline:update`, `prisma migrate deploy|dev`, `npm run build`, any migration/replay, any database
contact, A4, deployment, C2/C3/C4 commits, STEP 2C.7.
