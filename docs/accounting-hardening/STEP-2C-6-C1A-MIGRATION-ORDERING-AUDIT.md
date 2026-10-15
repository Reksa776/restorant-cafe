# STEP 2C.6-C1A — MIGRATION ORDERING & COMMIT SAFETY AUDIT

**Subphase of 2C.6 · mode: STRICT READ-ONLY AUDIT · C1 COMMIT REMAINS ON HOLD**

| | |
|---|---|
| Audit date | 2026-10-14 |
| HEAD | `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` |
| Branch | `main` |
| Prisma (installed) | `prisma` **7.10.0**, `@prisma/client` **7.10.0** |
| Migration engine | `@prisma/engines/schema-engine-debian-openssl-3.0.x` (engines-version `7.10.0-4.0edf323efd1d98336f3f0a68684b56f689b900d3`) |
| Read-only DB used | `127.0.0.1:3308/restaurant_app_test_v3` (disposable container `restaurant-mariadb-test`) |
| Verdict | **✅ C1 IS READY — with one newly-evidenced coupling (ordering is collation-derived, see §2.4)** |

> **Scope discipline.** No `git add`, no commit, no push, no reset/restore/stash, no merge/rebase, no migration
> command of any kind (`migrate dev|deploy|resolve|db push`), no ledger write, no schema/SQL edit, no new
> database or container. The only database contact was read-only `SELECT` against the approved disposable v3
> instance on **3308**. **3306, 3307, v1 and v2 were never contacted.** No source or test file was modified.
> The approved container `restaurant-mariadb-test` was **exited** at session start; it was **started** only to
> enable that `SELECT` and **returned to its stopped state** afterwards — no container was created, recreated,
> removed or pruned, and no volume was touched.

---

## 1. Initial state `[Measured]`

| # | Item | Value |
|---|---|---|
| 1.1 | `git rev-parse HEAD` | `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` |
| 1.2 | `git rev-parse --abbrev-ref HEAD` | `main` |
| 1.3 | `git status --porcelain \| wc -l` | **29** |
| 1.4 | `git diff --cached --name-only \| wc -l` (index) | **0** — index empty |
| 1.5 | `git stash list \| wc -l` | **0** |
| 1.6 | merge/rebase sentinels (`MERGE_HEAD`, `rebase-merge`, `rebase-apply`) | **none** |
| 1.7 | `git diff --check` | **exit 0** |
| 1.8 | migration directories | **22** (+ `migration_lock.toml`, provider `mysql`) |
| 1.9 | tracked files modified by the F-7 repair under `prisma/migrations/` | **exactly 4** |

The four files in the C1 candidate set are unchanged since the 2C.6-C1 audit: `20260908030144_add_branch_multi_cabang`,
`20260909_add_customer_auth_promo`, `20260911_add_ingredient_purchasing_wac`,
`20260911140000_add_purchasing_inventory_foundation` — **+41 / −29**, relocation only.

---

## 2. Migration ordering mechanism `[Measured]`

### 2.1 The mechanism is `localeCompare`, not byte order

The ordering is decided **in the Prisma CLI**, before the engine is called. From the installed bundle
`node_modules/prisma/build/cli.js` (migration-directory loader, minified — inner identifiers `e`…`l` are the
bundle's, the body is verbatim):

```js
async function Bl(e, r) {
  let n = e, o = "migration_lock.toml",
      i = await fs.readFile(path.join(e, o), { encoding: "utf-8" }).catch(() => null),
      a = { path: o, content: i }, c = [];
  try { c = await fs.readdir(e, { withFileTypes: !0, recursive: !1 }).catch(p => []) }
  catch (p) { if (p.code === "ENOENT") return { baseDir: n, lockfile: a, migrationDirectories: [], shadowDbInitScript: r }; throw p }
  let u = [];
  for (let p of c.filter(f => f.isDirectory())) {
    let f = path.join(n, p.name), g = "migration.sql",
        b = await fs.readFile(path.join(f, g), { encoding: "utf-8" }).then(/* … */);
    u.push({ path: p.name, migrationFile: { path: g, content: b } })
  }
  let l = u.sort((p, f) => p.path.localeCompare(f.path));   // <-- ordering decided here
  return { baseDir: n, lockfile: a, migrationDirectories: l, shadowDbInitScript: r }
}
```

The sorted list is handed to the engine unchanged:

```js
async applyMigrations() {
  if (!this.migrationsDirectoryPath) throw new Error("this.migrationsDirectoryPath is undefined");
  let r = await Bl(this.migrationsDirectoryPath, this.shadowDbInitScript);
  return this.engine.applyMigrations({ migrationsList: r, filters: this.schemaFilter })
}
```

**Conclusion:** `prisma migrate deploy` applies migrations in **`String.prototype.localeCompare` order**
(ICU collation), **not** in byte/ASCII order. This replaces the 2C.6 Part II §5.1 `[Inferred]` statement with a
source-level `[Measured]` fact.

### 2.2 It is the CLI that sorts, not the engine

- The engine receives an already-ordered `migrationsList` (`applyMigrations({ migrationsList, filters })`).
- `strings` over `schema-engine-debian-openssl-3.0.x` shows **no** migration-name sorting symbol (the
  `Sorter*` symbols present belong to the bundled SQLite engine). `[Measured]`
- Corroborated independently: the CLI-derived order matches the recorded apply order in all 22 ledger rows (§3.1),
  so whatever the engine does internally is consistent with the CLI order. `[Measured]`

### 2.3 Where `localeCompare` diverges from `ls | sort` `[Measured]`

ICU/CLDR gives the underscore a **lower primary weight than digits**, so `20260911_add_…` sorts **before**
`20260911140000_…`. Byte comparison does the opposite because `'1'` (0x31) < `'_'` (0x5F).

REPL produced with Node v24.21.0 over the real 22 directory names:

```
ledger == localeCompare : true
ledger == bytewise      : false
first divergence at index 2
  localeCompare: 20260904_add_qris_payment_fields
  bytewise     : 20260904155600_add_rbac_shifts_approvals
```

### 2.4 Locale-sensitivity analysis `[Measured]` + residual `[Inferred]`

`localeCompare` without an explicit locale uses the **runtime's default ICU locale**. Therefore the effective
order is, in principle, a property of the *environment that runs* `prisma migrate`.

| Env locale | Node default locale resolved | Sort vs ledger |
|---|---|---|
| `en_US.UTF-8` | `en-US` | ✅ matches |
| `C` | `en-US` (ICU fallback) | ✅ matches |
| `POSIX` | `en-US` | ✅ matches |
| `C.UTF-8` | `en-US` | ✅ matches |
| `id_ID.UTF-8` | `id-ID` | ✅ matches |
| `de_DE.UTF-8` | `de-DE` | ✅ matches |

Node build: `v24.21.0`, `v8_enable_i18n_support: 1`, `icu_small: false`, ICU **78.3**, Unicode 17.0.

**Assessment.** All six tested locales agree with the ledger, because underscore-vs-digit weighting comes from the
CLDR **root** collation that every locale inherits unless tailored. The residual risk is therefore narrow but real:
a Node built with `--with-intl=none` (no ICU) degrades `localeCompare` to code-unit comparison → byte order → the
chain would break exactly as in §4.3. **This is recorded, not fixed** (A2 freezes the target state).

---

## 3. Complete 22-migration ordering comparison `[Measured]`

### 3.1 Three orderings

1. **Directory-name (byte/`ls | sort`, `LC_ALL=C`)** — what an operator or a naive script produces.
2. **v3 ledger apply order** — read-only `SELECT migration_name … ORDER BY started_at, id` from
   `restaurant_app_test_v3._prisma_migrations` (22 rows).
3. **Effective order** — the CLI mechanism, reproduced by running `localeCompare` over the same 22 names.

**`ledger order ≡ localeCompare order` on all 22 positions (`true`); `ledger ≡ byte order` is `false`.**

Ledger integrity at the same time: **22 rows, 0 unfinished (`finished_at IS NULL`), 0 rolled back, 22 distinct names**.
The conclusion does not depend on which timestamp column is used — ordering by `started_at, id`, by `finished_at`, and
the `localeCompare` reproduction are **mutually identical** on all 22 positions.

| # | Effective (localeCompare = ledger) | Bytewise (`ls \| sort`) | same |
|---|---|---|---|
| 1 | `0000_init_schema` | `0000_init_schema` | = |
| 2 | `20260904_add_qris_payment_fields` | `20260904155600_add_rbac_shifts_approvals` | **DIFF** |
| 3 | `20260904155600_add_rbac_shifts_approvals` | `20260904_add_qris_payment_fields` | **DIFF** |
| 4 | `20260907_hardening_session_payment` | `20260907_hardening_session_payment` | = |
| 5 | `20260908_add_restaurant_branding` | `20260908030144_add_branch_multi_cabang` | **DIFF** |
| 6 | `20260908030144_add_branch_multi_cabang` | `20260908040000_table_unique_per_branch` | **DIFF** |
| 7 | `20260908040000_table_unique_per_branch` | `20260908_add_restaurant_branding` | **DIFF** |
| 8 | `20260909_add_customer_auth_promo` | `20260909_add_customer_auth_promo` | = |
| 9 | `20260910_add_product_recommendations` | `20260910_add_product_recommendations` | = |
| 10 | **`20260911_add_ingredient_f1`** | `20260911120000_add_promousage_branch_id` | **DIFF** |
| 11 | **`20260911_add_ingredient_purchasing_wac`** | `20260911130000_add_stock_branchproduct` | **DIFF** |
| 12 | **`20260911_add_recipe_bom`** | **`20260911140000_add_purchasing_inventory_foundation`** | **DIFF** |
| 13 | `20260911120000_add_promousage_branch_id` | `20260911143644_f5_order_item_cost_snapshot` | **DIFF** |
| 14 | `20260911130000_add_stock_branchproduct` | **`20260911_add_ingredient_f1`** | **DIFF** |
| 15 | **`20260911140000_add_purchasing_inventory_foundation`** | **`20260911_add_ingredient_purchasing_wac`** | **DIFF** |
| 16 | `20260911143644_f5_order_item_cost_snapshot` | **`20260911_add_recipe_bom`** | **DIFF** |
| 17 | `20260912_add_branchproduct_costing_mode` | `20260912_add_branchproduct_costing_mode` | = |
| 18 | `20260913_add_addon_option_bom` | `20260913_add_addon_option_bom` | = |
| 19 | `20260913_add_refund_item_allocation` | `20260913_add_refund_item_allocation` | = |
| 20 | `20260915_add_reservation` | `20260915_add_reservation` | = |
| 21 | `20260920_add_floor_layout` | `20260920_add_floor_layout` | = |
| 22 | `20261009_add_expense_management` | `20261009_add_expense_management` | = |

**12 of 22 positions differ** (10 are equal). The `20260911_*` block (effective 10–12) and the
`20260911120000…20260911143644` block (effective 13–16) are **exactly swapped** between the two orders — this
is the single structural fact that F-7 depends on.

---

## 4. F-7 dependency verification `[Measured]`

### 4.1 Method — a real dependency graph, not an assumption

Static SQL scan of all 22 `migration.sql` files (comments stripped): every `CREATE TABLE` (48 tables) was indexed
against the migration that first creates it in a given order; every `REFERENCES …`, `ALTER TABLE …`,
`CREATE INDEX … ON …` and `INSERT INTO …` target was then checked for a **forward reference** (used before created).

### 4.2 Result

| Tree | Effective order (`localeCompare`) | Bytewise order (`ls \| sort`) |
|---|---|---|
| **HEAD (pre-fix, committed)** | **2 forward references** — `promo`, `purchase` | **1 forward reference** — `promo` |
| **Working tree (post-fix, C1 candidate)** | **0 forward references** ✅ | **1 forward reference** — `ingredient` |

**Both F-7 defects are ordering-sensitive, and in different ways** `[Measured]`:

- the **`promo`** defect fails under **both** orderings — under byte order the branch migration is step **5** and
  `promo` is created at step **8**, so it is a *genuine* broken reference independent of collation;
- the **`purchase`** defect fails **only** under the effective order — under byte order the WAC migration lands at
  step **15**, *after* the foundation migration at step **12** created `purchase`, so it happens to survive.

So `HEAD` is broken whichever order you use (2 or 1 violations), which also confirms CK-1 from a second angle:
committing nothing leaves provisioning broken under every collation. After the fix, correctness holds under the
effective order and the *only* residual byte-order failure is the `ingredient` FK of §4.3.

**HEAD, effective order — the two defects F-7 exists to repair:**

```
step  6  20260908030144_add_branch_multi_cabang
          references `promo`     first created at step 8  (20260909_add_customer_auth_promo)
step 11  20260911_add_ingredient_purchasing_wac
          references `purchase`  first created at step 15 (20260911140000_add_purchasing_inventory_foundation)
```

**Working tree, effective order — none.** All three moved objects resolve:

| Moved object | Requires | Created by | Effective step | OK |
|---|---|---|---|---|
| `promo.branchId` + index + FK → `branch` | `promo`, `branch` | `promo` @ line 21 of file 2; `branch` @ line 29 of file 1 | `promo` step 8; `branch` step 6 | ✅ |
| `purchaseingredient` → `purchase` | `purchase` | line 21 of file 4 (**earlier line in the same file**) | 15 | ✅ |
| `purchaseingredient` → `ingredient` | `ingredient` | `20260911_add_ingredient_f1` line 9 | **10, before 15** | ✅ |

Relocated block positions in the fixed tree: `ALTER TABLE promo ADD COLUMN branchId` @ **line 100**,
`CREATE INDEX promo_branchId_idx` @ **103**, `… ADD CONSTRAINT promo_branchId_fkey` @ **106** — all safely after
`CREATE TABLE promo` @ line 21. `CREATE TABLE purchaseingredient` @ **line 110** of file 4, after
`CREATE TABLE purchase` @ line 21. Column → index → foreign key order is preserved in both blocks.

### 4.3 What byte order would do to the same fixed tree

Exactly **one** forward reference:

```
20260911140000_add_purchasing_inventory_foundation
    references `ingredient`  first created later by  20260911_add_ingredient_f1
```

Under byte order the foundation migration lands at position **12**, before `20260911_add_ingredient_f1` at **14**,
so `purchaseingredient`'s `ingredientId` FK points at a table that does not exist yet → the classic
`P3018` / errno **1146**. This is precisely the latent fragility recorded in 2C.6 §5.1, now **quantified**.

---

## 5. Statement preservation `[Measured]`

Re-derived independently for this audit by the documented method — strip `--` and `/* */` comments, split on `;`,
normalise whitespace, compare **multisets** over the pair total (the scope in which statements move):

| Pair | HEAD statements | Working-tree statements | Multiset equal | Lost | Added |
|---|---|---|---|---|---|
| 1 · `20260908030144` + `20260909_add_customer_auth_promo` | **44** | **44** | ✅ `true` | `{}` | `{}` |
| 2 · `20260911_add_ingredient_purchasing_wac` + `20260911140000` | **16** | **16** | ✅ `true` | `{}` | `{}` |

**44 ≡ 44 and 16 ≡ 16. Lost statements = 0. Added statements = 0.** Per-file comparison is intentionally *not*
equal for donors/receivers (e.g. `wac` 18 → 3 significant SQL lines) — that is the relocation itself. Third
independent confirmation: 2C.2D `[Recorded]`, 2C.6 Part II §12.5, and this audit.

---

## 6. Checksum verification `[Measured]`

`_prisma_migrations.checksum` is a **sha256 content hash of `migration.sql`** — confirmed because a plain
`sha256sum` of the working-tree files reproduces the ledger values exactly, including the files that now carry
added `--` comment banners.

| Migration | Working tree `sha256` | HEAD `sha256` | v3 ledger | WT = ledger | WT = HEAD |
|---|---|---|---|---|---|
| `20260908030144_add_branch_multi_cabang` | `97ee89d541046738…` | `7348b5db51fddef2…` | `97ee89d541046738…` | ✅ **YES** | ❌ NO |
| `20260909_add_customer_auth_promo` | `019b42ed36c739a9…` | `0a9f59304a609c17…` | `019b42ed36c739a9…` | ✅ **YES** | ❌ NO |
| `20260911_add_ingredient_purchasing_wac` | `fac529c73bcf008c…` | `4f286cdc429c2443…` | `fac529c73bcf008c…` | ✅ **YES** | ❌ NO |
| `20260911140000_add_purchasing_inventory_foundation` | `47365a5cdbaf4a13…` | `112aca03238800ae…` | `47365a5cdbaf4a13…` | ✅ **YES** | ❌ NO |

Full 64-char working-tree digests:

```
97ee89d5410467386546ea656b42a3c545f70e859bcde54ef786e1f1304462d6  …/20260908030144_add_branch_multi_cabang/migration.sql
019b42ed36c739a9b6d800c24c5cef548263df34e2fee555c333b8e6882641e1  …/20260909_add_customer_auth_promo/migration.sql
fac529c73bcf008cab9c8c1f75d1a37b3bd12be87abf72e0da28ebb8a39ea969  …/20260911_add_ingredient_purchasing_wac/migration.sql
47365a5cdbaf4a131aab686dceacd83a90c1557a544ece8dc739cc9ee8a6f840  …/20260911140000_add_purchasing_inventory_foundation/migration.sql
```

Ledger size: **22 rows**, 0 unfinished, 0 rolled back.

### 6.1 Checksum-change factors (formatting / comments / newline)

Because the checksum is a byte-level hash of the file, **any** edit changes it, including:

- the **comment banners** added by the F-7 repair — **18 added `--` lines** (`20260909_add_customer_auth_promo` 9,
  `20260911_add_ingredient_purchasing_wac` 6, `20260911140000_add_purchasing_inventory_foundation` 3), with 2
  pre-existing comment lines removed/renumbered (`-- 1. New table: purchaseingredient` dropped with its block, and
  `-- 2. Add cost fields to BranchIngredient` re-emitted as `-- 1.`) — they change the hash even though they change
  no SQL;
- the **restored trailing newline** in `20260909_add_customer_auth_promo` (the file previously ended without one —
  `\ No newline at end of file` in the diff); all four files now end with a trailing `\n`;
- pure whitespace/formatting changes.

`[Measured]` The four HEAD digests differ from the ledger on **all four** files, which is the drift quantity a
pre-fix database carries. **Operational rule:** an applied migration's `migration.sql` is immutable in practice —
never "tidy" comments or newlines in it, because that is indistinguishable from a semantic edit as far as the
ledger is concerned.

---

## 7. Hidden dependency assessment `[Measured]`

| # | Question | Finding |
|---|---|---|
| 7.1 | Are the four files alone enough for a clean fresh replay? | **Yes, under the effective (localeCompare) order.** The fixed tree has **0** forward references across all 22 migrations and 48 tables (§4.2). |
| 7.2 | Any table referenced but never created in this chain? | **None.** All 48 tables are created inside the chain. (An initial scan surfaced a spurious `CASCADE` "orphan"; it is a regex artefact of `ON UPDATE CASCADE` being captured by an `UPDATE …` pattern, not a real reference.) |
| 7.3 | Any destructive DDL whose order matters? | **One** `DROP`: `ALTER TABLE \`table\` DROP INDEX \`table_restaurantId_number_key\`` in `20260908040000_table_unique_per_branch`. The index is created in `0000_init_schema` line 46, which is step 1 in **both** orderings → satisfied. No `DROP TABLE`, no `DROP COLUMN`. |
| 7.4 | Data migrations that could depend on ordering? | **None.** No `UPDATE` / `DELETE FROM` statements anywhere in the chain. |
| 7.5 | Does anything else reference the moved objects? | `promo` is referenced only by its own migration (`20260909_add_customer_auth_promo`); `purchaseingredient` is referenced by no other migration. The relocation does not orphan a reference. |
| 7.6 | Is there a *missing* migration? | **No** — the 22 directories are complete and the graph is closed. |
| 7.7 | So what *is* the hidden dependency? | **The ordering mechanism itself.** C1's correctness rests on the CLI's `localeCompare` collation (§2), not on any file content. This is the only non-local dependency, and it is environment-level, not tree-level. |

---

## 8. Existing-database compatibility implications `[Measured]` / `[Inferred]`

| Database state | After C1 is committed | Consequence |
|---|---|---|
| Fresh / v3 (provisioned from the fixed tree) | 22/22 checksums match | none |
| Already provisioned from the **pre-fix** tree (e.g. a host built at `HEAD`) | **18 match / 4 differ** — exactly the four rows keep their pre-patch digest | sees §6.1 |

**What the CLI does with that difference `[Measured]`:**

- `prisma migrate status` → calls `diagnoseMigrationHistory({ optInToShadowDatabase: false })`
  (CLI handler, alongside `listMigrationDirectories`) — drift is **surfaced**.
- `prisma migrate deploy` → handler calls **`f.applyMigrations()` only**. There is **no**
  `diagnoseMigrationHistory` call in the deploy path. Confirmed by locating all 5 call sites in
  `cli.js`: the engine-RPC wrapper, the `Kn` class method, the `status` handler, and its debug branches.
- Checksum comparison against the ledger happens **inside the Rust engine**; the JS layer contains no
  migration-checksum logic (`checksum` hits in the bundle are all `fs-extra` file-hashing helpers). `[UNKNOWN]`
  whether the engine warns or errors on a modified-but-applied migration during `applyMigrations`; this was **not**
  tested, because testing it would require a mutation the phase forbids.

**Therefore:** drift for these four rows is **metadata-only at the CLI level** — no DDL, no data change, no
automatic reconciliation. It must be documented per environment and **never** reconciled by rewriting
`_prisma_migrations` or by `migrate resolve`.

---

## 9. Remaining unknowns

| # | Unknown | Why it stays open |
|---|---|---|
| U-C1A-1 | The **production** ledger's four digests | Not readable from this workspace; production was never contacted |
| U-C1A-2 | Whether the **engine** (not the CLI) warns/errors on checksum drift during `applyMigrations` | Engine-internal; determining it would require a prohibited mutation |
| U-C1A-3 | Behaviour under a **no-ICU** Node (`--with-intl=none`) | Cannot install a second runtime; inferred only |
| U-C1A-4 | Exhaustive locale coverage | 6 representative locales tested; ICU root weighting makes agreement very likely, but not proven for every locale |
| U-C1A-5 | WASM `query_compiler_*` vs native `schema-engine` parity for the migration path | Only the native engine binary was inspected |
| U-C1A-6 | Behaviour of a **fresh** provisioning run *now* | No replay was permitted (A4 stays prepared-only); correctness is established statically (§4.2) plus the recorded 2C.2E 22/22 result |

---

## 10. C1 readiness verdict

**✅ C1 REMAINS READY — and the evidence base is now stronger than at 2C.6.**

Upgrades relative to the 2C.6-C1 audit:

1. The ordering mechanism is now **read from source** (`localeCompare` in `prisma/build/cli.js`) instead of being
   inferred from the ledger, closing 2C.6 §5.1's `[Inferred]` tag.
2. `ledger order ≡ localeCompare order` is verified **programmatically on all 22 rows**.
3. The F-7 repair is proven **quantitatively** in the effective order: HEAD = **2 forward references**, fixed tree
   = **0**, with both HEAD defects named and located — and HEAD is additionally shown to be broken under byte order
   too (**1** forward reference), so it is broken under *every* collation.
4. Byte-order fragility of the *fixed* tree is **quantified**: exactly **1** forward reference (the `ingredient` FK).
5. Locale sensitivity was **tested across 6 locales** and the residual risk narrowed to a no-ICU runtime.
6. Statement preservation is independently re-confirmed (44 ≡ 44, 16 ≡ 16, lost 0, added 0).
7. Checksum identity is re-confirmed 4/4 against the v3 ledger, and the drift mechanism (byte hash incl. comments
   and newline) is explained.

**Carried-over protections unchanged:** the four-file boundary, `+41 / −29`, path-explicit staging, and the
exclusion of `.env*`, `src/**`, `tests/**`, `docs/**` from C1.

**One new caveat (not a blocker):** C1's correctness is coupled to the migration runner's collation
(§2.4 / §4.3). Documented; deliberately not remediated (A2).

---

## 10b. Root cause and remediation proposal

### 10b.1 New finding of this audit

**Finding C1A-F1 — the F-7 repair is correct only under the collation-derived ordering.**

| | |
|---|---|
| Statement | After the repair, a fresh replay succeeds **iff** the runner orders `20260911_add_ingredient_f1` **before** `20260911140000_add_purchasing_inventory_foundation` |
| Evidence | §2 (mechanism), §3.1 (`ledger ≡ localeCompare`, **12/22** positions differ from byte order), §4.3 (byte order ⇒ **1** forward reference) |
| Severity | **Medium** — no defect under the actual runner (Node + ICU, 6/6 locales tested), but a silent provisioning failure if the runner's collation changes |

### 10b.2 Root cause

Not a bad edit inside the four files — the relocation is statement-preserving (§5). The root cause is **structural and pre-existing** in
the chain's naming and dependency shape:

1. The 22 directories mix **two prefix widths** — 8-digit (`20260911_…`) and 14-digit (`20260911140000_…`).
2. ICU/CLDR collation gives `_` a **lower primary weight than a digit**, byte comparison gives it a **higher** one
   (`'1'` = 0x31 < `'_'` = 0x5F). The two prefix widths therefore **swap order** between the two comparisons (§3.1).
3. The fixed tree carries a **cross-migration DDL dependency** that is only satisfied by one of those two orders:
   `purchaseingredient`'s `FOREIGN KEY (ingredientId) REFERENCES ingredient` requires `ingredient`, created by a
   *different* migration. When that migration is ordered later, the DDL fails (errno 1146).
4. The *ordering itself* is produced by the CLI's `localeCompare` — a property of the **runtime's ICU build and locale**,
   not of the repository. So a correct tree can be applied in an incorrect order by a different environment.

Both original F-7 defects are instances of the same structural cause (a migration referencing a table created by a
*different, later-ordered* migration); the repair removed the two instances but not the enabling condition.

### 10b.3 Remediation proposal — **proposed only, NOT applied** (A2 freeze)

| Option | Description | Assessment |
|---|---|---|
| **R1 — Eliminate cross-migration DDL dependencies** | Ensure every `CREATE TABLE`/FK block references only tables created **in the same migration or in one that precedes it under every possible ordering** (e.g. put `purchaseingredient`'s creation in the migration that also creates/guarantees `ingredient`). | **Most durable.** Achieves order-independence without touching already-applied names. Requires editing an applied migration → ledger drift (see caveat). |
| **R2 — Uniform prefix width for *future* migrations** | Adopt a single 14-digit timestamp width for all new directories so ICU and byte comparison agree. Does **not** retro-fix the 22 existing names. | **Cheap and safe** if applied only going forward; the existing chain stays collation-coupled. |
| **R3 — Pin the collation** | Document/enforce a full-ICU Node for migration runs (e.g. an env guard in the release procedure). | **Mitigation, not a fix**; addresses U-C1A-3 only. |
| **R4 — Rename the existing directories** to uniform width | Would make the two orders coincide immediately. | ❌ **Rejected** — renaming changes `migration_name`, so the ledger no longer matches; reconciling it would need `migrate resolve`/ledger rewrites, which this programme prohibits. |

**Recommendation:** treat **R1** as the durable target when the freeze lifts, with **R2** adopted for new work in the
meantime and **R3** documented in the release procedure. **Do not** pursue R4. **No option was implemented, and none is
authorised by this phase.** The remediation is recorded so the decision is explicit rather than implicit.

---

## 11. Recommended next action

1. **Approve and commit C1** as the exactly-bounded four-file commit from 2C.6-C1 §7 (still on hold pending AP-1).
2. **Then**, as a *separate, later* discussion — not part of C1 and not authorised here — consider making the chain
   order-independent so provisioning no longer depends on collation: the durable fix is to stop relying on
   pre-existing tables (`ingredient`, `purchase`, `promo`) from earlier migrations inside a later migration's
   `CREATE TABLE`/FK block. This is a design follow-up (A2 freezes it for now).
3. **Record the drift acceptance** per environment (18/4) in the operator runbook, so a future `migrate status`
   report of "modified after applied" on these four rows is expected, not alarming.
4. **Keep A4** (committed-tree replay on a disposable database) prepared-only until explicitly approved.

---

## 12. Approval gate

| ID | Decision requested | Status |
|---|---|---|
| **AP-1** | Approval to **commit C1** (the 4-file F-7 relocation, 2C.6-C1 §7) | ⏸ **WITHHELD — C1 stays on HOLD** |
| **AP-2** | Commit sequence for C2/C3/C4 + whether the HELD files (`.env.example`, four `HERMES-*.md`, `INVENTORY-DESIGN-REVIEW.md`) are ever committed | ⏸ open |
| **AP-3** | Confirmation that **A4** (committed-tree replay) stays prepared-only | ⏸ open |
| **AP-4** *(new)* | Whether to open a follow-up to remove the collation dependency of the migration chain (§11.2) | ⏸ open |
| **AP-5** *(new)* | Whether the 4-row checksum drift is formally accepted per environment (§8) | ⏸ open |

**STOP.** No commit, no push, no deploy, no migration command, no A4 replay, no STEP 2C.7. Awaiting **AP-1**.

---

## Appendix A — Checks executed in this audit

| Check | Command class | Result |
|---|---|---|
| Git identity/state | `git rev-parse`, `status --porcelain`, `diff --cached`, `stash list` | `e8d4aa3` · 29 · index 0 · stash 0 |
| Whitespace/conflict | `git diff --check; echo $?` | **exit 0** |
| Migration inventory | `ls -d prisma/migrations/*/`, `readdir` | 22 dirs + lockfile |
| Ordering mechanism | read `node_modules/prisma/build/cli.js` (`Bl`, `applyMigrations`) | `localeCompare` |
| Ordering comparison | Node `localeCompare` vs byte sort vs v3 ledger (`SELECT`, read-only) | ledger ≡ localeCompare (22/22); ≠ byte |
| Locale matrix | 6 × `LC_ALL=… node …` | all match ledger |
| Dependency graph | static SQL scan of 22 files (48 tables) | HEAD **2** → WT **0** forward refs |
| Statement preservation | Python multiset over comment-stripped `;`-split statements | 44 ≡ 44 · 16 ≡ 16 · lost 0 · added 0 |
| Checksum identity | `sha256sum` (WT) vs `git show HEAD:` vs v3 ledger | 4/4 **= ledger**, 4/4 **≠ HEAD** |
| Destructive-DDL scan | `grep DROP` | 1 × `DROP INDEX`, satisfied by `0000_init_schema` |
| Data-migration scan | `grep UPDATE\|DELETE FROM` | none |
| Deploy/status paths | occurrence scan of `cli.js` | `deploy` → `applyMigrations()` only; `status` → `diagnoseMigrationHistory` |

**Database safety:** the only database access was read-only `SELECT` against
`127.0.0.1:3308/restaurant_app_test_v3`. No `INSERT`/`UPDATE`/`DELETE`/DDL, no `migrate` command of any kind, no
ledger modification, no new database or container, and **no contact with 3306, 3307, v1 or v2**. The approved
container `restaurant-mariadb-test` was started (from its prior *exited* state) solely to permit the read-only
`SELECT`s and was stopped again at the end of the audit; its live identity was verified as
`restaurant_app_test_v3` / `restaurant_test_v3@…` / `MariaDB 11.8.9` / internal port `3306` before any query ran.
