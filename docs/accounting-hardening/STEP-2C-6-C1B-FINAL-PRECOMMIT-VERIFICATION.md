# STEP 2C.6-C1B — FINAL PRE-COMMIT VERIFICATION

**Subphase of 2C.6-C1B · mode: STRICT READ-ONLY VERIFICATION · C1B COMMIT NOT AUTHORISED**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD | `350afeca8bcee528152b1f2883dc4e91e5708e83` |
| Parent | `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` |
| Branch | `main` |
| Inputs (read-only) | `STEP-2C-6-C1B-RUNNER-GUARD-DESIGN.md`, `STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md`, `STEP-2C-6-C1B-FINAL-ACCEPTANCE.md`, `STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md`, `STEP-2C-6-C1-COMMIT-EXECUTION.md`, `ROADMAP.md` |
| Verdict | ✅ **READY FOR OWNER COMMIT APPROVAL** — READY does **not** authorise a commit |

> **Scope.** Verification only. **No** `git add`/staging/commit/push/reset/restore/stash/merge/rebase/amend, **no**
> migration/replay, **no** `db:deploy`, **no** `prisma migrate deploy|dev`, **no** `db:baseline:update`, **no**
> rebuild, **no** database contact (3306/3307/3308/v1/v2/production all untouched), **no** ledger write, **no** A4,
> **no** STEP 2C.7. No migration SQL, source, test, guard file, `.gitignore` or report was edited. The only writes
> are this new report and a short ROADMAP status update; all earlier reports are read-only archives.
> C1 was **not** re-audited or re-executed.

**Evidence classes.** `[Measured]` read first-hand on this host in this phase · `[Code]` read from the repository's
own files · `[Recorded]` carried from a prior accepted report (not re-measured here).

---

## 1. Initial HEAD and Git state `[Measured]`

| Item | Value |
|---|---|
| `git rev-parse HEAD` | `350afeca8bcee528152b1f2883dc4e91e5708e83` |
| `git branch --show-current` | `main` |
| `git diff --cached --name-only` | **empty** (index 0) |
| `git stash list` | **empty** (stash 0) |
| `git status --porcelain=v1` (short) | **29** entries |
| `git status --porcelain=v1 -uall` | **52** entries = **16** modified + **36** untracked |
| `git diff --check` | **exit 0** |

`git show --format=fuller --stat HEAD` `[Measured]`:

```
commit 350afeca8bcee528152b1f2883dc4e91e5708e83
Author:     reksa776 <reksa776@gmail.com>
AuthorDate: Thu Oct 15 12:45:59 2026 +0700
Commit:     reksa776 <reksa776@gmail.com>
CommitDate: Thu Oct 15 12:45:59 2026 +0700

    fix(migrations): correct historical F7 dependency ordering

 .../migration.sql                                  |  9 --------
 .../20260909_add_customer_auth_promo/migration.sql | 17 ++++++++++++++-
 .../migration.sql                                  | 19 ++++++++++++++++
 .../migration.sql                                  | 25 ++++++----------------
 4 files changed, 41 insertions(+), 29 deletions(-)
```

**Gate result:** branch `main` · HEAD exactly `350afec…` · index empty · stash empty · C1 = exactly the four
migration SQL (**PASS**). C1B is still **uncommitted** (its five files appear as modified/untracked in the tree).

**Note on the porcelain count.** The historical count is **not** used as a gate. `-uall` reads **52** rather than
the 51 recorded at C1-EXEC exit; the single extra untracked entry is this programme's own
`STEP-2C-6-C1-COMMIT-EXECUTION.md`, created *after* that measurement. Every entry is individually classified in §10.

---

## 2. C1 committed-tree verification `[Measured]`

* `git ls-tree -r --name-only HEAD prisma/migrations` → **22** `migration.sql` blobs / **22** directories.
* On-disk migration directories → **22**. **Committed set == on-disk set: true.**
* `git status --porcelain=v1 -- prisma/` → only ` M prisma/seed.ts` (C2 accounting source). **No
  `prisma/migrations/**` entry is modified** ⇒ the four F-7 migration SQL are byte-identical to the committed
  blobs — **no migration SQL change after the C1 commit** (task §5 item 10, **PASS**).
* C1's own contents were **not** re-audited; §2 of `STEP-2C-6-C1-COMMIT-EXECUTION.md` remains the record.

---

## 3. Baseline 22/22 verification `[Measured]`

`tools/migration-order.baseline.json`:

| Check | Expected | Measured | Result |
|---|---|---|---|
| `schemaVersion` | 1 | **1** | ✅ |
| `prismaVersion` | `7.10.0` | **`7.10.0`** | ✅ |
| `order` length | 22 | **22** | ✅ |
| `checksums` entries | 22 | **22** | ✅ |
| Migration directories (baseline set) | 22 | **22** | ✅ |
| Baseline set == committed set (HEAD) | true | **true** | ✅ |
| Missing migrations | 0 | **0** | ✅ |
| Extra migrations | 0 | **0** | ✅ |
| **Committed-blob checksums vs baseline** | 22/22 | **22 checked, 0 mismatch, 0 missing** | ✅ |
| Effective (ICU) order ≡ `baseline.order` | true | **true** — proven by `db:preflight` F2 (§6) | ✅ |

Method `[Measured]`: for every one of the 22 names, `sha256(git show HEAD:prisma/migrations/<name>/migration.sql)`
was recomputed and compared with `baseline.checksums[name]`. The comparison is against the **committed blob**
(`git show HEAD:<path>`), not the working tree, so §3 proves the baseline is valid for the committed tree.

Additional keys present (informational): `description`, `migrationsDir`, `generatedBy`, `capturedWith`
(`node v24.21.0`, `icu 78.3`, `unicode 17.0`, `icuSmall false`, `i18nSupport 1`, `defaultLocale en-US`).

**Ordering note `[Recorded]`.** `baseline.order` deliberately differs from a plain byte/codepoint sort (C1A:
12 of 22 positions differ). It reproduces the Prisma CLI's `localeCompare` order; the guard asserts it at runtime
via F1 (canary) + F2 (order), which is why §3 does not treat "not equal to `sorted()`" as a failure.

---

## 4. Four F-7 committed checksum comparison `[Measured]`

Each of the four values was compared across **four** sources: the expected value in this task, the committed blob
(`git show HEAD:<path>`), the on-disk file, and `baseline.checksums`.

| Migration | expected == committed == on-disk == baseline | SHA256 |
|---|---|---|
| `20260908030144_add_branch_multi_cabang` | ✅ **true** | `97ee89d5410467386546ea656b42a3c545f70e859bcde54ef786e1f1304462d6` |
| `20260909_add_customer_auth_promo` | ✅ **true** | `019b42ed36c739a9b6d800c24c5cef548263df34e2fee555c333b8e6882641e1` |
| `20260911_add_ingredient_purchasing_wac` | ✅ **true** | `fac529c73bcf008cab9c8c1f75d1a37b3bd12be87abf72e0da28ebb8a39ea969` |
| `20260911140000_add_purchasing_inventory_foundation` | ✅ **true** | `47365a5cdbaf4a131aab686dceacd83a90c1557a544ece8dc739cc9ee8a6f840` |

**No mismatch.** The C1 → C1B hard edge recorded by the boundary audit is therefore satisfied against the
**committed** tree, not merely against the working tree. `baseline:update` was **not** run.

---

## 5. Prisma version `[Measured]`

| | Value |
|---|---|
| Installed (`node_modules/prisma/package.json`) | **7.10.0** |
| Baseline `prismaVersion` | **7.10.0** |
| Verdict | **equal** → guard's F8 hard-fail is not triggered |
| Node runtime | **v24.21.0**, `v8_enable_i18n_support=1`, `icu_small=false`, ICU **78.3** |
| Canary probe `"a_".localeCompare("a0")` | **-1** (ICU/CLDR; byte order would give +1) |

---

## 6. Migration preflight result `[Measured]` — **PASS**

```
$ npm run db:preflight
> node tools/preflight-migrations.mjs
[preflight] project root : /home/reksa/restorant-cafe
[preflight] migrations   : /home/reksa/restorant-cafe/prisma/migrations
[preflight] baseline     : /home/reksa/restorant-cafe/tools/migration-order.baseline.json
[preflight] runtime      : node v24.21.0, icu 78.3, locale en-US, smallIcu false
[preflight] prisma       : installed 7.10.0, baseline 7.10.0
[preflight] migrations   : 22 on disk, 22 in baseline
[preflight] PASS — effective order matches the baseline and every checksum is identical.
exit 0
```

* **22/22** migrations valid; effective ICU order ≡ baseline order; every checksum identical.
* **No database connection**, **no migration executed**, **no baseline rewrite** (read-only by construction:
  the only write sites in the guard are the two lines inside the `--update` branch, §9 item 5).

---

## 7. Guard unit test result `[Measured]` — **23/23 PASS**

```
$ npx tsx --test tests/migration-ordering.unit.test.ts
✔ T1 happy path — real repository tree matches its committed baseline
✔ T2 order mismatch (reversed baseline) → F2      ✔ T3 adjacent swap → F2
✔ T4 migration missing on disk → F4               ✔ T5 unexpected migration → F3
✔ T6 checksum mismatch (added comment) → F5       ✔ T7 checksum mismatch (single newline) → F5
✔ T8 full-ICU runtime passes                      ✔ T9 simulated small-ICU still passes
✔ T10 simulated no-ICU → F1 (fail-closed)         ✔ T11 LANG=C LC_ALL=C unchanged
✔ T12 runs with no DATABASE_URL, touches no DB    ✔ T12b imports only Node built-ins
✔ T13a/b/c corrupt / missing / unknown schemaVersion → F6
✔ T14 empty migrations dir → F7                   ✔ T15 Prisma mismatch → F8 (hard fail)
✔ T15b missing Prisma package → F8                ✔ T16 pure + idempotent (writes nothing)
✔ T16b failing preflight does not rewrite baseline
✔ E1 --update refuses to regenerate when the canary fails
✔ E2 guard code (comments stripped) has no bypass/force flag
ℹ tests 23   ℹ pass 23   ℹ fail 0   ℹ cancelled 0   ℹ skipped 0   ℹ duration_ms 4059
exit 0
```

Tests were **not** modified to make them pass (no test/source edit in this phase at all).

---

## 8. TypeScript result `[Measured]` — **exit 0**

| Check | Command | Exit |
|---|---|---|
| Type check | `npx tsc --noEmit` | **0** |
| Diff validation | `git diff --check` | **0** |

`npm run build` was **not** run, as instructed (the C1B Final Acceptance build evidence is reused to avoid
`next-env.d.ts` / generated-file drift).

---

## 9. Exact five-file C1B boundary `[Measured]` + `[Code]`

```
tools/preflight-migrations.mjs          (new, 24114 bytes)
tools/migration-order.baseline.json     (new,  3851 bytes)
tests/migration-ordering.unit.test.ts   (new, 20027 bytes)
package.json                            (modified)
README.md                               (modified)
```

| # | Required property | Evidence | Result |
|---|---|---|---|
| 1 | `package.json` adds **only** three scripts | `git diff -- package.json` shows a single hunk adding `db:preflight`, `db:deploy`, `db:baseline:update`; no other line and no dependency changed | ✅ |
| 2 | `db:deploy` runs preflight **before** Prisma deploy | `"db:deploy": "node tools/preflight-migrations.mjs && prisma migrate deploy"` — preflight first, `&&`-joined | ✅ |
| 3 | `README.md` carries only guard/preflight docs | the whole diff is 2 hunks (44 ins / 2 del): the *Database* section + the *Production (VPS)* note, both guard-related | ✅ |
| 4 | Guard opens **no** database connection | imports are `node:crypto`, `node:fs`, `node:path`, `node:url` only; grep for `prisma/client`/`adapter`/`mariadb`/`mysql`/`DATABASE_URL`/`createConnection`/`fetch(`/`http`/`net.` → **no match** | ✅ |
| 5 | Guard uses Node.js built-ins only | `import { createHash } from "node:crypto"`, `node:fs`, `node:path`, `node:url`; no third-party import; no `spawn`/`execSync` | ✅ |
| 6 | No new dependency | `git diff -- package.json` = scripts hunk only; `package-lock.json` not in `git status`; no `require()`/import of a new package | ✅ |
| 7 | No bypass flag or bypass env var | declared flags: `--project-root`, `--migrations-dir`, `--baseline`, `--json`, `--update`, `--help`; no `--force`/`--skip`/`--ignore`/`--bypass`; `process.env.*` → **no match** (grep exit 1) | ✅ |
| 8 | `baseline:update` runs **only** explicitly | `--update` is reached only via the explicit argument (`npm run db:baseline:update`); `if (args.update)` block runs `runCanary()` → `return 1` **before** `buildBaseline()` → `writeFileSync`; the preflight path contains **0** `writeFileSync`; exit accounting is `return outcome.failures.length === 0 ? 0 : 1` | ✅ |
| 9 | No C2/C3 source inside the boundary | the boundary is disjoint from C2 (11), C3 (13), C4 (13), HELD (8), EXCLUDE (2) — intersection **NONE** | ✅ |
| 10 | No migration SQL changed after commit C1 | `git status --porcelain -- prisma/` → only `prisma/seed.ts` (C2); `prisma/migrations/**` clean | ✅ |

**Drift check vs the accepted implementation `[Measured]`.** Artifact sizes match the accepted Final-Acceptance
report **exactly** — `24114`, `3851`, `20027` bytes (that report recorded the same three values), and the
accepted content is reproduced line-for-line in the inspected regions (scripts, README hunks, guard imports,
flag list, write sites, exit accounting). **No drift detected.** The baseline was **not** regenerated.

`tools/` contains exactly those two files — nothing else can be swept in from that directory.

---

## 10. Exclusion verification `[Measured]`

Every working-tree path (**52** with `-uall`) is individually classified; **NONE unclassified**, all groups disjoint.

| Group | Present | Notes |
|---|---|---|
| **C1B** (candidate) | **5 / 5** | the five paths in §9 |
| C2 — accounting / F-2 source | 11 | `prisma/seed.ts`, `scripts/{backfill-branch,diag-p3018,prisma-diag}.mjs`, `src/lib/prisma.ts`, `src/lib/database-url.ts`, `src/services/accounting/integrity.{rules,service,types}.ts`, `src/services/report/report.service.ts`, `src/app/api/reports/products/export/route.ts` |
| C3 — tests + test infra | 13 | the six `tests/**` files (excl. the guard test), `src/services/accounting/integrity.unit.test.ts`, `src/lib/database-url.unit.test.ts`, `tests/fixtures/accounting.ts`, `.gitignore`, `.env.test.example` |
| C4 — docs / reports | 13 | all `docs/accounting-hardening/*.md` except the `.kate-swp` |
| HELD | 8 | `.env.example`, 4 × `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`, `ACCOUNTING-INTEGRATION-TEST-PLAN.md`, `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` |
| EXCLUDE | 2 | `next-env.d.ts`, `docs/accounting-hardening/.STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md.kate-swp` |

**Required exclusions confirmed outside C1B `[Measured]`:**

| Path | State | Must be excluded | Result |
|---|---|---|---|
| `next-env.d.ts` | tracked, modified; diff = the two `./.next/dev/types/*` → `./.next/types/*` lines only (build byproduct, unchanged from acceptance) | yes | ✅ not in C1B |
| `docs/accounting-hardening/.STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md.kate-swp` | untracked, **3291723 bytes**, still on disk | yes | ✅ not in C1B; **not deleted** |
| `.env.example` | tracked, modified (HELD) | yes | ✅ not in C1B |
| `HERMES-*.md` (4) | untracked (HELD) | yes | ✅ not in C1B |
| `INVENTORY-DESIGN-REVIEW.md` | untracked (HELD) | yes | ✅ not in C1B |
| C2 / C3 / C4 changes | modified/untracked | yes | ✅ separate from C1B |

**Labeling note (no coverage gap).** The boundary audit split these same files as C4 = 14 / HELD = 6; this report
classifies `ACCOUNTING-INTEGRATION-TEST-PLAN.md` and `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` under **HELD** (following
the Final-Acceptance report's HELD list), giving C4 = 13 / HELD = 8. Only the label differs — the union is
identical and fully covers the tree with **0** unclassified paths.

**Other observations `[Measured]`:** `.gitignore`'s only change is `+.env.test` — it adds **no** guard negation
(the guard correctly lives in the untracked-but-not-ignored `tools/`); no `docs/` file is staged; the index is
empty.

---

## 11. Final Git state `[Measured]`

| Item | Value |
|---|---|
| HEAD | `350afeca8bcee528152b1f2883dc4e91e5708e83` (**unchanged**) |
| Branch | `main` |
| Index (staged) | **empty** |
| Stash | **0** |
| `git status --porcelain=v1` / `-uall` | **29** / **52** (16 modified + 36 untracked) |
| `git diff --check` | **exit 0** |
| Working-tree delta caused by this phase | **only** this new report + the ROADMAP status update (both untracked) |

Nothing was staged, committed, pushed, reset, restored or stashed; no file was deleted or renamed.

---

## 12. Residual risks

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-1 | A hand-typed `npx prisma migrate deploy` still bypasses the guard | Medium | documented in `README.md`; only `db:deploy` is guarded (unchanged) |
| R-2 | The guard replicates the CLI's one-line comparator (Prisma's loader is not exported) | Medium | bounded by the frozen `prismaVersion` + **F8 hard fail** → fail-closed, never silent |
| R-3 | The baseline goes stale when a migration is added/edited | Medium | explicit `--update` + review; a stale baseline fails closed with an explicit remedy |
| R-4 | No CI in this repository → the gate runs only where `db:preflight`/`db:deploy` is invoked | Medium | `README.md` documents the mandate; artifacts live in committable `tools/` |
| R-5 | T9/T10 simulate small-/no-ICU via a `localeCompare` preload rather than a real binary | Low | the shadowed primitive is exactly what the guard and CLI depend on; recorded as a limitation |
| R-6 | The guard can only refuse a drifted runtime, not repair it | Low | intended (fail-closed by design) |
| R-7 | `next-env.d.ts` drift between `next dev` and `next build` will resurface | Low | excluded from commits; regenerated automatically |
| R-8 | This report and the ROADMAP update are **uncommitted** and are deliberately outside the five-file C1B boundary | Low | they belong to the C4 docs boundary (separate commit); staging must be path-explicit |
| R-9 | A broad `git add` in a future C1B commit would sweep in `next-env.d.ts` and the whole 2C.x tree | High if executed | path-explicit staging only is the control; `git add .`/`-A`/`-u`/`commit -a` are prohibited |
| R-10 | C1B is complementary, not a substitute for the collation-dependency follow-up (C1A §11.2 / AP-4) | Low | recorded; not fixed here (freeze honoured) |

---

## 13. Commit readiness verdict

### ✅ READY FOR OWNER COMMIT APPROVAL

All gates PASS, with no drift from the accepted implementation:

* Git gate: branch `main`, HEAD exactly `350afec…`, index empty, stash empty, C1 = exactly 4 migration SQL.
* Baseline valid **against the committed tree**: schemaVersion 1, Prisma 7.10.0, 22 order / 22 dirs / 22 checksums,
  0 missing, 0 extra, 0 mismatch — and the four F-7 checksums equal expected == committed == on-disk == baseline.
* `db:preflight` **PASS** (22/22, no DB, no migration, no baseline write); guard tests **23/23** pass, 0 fail;
  `tsc --noEmit` **0**; `git diff --check` **0**.
* The boundary is **exactly five files**, single-purpose, with the three new artifacts unmodified since
  acceptance (byte sizes match) and `package.json` restricted to three added scripts.
* All required exclusions (`next-env.d.ts`, the foreign `.kate-swp`, `.env.example`, `HERMES-*.md`,
  `INVENTORY-DESIGN-REVIEW.md`) and all C2/C3/C4 changes remain **outside** C1B.

**READY does not authorise a commit.** No commit, staging or push was performed, and the guards on the possible
failure modes above (path-explicit staging, no broad add) must be observed when the commit is later approved.

---

## 14. Remaining approval gates

| ID | Decision | Status |
|---|---|---|
| **AP-C1B-commit** | Authorise the controlled C1B commit (exactly the five files in §9, path-explicit) | ⏸ **OPEN — this report is the evidence** |
| AP-C2 / AP-C3 / AP-C4 | Authorise the C2 / C3 / C4 commits | ⏸ open |
| AP-C1B-3 | Confirm the Prisma-version policy is the implemented **HARD FAIL** | ✔ implemented; confirm |
| AP-C1B-4 | Confirm the bypass policy is the implemented **none** | ✔ implemented; confirm |
| AP-B2 | Decide the foreign `.kate-swp` (delete vs `.gitignore`) — left in place | ⏸ open |
| AP-B3 | Decide `next-env.d.ts` (leave uncommitted vs restore) — left modified | ⏸ open |
| AP-4 | Whether to open a follow-up removing the collation dependency (C1A §11.2) | ⏸ open |
| AP-3 | A4 (committed-tree replay) stays **prepared-only** | ⏸ open |
| AP-2 | HELD files (`.env.example`, `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`, …) | ⏸ open |

**STOP.** Nothing was staged or committed. Awaiting the owner's explicit approval before the C1B commit, C2, C3,
C4, A4 or STEP 2C.7.

---

## Appendix A — Commands executed and real exit codes

| # | Command | Exit |
|---|---|---|
| 1 | `git rev-parse HEAD`, `git branch --show-current` | 0 |
| 2 | `git status --porcelain=v1 -uall` | 0 (29 / 52 entries) |
| 3 | `git diff --cached --name-only` | 0 (empty) |
| 4 | `git stash list` | 0 (empty) |
| 5 | `git show --format=fuller --stat HEAD` | 0 |
| 6 | committed-blob re-hash vs `baseline.checksums` (22 files, python) | 0 (0 mismatch) |
| 7 | `git show HEAD:<path>` × 4 F-7 vs expected/on-disk/baseline | 0 (all true) |
| 8 | `npm run db:preflight` | **0** (PASS) |
| 9 | `npx tsx --test tests/migration-ordering.unit.test.ts` | **0** (23/23, 0 fail) |
| 10 | `npx tsc --noEmit` | **0** |
| 11 | `git diff --check` | **0** |
| 12 | `git diff -- package.json` / `-- README.md` / `-- .gitignore` / `-- next-env.d.ts` | 0 |
| 13 | guard import / write-site / flag / env / db-token greps | 0 (no matches where none expected; `grep` exit 1 = correct) |
| 14 | `git check-ignore -q` × 5 C1B files | 1 (correct: none ignored) |
| 15 | `stat -c %s` × 3 artifacts | 0 (24114 / 3851 / 20027) |
| 16 | boundary classification (python, 52 paths) | 0 (`NONE` unclassified) |

**Not run (prohibited or unauthorised):** `git add`, `git commit`, `git push`, `git reset`, `git restore`,
`git stash`, merge/rebase, `--amend`, `npm run db:deploy`, `npm run db:baseline:update`,
`prisma migrate deploy|dev`, `npm run build`, any migration/replay, any database contact, A4, deployment,
STEP 2C.7.
