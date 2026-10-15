# STEP 2C.6-C1 — F-7 COMMIT READINESS (four historical migration relocations)

**Project:** `/home/reksa/restorant-cafe`
**Date:** 2026-10-14
**Phase:** **2C.6-C1** (sub-gate of 2C.6; 2C.6 itself is not re-opened)
**Mode:** 🔒 **AUDIT ONLY → APPROVAL GATE.** No `git add`, no `commit`, no `push`, no merge/rebase/reset/restore/stash,
no migration command, no schema/SQL change, no production database contact, no A4 replay, no 2C.7 start, and the
older reports are treated as **read-only archives**.
**Report policy:** this is a **new, self-contained** report. Nothing was appended to
`ACCOUNTING-INTEGRATION-TEST-PLAN.md` or `STEP-2C-6-MIGRATION-COMPATIBILITY.md`.

**Verdict: ✅ C1 IS READY FOR AN EXACTLY-BOUNDED COMMIT — SUBJECT TO EXPLICIT OWNER APPROVAL.**
The four files are self-contained, statement-preserving, dependency-correct under the order Prisma actually applies,
and carry no unrelated change. **Nothing has been staged and nothing has been committed.** C1 remains
**release-critical**: without it, any environment provisioned from `HEAD` still fails.

**Evidence classes** (nothing is asserted above its class):

| Class | Meaning |
|---|---|
| `[Measured]` | Read first-hand in this phase (git, sha256, `docker inspect`, read-only SQL) |
| `[Recorded]` | Carried from an earlier phase's report of this repo (the phase is named) |
| `[Inferred]` | Follows from the evidence but is not itself observed |
| `[UNKNOWN]` | Not determinable here |

---

## 1. Initial working-tree state `[Measured]`

```
$ git rev-parse --abbrev-ref HEAD     main
$ git rev-parse HEAD                  e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0
$ git log -1 --oneline                e8d4aa3 fix selesai orderan
$ git status --porcelain | wc -l      29
$ git stash list | wc -l              0
$ git diff --cached --name-only       (empty — nothing staged)
$ git diff --check                    exit 0
$ test -f .git/MERGE_HEAD             no merge / no rebase in progress
```

Identical to the 2C.5 and 2C.6 exit state: **29 porcelain entries / 42 files**, HEAD `e8d4aa3`, branch `main`.

<details><summary>Full initial <code>git status --porcelain</code></summary>

```
 M .env.example
 M .gitignore
 M prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
 M prisma/migrations/20260909_add_customer_auth_promo/migration.sql
 M prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
 M prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
 M prisma/seed.ts
 M scripts/backfill-branch.ts
 M scripts/diag-p3018.mjs
 M scripts/prisma-diag.mjs
 M src/app/api/reports/products/export/route.ts
 M src/lib/prisma.ts
 M src/services/accounting/integrity.rules.ts
 M src/services/accounting/integrity.service.ts
 M src/services/accounting/integrity.types.ts
 M src/services/accounting/integrity.unit.test.ts
 M src/services/report/report.service.ts
?? .env.test.example
?? ACCOUNTING-INTEGRATION-TEST-PLAN.md
?? ACCOUNTING-M2-SOLUTION-PROPOSAL.md
?? HERMES-ACCOUNTING-CONFLICT-AUDIT.md
?? HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md
?? HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md
?? HERMES-PROJECT-AUDIT.md
?? INVENTORY-DESIGN-REVIEW.md
?? docs/
?? src/lib/database-url.ts
?? src/lib/database-url.unit.test.ts
?? tests/
```
</details>

`git status --porcelain -- prisma/` returns exactly the four migrations **plus `prisma/seed.ts`** (an F-2 source
change, not part of C1). There is **no untracked file inside `prisma/migrations/`**.

---

## 2. The four files that would enter C1

| # | Path | Role in the repair |
|---|---|---|
| 1 | `prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql` | **Loses** the three `promo.branchId` statements (AlterTable / CreateIndex / AddForeignKey) that ran before `promo` existed |
| 2 | `prisma/migrations/20260909_add_customer_auth_promo/migration.sql` | **Receives** those three statements verbatim, after `CREATE TABLE promo` |
| 3 | `prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql` | **Loses** `CREATE TABLE purchaseingredient` (split across the two words) — it ran before its parent table `purchase` existed — and gains an explanatory comment |
| 4 | `prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql` | **Receives** that `CREATE TABLE purchaseingredient` verbatim, after `CREATE TABLE purchase` |

`[Recorded]` These four files are the **F-7 repair produced in STEP 2C.2D** ("historical migration relocation"), and
they are the target state confirmed in 2C.6 (decision **A2** — keep Option A; do not edit SQL further, do not rewrite
the checksum ledger).

---

## 3. Exact diff and hash verification `[Measured]`

### 3.1 Change size (only relocation + one comment + one newline)

```
$ git diff --numstat -- prisma/migrations/
0       9       prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
16      1       prisma/migrations/20260909_add_customer_auth_promo/migration.sql
19      0       prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
6       19      prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
```

**4 files changed, 41 insertions(+), 29 deletions(-).** The insertions that are not relocated SQL are:
(a) two explanatory `--` comment blocks (13 lines, one per receiving file), and
(b) a **missing trailing newline restored** at the end of file 2 (the `\ No newline at end of file` marker).
Neither alters a statement; both are safe to commit.

### 3.2 What moves

**Pair 1 — `promo.branchId` (9 lines removed from file 1, 16 added to file 2)**

```sql
-- AlterTable
ALTER TABLE `promo` ADD COLUMN `branchId` VARCHAR(191) NULL;
-- CreateIndex
CREATE INDEX `promo_branchId_idx` ON `promo`(`branchId`);
-- AddForeignKey
ALTER TABLE `promo` ADD CONSTRAINT `promo_branchId_fkey` FOREIGN KEY (`branchId`) REFERENCES `branch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
```

**Pair 2 — `purchaseingredient` (19 lines removed from file 3, 19 added to file 4)**

```sql
CREATE TABLE `purchaseingredient` (
  `id` VARCHAR(191) NOT NULL, `purchaseId` VARCHAR(191) NOT NULL, `ingredientId` VARCHAR(191) NOT NULL,
  `quantity` DECIMAL(18,3) NOT NULL, `unit` ENUM('PCS','GRAM','KG','ML','LITER') NOT NULL,
  `unitCost` DECIMAL(12,2) NOT NULL, `lineTotal` DECIMAL(12,2) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `purchaseingredient_purchaseId_idx` (`purchaseId`),
  INDEX `purchaseingredient_ingredientId_idx` (`ingredientId`),
  CONSTRAINT `purchaseingredient_purchaseId_fkey` FOREIGN KEY (`purchaseId`) REFERENCES `purchase`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `purchaseingredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

`[Measured]` **Byte-identical relocation, proven at line level.** Comparing the `-`/`+` lines of `git diff` and
discarding comment and blank lines, the non-comment SQL lines **removed** equal the non-comment SQL lines **added** as a
multiset for **both** pairs — pair 1: **4 ≡ 4**, pair 2: **15 ≡ 15**, **lost `[]`, extra `[]`**. In other words not one
statement was reflowed, reordered, retyped or truncated; the only non-statement insertions are the explanatory `--`
comment banners and one restored trailing newline in file 2. `git diff --check` over the whole working tree returns
**exit 0** (no whitespace errors, no conflict markers).

### 3.3 Hash verification

| File | `HEAD:` blob content sha256 | working-tree sha256 | v3 ledger `checksum` (12) |
|---|---|---|---|
| `20260908030144_add_branch_multi_cabang` | `7348b5db51fddef2…2c940e0` | **`97ee89d5410467386546ea656b42a3c545f70e859bcde54ef786e1f1304462d6`** | `97ee89d54104` ✅ |
| `20260909_add_customer_auth_promo` | `0a9f59304a609c17…bac8a0b0b` | **`019b42ed36c739a9b6d800c24c5cef548263df34e2fee555c333b8e6882641e1`** | `019b42ed36c7` ✅ |
| `20260911_add_ingredient_purchasing_wac` | `4f286cdc429c2443…5d5e3b2c5` | **`fac529c73bcf008cab9c8c1f75d1a37b3bd12be87abf72e0da28ebb8a39ea969`** | `fac529c73bcf` ✅ |
| `20260911140000_add_purchasing_inventory_foundation` | `112aca03238800ae…8718b5dd` | **`47365a5cdbaf4a13…ee8a6f840`** | `47365a5cdbaf` ✅ |

`[Measured]` The working-tree hashes are **in the confirmed 2C.6 record** and are **identical to the checksums the
approved test database `restaurant_app_test_v3` holds for these four migrations**. So the artefact that would be
committed is exactly the artefact that was replayed and audited — no drift between audit and commit candidate.

---

## 4. Statement-preservation result `[Measured]`

Independent scan (Python: strip `--` and `/* */` comments, split on `;`, normalise whitespace, compare multisets of
statements) over the **pair total**, i.e. exactly the scope in which statements were moved:

| Pair | HEAD statements | Working-tree statements | Multiset equal | Lost | Added |
|---|---|---|---|---|---|
| 1 · `20260908030144` + `20260909_add_customer_auth_promo` | **44** | **44** | ✅ **true** | `[]` | `[]` |
| 2 · `20260911_add_ingredient_purchasing_wac` + `20260911140000` | **16** | **16** | ✅ **true** | `[]` | `[]` |

**44 ≡ 44 and 16 ≡ 16, zero lost, zero added.** The repair moves statements between files inside a pair; it does not
create, drop or rewrite any statement. This is confirmed a second time (the same result was measured in 2C.6 Part II
§12.5) and matches `[Recorded]` 2C.2D.

---

## 5. Migration compatibility risk

### 5.1 Apply order — the relocation is order-dependent, and the order is proven `[Measured]`

Prisma does **not** apply this chain in plain directory-name (`ls | sort`) order. The order recorded in the approved
v3 ledger (read-only `SELECT … ORDER BY started_at, id`) is:

```
 5  20260908_add_restaurant_branding
 6  20260908030144_add_branch_multi_cabang          <- CREATE TABLE branch
 7  20260908040000_table_unique_per_branch
 8  20260909_add_customer_auth_promo                <- CREATE TABLE promo, then promo.branchId block
 …
10  20260911_add_ingredient_f1                      <- CREATE TABLE ingredient
11  20260911_add_ingredient_purchasing_wac          <- no longer creates purchaseingredient
12  20260911_add_recipe_bom
13  20260911120000_add_promousage_branch_id
14  20260911130000_add_stock_branchproduct
15  20260911140000_add_purchasing_inventory_foundation   <- CREATE TABLE purchase, then purchaseingredient
16  20260911143644_f5_order_item_cost_snapshot
```

Note that all `20260911_*` folders (8-digit prefix) are applied **before** `20260911120000…/20260911140000…`
(14-digit prefix); plain `ls | sort` orders them the other way round. Dependency check under the **actual** order:

| Moved object | Needs | Created at | Applied at | OK |
|---|---|---|---|---|
| `promo.branchId` + index + FK → `branch` | `promo`, `branch` | `promo` line 21 of file 2; `branch` line 29 of file 1 | 8 / 8 (§5.1 index 6 before 8) | ✅ |
| `purchaseingredient` → `purchase` | `purchase` | line 21 of file 4 | 15 (same file, earlier line) | ✅ |
| `purchaseingredient` → `ingredient` | `ingredient` | `20260911_add_ingredient_f1` line 9 | 10, before 15 | ✅ |

`[Recorded]` And it is **empirically proven end-to-end**: the 2C.2E rehearsal replayed the fixed tree into a fresh
schema with **22/22 applied, exit 0** (no P3018 / errno 1146), and v3's 22/22 checksums match the working tree.
`[Inferred]` The relocation is therefore correct **as long as Prisma keeps applying `20260911_*` before
`20260911140000_*`**. **Do not reason about this chain with plain lexicographic/`ls` order** — that ordering would put
`20260911140000` (index 12) *before* `20260911_add_ingredient_f1` (index 14) and the `ingredient` FK would fail.
This is a latent fragility of the relocation (recorded, not fixed — A2 freezes the target state).

### 5.2 Checksum drift against existing databases

| Database | State after C1 is committed | Consequence |
|---|---|---|
| Fresh / `v3` (chain-provisioned) | 22/22 checksums match | none |
| Existing DB built from the pre-fix tree (`HEAD`, e.g. the shared host on 3306) | **18 match / 4 differ** — exactly these four rows keep their pre-patch checksum | `[Recorded]` Prisma 7.10.0 `migrate deploy` does not act on the difference (it never calls `diagnoseMigrationHistory`) → metadata-only delta; **no DDL, no data change**. Must be documented per environment; **never** reconciled by rewriting `_prisma_migrations` or by `migrate resolve` |

`[UNKNOWN]` The production ledger's four checksums (not readable from this workspace). `[Inferred]` C1 does **not**
worsen drift: the four files already differ from `HEAD` today; committing them changes *who* the difference is
attributed to, not whether it exists.

### 5.3 Why C1 cannot be deferred

`[Recorded]` CK-1: the F-7 fix exists **only in the working tree**. A deployment or environment provisioned from
`HEAD` still fails at `20260911_add_ingredient_purchasing_wac` (P3018 / errno **1146**, missing `promo` /
`purchase`). **C1 is the release-critical unit** — nothing else in the working tree fixes provisioning.

---

## 6. Proposed commit boundary `[Measured]`

**C1 contains exactly four files and nothing else:**

```
prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
prisma/migrations/20260909_add_customer_auth_promo/migration.sql
prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql
```

**Explicitly OUT of C1** (verified absent from the diff of `prisma/migrations/`):

| Excluded group | Paths | Why |
|---|---|---|
| Accounting / M2 source | `src/services/accounting/integrity.{rules,service,types}.ts`, `src/services/report/report.service.ts`, `src/app/api/reports/products/export/route.ts` | production-behaviour changes — separate commit (C2) |
| F-2 source | `prisma/seed.ts`, `scripts/backfill-branch.ts`, `scripts/diag-p3018.mjs`, `scripts/prisma-diag.mjs`, `src/lib/prisma.ts`, `src/lib/database-url.ts` | separate commit (C2) |
| Tests | `src/services/accounting/integrity.unit.test.ts`, `src/lib/database-url.unit.test.ts`, `tests/**` | separate commit (C3) |
| Test infra | `.gitignore`, `.env.test.example`, `tests/setup.ts`, `tests/README.md`, `tests/fixtures/accounting.ts` | separate commit (C3) |
| Docs / reports | `docs/**`, `ACCOUNTING-INTEGRATION-TEST-PLAN.md`, `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` | separate commit (C4) |
| `.env*` | `.env.example` | **HELD** — pre-programme (2026-10-13), needs an owner decision |
| Unrelated / pre-programme | `HERMES-*.md` (4), `INVENTORY-DESIGN-REVIEW.md` | **HELD** — not part of this programme |

`[Measured]` `git status --porcelain -- prisma/` lists only the four files plus `prisma/seed.ts`; there is **no
accidental carry-over** and no untracked file inside `prisma/migrations/`.

**Sufficiency:** the four files are a complete, self-contained unit — the chain's correctness depends only on the
migration folders' names and SQL, on `prisma/schema.prisma` (unchanged), and on nothing in groups 2–5 above.
**No other file is required for C1 to be a valid, working commit.**

**Proposed message (for review; not executed):**

```
fix(migrations): relocate two dependency blocks so an empty database can provision

Two historical migrations referenced tables created later in the chain, so a
fresh replay failed (P3018 / errno 1146). Move the `promo.branchId` block into
20260909_add_customer_auth_promo and `CREATE TABLE purchaseingredient` into
20260911140000_add_purchasing_inventory_foundation, after their parent tables.

Statement-preserving (44=44, 16=16; no statement added or lost). Existing
databases only see a metadata-only checksum delta, already documented.
```

---

## 7. Exact staging / commit commands for review — **DO NOT EXECUTE YET**

```bash
cd /home/reksa/restorant-cafe

# 1. prove the tree is still the audited one
git rev-parse HEAD                         # expect e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0
git status --porcelain | wc -l             # expect 29
git diff --check                           # expect exit 0

# 2. stage ONLY the four files (explicit paths — never a broad add)
git add -- prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql
git add -- prisma/migrations/20260909_add_customer_auth_promo/migration.sql
git add -- prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql
git add -- prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql

# 3. GATE: the staged set must be exactly these four files
git diff --cached --name-only              # expect exactly 4 paths, all under prisma/migrations/
git diff --cached --stat                   # expect 4 files, 41 insertions(+), 29 deletions(-)
git diff --cached --check                  # expect exit 0

# 4. commit (only after the gate above passes and approval is on record)
git commit -F- <<'EOF'
fix(migrations): relocate two dependency blocks so an empty database can provision

🤖 Generated with Codebuff
Co-Authored-By: Codebuff <noreply@codebuff.com>
EOF
```

**Prohibited in this phase (and in step 2 above):** `git add .`, `git add -A`, `git add -u`, `git commit -a`,
`git push`, `git merge/rebase/reset/restore/stash`. Staging must be **path-explicit**.

---

## 8. Rollback / recovery considerations

| Situation | Action (only with approval) | Note |
|---|---|---|
| Wrong file staged, before commit | `git restore --staged -- <path>` | Unstages only; the working tree is untouched. (`restore` is out of scope for this phase until approved) |
| C1 committed but wrong | `git reset --soft HEAD~1` then re-stage, **or** `git revert <sha>` | `--soft` keeps the working tree; never `--hard` |
| C1 must be abandoned entirely | `git checkout HEAD -- <the 4 files>` | ⚠️ Reintroduces F-7: fresh provisioning fails again (CK-8). Emergency only, never routine |
| Desired ledger checksum parity with an existing DB | **none** | Forbidden: `migrate resolve`, `UPDATE _prisma_migrations`. Accept the documented delta (§5.2) |

`[Measured]` No rollback was needed and none was performed: nothing is staged, `git stash list` is empty, and no
merge/rebase is in progress.

---

## 9. STOP conditions (abort C1, do not commit)

1. `git rev-parse HEAD` ≠ `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` (re-baseline first).
2. `git diff --cached --name-only` after step 2 ≠ **exactly** the four paths — unstage and restart the gate.
3. Any file from groups `.env*`, `docs/**`, `tests/**`, `src/**`, `scripts/**`, `HERMES-*` appears staged.
4. Working-tree sha256 of any of the four files differs from §3.3 — the audited artefact changed; **re-audit**.
5. `git diff --cached --check` ≠ exit 0, or a conflict marker appears.
6. A merge / rebase / cherry-pick is in progress (`.git/MERGE_HEAD` etc.).
7. Statement-preservation no longer holds (re-run §4 before staging) — a lost/added statement means the working tree
   is not the audited artefact.
8. Anyone proposes reconciling checksums by rewriting `_prisma_migrations`, or running `migrate resolve`, `migrate dev`,
   `db push`, or `migrate reset` — **prohibited**.
9. Approval for C1 is not explicitly on record.

---

## 10. Approval required before commit

| ID | Approval |
|---|---|
| **AP-1** | **Authorise commit C1** — the exactly four-file F-7 relocation, path-explicit staging, message in §6. *(This is the only approval C1 needs; decision A3 withheld it.)* |
| AP-2 | Confirm the sequence for C2/C3/C4 (accounting + F-2, tests/infra, docs) and whether `.env.example` + the four `HERMES-*.md` + `INVENTORY-DESIGN-REVIEW.md` are ever committed (currently **HELD**). |
| AP-3 | Re-confirm that **A4** (committed-tree replay on a disposable DB) stays prepared-only. |

---

## 11. Verification performed in this phase `[Measured]`

| # | Check | Command | Result |
|---|---|---|---|
| 11.1 | Initial working tree | `git status --porcelain`, `rev-parse HEAD`, `rev-parse --abbrev-ref` | 29 entries, `e8d4aa3`, `main`; nothing staged; stash 0; no merge |
| 11.2 | Whitespace / conflict | `git diff --check; echo $?` | **exit 0** |
| 11.3 | C1 scope | `git diff --name-only -- prisma/migrations/ \| wc -l` | **4** (no fifth file) |
| 11.4 | Change size | `git diff --numstat -- prisma/migrations/` | 4 files, **+41 / −29** |
| 11.5 | Exact content | `git diff -- <4 paths>` | relocation only + 2 comment banners + 1 restored trailing newline; relocated SQL lines **removed ≡ added** (pair 1 4 ≡ 4, pair 2 15 ≡ 15, lost `[]`, extra `[]`) |
| 11.6 | Hash identity | `sha256sum` (working tree) vs `git show HEAD:<path> \| sha256sum` vs v3 ledger | working tree **= v3 ledger** on all four; all four differ from `HEAD` |
| 11.7 | Statement preservation | independent Python multiset scan | **44 ≡ 44** and **16 ≡ 16**, lost `[]`, added `[]` |
| 11.8 | Dependency ordering | `grep -n "CREATE TABLE …"` + v3 ledger `ORDER BY started_at, id` (read-only) | all three moved objects' parents exist earlier in the **actual** applied order |
| 11.9 | Accidental carry-over | `git status --porcelain -- prisma/` | 4 migrations + `prisma/seed.ts` only; no untracked file in `prisma/migrations/` |
| 11.10 | Database safety | `docker inspect restaurant-mariadb-test` | read-only: container `bae65d9fc587…`, `127.0.0.1:3308`, volume `restaurant-mariadb-test_data`; **only `SELECT`** issued; no write, no migration command, no DDL |
| 11.11 | No commit / push | `git log -1`, `git diff --cached` | HEAD unchanged, index empty |

**Command log for this phase:** `git` (read-only: `rev-parse`, `status`, `diff`, `show`, `log`, `stash list`),
`sha256sum`, `grep`, `ls`, `nl`, `python3` (filesystem/stdin only), `docker inspect`, and `mariadb` **read-only
`SELECT`** against the approved disposable test container. **No `git add`, no `commit`, no `push`, no migration
command of any kind, no schema/SQL edit, no production database contact.**

### 11.12 Second independent pass (re-verification before handoff) `[Measured]`

Every value above was **re-measured from scratch in a separate pass**, without reusing the earlier run's output:

| # | Re-check | Result |
|---|---|---|
| a | `git rev-parse HEAD`; `status --porcelain \| wc -l`; index; stash; merge/rebase sentinels; `diff --check` | `e8d4aa3…`, **29**, staged **0**, stash **0**, no merge/rebase, **exit 0** — unchanged |
| b | C1 scope | `git diff --name-only -- prisma/migrations/` = exactly **4** paths; `grep -cE '\.env\|^src/\|^tests/\|^docs/'` on that scope = **0** |
| c | Hash identity | `sha256sum` of all four working-tree files `97ee89d5…`, `019b42ed…`, `fac529c7…`, `47365a5c…` — each **equal to its `restaurant_app_test_v3` ledger checksum** (4/4) |
| d | Apply order | re-read `ORDER BY finished_at` (v3 ledger, read-only `SELECT`): `branch_multi_cabang`(6) → `customer_auth_promo`(8); `ingredient_f1`(10) → `ingredient_purchasing_wac`(11) → `purchasing_inventory_foundation`(15). **Same sequence** as the `started_at` ordering in §5.1, so the ordering conclusion is independent of which ledger column is used |
| e | Plain `ls \| sort` contrast | confirmed **opposite**: `20260911140000` sorts **12th**, *before* `20260911_add_ingredient_f1` (14th) — i.e. under naive lexicographic order the `ingredient` FK would fail, which is the latent fragility recorded in §5.1 |
| f | Statement preservation | re-derived by the documented method (strip comments, split on `;`, whitespace-normalise, compare multisets): pair 1 **44 ≡ 44**, pair 2 **16 ≡ 16**, lost `[]`, added `[]` |
| g | Line-granularity cross-check | independent of the statement count: relocated SQL lines removed ≡ added — pair 1 **3 ≡ 3** (`ALTER TABLE` / `CREATE INDEX` / `ALTER TABLE … ADD CONSTRAINT`), pair 2 **15 ≡ 15** (the whole `CREATE TABLE purchaseingredient` block) |
| h | Boundary carry-over | all 29 porcelain entries enumerated: modified = 4 migrations + 9 other (`prisma/seed.ts`, 3 `scripts/`, `src/app/api/reports/products/export/route.ts`, `src/lib/prisma.ts`, 4 `src/services/**`); untracked = `.env.test.example`, 6 `HERMES-*.md`-class docs, `docs/`, `src/lib/database-url*`, `tests/` — **none of these is inside the C1 scope** |

No value in §1–§11 changed as a result of the second pass, so **no repair was required**. Nothing was staged, committed, pushed, or executed from §7.

---

## 12. Handoff to STEP 2C.6-C2 (after C1 approval)

1. **C1** — the four-file F-7 relocation (this report). Release-critical.
2. **C2** — accounting predicate fixes (A-9/A-11/A-12) + F-2 credential decoding, with their unit tests.
3. **C3** — integration/unit test suites, approved-target guard, `.gitignore` / `.env.test.example`.
4. **C4** — `docs/accounting-hardening/**` + the two accounting archives.
5. **HELD** — `.env.example`, the four `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`.
6. **Not started:** A4 committed-tree replay execution, STEP 2C.7–2C.9, any deployment.

**STOP.** No commit, no push, no deploy, no migration. Awaiting **AP-1**.
