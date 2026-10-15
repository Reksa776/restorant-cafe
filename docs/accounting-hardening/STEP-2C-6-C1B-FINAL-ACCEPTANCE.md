# STEP 2C.6-C1B — FINAL ACCEPTANCE VERIFICATION

**Subphase of 2C.6-C1B · mode: READ-ONLY VERIFICATION · C1 REMAINS ON HOLD**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD | `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` |
| Branch | `main` |
| Baseline input | `STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md` (read-only input; **not modified**) |
| Verdict | ✅ **ACCEPTED** — the guard implementation matches its report and every acceptance check passes |

> **Scope.** Verification only. No `git add`/commit/push, no staging, no migration/replay, no `db:deploy`,
> no rebuild, no integration suite, no database contact, no ledger write, no A4, no STEP 2C.7. The only writes are
> this report and a short ROADMAP update; all earlier reports are read-only archives and were **not** modified.

---

## 1. Acceptance verdict

**ACCEPTED.** The three guard artifacts exist, are committable (not gitignored), and match the implementation
report exactly:

* the baseline is internally consistent — **22 order entries, 22 checksums, 22 on-disk directories, 0 mismatches**
  on an independent re-hash;
* `db:deploy` is `preflight && prisma migrate deploy` in that order;
* a Prisma-version mismatch is a **hard fail** (non-zero exit);
* there is **no bypass** flag or env var in v1;
* `--update` is explicit, gated by the canary, and the preflight path never writes;
* `next-env.d.ts` changed **only** as a build byproduct and is excluded from the commit scope;
* the guard's own tests and the preflight both pass on a re-run;
* Git is clean of staging: index empty, stash empty, `git diff --check` exit 0.

---

## 2. Check results (task items 1–9)

### 1 — Three files exist and are not ignored ✅

```
-rw-r--r-- 20027  tests/migration-ordering.unit.test.ts
-rw-r--r--  3851  tools/migration-order.baseline.json
-rw-r--r-- 24114  tools/preflight-migrations.mjs
```

`git check-ignore -v` over all three → **exit 1, no output** = **none is ignored** (contrast: `.gitignore`
line 18 `/scripts/*` *does* ignore new files under `scripts/` — the guard was deliberately placed in `tools/`).
`git status --porcelain -- tools/ tests/migration-ordering.unit.test.ts` shows them as `?? tools/` and
`?? tests/migration-ordering.unit.test.ts` — i.e. visible and committable.

### 2 — Baseline: 22 migrations, 22 checksums ✅

Independent re-hash (not reusing the generator's output):

```
schemaVersion: 1            prismaVersion: 7.10.0
order length: 22 (22? true)
checksum entries: 22 (22? true)
on-disk dirs: 22
order set == on-disk set: true
checksum mismatches: NONE
VERDICT: BASELINE OK
```

The baseline's set is exactly the 22 existing migration directories, and every `checksums[name]` equals
`sha256(prisma/migrations/<name>/migration.sql)` recomputed from disk.

### 3 — `db:deploy` = preflight then deploy ✅

```
"db:deploy" => "node tools/preflight-migrations.mjs && prisma migrate deploy"
has && : true
preflight first: true
```

The preflight runs first and is joined with `&&`, so a failing preflight stops the deploy before any migration.

### 4 — Prisma-version mismatch is a hard fail ✅

Two `F8_PRISMA_VERSION` sites exist in `tools/preflight-migrations.mjs` (lines 393, 400): one for *version
undeterminable* (missing/unreadable `node_modules/prisma/package.json`) and one for *installed ≠ baseline*.
Both are pushed into `failures`, and the exit accounting is
`return outcome.failures.length === 0 ? 0 : 1` (line 672) — so **any** F8 makes the process exit non-zero.
Independently exercised by the re-run suite: **T15** (installed 7.11.0 vs baseline 7.10.0 → F8) and **T15b**
(missing Prisma package → F8), both passing.

### 5 — No automatic bypass ✅

Declared CLI flags (comments stripped): `--project-root`, `--migrations-dir`, `--baseline`, `--json`, `--update`,
`--help`. `--force` / `--skip` / `--ignore` / `--bypass` → **absent**; `process.env.*BYPASS` → **absent**.
`db:deploy` contains no bypass and only the `&&` chain. Enforced independently by suite test **E2**.

### 6 — `--update` security audit ✅

* **Every** write site in the file is the single pair at lines 623–624
  (`mkdirSync(dirname(baselinePath))` + `writeFileSync(baselinePath, …)`), and both sit **inside the
  `args.update` branch**. The preflight path (after `outcome = preflight(...)`) contains **0** `writeFileSync`
  calls — it is read-only by construction.
* **Gated by the canary:** within the `--update` branch the order is `runCanary()` → on failure `return 1`
  **before** any write; only then `buildBaseline(...)` → `writeFileSync(...)`. So the guard refuses to freeze an
  order it cannot trust.
* **Never automatic:** `--update` is reached only via the explicit `--update` argument
  (`npm run db:baseline:update`). Nothing in the preflight or deploy path calls it, so a failing preflight or a
  failing `db:deploy` can never rewrite the baseline. `baselinePath` is never modified elsewhere.
* **Review enforced out-of-band:** the baseline is a version-controlled file; CI/human review of the diff is the
  control (no CI exists in this repo — see §4 R-4). Independently enforced by suite tests **E1** (`--update`
  refuses when the canary fails; baseline byte-identical) and **T16b** (a failing preflight leaves a tampered
  baseline untouched).

### 7 — `next-env.d.ts` changed only due to the build, and is out of commit scope ✅

```
-import "./.next/dev/types/routes.d.ts";
-import "./.next/dev/types/root-params.d.ts";
+import "./.next/types/routes.d.ts";
+import "./.next/types/root-params.d.ts";
```

That is the whole diff: Next.js regenerating its own generated file when the production build ran
(`next build` vs `next dev` type paths). The file itself says *"This file should not be edited"*. It is a
**tracked** file, so it would be picked up by a broad `git add .` — and it is therefore listed in the exclusion
set in §5. It is not part of the guard deliverable and must not be committed with it.

### 8 — Guard unit tests and preflight re-run ✅

```
npm run db:preflight                              → exit 0  (PASS, 22 on disk / 22 baseline, checksums identical)
npx tsx --test tests/migration-ordering.unit.test.ts
    ℹ tests 23   ℹ pass 23   ℹ fail 0   ℹ duration_ms 6024
                                                  → exit 0  (0 "not ok" lines)
```

No migration, no `db:deploy`, no rebuild, no integration suite was run.

### 9 — Git status / index / whitespace ✅

```
HEAD   = e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0
branch = main
index (staged) = 0      (empty)
stash          = 0
git diff --check → exit 0
porcelain entries = 33
```

Everything is unstaged; nothing was committed, pushed, staged, reset, restored or stashed.

---

## 3. Residual risk

| ID | Risk | Severity | Status |
|---|---|---|---|
| R-1 | A manual `npx prisma migrate deploy` still bypasses the guard | Medium | Documented in `README.md`; not automated (out of the approved scope). |
| R-2 | The guard replicates the CLI's one-line comparator (Prisma's loader is not exported) | Medium | Bounded by the frozen `prismaVersion` + **F8 hard fail** on any Prisma change → fail-closed, never silent. |
| R-3 | The baseline goes stale when a migration is added/edited | Medium | Explicit `--update` + review; a stale baseline fails closed with an explicit remedy message. |
| R-4 | No CI in this repository → the gate runs only where `db:preflight`/`db:deploy` is invoked | Medium | README documents the mandate; the artifacts live in the committable `tools/`. |
| R-5 | T9/T10 simulate small-/no-ICU via a `localeCompare` preload rather than a real binary | Low | The shadowed primitive is exactly what the guard and CLI depend on; recorded as a limitation. |
| R-6 | The guard can only refuse a drifted runtime, not repair it | Low | Intended (fail-closed by design). |
| R-7 | `next-env.d.ts` drift between `next dev` and `next build` will resurface | Low | Excluded from commits; regenerated automatically; no action required. |

---

## 4. Exact commit exclusion

Nothing was staged. For a future guard commit, the scope is **exactly** the guard's own files; everything below
must remain **uncommitted/unchanged** in that commit. The 33 porcelain entries, by intended disposition:

**INCLUDE (guard commit only — not authorised here):**

```
tools/preflight-migrations.mjs                     (new)
tools/migration-order.baseline.json                (new)
tests/migration-ordering.unit.test.ts              (new)
package.json                                       (scripts hunk only: db:preflight, db:deploy, db:baseline:update)
README.md                                          (migration-safety-preflight section + VPS note)
docs/accounting-hardening/STEP-2C-6-C1B-*.md       (design + implementation + this acceptance report)
docs/accounting-hardening/ROADMAP.md               (status lines for C1B)
```

**EXCLUDE — must NOT appear in a guard commit:**

| Group | Paths | Why |
|---|---|---|
| **Build byproduct** | `next-env.d.ts` | Auto-regenerated by `npm run build`; not a hand edit |
| **C1 material (on HOLD)** | `prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql`, `…/20260909_add_customer_auth_promo/…`, `…/20260911_add_ingredient_purchasing_wac/…`, `…/20260911140000_add_purchasing_inventory_foundation/…` | The 4-file F-7 relocation — belongs to commit **C1**, explicitly unapproved |
| **C2 source (pre-existing)** | `prisma/seed.ts`, `scripts/backfill-branch.ts`, `scripts/diag-p3018.mjs`, `scripts/prisma-diag.mjs`, `src/lib/prisma.ts`, `src/lib/database-url.ts`, `src/services/accounting/integrity.{rules,service,types}.ts`, `src/services/report/report.service.ts`, `src/app/api/reports/products/export/route.ts` | Accounting + F-2 work → separate commit |
| **C3 tests (pre-existing)** | `tests/**` **except** `tests/migration-ordering.unit.test.ts`, `src/services/accounting/integrity.unit.test.ts`, `src/lib/database-url.unit.test.ts`, `tests/setup.ts`, `tests/fixtures/**`, `tests/accounting/**` | Test work → separate commit |
| **C3 infra** | `.gitignore`, `.env.test.example` | Test infrastructure → separate commit |
| **HELD (pre-programme)** | `.env.example`, `HERMES-*.md` (4), `INVENTORY-DESIGN-REVIEW.md`, `ACCOUNTING-INTEGRATION-TEST-PLAN.md`, `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` | Unrelated / owner decision pending |

**Staging rule for that future commit:** path-explicit only (`git add -- <path>`), never `git add .` / `-A` /
`-u` / `commit -a` — a broad add would sweep in `next-env.d.ts` and the whole pre-existing 2C.x tree.

---

## 5. Open blockers

| ID | Blocker | Owner decision |
|---|---|---|
| **AP-1** | **Commit C1** (the 4-file F-7 relocation) — still **WITHHELD**; C1 remains on HOLD and uncommitted | explicit approval required |
| **AP-C1B-6** | Accept the guard implementation as delivered (this report is the evidence) | explicit approval required |
| AP-C1B-3 | Confirm the Prisma-version policy is the implemented **HARD FAIL** | confirm |
| AP-C1B-4 | Confirm the bypass policy is the implemented **none** | confirm |
| AP-3 | A4 (committed-tree replay) stays prepared-only | confirm |
| R-4 | Decide whether a CI gate is added (no CI exists today) | future phase |

**STOP.** No commit, no staging, no push, no deploy, no migration, no A4, no STEP 2C.7.

---

## Appendix A — Commands and exit codes

| Check | Command | Exit |
|---|---|---|
| Artifact existence | `ls -l tools/... tests/...` | 0 |
| Not ignored | `git check-ignore -v tools/… tests/…` | **1** (correct: none ignored) |
| Baseline integrity | independent `node` re-hash + set compare | 0 (`BASELINE OK`) |
| `db:deploy` shape | `node -e` on `package.json.scripts` | 0 (`&&`, preflight first) |
| F8 path | `grep -n F8_PRISMA_VERSION` + exit accounting | 0 |
| No bypass | comment-stripped flag scan | 0 (`beyond present: false`) |
| `--update` write sites | `grep -n writeFileSync` + branch scan | 0 (only lines 623–624, inside `--update`) |
| Preflight path is read-only | `awk` slice after `outcome = preflight(` → `grep -c writeFileSync` | 0 matches (**grep itself exits 1 on no-match — expected, not a failure**) |
| `next-env.d.ts` | `git diff -- next-env.d.ts` | 0 |
| Guard tests | `npx tsx --test tests/migration-ordering.unit.test.ts` | **0** (tests 23 / pass 23 / fail 0) |
| Preflight | `npm run db:preflight` | **0** (PASS) |
| Git state | `rev-parse`, `status --porcelain`, `diff --cached`, `stash list`, `diff --check` | 0 / 0 / empty / 0 / **0** |
