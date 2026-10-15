# STEP 2C.6-C1 — CONTROLLED COMMIT EXECUTION

**Subphase of 2C.6 · mode: CONTROLLED EXECUTION — C1 ONLY · OWNER APPROVAL AP-1 GRANTED**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| Branch | `main` |
| Pre-commit HEAD | `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` |
| **New commit** | **`350afeca8bcee528152b1f2883dc4e91e5708e83`** (`350afec`) |
| Parent | `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` ✅ |
| Commit message | `fix(migrations): correct historical F7 dependency ordering` (verbatim, as instructed — no extra footer/trailer lines added) |
| Result | ✅ **C1 COMMITTED SUCCESSFULLY — all gates PASS, all post-commit invariants hold** |

> **Scope honoured.** Only the four C1 migration SQL files were staged and committed, path-explicitly. No `git add .`
> / `-A` / `-u`, no `git commit -a`, no wildcard staging. **No** push, merge/rebase, `reset --hard`, `restore`,
> `stash`, `--amend`; **no** migration/replay, `prisma migrate deploy`, `db:deploy`, `db:baseline:update`, no
> database contact/write, no A4, no deployment, no STEP 2C.7. No migration SQL, source, test or guard file was
> edited. Baseline reports were read, not re-audited.

---

## 1. Pre-commit HEAD and Git state `[Measured]`

```
branch = main
HEAD   = e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0
index  = 0   (empty — nothing staged)
stash  = 0
```

Working-tree changes under `prisma/migrations/` were **exactly the four** C1 files (count = 4), and
`prisma/schema.prisma` was **untouched** (`git status --porcelain -- prisma/schema.prisma` → 0).

---

## 2. Four checksums before staging `[Measured]`

Each file was hashed and compared **both** to the approved expected digest and to the C1B guard baseline (to
confirm the baseline still matches the four SQL):

| Migration | file vs expected | baseline vs expected | sha256 (16) |
|---|---|---|---|
| `20260908030144_add_branch_multi_cabang` | **OK** | **OK** | `97ee89d541046738` |
| `20260909_add_customer_auth_promo` | **OK** | **OK** | `019b42ed36c739a9` |
| `20260911_add_ingredient_purchasing_wac` | **OK** | **OK** | `fac529c73bcf008c` |
| `20260911140000_add_purchasing_inventory_foundation` | **OK** | **OK** | `47365a5cdbaf4a13` |

Full digests match the audited values exactly:
`97ee89d5410467386546ea656b42a3c545f70e859bcde54ef786e1f1304462d6`,
`019b42ed36c739a9b6d800c24c5cef548263df34e2fee555c333b8e6882641e1`,
`fac529c73bcf008cab9c8c1f75d1a37b3bd12be87abf72e0da28ebb8a39ea969`,
`47365a5cdbaf4a131aab686dceacd83a90c1557a544ece8dc739cc9ee8a6f840`.

The porcelain count was **not** used as the sole gate (the new audit reports add untracked entries).

---

## 3. Exact staged set `[Measured]`

Staged with a single path-explicit command:

```bash
git add -- \
  prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql \
  prisma/migrations/20260909_add_customer_auth_promo/migration.sql \
  prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql \
  prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
```

`git diff --cached --name-only`:

```
prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
prisma/migrations/20260909_add_customer_auth_promo/migration.sql
prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
```

**count = 4.** `name-status` = **4 × `M`**, with **no `R`/`A`/`D`** → no migration rename, no addition, no deletion.

---

## 4. Staged diff verification `[Measured]`

Staged-set gate — **all nine requirements PASS**:

| # | Requirement | Result |
|---|---|---|
| 1 | Exactly four files | ✅ 4 |
| 2 | No additional file | ✅ none |
| 3 | No migration name change | ✅ 4 × `M`, no `R` |
| 4 | No Prisma schema change | ✅ `prisma/schema.prisma` absent from the staged set |
| 5 | No guard / README / package.json / docs / tests | ✅ none staged |
| 6 | No `.kate-swp`, `next-env.d.ts`, `.env*`, HELD files | ✅ grep over the staged set → `NONE` |
| 7 | Diff matches the audited F-7 relocation (+41 / −29) | ✅ `4 files changed, 41 insertions(+), 29 deletions(-)` |
| 8 | No SQL statement lost or added | ✅ **PB1 44 ≡ 44**, **PB2 16 ≡ 16**, lost `[]`, added `[]` (multiset over `HEAD:` vs index blobs) |
| 9 | `git diff --cached --check` | ✅ **exit 0** |

Per-file staged `--numstat` (matches C1 §3.1):

```
0       9       .../20260908030144_add_branch_multi_cabang/migration.sql
16      1       .../20260909_add_customer_auth_promo/migration.sql
19      0       .../20260911140000_add_purchasing_inventory_foundation/migration.sql
6       19      .../20260911_add_ingredient_purchasing_wac/migration.sql
```

`[Measured]` No active Git hooks exist (`ls .git/hooks | grep -v .sample` → empty), so no hook could alter or block
the commit; none was bypassed.

---

## 5. Commit hash and parent hash `[Measured]`

```
$ git commit -m "fix(migrations): correct historical F7 dependency ordering"
[main 350afec] fix(migrations): correct historical F7 dependency ordering
 4 files changed, 41 insertions(+), 29 deletions(-)
commit-exit = 0

$ git rev-parse HEAD    350afeca8bcee528152b1f2883dc4e91e5708e83
$ git rev-parse HEAD^   e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0
$ git rev-list --count e8d4aa3..HEAD   1
```

Author/committer: `reksa776 <reksa776@gmail.com>`, `Thu Oct 15 12:45:59 2026 +0700`.

---

## 6. Exact committed file list `[Measured]`

`git diff-tree --no-commit-id --name-only -r HEAD`:

```
prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
prisma/migrations/20260909_add_customer_auth_promo/migration.sql
prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
```

**count = 4.**

---

## 7. Post-commit Git state `[Measured]`

```
HEAD   = 350afeca8bcee528152b1f2883dc4e91e5708e83   (exactly one commit past e8d4aa3)
parent = e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0
index  = 0        (empty again)
stash  = 0
git diff --check           exit 0
git status --porcelain      29   (short)
git status --porcelain -uall 51  (16 modified + 35 untracked)
```

Expected and observed: the four migration files left the "modified" set (−4), every other entry survives
unchanged.

**Guard baseline ↔ committed blobs** `[Measured]`: sha256 of `git show HEAD:<path>` equals
`tools/migration-order.baseline.json` for **all four** (`OK` ×4) — i.e. the C1B baseline now matches the
**committed** SQL, closing the C1 → C1B dependency that the boundary audit flagged.

**Excluded artifacts** `[Measured]`: `next-env.d.ts` remains **modified but uncommitted**; the foreign
`docs/accounting-hardening/.STEP-2C-6-C1B-GUARD-IMPLEMENTATION.md.kate-swp` is **not tracked by Git**
(`ls-files --error-unmatch` → "did not match any file(s) known to git") and is **still present on disk**
(c ~3.29 MB). Neither entered the commit.

---

## 8. Preservation of all other boundaries `[Measured]`

`git status --porcelain=v1 -uall` post-commit, grouped — **every non-C1 boundary is intact and untouched**:

| Boundary | State after C1 | Evidence |
|---|---|---|
| **C1B** (5) | intact | `tools/preflight-migrations.mjs`, `tools/migration-order.baseline.json`, `tests/migration-ordering.unit.test.ts` untracked; `package.json`, `README.md` still modified |
| **C2** (11) | intact | `prisma/seed.ts`, 3 × `scripts/*`, `src/lib/prisma.ts`, `src/lib/database-url.ts`, 3 × `integrity.*.ts`, `report.service.ts`, `export/route.ts` all still present as before |
| **C3** (13) | intact | `.gitignore`, `.env.test.example`, `integrity.unit.test.ts`, `database-url.unit.test.ts`, 10 × `tests/**` unchanged |
| **C4** (14) | intact | 12 × `docs/accounting-hardening/*.md` + 2 × `ACCOUNTING-*.md` unchanged (all untracked) |
| **HELD** (6) | intact | `.env.example`, 4 × `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md` unchanged |
| **EXCLUDE** (2) | intact | `next-env.d.ts` uncommitted; `.kate-swp` untracked and present |

No file was lost, created, deleted or modified by the commit process other than the four C1 files.

---

## 9. Report and ROADMAP impact

* **New report (this file):** `docs/accounting-hardening/STEP-2C-6-C1-COMMIT-EXECUTION.md` — created **after** the
  commit, so it is **not** part of C1 (no retro-active inclusion). It is untracked and belongs to **C4**.
* **ROADMAP:** updated with a short status row/section and a link to this report only; no long report pasted.
* **Prior reports:** read-only archives — none appended to or modified.

---

## 10. Remaining approval gates

| ID | Decision | Status |
|---|---|---|
| **AP-1** | Commit C1 | ✅ **EXECUTED** (`350afec`) |
| **AP-C1B-commit** | Authorise committing **C1B** (guard; accepted & closed, **not** yet authorised to commit) | ⏸ open |
| AP-C2 / AP-C3 / AP-C4 | Authorise the C2 / C3 / C4 commits (boundaries in `STEP-2C-6-FINAL-COMMIT-BOUNDARY-AUDIT.md`) | ⏸ open |
| **AP-B2** | `.kate-swp` (delete vs `.gitignore`) | ⏸ open |
| **AP-B3** | `next-env.d.ts` (leave vs housekeeping vs restore) | ⏸ open |
| **AP-3** | A4 (committed-tree replay) — now unblocked in principle by C1, still **prepared-only** | ⏸ open |
| AP-2 | `.env.example` + 4 × `HERMES-*.md` + `INVENTORY-DESIGN-REVIEW.md` stay HELD | ⏸ open |

**STOP.** C1 is complete. **No** C1B commit, **no** A4, **no** STEP 2C.7 was started. Awaiting the next explicit
approval.

---

## Appendix — Gate transcript (exit codes captured directly)

| Step | Command | Exit |
|---|---|---|
| Pre-commit | `git rev-parse --abbrev-ref HEAD` / `rev-parse HEAD` / `diff --cached --name-only` / `stash list` | `main` / `e8d4aa3…` / `0` / `0` |
| Checksums | `sha256sum` + baseline compare (4 files) | all **OK** |
| Staging | `git add -- <4 paths>` | 0 |
| Staged set | `git diff --cached --name-only` | 4 |
| Staged names | `git diff --cached --name-status` | 4 × `M` |
| Staged size | `git diff --cached --numstat` | **+41 / −29** |
| Whitespace | `git diff --cached --check` | **0** |
| Statements | multiset `HEAD:` vs index over PB1/PB2 | **44≡44, 16≡16** (PASS) |
| Hooks | `ls .git/hooks \| grep -v .sample` | none |
| Commit | `git commit -m "…"` | **0** |
| Post | `git show/diff-tree/status/rev-list` + baseline↔committed | all invariants hold |
