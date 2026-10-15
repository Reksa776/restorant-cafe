# STEP 2C.6 — C2 CONTROLLED COMMIT EXECUTION

**Subphase of 2C.6 · mode: STRICT CONTROLLED COMMIT (11-file allowlist) · AP-C2 APPROVED**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| Pre-commit HEAD | `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56` |
| **Commit** | **`7dc2496a6a10ffa5c5ad268f769601389d2d7cba`** |
| Parent | `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56` (exactly 1 commit ahead) |
| Message | `feat(accounting): correct F-2 credential parsing and canonical revenue predicates` (verbatim) |
| Branch | `main` |
| Readiness input | `STEP-2C-6-C2-FINAL-READINESS.md` (read-only; **not modified**) |
| Verdict | ✅ **C2 CONTROLLED COMMIT SUCCESS** |

> **Scope.** Exactly one commit containing exactly the 11 C2 files, staged path-explicitly. **No** push, merge,
> rebase, amend, broad staging, reset/restore/stash, database contact of any kind (3306/3307/**3308** untouched),
> migration execution/replay, `db:deploy`, `db:baseline:update`, A4, deployment, C3/C4 commit, or STEP 2C.7.
> C1 and C1B were **not** re-audited or re-executed. No file was repaired or had its fingerprint refreshed
> automatically. The only writes after the commit are this new report, a short ROADMAP update and `EXECUTION-STATE.md`.

---

## 1. Owner approval scope

| Item | Value |
|---|---|
| Approval | **AP-C2 = APPROVED (explicit)** |
| Covered | **one** commit containing **exactly 11** C2 files per `STEP-2C-6-C2-FINAL-READINESS.md` |
| **Not** covered | C3/C4 commits · A4 · database contact (incl. 3308) · migration · push · deployment · STEP 2C.7 |
| Re-use | the readiness evidence was used as-is; no architecture audit was repeated |

---

## 2. Initial Git state `[Measured]`

| Item | Value |
|---|---|
| `git branch --show-current` | `main` |
| `git rev-parse HEAD` / `HEAD^` | `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56` / `350afeca8bcee528152b1f2883dc4e91e5708e83` |
| Index (staged) | **empty** (0) |
| Stash | **empty** (0) |
| `git diff --check` | **exit 0** |
| `git status --porcelain=v1 -uall` | **51** entries (historical counts not used as a gate) |
| 11 C2 paths available | **11 / 11 present** — 10 `M` + `src/lib/database-url.ts` `??` |
| `git status --porcelain -- prisma/` | only ` M prisma/seed.ts` (a C2 file) → **no migration SQL, `prisma/schema.prisma` clean** |

**Gate result: PASS** — branch, HEAD, parent, empty index/stash, `diff --check`, path availability and
migration/schema cleanliness all match. C3/C4/HELD/EXCLUDE were untouched.

---

## 3. SHA256 fingerprint gate — **11/11 EXACT MATCH**

Working-tree contents compared against the fingerprint recorded in the C2 Final Readiness report:

```
92a243580efb052325116b92f453aeb72da21dbe6a2deaff401399a5cab9a933  prisma/seed.ts
1a55980a243357512c1ca7cb169c5048d0cd20955a95b02d537cb84f9c8f65ef  scripts/backfill-branch.ts
ae319ad69e430b6da8b892777b76f084e212df81aeb4b6cf35a1ae996bb6061b  scripts/diag-p3018.mjs
1de47d9868920d1d460388295e15ec97b66f9387417d630d1b4568ae6907c2f6  scripts/prisma-diag.mjs
e9fc34c79f8928ecc7df0d4f09e6ae3a0d3afc144299c9c2a9b5452b65d97c5f  src/lib/prisma.ts
2edaa7095aa9cb273609384eb791b5ed8ccbcfd9bf59074e1fc5dd6b21246b96  src/lib/database-url.ts
2396b170d9eb6be3bbbd3467463cfb8fcca01e4af8bc4d5d1dbea9da4d0ef818  src/services/accounting/integrity.rules.ts
741b8920c33b8d7d42778ce8d97e00a223f752afaad0f21e9d458aa9358abb43  src/services/accounting/integrity.service.ts
5a4590d4359e213387b94be02aeb25846e731c863b07a2ad6cedeb0fd88416da  src/services/accounting/integrity.types.ts
7ed61568c466f0079827ddd3d02cea1c91b7e82b650b890c40ddaebabf5f9121  src/services/report/report.service.ts
2412f660ef8c849587eeb8275c3ac39d33c8533a31e3b31bc52145f403847934  src/app/api/reports/products/export/route.ts
```

`sha256sum` + sorted diff → **exact match, missing = 0, mismatch = 0**. No file was repaired and no fingerprint
was regenerated.

---

## 4. Functional gate and actual exit codes — **PASS**

| # | Command | Expected | **Actual** | Result |
|---|---|---|---|---|
| G1 | `npx tsx --test src/lib/database-url.unit.test.ts` | 24/24 | **exit 0** — tests 24, pass 24, fail 0 | ✅ |
| G2 | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | 78/78 | **exit 0** — tests 78, pass 78, fail 0 | ✅ |
| G3 | `npx tsc --noEmit` | exit 0 | **exit 0** | ✅ |
| G4 | `npm run db:preflight` | 22/22 PASS | **exit 0** — 22 on disk / 22 in baseline, all checksums identical | ✅ |
| G5 | `git diff --check` | exit 0 | **exit 0** | ✅ |

G1/G2 output was piped through `tail`; the tested command's status was captured explicitly via
`${PIPESTATUS[0]}` (**0** each) — a `tail` exit was never accepted as the result. Both suites are DB-free.

**Not run:** integration suites (not required by this task) and `npm run build` (avoiding generated-file drift).
The last build result remains **historical** evidence, not a fresh PASS.

---

## 5. Exact staged-set comparison — **PASS**

Staging was path-explicit (`git add -- <11 paths>`); **no** `git add .`/`-A`/`-u`, **no** `git commit -a`.

| Check | Result |
|---|---|
| Exactly 11 paths | **11** ✅ |
| Missing vs allowlist | **0** ✅ |
| Extra vs allowlist | **0** ✅ |
| Set identical to allowlist | **true** ✅ |
| `name-status` codes | **{A, M}** only — 10 `M` + 1 `A` (`src/lib/database-url.ts`) ✅ |
| Renames / deletions | **NONE** ✅ |
| `git diff --cached --check` | **exit 0** ✅ |
| `git diff --cached --stat` | **11 files changed, 819 insertions(+), 80 deletions(-)** — expected ✅ |

`--cached --numstat` reproduced every per-file number from the readiness report (seed 8/7 · backfill 4/2 ·
diag 14/2 · prisma-diag 14/2 · export route 4/3 · database-url 87/0 · prisma.ts 18/10 · rules 367/4 ·
service 186/30 · types 104/13 · report.service 13/7).

---

## 6. Staged diff / content verification — **PASS**

| Check | Method | Result |
|---|---|---|
| **Staged blob SHA256 == fingerprint** (not just the working tree) | `git show :<path> \| sha256`, all 11 | **11/11 match** ✅ |
| Staged paths all inside the allowlist | set compare | **none outside** ✅ |
| No C3 test files | set intersection | **NONE** ✅ |
| No C4 documentation | set intersection | **NONE** ✅ |
| No HELD files | set intersection | **NONE** ✅ |
| No EXCLUDE files | set intersection | **NONE** ✅ |
| No `.env*` | prefix scan | **NONE** ✅ |
| No migration SQL / schema change | prefix + name check | **NONE** — only `prisma/seed.ts` under `prisma/`; `prisma/schema.prisma` not staged ✅ |

---

## 7. Exclusion gate — **PASS**

`staged ∩ C3`, `∩ C4`, `∩ HELD`, `∩ EXCLUDE`, `∩ .env*`, `∩ prisma/migrations/**` → **all NONE**;
`schema.prisma` staged → **false**; staged paths outside the allowlist → **NONE**.
C3 (13), C4 (19 at the time), HELD (6) and EXCLUDE (2: `next-env.d.ts`, the foreign `.kate-swp`) all remain
uncommitted and unmodified.

---

## 8. Commit execution and actual hash

No non-sample Git hooks exist in `.git/hooks/`, so nothing was bypassed. Exactly one commit:

```
$ git commit -m "feat(accounting): correct F-2 credential parsing and canonical revenue predicates"
[main 7dc2496] feat(accounting): correct F-2 credential parsing and canonical revenue predicates
 11 files changed, 819 insertions(+), 80 deletions(-)
 create mode 100644 src/lib/database-url.ts
exit 0
```

**Commit `7dc2496a6a10ffa5c5ad268f769601389d2d7cba`** — parent `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`.

---

## 9. Exact committed file list `[Measured]`

```
$ git diff-tree --no-commit-id --name-status -r HEAD
M   prisma/seed.ts
M   scripts/backfill-branch.ts
M   scripts/diag-p3018.mjs
M   scripts/prisma-diag.mjs
M   src/app/api/reports/products/export/route.ts
A   src/lib/database-url.ts
M   src/lib/prisma.ts
M   src/services/accounting/integrity.rules.ts
M   src/services/accounting/integrity.service.ts
M   src/services/accounting/integrity.types.ts
M   src/services/report/report.service.ts
```

Exactly **11** paths — the allowlist, nothing else.

---

## 10. Post-commit verification — **PASS**

| # | Requirement | Measured | Result |
|---|---|---|---|
| 1 | HEAD exactly one commit above `cd3d849…` | HEAD `7dc2496a6a10ffa5c5ad268f769601389d2d7cba`, `HEAD^` = `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56` | ✅ |
| 2 | Commit contains exactly the 11 C2 paths | `diff-tree` → 11 | ✅ |
| 3 | `name-status` only `A`/`M` | 10 `M` + 1 `A` | ✅ |
| 4 | No 12th file | **none** | ✅ |
| 5 | Committed blob SHA256 11/11 == fingerprint | **11/11 match** | ✅ |
| 6 | Index empty again | `git diff --cached --name-only` → **0** | ✅ |
| 7 | Stash empty | **0** | ✅ |
| 8 | C3/C4/HELD/EXCLUDE preserved | 13 / 19 / 6 / 2 — **0 unclassified** | ✅ |
| 9 | Migration SQL and schema unchanged | no `prisma/migrations/**`, `prisma/schema.prisma` not dirty | ✅ |
| 10 | No report / ROADMAP / EXECUTION-STATE committed | `git ls-tree -r HEAD` grep → **0** | ✅ |
| 11 | `git diff --check` | **exit 0** | ✅ |

Blob equality was additionally confirmed positionally: every committed blob's SHA256 equals the readiness
fingerprint, so the committed content is byte-identical to what was verified pre-commit.

**Safe post-commit re-runs `[Measured]`:**

| Check | Command | **Actual exit** |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | **0** |
| Migration guard | `npm run db:preflight` | **0** — PASS, 22 on disk / 22 in baseline |

Other state: `git status --porcelain=v1 -uall` = **40** (4 modified + 36 untracked) = 51 − 11 committed;
short porcelain = 19.

---

## 11. Preservation of C3 / C4 / HELD / EXCLUDE `[Measured]`

| Boundary | Expected | Present after commit | Result |
|---|---|---|---|
| **C2** | 11 | now **committed** → 0 dirty | ✅ |
| C3 — tests + test infra | 13 | 13 | ✅ |
| C4 — docs/reports (incl. the two `ACCOUNTING-*.md`, kept as C4 per the FINAL COMMIT BOUNDARY AUDIT) | 19 | 19 | ✅ |
| HELD — `.env.example`, 4 × `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md` | 6 | 6 | ✅ |
| EXCLUDE — `next-env.d.ts`, `.kate-swp` | 2 | 2 (`.kate-swp` still on disk, **not** deleted) | ✅ |
| C1B (committed earlier) | 5 | 0 dirty | ✅ |
| Unclassified working-tree paths | 0 | **NONE** | ✅ |

No file was lost, renamed or altered by the commit process.

---

## 12. Report / ROADMAP / EXECUTION-STATE impact

* **New report:** this file, created **after** the commit — **not** part of the C2 commit and not added
  retroactively.
* **ROADMAP:** brief update only — one status row, one short section, report link. **Uncommitted.**
* **`EXECUTION-STATE.md`:** updated with the C2 commit hash, completion status, last verified HEAD, verification
  results with exit codes, remaining approval gates, next checkpoint (**C3 FINAL READINESS**) and the next action
  (verification only, pending separate approval). **Uncommitted.**
* All three documentation files stay **uncommitted**; no second commit was created to include them, and all
  historical reports remain read-only archives.

---

## 13. Residual risks and remaining approval gates

| ID | Risk | Severity | Note |
|---|---|---|---|
| C2R-1 | The 5 accounting integration suites + the F-2 live regression have **not** run against this exact tree | Medium | they belong to the C3 checkpoint under its own database-target approval; no fresh PASS is claimed |
| C2R-2 | Two pre-existing ESLint warnings sit inside a committed file (`report.service.ts` L170/L605) | Low | present identically at the previous HEAD and untouched by the C2 diff — not a regression |
| C2R-3 | The committed `src/lib/database-url.ts` error message is slightly longer than the 2C.4 §6 draft (adds `` `:` ``/`` `/` ``) | Low | behaviour-preserving; the F-2 unit case asserting the message contains neither URL nor credential passes |
| C2R-4 | A broad `git add` would sweep in the remaining 13 C3, 19 C4, 6 HELD and 2 EXCLUDE entries | High if executed | path-explicit staging remains mandatory |
| C2R-5 | Production behaviour is still unverified live | Medium | STEP 2C.8/UAT and the release gate cover it; production remains NOT READY |

| Gate | Decision | Status |
|---|---|---|
| AP-C1 / AP-C1B-commit | commit C1 / C1B | ✅ CLOSED — `350afec` / `cd3d849` |
| **AP-C2** | commit the 11-file C2 boundary | ✅ **EXECUTED — `7dc2496`** |
| AP-C3 | authorise the C3 commit (**and** a database target for its suites) | ⏸ **OPEN — next** |
| AP-C4 | authorise the C4 documentation commit | ⏸ open |
| AP-B2 | `.kate-swp` delete vs `.gitignore` — untouched | ⏸ open |
| AP-B3 | `next-env.d.ts` leave vs restore — untouched | ⏸ open |
| AP-4 | follow-up removing the collation dependency (C1A §11.2) | ⏸ open |
| AP-3 | A4 committed-tree replay — **prepared-only** | ⏸ open |
| AP-2 | HELD files | ⏸ open |

---

## 14. Final verdict

### ✅ C2 CONTROLLED COMMIT SUCCESS

* Commit **`7dc2496a6a10ffa5c5ad268f769601389d2d7cba`** on `main`, parent `cd3d8497c10f4ca9810b0226f8bf32ef7e55ae56`,
  exactly **one** commit ahead.
* **Exactly 11 files**, `{A, M}` only — `11 files changed, 819 insertions(+), 80 deletions(-)`; staged
  path-explicitly; staged-blob SHA256 **11/11** equal to the readiness fingerprint; no C3/C4/HELD/EXCLUDE, no
  `.env*`, no migration SQL, no schema, no report.
* Every gate PASSED: pre-staging · SHA256 fingerprint · functional (`db:preflight` 22/22, F-2 unit 24/24,
  M2 unit 78/78, `tsc` 0, `diff --check` 0) · staged-set (set identical, stat exactly +819/−80, `--cached --check` 0)
  · staged-blob fingerprint · exclusion.
* Post-commit: index **empty**, stash **0**, `diff --check` **0**, `tsc --noEmit` **0**, `db:preflight` **PASS**,
  C3/C4/HELD/EXCLUDE preserved (13/19/6/2, 0 unclassified), migration SQL and schema untouched, nothing documented
  committed.

**STOP.** No push, no database contact, no migration, no A4, no C3/C4 commit, no deployment, no STEP 2C.7.
Awaiting the owner's next explicit approval (next checkpoint: **C3 FINAL READINESS**).

---

## Appendix A — Commands executed and real exit codes

| # | Command | Exit |
|---|---|---|
| 1 | `git branch --show-current` · `git rev-parse HEAD` · `git rev-parse HEAD^` | 0 |
| 2 | `git diff --cached --name-only` · `git stash list` · `git diff --check` · `git status --porcelain=v1 -uall` | 0 / 0 / **0** / 0 (51) |
| 3 | 11-path existence + `stat -c %s` + `git status --porcelain` | 0 |
| 4 | `git status --porcelain -- prisma/` | 0 (only `prisma/seed.ts`) |
| 5 | `sha256sum` × 11 + sorted `diff` vs the recorded fingerprint | 0 (**exact match**) |
| 6 | `npx tsx --test src/lib/database-url.unit.test.ts` (status via `${PIPESTATUS[0]}`) | **0** (24/24) |
| 7 | `npx tsx --test src/services/accounting/integrity.unit.test.ts` (same) | **0** (78/78) |
| 8 | `npx tsc --noEmit` | **0** |
| 9 | `npm run db:preflight` | **0** (PASS 22/22) |
| 10 | `git diff --check` | **0** |
| 11 | `git add -- <11 paths>` | 0 |
| 12 | `git diff --cached --name-only` / `--name-status` / `--numstat` / `--stat` / `--check` | 0 / 0 / 0 / 0 / **0** |
| 13 | staged-blob `git show :<path> \| sha256` × 11 vs fingerprint | 0 (**11/11**) |
| 14 | exclusion set intersections (C3/C4/HELD/EXCLUDE/.env*/prisma) | 0 (all `NONE`) |
| 15 | `git commit -m "feat(accounting): correct F-2 credential parsing and canonical revenue predicates"` | **0** |
| 16 | `git rev-parse HEAD` · `HEAD^` · `git log -1 --format=fuller` · `git diff-tree …` | 0 |
| 17 | `git diff --cached --name-only` · `git stash list` · `git diff --check` · `git status --porcelain=v1 -uall` | 0 / 0 / **0** / 0 (40) |
| 18 | committed-blob re-hash × 11 vs fingerprint | 0 (**11/11**) |
| 19 | `git ls-tree -r HEAD` grep (docs/report/ROADMAP absent) · `diff-tree` grep (migration/schema absent) | 0 (**grep exit 1** = no match, as required) |
| 20 | `npx tsc --noEmit` (post-commit) | **0** |
| 21 | `npm run db:preflight` (post-commit) | **0** (PASS 22/22) |
| 22 | boundary preservation classification (40 paths) | 0 (**NONE** unclassified) |

**Not run (prohibited or not authorised):** push, merge/rebase, `--amend`, reset/restore/stash, broad staging,
database contact (3306/3307/3308), integration tests, `npm run build`, migration/replay/A4, `db:deploy`,
`db:baseline:update`, deployment, C3/C4 commits, STEP 2C.7.
