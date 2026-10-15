# STEP 2C.6 — F-6 / F-8: MIGRATION COMPATIBILITY & DEPLOYMENT SAFETY

**Project:** `/home/reksa/restorant-cafe`
**Date:** 2026-10-14
**Mode:** 🔒 **STRICT READ-ONLY AUDIT + DECISION GATE.** No production code change, no test change, no schema change,
no migration edit, no `_prisma_migrations` write, no database reset, no `migrate deploy` / `dev` / `resolve` /
`db push`, no `ALTER TABLE`, no `ALTER DATABASE`, **no database connection of any kind**, no commit / push /
merge / deploy, and STEP 2C.7 was **not** started.
**Outcome:** F-6 and F-8 are **root-caused at the level the available evidence supports**, with every claim
labelled by evidence class. Two structural facts dominate the deployment story and neither was previously
stated this plainly: (i) **the F-7 fix currently exists only in the working tree — it is uncommitted**, so a
deployment built from `HEAD` would still fail; (ii) **the approved v3 test database is currently unavailable**
(its container exited), so 2C.8 cannot run until it is started. **No fix was applied. This report stops at the
approval gate.**

**Evidence classes used in this report** (nothing is asserted above its class):

| Class | Meaning |
|---|---|
| `[Code]` | Read first-hand from the repository's own executable/configuration files in this phase |
| `[Source]` | Read first-hand from a repo file, non-executable (docs, env templates) |
| `[Measured]` | Read first-hand from the host/runtime in this phase (git, sha256, docker, ps, ports) |
| `[Recorded]` | Carried from an earlier phase's report in this repo (not re-measured; the phase is named) |
| `[Docs]` | Third-party documentation or an external issue report |
| `[Inferred]` | A conclusion that follows from the evidence above but is not itself observed |
| `[UNKNOWN]` | Not determinable from anything available to this audit |

---

# PART A — FINDINGS

## 0. Phase lock & session recovery

### 0.1 Git identity and initial status

```
$ git rev-parse --abbrev-ref HEAD            main
$ git rev-parse HEAD                         e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0
$ git log -1 --oneline                       e8d4aa3 fix selesai orderan
$ git status --porcelain | wc -l             29
```

<details><summary>Full initial `git status --porcelain` (29 entries)</summary>

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

`[Measured]` Identical to the 2C.5 exit state (29 entries), so this phase inherited the tree as 2C.5 left it.
Branch `main`, HEAD `e8d4aa3` — unchanged at the end of this phase (§7.5).

### 0.2 Recovery reading performed

`[Source]` `docs/accounting-hardening/ROADMAP.md`; `docs/accounting-hardening/STEP-2C-5-CUTOFF-FINALIZATION.md`;
`docs/accounting-hardening/STEP-2C-4-DATABASE-CONNECTION.md`; the **F-7 historical-migration-repair** report
(archive §24–§25) and the **fresh v3 replay** report (archive §26) inside `ACCOUNTING-INTEGRATION-TEST-PLAN.md`;
archive §22 (topology / F-6 root cause), §23 (v1/v2 evidence) and §27 (2C.2F);
`ACCOUNTING-M2-SOLUTION-PROPOSAL.md` (cutoff/checksum evidence E6); `prisma.config.ts`; `package.json`;
`prisma/schema.prisma` (read; no schema change considered); all 22 migration directories; `docker-compose.yml`,
`Dockerfile`, `Dockerfile.worker`, `docker/nginx.conf`, `README.md`, `.env.example`, `.env.test.example`,
`.gitignore`; `tests/README.md`, `tests/setup.ts`; `src/lib/prisma.ts`, `src/lib/database-url.ts`;
`node_modules/prisma/build/cli.js` + `node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x`
(behaviour evidence, read-only); the 2C.2D byte-for-byte backup at
`/home/reksa/restorant-cafe-f7-backup-20261014/`.

### 0.3 Baselines carried forward (NOT re-run in this phase)

`[Recorded]` From 2C.5 / 2C.4 / 2C.3B: accounting integration **111/111**, M2 unit **78/78**, F-2 unit **24/24**,
F-2 live **4/4**, `tsc --noEmit` exit 0, `npm run build` exit 0, eslint on the 5 changed files exit 0,
project-wide eslint **245 problems** (pre-existing debt, unchanged).
**This phase claims no test result of its own.** No suite was executed — the phase is read-only, and the
approved v3 target is unavailable (§1.5). Nothing below is a PASS in the test sense.

### 0.4 Protected targets, and the access policy actually applied

`[Measured] [Source]`

| Target | What it is | This phase |
|---|---|---|
| **127.0.0.1:3306** | host MariaDB, `mariadb-server-11.8.8-3.fc44`, system service `mariadb.service` **active**; holds `restaurant_app` **plus unrelated local databases** | **NOT CONTACTED** — no connection, no query, no credential test. Only package metadata / service state were read |
| **127.0.0.1:3307** | sibling project `restorant-cafe2`'s container `restaurant-mariadb` (compose labels prove ownership) | **NOT CONTACTED** — a different project's database |
| **127.0.0.1:3308** | standalone test container `restaurant-mariadb-test` (no compose labels; binds 127.0.0.1 only) | **NOT CONTACTED** — the container is currently **exited** (§1.5) |
| **v1 `restaurant_app_test`** | preserved read-only evidence | NOT CONTACTED |
| **v2 `restaurant_app_test_v2`** | failed provisioning evidence | NOT CONTACTED |
| **Deployed / production DB** | not present in this workspace | **UNKNOWN — not contacted, not inferable from here** |

`[Measured]` The host timezone is **WIB (UTC+07:00)** (`date` → `Wed Oct 14 21:24 WIB` vs
`14:24 UTC`); the test container runs **UTC** (`[Recorded]` §26.10). This matters for any comparison of naive
`_prisma_migrations` timestamps and is already handled by 2C.5's `parseNaiveUtcDateTime()`.

**A deliberate policy note.** The directive for this phase forbids *using a credential to test* a protected
target and requires operator-facing read-only SQL instead of automatic execution. The audit therefore
**relies on the recorded, previously-measured evidence for 3306 / v1 / v2** (`[Recorded]` §22.3, §26.7, §26.9,
§26.11) and re-measures only things that need no database connection (files, checksums, git, container
metadata, listening ports). §4 contains the SQL that an operator can run to close each remaining gap.

### 0.5 Sources that do not exist (recorded so nobody looks for them)

`[Measured]` There is **no PM2 binary, no `~/.pm2`, no `ecosystem*.js|json`**; **no CI/CD or Ansible/PM2
deployment file**; **no `.env.production`** (gitignored, absent); **no `/tmp` artefacts** from the 2C.2E/2C.2F
runs (`/tmp/c2c2e-*.mjs`, logs) — they are gone (expected for `/tmp`). The only surviving artefacts outside git
are the 2C.2D backup directory and the gitignored `.env.test`.

### 0.6 ROADMAP update at phase start

`ROADMAP.md` now reads `| 2C.6 | F-6 / F-8 / migration compatibility | 🔎 CURRENT — AUDIT ONLY | this report |`.
**STEP 2C.7 / 2C.8 / 2C.9 statuses were not touched** (all three remain `NOT STARTED`).

---

## 1. F-6 (part 1) — DATABASE TARGET IDENTIFICATION

### 1.1 Consumer / target matrix

Every configuration point that can select a database, with the evidence class for the *configuration* and for
the *runtime observation* (those are two different claims and are kept apart):

| # | Consumer | Configured target | Config evidence | Runtime status |
|---|---|---|---|---|
| 1 | **Local Next.js app** | `mysql://root:***@localhost:3306/restaurant_app` | `[Code]` `.env` `DATABASE_URL` (sanitized) | `[Measured]` **not running**: no listener on :3000/:3001 (`ss`), no process whose cwd is this repo (`ps`) — matches `[Recorded]` §22.4 |
| 2 | **Local integration tests** | `mysql://restaurant_test_v3:***@127.0.0.1:3308/restaurant_app_test_v3` (both `TEST_DATABASE_URL` and `DATABASE_URL`) | `[Code]` `.env.test`; `[Code]` `.env.test.example` | `[Measured]` **target unreachable** — 3308 refuses connections (§1.5) |
| 3 | **Prisma CLI** (`migrate deploy/dev/status`, `db push`, `db seed`) | the same `DATABASE_URL` as `.env` → **3306 `restaurant_app`** | `[Code]` `prisma.config.ts` (`import "dotenv/config"` → `datasource.url = env("DATABASE_URL")`); `[Code]` `package.json` `db:migrate`=`prisma migrate dev`, `db:push`, `db:seed` | `[Measured]` not executed. **R-1 (bare CLI targets the shared host DB) is confirmed by configuration** and was `[Recorded]` live-confirmed in §26.3 |
| 4 | **Docker Compose app/worker** | `mysql://restaurant:password@mysql:3306/restaurant_app` (compose-internal DNS) | `[Code]` `docker-compose.yml` `environment:` for `app` and `worker` | `[Measured]` the stack is **not running** (only `restaurant-mariadb`, `restaurant-phpmyadmin`, `restaurant-redis` exist; `restaurant-app`/`restaurant-worker` are the *sibling* project's, exited 8 days ago). Note: compose publishes `3306:3306`, which would **collide with the host service** if started here |
| 5 | **Docker images themselves** | inherit `DATABASE_URL` from the environment | `[Code]` `Dockerfile` `CMD ["node","server.js"]`, `Dockerfile.worker` `CMD ["npx","tsx", ...]` | `[Code]` **neither image runs a migration at start** — no `migrate deploy` anywhere in the Dockerfiles or the compose file, so schema provisioning is a manual/ops step |
| 6 | **PM2 (VPS)** | README documents `next start -p 3001` under PM2, single instance, plus `npx prisma migrate deploy` | `[Source]` `README.md` §Production (VPS) | `[Measured]` **no PM2 in this workspace**; the VPS process manager / env file is **`[UNKNOWN]`** |
| 7 | **Nginx / reverse proxy** | `server_name localhost`, TLS lines commented out; `proxy_pass http://app` | `[Code]` `docker/nginx.conf` | `[Measured]` no nginx container running. **No production hostname appears anywhere in the repo** → the deployed origin is `[UNKNOWN]` |

### 1.2 Environment-variable precedence (as configured today)

`[Code]`

1. **Tests:** `tests/setup.ts` loads `.env.test` **only if `TEST_DATABASE_URL` is not already exported**, so a
   runner-provided value wins; it then asserts **both** URLs against `APPROVED_TEST_TARGET`
   (`mysql:` / `127.0.0.1` / `3308` / `restaurant_app_test_v3` / `restaurant_test_v3`), **rejects protected
   ports 3306 and 3307 and protected names** (`restaurant_app`, `restaurant_app_test`, `restaurant_app_test_v2`,
   `production`, `main`, `app`), and refuses when the two URLs disagree. This is fail-closed and lives in the
   bootstrap, not per suite — i.e. the 2C.2F hardening plan item is **already done** (this supersedes the
   per-suite pin described in `[Recorded]` §25.10.1).
2. **Prisma CLI:** `prisma.config.ts` → `dotenv/config` (dotenv does **not** overwrite variables already present
   in the process environment) → `env("DATABASE_URL")`.
3. **App:** `src/lib/prisma.ts` reads `process.env.DATABASE_URL` (Next.js's own `.env`/`.env.local`
   precedence applies at runtime; `.env.local` and `.env.production` are gitignored and **absent here**).
4. **Docker:** container `environment:` wins over any file baked into the image (no `.env` is copied by either
   Dockerfile).

### 1.3 Prisma adapter configuration

`[Code]` `src/lib/prisma.ts` → `parseDatabaseUrl(DATABASE_URL)` (`src/lib/database-url.ts`, the 2C.4 F-2 fix)
→ `new PrismaMariaDb({ host, port, user, password, database, connectionLimit: 5 })` → `new PrismaClient({ adapter })`.
So the **only** input to the effective datasource is `DATABASE_URL`, parsed by this repo's own code, with the
credential decoded exactly once. There is no `directUrl`, `shadowDatabaseUrl`, or second datasource anywhere.

### 1.4 Verdict on 3306 (explicitly, as instructed)

`[Measured]/[Recorded]`: 3306 is the **shared host MariaDB** consumed by this repo's `.env`, by the bare Prisma
CLI, and it is the DB that the *recorded* 2C.2E parity comparison used as "the application reference" (A).
It is **not** evidence of the deployed production target: nothing in this workspace runs this repo's app, the
production hostname/PM2/env file is absent, and the compose stack that defines its own MySQL is not running.
**No conclusion is drawn that the 3306 database is the production deployment target** — that remains
**UNKNOWN** and must be established on the deployment host itself (§4, P1–P3).

### 1.5 Operational finding — the approved test target is currently DOWN

`[Measured]`

```
$ ss -ltnp            → LISTEN :3306 (host mariadb.service), :3307 (sibling container)   [no :3308]
$ docker ps -a
  restaurant-mariadb-test  mariadb:11.8  Exited (0) 4 hours ago        ← 3308 target
  restaurant-mariadb       mariadb:11.8  Up 2 minutes (healthy)  0.0.0.0:3307->3306/tcp
$ docker inspect restaurant-mariadb-test
  status=exited  started=2026-10-14T02:16:18Z  finished=2026-10-14T10:06:31Z  restarts=0
  portbindings={"3306/tcp":[{"HostIp":"127.0.0.1","HostPort":"3308"}]}
```

The v3 container stopped cleanly (exit 0) at `2026-10-14T10:06:31Z` ≈ 17:06 WIB — i.e. right around the end of
the 2C.5 phase — and was **not** restarted or removed. `[Measured]` This phase started/stopped/restarted **no**
container (only `docker ps`, `docker ps -a`, `docker volume ls`, `docker inspect` were run; the sibling
container's `restart=0` and this container's `restart=0` both confirm no lifecycle action by this audit).
**Consequence:** the v3 databases and both backup paths survive on the volume `restaurant-mariadb-test_data`,
but **any 2C.8 regression run must start this container first**, and no live collation/ledger re-measurement is
possible until then. This is an operational blocker for 2C.8, not a data-loss event.

### 1.6 F-6 (part 1) — required outputs

| # | Item | Result |
|---|---|---|
| 1 | **Root cause** | Not a defect: F-6 is a *naming/assumption* error ("the container on 3307/3308 is the app DB") combined with **one genuine hazard**: every default path (`prisma.config.ts` → `.env`) points the **bare** Prisma CLI at the **shared host DB on 3306**. The deployed target is simply not present in this workspace, so it cannot be verified from here. `[Code]/[Recorded]` |
| 2 | **Exact evidence** | §1.1 rows 1–7 with the file/line-level sources named there; §0.4 (host service, versions); §1.5 (ports/containers); `[Recorded]` §22.4–§22.5, §26.3 |
| 3 | **Current state** | Local app: configured → 3306, not running. Tests: pinned → 3308/v3, **target down**. CLI: → 3306 (**hazard**). Docker: compose-internal `mysql` service, stack not running, **no migration step in any image**. PM2/VPS/production: **UNKNOWN** |
| 4 | **Fresh-DB compatibility** | Unaffected by F-6 — a fresh DB is provisioned only by an explicit `DATABASE_URL=<isolated>` invocation; the hazard is that forgetting the override targets 3306 |
| 5 | **Existing-DB compatibility** | Unaffected — no code or config change is proposed here; the hazard is procedural, not structural |
| 6 | **Production deployment risk** | **High if procedural controls are missing:** a single bare `npm run db:migrate` (`migrate dev`!) or `db:push` from the repo root on a machine whose `.env` points at the deployed DB could apply a migration or reset it. Mitigations exist in the test path only |
| 7 | **Minimal remediation options** | (A) keep the existing discipline (explicit `DATABASE_URL` override on every command) + document it; (B) rename the risky scripts or add a guard script that refuses to run without an explicit `DATABASE_URL` that is not the host DB; (C) do nothing |
| 8 | **Recommended approach** | **A now** (zero code change, this report is the documentation), **B later** only if 2C.7 is authorised; the operator checklist in §4 makes the target identity a pre-deploy gate |
| 9 | **Rollback** | n/a — no change made |
| 10 | **Remaining UNKNOWN** | Deployed VPS: DB host/port/name/user, `.env.production`, PM2 config, whether `migrate deploy` is run at all and by whom, and whether the deployed DB is the 3306 host DB, a compose MySQL, or a remote server (§4 P1–P3) |
| 11 | **Approval required** | Only if option B (a guard in `package.json`/scripts) is wanted — that is a code change and belongs to an approved implementation phase |

---

## 2. F-6 (part 2) — MIGRATION CHECKSUM COMPATIBILITY

### 2.1 Static migration inventory `[Measured]`

* **22** migration directories + `migration_lock.toml` (`provider = "mysql"`, unmodified).
* Observed apply order = the order empirically recorded in the fresh-v3 replay `[Recorded]` §26.5:
  `0000_init_schema`, `20260904_add_qris_payment_fields`, `20260904155600_add_rbac_shifts_approvals`,
  `20260907_hardening_session_payment`, `20260908_add_restaurant_branding`,
  `20260908030144_add_branch_multi_cabang`, `20260908040000_table_unique_per_branch`,
  `20260909_add_customer_auth_promo`, `20260910_add_product_recommendations`, `20260911_add_ingredient_f1`,
  `20260911_add_ingredient_purchasing_wac`, `20260911_add_recipe_bom`, `20260911120000_add_promousage_branch_id`,
  `20260911130000_add_stock_branchproduct`, `20260911140000_add_purchasing_inventory_foundation`,
  `20260911143644_f5_order_item_cost_snapshot`, `20260912_add_branchproduct_costing_mode`,
  `20260913_add_addon_option_bom`, `20260913_add_refund_item_allocation`, `20260915_add_reservation`,
  `20260920_add_floor_layout`, `20261009_add_expense_management`.
  `[Measured]` A plain byte-wise sort of the directory names **differs** from that observed order in exactly one
  place (it puts `20260904155600_add_rbac_shifts_approvals` before `20260904_add_qris_payment_fields`) — i.e.
  Prisma's order is punctuation/locale-aware, not `LC_ALL=C` byte order. The difference is irrelevant to the
  dependency analysis (neither migration depends on the other), but the **observed** order is the authoritative
  one and is what §2.2 refers to.
* `[Measured]` Nothing outside the four files named in §2.2 differs between the working tree and `HEAD`:
  a comment-stripped, whitespace-normalised, `;`-split **statement multiset** over all 22 files reports exactly
  those four files as different and no others.

### 2.2 The four files changed by the F-7 repair — checksums and ledger facts

`[Measured]` sha256 of the file as committed (`git show HEAD:…`) vs as it exists now:

| Migration | `HEAD` sha256 (= §25.3 original) | Working-tree sha256 (= §25.5 patched) |
|---|---|---|
| `20260908030144_add_branch_multi_cabang` | `7348b5db51fddef2da96fac1056ca72eddba073d97ab5e1198db6127d2c940e0` | `97ee89d5410467386546ea656b42a3c545f70e859bcde54ef786e1f1304462d6` |
| `20260909_add_customer_auth_promo` | `0a9f59304a609c17c48c54b8a0eaee3371bdd2e20eb592d403abb04bac8a0b0b` | `019b42ed36c739a9b6d800c24c5cef548263df34e2fee555c333b8e6882641e1` |
| `20260911_add_ingredient_purchasing_wac` | `4f286cdc429c2443429cb7a037f1a803e329fd0916fe4b2fc6761955d5e3b2c5` | `fac529c73bcf008cab9c8c1f75d1a37b3bd12be87abf72e0da28ebb8a39ea969` |
| `20260911140000_add_purchasing_inventory_foundation` | `112aca03238800ae1032c0f0d755273ea8eb7360e21016e1f390981a8718b5dd` | `47365a5cdbaf4a131aab686dceacd83a90c1557a544ece8dc739cc9ee8a6f840` |

`[Measured]` All four `HEAD` hashes are **byte-identical to the 2C.2D backup**
(`/home/reksa/restorant-cafe-f7-backup-20261014/ORIGINAL_SHA256.txt`), so the pre-edit state is independently
recoverable. Prisma's `checksum` column is the sha256 of `migration.sql` `[Recorded]` §24.4 (22/22 equality
proved it), so these numbers are directly comparable to the ledger.

**Ledger facts (recorded, `[Recorded]` §26.9):**

| Database | Ledger | Comparison with the current files |
|---|---|---|
| **v3** (fresh replay of the patched tree) | 22 rows, 0 unfinished/rolled-back, 1 F.5 row | **22/22 checksums match** → no warning of any kind |
| **3306 `restaurant_app`** | 28 rows: 22 on-disk names + historical duplicates (`0_baseline`×2, `product_recommendations`×2, `ingredient_f1`×4), 5 historical `finished_at IS NULL` retries | **18 match / 4 differ / 0 absent**; the 4 differing are exactly the four files above; F.5 checksum identical in both (`f4234f86…`) |

### 2.3 Are the current files *semantically* still the same migrations? — yes, relocation only `[Measured]`

The F-7 repair moved statements between files; it never rewrote SQL. Verified first-hand this phase, over
`git HEAD` vs the working tree: comment/whitespace-normalised **statement multisets are identical per moved
pair** —

| Pair | HEAD statements | Working-tree statements | Multiset equal |
|---|---|---|---|
| `20260908030144_add_branch_multi_cabang` + `20260909_add_customer_auth_promo` | 44 | 44 | ✅ **true** |
| `20260911_add_ingredient_purchasing_wac` + `20260911140000_add_purchasing_inventory_foundation` | 16 | 16 | ✅ **true** |

The 3 `promo` statements still exist exactly once, in the migration that creates `promo`; the
`CREATE TABLE purchaseingredient` block still exists exactly once, in the migration that creates `purchase`.
So the **end schema is unchanged**; only the *order* of the two blocks and the checksums of the four files
changed. `[Inferred]` Therefore the "modified after it was applied" condition is a **metadata** difference, not
a schema or data difference.

**Dependency order, re-verified first-hand this phase in the current working tree** `[Measured]`:

| Block | Where it lives now | Parent present before it? | Gone from the old file? |
|---|---|---|---|
| `promo.branchId` + index + FK | `20260909_add_customer_auth_promo/migration.sql` — `CREATE TABLE promo` **L21**, `ALTER TABLE promo ADD COLUMN branchId` **L100**, `CREATE INDEX promo_branchId_idx` **L103**, `promo_branchId_fkey → branch(id)` **L106** | ✅ yes — same file (L21) and `branch` is created at `20260908030144_add_branch_multi_cabang/migration.sql` **L29**, an earlier migration in the observed order | ✅ yes — **zero** `promo` matches remain in `20260908030144…` |
| `purchaseingredient` (+ its 2 FKs) | `20260911140000_add_purchasing_inventory_foundation/migration.sql` — `CREATE TABLE purchase` **L21**, `CREATE TABLE purchaseingredient` **L110**, FKs to `purchase` **L123** and `ingredient` **L124** | ✅ yes — `purchase` in the same file (L21); `ingredient` created at `20260911_add_ingredient_f1/migration.sql` **L9**, which applies earlier (10th vs 15th) | ✅ yes — the old file keeps only the explanatory comment; the table name no longer appears in executable SQL there |

`[Measured]` No other migration in the tree references `purchaseingredient` (grep over all 22 dirs returns only the
new home and the comment in the old one), so nothing else depended on its previous position.

### 2.4 What Prisma 7.10.0 actually does with modified applied migrations

`[Code]` Read first-hand from `node_modules/prisma/build/cli.js` (7.10.0) and the bundled schema-engine strings:

* **`migrate deploy`** (command class `…migrate deploy…`) executes exactly:
  `listMigrationDirectories()` → print `N migrations found in prisma/migrations` → `applyMigrations()` →
  print `No pending migrations to apply.` **or** `The following migration(s) have been applied: …` +
  `All migrations have been successfully applied.`
  **It never calls `diagnoseMigrationHistory`.** The engine's `ApplyMigrationsOutput` carries **only**
  `appliedMigrationNames` — there is no warnings field to transmit, and the engine message
  ``The migration `<x>` was modified after it was applied.`` sits with the **`DriftDiagnostic`/diagnose** strings
  (`The migrations recorded in the database diverge from the local migrations directory.`,
  ``The migration `<x>` failed.``, `…applied to the database but missing from the local migrations directory: …`).
* **`migrate status`** *does* call `diagnoseMigrationHistory({ optInToShadowDatabase: false })` and renders:
  `databaseIsBehind` → list + **`process.exit(1)`**; `historiesDiverge` → last common migration + unapplied +
  **unpersisted** names + **`process.exit(1)`**; `failedMigrationNames` → **`process.exit(1)`**.
  In 7.10.0 the renderer does **not** print `editedMigrationNames` (the engine returns it). Therefore
  **`migrate status` is expected to exit 1 on 3306 regardless of F-7**, because of the pre-existing
  `0_baseline` rows (unpersisted ≠ local) — that is a *pre-existing* condition, not caused by this programme.
* **`migrate dev`** goes through `devDiagnostic` → `DevAction` ∈ {`createMigration`, `Reset`}, is interactive,
  and the CLI even refuses non-interactive environments ("`migrate dev` is an interactive command … to apply
  existing migrations in deployments, use `migrate deploy`"). On a history with edited/unpersisted migrations
  it is the command that proposes a **reset** — i.e. the one command that must never be pointed at a real DB.

**Also from a Prisma 7.10.0 upgrade path:** the first `migrate dev` after an engine upgrade may behave
differently again. Treating "deploy never validates checksums" as a permanent property would be unsafe.

`[Source]` This **corrects** the assumption recorded in archive §24.7 for this toolchain version: for
**Prisma 7.10.0** the measured code path is *stronger* (deploy is silent, not warning-and-continuing) and
*rarer* (the warning text belongs to the diagnose/dev path). The archive's claim came from vendor
documentation that describes the deploy/dev behaviour of other versions; both readings agree that **deploy
does not fail**, which is what matters operationally. `[UNKNOWN]` — the engine's `applyMigrations` was not
executed here, so "deploy is silent" is a **code-reading** conclusion, not a measured one (§4, P9).

### 2.5 Fresh-DB vs existing-DB: two different strategies are required

| | **Fresh / new database** (`migrate deploy` on an empty DB) | **Existing database where all 22 are applied** (3306; production `[UNKNOWN]`) |
|---|---|---|
| Checksum position | Local files are the only source of truth → **22/22 match, no warning** `[Recorded]` §26.9 | Ledger holds pre-patch checksums for 4 files → **4 differing rows** `[Recorded]` §26.9 |
| `migrate deploy` | Applies 22/22, exit 0 `[Recorded]` §26.5 | Expects **"No pending migrations to apply.", exit 0**; per §2.4 it should not even inspect the 4 checksums `[Code]`, `[Inferred]` |
| `migrate status` | Clean | **exit 1 expected** because of pre-existing `0_baseline` unpersisted rows `[Code]` — not an F-7 symptom |
| `migrate dev` | n/a | **FORBIDDEN** — may propose a **reset** (`DevAction::Reset`) `[Code]` |
| Schema/data effect of the patch | none (statement multiset identical, §2.3) | **none** — no DDL is executed; the end schema is unchanged |
| Baseline / `resolve` | cannot help (nothing to fix) | **forbidden** — rewriting the ledger is falsified history |

### 2.6 Risk register (F-6 checksum)

| ID | Risk | Class | Assessment |
|---|---|---|---|
| CK-1 | **The fix is uncommitted.** `HEAD` still contains the broken chain; a deployment built from a clean checkout of `HEAD` would fail at migration 6 with P3018 again | `[Measured]` | **This is the single most important deployment-safety finding of 2C.6.** Mitigation: commit the four files (needs its own approval) and re-run a fresh replay from the committed tree |
| CK-2 | Checksum drift on existing DBs (4 files) | `[Recorded]` | Metadata-only; no DDL, no data. Real, permanent, and detectable via §4 P4 |
| CK-3 | `migrate dev` / `db push` / `migrate reset` against 3306 or production | `[Code]/[Recorded]` R-1 | **Highest-consequence risk.** `db:migrate` = `migrate dev`; a reset would destroy the database. Procedural control only (§6) |
| CK-4 | Silencing the drift by writing `_prisma_migrations.checksum` | — | **PROHIBITED** (falsified history) |
| CK-5 | Wrong baseline / `migrate resolve --applied` to "fix" a ledger | — | **PROHIBITED without explicit approval**; it invents history and can mark an unapplied migration applied |
| CK-6 | Drift already **pre-dates** F-7 on some environments | `[Recorded]` §24.4 | 3306's ledger matches the **post-`f835e13`** ("align F1-F5 migration collations", 2026-09-11) versions of `f5_order_item_cost_snapshot`, `add_ingredient_f1`, `add_recipe_bom` — those three were edited **after** being written. A production DB migrated **before** `f835e13` would carry **4 additional** differing checksums. Must be measured, not assumed |
| CK-7 | Deployment run from a machine whose `.env` points at 3306 | `[Code]` `prisma.config.ts` | A bare `npx prisma migrate deploy` from this workspace would target **3306**. Every deploy/verification command must carry an explicit `DATABASE_URL` |
| CK-8 | Rolling back the four files re-breaks fresh provisioning | `[Measured]` §2.3 | Rollback restores checksum parity with existing DBs but **reintroduces F-7** (empty-DB replay fails). It is a valid emergency action, not a fix |
| CK-9 | A future Prisma upgrade changes deploy's checksum behaviour | `[Code]` (7.10.0) | Low now; re-verify after any Prisma version change |

### 2.7 Options considered

**Option A — keep the four-file relocation (current state), commit it, and gate deployments on a read-only ledger check.**
*Fresh:* 22/22, exit 0, no warnings (`[Recorded]` §26.5/§26.9). *Existing:* no DDL; at most a metadata note in
tools that run `diagnose`. *Cons:* 4 permanently differing checksums in every DB migrated before the patch;
editing applied migrations is contrary to Prisma's general advice; requires the patch to be committed (CK-1).

**Option B — revert the four files to `HEAD`.**
Restores checksum parity everywhere, including any production DB migrated pre-`f835e13`. *Cons:* **F-7
returns** — a fresh provisioning fails at migration 6 (P3018, errno 1146). Only acceptable as an emergency
rollback (CK-8), never as the target state.

**Option C — replace history with a new squashed baseline / `migrate resolve --applied` everywhere.**
*Cons:* destroys the F.5 migration **name** that `resolveLegacyCutoff()` looks for (so the M2 cutoff mechanism
would permanently fail to resolve on every freshly provisioned environment), requires a `resolve` on **every**
existing DB (ledger manipulation), and leaves orphan names behind. **Rejected** (same conclusion as archive §24.5).

**Option D — add a corrective migration after the failing one.**
A fresh deploy still stops **before** reaching it. **Rejected**, unchanged from archive §24.5.

### 2.8 Recommended strategy (for approval — nothing implemented)

1. **Keep Option A.** It is the only option that fixes fresh provisioning without touching data, without
   `resolve`, and without destroying the F.5 name.
2. **Commit the four migration files** (and only them, plus the accompanying documentation) so the fix exists
   in history — **separate approval, out of scope for this phase** (CK-1).
3. **Treat the modified-applied-migration condition as a documented, monitored deviation**, not as something to
   be silenced: record the expected 4-row delta in the pre-deploy checklist (§6) and verify it read-only before
   and after every deployment (§4, P3/P4).
4. **Prohibit, in writing, on every environment that already has the migrations applied:** `migrate dev`,
   `db push`, `migrate reset`, `migrate resolve`, and any `UPDATE`/`INSERT`/`DELETE` on `_prisma_migrations`.
   Only `migrate deploy` may be used, always with an explicit `DATABASE_URL`.
5. **Re-run a fresh replay from the committed tree** as the first step of any release (an env-provisioning
   dry run on a throwaway database), so the committed chain — not the working tree — is what gets proven.

### 2.9 Rollback (F-6)

* **Nothing to roll back in this phase** (no file, no DB, no ledger change).
* If the four-file patch itself must be rolled back later:
  `git restore` the four paths (they were clean at `HEAD e8d4aa3`) **or** `cp` from
  `/home/reksa/restorant-cafe-f7-backup-20261014/originals/<dir>/migration.sql` — both verified byte-identical
  to `HEAD` `[Measured]`. **Never** `git stash`/`checkout -f` (they would drag in unrelated 2C.x work) and
  **never** edit `_prisma_migrations`.
* Rolling that back **reintroduces F-7** and must therefore be paired with a fresh-replay failure report.

### 2.10 F-6 (part 2) — required outputs

| # | Item | Result |
|---|---|---|
| 1 | **Root cause** | Historical migrations contained statements that ran before their parent tables existed (mixed-length timestamp prefixes); F-7's fix relocated them, which by construction changed 4 files' checksums. **Nothing about the end schema changed** (§2.3) |
| 2 | **Exact evidence** | §2.1–§2.4 (first-hand) + `[Recorded]` §24.2/§24.4/§24.7/§25.3/§25.5/§25.6/§25.7/§26.5/§26.9 |
| 3 | **Current state** | 22 dirs intact; exactly 4 files differ from `HEAD` and only by relocation; patch **uncommitted**; no DB touched |
| 4 | **Fresh DB compatibility** | 22/22 applied, exit 0, 22/22 checksums match, 0 warnings `[Recorded]` §26.5/§26.9 |
| 5 | **Existing DB compatibility** | 18 match / 4 differ, no DDL, no data change; `deploy` expected silent+exit 0 `[Code]/[Inferred]`; `status` expected exit 1 for the pre-existing `0_baseline` reason `[Code]`; `dev` forbidden |
| 6 | **Production deployment risk** | Metadata-only for an already-migrated DB **provided** `dev`/`push`/`reset`/`resolve` are never run there. The real risk is CK-1 (uncommitted fix) and CK-3 (wrong command on the wrong target) |
| 7 | **Minimal remediation options** | §2.7 A–D |
| 8 | **Recommended approach** | §2.8 (keep A, commit, gate with read-only checks, forbid dev/push/reset/resolve, replay from the committed tree) |
| 9 | **Rollback** | §2.9 |
| 10 | **Remaining UNKNOWN** | Production ledger contents/checksums; whether production was migrated before `f835e13` (CK-6); whether `migrate deploy` is silent in a real run (P9); whether any process outside this workspace runs migrations automatically |
| 11 | **Approval required** | (a) keeping the patch as the target state, (b) committing it, (c) any future decision to revert it |

---

## 3. F-8 — COLLATION COMPATIBILITY

### 3.1 The delta

`[Recorded]` §26.7 (measured read-only in 2C.2E, `information_schema.TABLES.TABLE_COLLATION`):

| Side | Collation distribution |
|---|---|
| **Fresh v3** (`restaurant_app_test_v3`, provisioned by `prisma migrate deploy`) | **49 × `utf8mb4_unicode_ci`** |
| **Existing A** (3306 `restaurant_app`) | **44 × `utf8mb4_unicode_ci` + 5 × `utf8mb4_uca1400_ai_ci`** |

The five deviating tables, and where the migration chain creates them `[Measured]`:

| Table | Created by | Explicit collation in the DDL today |
|---|---|---|
| `auditlog` | `20260904155600_add_rbac_shifts_approvals` (L106) | `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` |
| `notification` | `0000_init_schema` (L293) | idem |
| `orderitem` | `0000_init_schema` (L181) | idem |
| `paymenttransaction` | `0000_init_schema` (L236) | idem |
| `whatsappmessage` | `0000_init_schema` (L252) | idem |

### 3.2 Root cause — and how far the evidence actually reaches

`[Measured]` The two files that own all five tables have **exactly one commit each** (`5eb8231` "login multi
role"), and `git log -S utf8mb4_unicode_ci` shows the explicit `COLLATE utf8mb4_unicode_ci` was present from
that commit and **never changed since**. No migration anywhere contains an `ALTER TABLE … CONVERT TO` /
`ALTER DATABASE` / charset-altering statement (`grep` over all 22 files: **none**).

`[Measured]` The host runs **MariaDB 11.8.8**, whose default collation for new databases is
`utf8mb4_uca1400_ai_ci`; the 2C.2E phase recorded that v3's database default was deliberately created as
`utf8mb4_uca1400_ai_ci` **to mirror the 3306 database default** `[Recorded]` §26.3.

**Therefore the chain mandates `utf8mb4_unicode_ci` for all 49 tables, and 3306's five tables do not match the
chain.** `[Inferred]` Because the migration DDL for those five tables has never lacked the explicit cut off,
the deviation cannot have been produced by *executing* this chain on 3306: those five tables must have been
created (or re-created) on 3306 by a path that does **not** carry the migration's explicit collation —
consistent with archive §22's finding that 3306 was built **incrementally** rather than by replaying the chain
(it carries two `0_baseline` ledger rows with no local file, and the 2C.1 audit already proved its FK/ledger
state is not `db push`- or `migrate deploy`-equivalent). `[UNKNOWN]` **which** exact historical mechanism
created those five tables (an early `db push` from schema.prisma, a manual creation, a restore, or an earlier
DDL revision now lost) **cannot be determined from anything in this workspace** — 3306's DDL history is not
recorded anywhere, and this phase intentionally did not connect to it. §4 P7 lists the discriminating
read-only probes.

**Which of the four candidate sources produced the skew?** `[Measured]/[Inferred]` — asked explicitly, and the
answer is *not* the migration SQL:

| Candidate source | Verdict |
|---|---|
| **Migration SQL** (the chain) | ❌ **not the source.** All five `CREATE TABLE`s state `DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` explicitly and have done since `5eb8231`; a chain-provisioned DB (v3) is uniformly `unicode_ci` `[Recorded]` §26.7 |
| **Server / database default** | ✅ **the only candidate that matches the observed value.** The host is MariaDB **11.8.8** `[Measured]`, whose default for new schemas is `utf8mb4_uca1400_ai_ci`; the 2C.2E phase recorded 3306's database default as exactly that `[Recorded]` §26.3. Anything built without the explicit `COLLATE` inherits it |
| **`prisma/schema.prisma`** | ✅ **the enabling factor.** `grep -ciE 'collation\|charset' prisma/schema.prisma` → **0** `[Measured]`; the datasource is bare (`provider = "mysql"`, no URL, no collation). So any path that derives DDL from the schema (`prisma db push`, an introspection-driven create) **cannot express a collation** and necessarily inherits the server/DB default |
| **A later migration altering collation** | ❌ impossible — there is **no** `ALTER TABLE … CONVERT TO` / `ALTER DATABASE` / charset-altering statement anywhere in the 22 files `[Measured]` |

`[Inferred]` ⇒ the five tables were created on 3306 **without executing this chain's DDL for them** (a
schema-driven provisioning path such as `db push`, or a manual/restored creation), on a server whose default is
`uca1400_ai_ci`. `[Recorded]` This is consistent with the 2C.1/2C.2A finding that 3306's provisioning was a hybrid
(partial ledger, `0_baseline` rows, 28 ledger rows for 22 names). `[UNKNOWN]` Why **only five** tables — i.e. the
per-table history of that hybrid path — is not recorded anywhere available to this workspace (§4 P6/P8).

### 3.3 Impact assessment

| Dimension | Finding |
|---|---|
| **Charset** | Both collations are **`utf8mb4`** — no encoding/emoji/storage difference. Only *comparison and sort behaviour* differs |
| **Foreign keys** | `[Recorded]` 3306 holds the **same 105 FKs** as v3, including all 5 on `orderitemcostsnapshot` and the FKs **from** the five deviating tables (`orderitem`→`order`/`product`, `paymenttransaction`→`payment`, `auditlog`→`restaurant`/`user`/`branch`, `notification`→`restaurant`/`branch`). So InnoDB accepts these FKs **with the mixed collations present** — the DDL layer is compatible in practice |
| **Unique indexes** | `whatsappmessage_messageId_key` is the only unique index on the five tables (`[Measured]` from the DDL). It holds provider message ids (ASCII), so no observable risk. Semantically `uca1400_ai_ci` is **accent-insensitive** while `unicode_ci` is **accent-sensitive**, so the *uniqueness predicate* is very slightly looser on 3306 — a theoretical duplicate-collision difference, not a correctness break for ASCII ids |
| **Comparison / joins** | **The real risk.** MariaDB's documented rule: comparing two columns whose collations both have `IMPLICIT` coercibility and neither takes precedence **fails with error 1267, "Illegal mix of collations"** `[Docs]`. This is not theoretical for MariaDB 11.x: when 11.5+ moved the default to `utf8mb4_uca1400_ai_ci`, real applications began hitting 1267 on joins `[Docs]` (Matomo issue #22536) |
| **Reachability today** | A `JOIN … ON orderitem.productId = product.id` **on 3306** mixes `uca1400` (child) with `unicode_ci` (parent). Whether it errors **cannot be answered by this audit** — answering it requires a query, and this phase made no connection `[UNKNOWN]`. If it does error, the affected surfaces are exactly the ones that join those five tables to the rest of the schema (order/kitchen views, P&L revenue joins, audit-log viewer, payment transaction views). Note also that this repo's **Prisma-ORM** relation loads always JOIN on those FK columns |
| **Sorting** | Ordering of strings in the five tables can differ between environments (accent handling). Reports that `ORDER BY` string columns from these tables can order differently on 3306 vs a fresh DB |
| **Existing data** | None at risk — this is a metadata difference, and no data is being moved |
| **Deployment** | Fresh environments (v3, staging, production-by-`migrate deploy`) will be **uniformly `unicode_ci`**, i.e. **not** collation-identical to today's 3306 on those 5 tables. A `mysqldump`/restore from 3306 into a fresh DB carries the table-level collation with it, so the divergence propagates if a dump is used |
| **Does it break migrations?** | **No.** A collation difference never makes `migrate deploy` fail; the chain's own DDL is explicit. §26.5/§26.7 already proved 22/22 applied with exit 0 and structural parity |

### 3.4 Options considered

**Option A(8) — accept and document the divergence.**
No DDL. The chain is self-consistent; fresh environments are consistent; only 3306's five tables differ. Cost:
a latent 1267 risk *inside 3306* and an asymmetry between environments. **Recommended now.**

**Option B — normalise 3306 (the reference side) with `ALTER TABLE … CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci` on the five tables.**
This is a **write** on a shared host DB: it rebuilds each table (`COPY`/`INPLACE` depending on version), takes
locks, re-validates FKs and unique indexes, and briefly doubles table size. It would make 3306 agree with the
chain. **Prohibited without a verified backup and an agreed release window**, and it should only be undertaken
**if a real 1267 is observed** — otherwise it is a risky change with no proven benefit. If it is ever done, it
must be done for all five tables in one window, preceded by `SHOW CREATE TABLE` + row counts and followed by
P5–P7 re-measurement.

**Option C — change the chain to `uca1400_ai_ci`.**
Would require editing 22 already-applied migration files (more historical edits, more checksum drift) and would
flip the collation of *every* freshly provisioned database — while the data migrating into it would still carry
`unicode_ci`. **Rejected.**

**Option D — make collation an explicit, checked deployment property (complements A).**
Add the collation query (§4 P5) to the pre-deploy checklist and to post-migration verification, so the expected
distribution (`49 × utf8mb4_unicode_ci` for any DB provisioned by this chain) is asserted rather than assumed.
Zero risk, catches regressions introduced by future migrations that forget `COLLATE`.

### 3.5 Recommendation, rollback and remaining unknowns (F-8)

* **Recommended:** **A + D** (document the deviation, verify collation read-only before/after deploys). Keep
  **B** on the shelf as an evidence-triggered, backup-gated operation; reject **C**.
* **Rollback:** none needed for A/D (no change). For B the rollback would itself be an `ALTER TABLE … CONVERT
  TO` back to `uca1400_ai_ci` plus a restore from the pre-window backup — another reason to require the backup
  gate.
* **Remaining UNKNOWN:** (i) whether the mixed collations actually raise 1267 for this application's queries on
  3306 (§4 P6/P7); (ii) the mechanism that created those five tables on 3306 (§4 P8); (iii) the collation
  distribution of the **deployed production** database (§4 P5) — it may be uniform (if provisioned by
  `migrate deploy`) or skewed like 3306 (if built incrementally); (iv) whether the 5 tables' indexes were
  rebuilt at a different time from the tables themselves.

### 3.6 F-8 — required outputs (same eleven items as F-6)

| # | Item | Result |
|---|---|---|
| 1 | **Root cause** | The chain **always** mandated `utf8mb4_unicode_ci` for the five tables (unchanged since `5eb8231`, no charset-altering DDL exists), while 3306's copies sit at MariaDB 11.8's default `utf8mb4_uca1400_ai_ci` ⇒ they were created on 3306 by a path that did not execute this chain's DDL for them, with `schema.prisma` unable to express a collation and the server/DB default supplying one. **Reference-side, not a replay defect** `[Measured]/[Inferred]` |
| 2 | **Exact evidence** | §3.1–§3.2: per-table DDL location `[Measured]`; explicit-`COLLATE` grep `[Measured]`; `git log -S` history `[Measured]`; `0` collation attributes in `prisma/schema.prisma` `[Measured]`; MariaDB 11.8.8 host + container `[Measured]`; recorded `information_schema` distribution and the v3 DB default `[Recorded]` §26.3/§26.7 |
| 3 | **Current state** | 3306: 44 `unicode_ci` + 5 `uca1400_ai_ci`; v3 (and any chain-provisioned DB): 49 `unicode_ci`. **No change made or proposed in-place** |
| 4 | **Fresh DB compatibility** | Uniform `unicode_ci`, exactly as the chain dictates — **fully self-consistent**; the skew cannot reappear on a DB provisioned by `migrate deploy` `[Recorded]` §26.7 |
| 5 | **Existing DB compatibility** | FKs (105) and unique indexes exist **with** the mix, so DDL compatibility holds; the residual risk is query-time 1267 / ordering on mixed comparisons (§3.3). No data or schema change is needed for the migrations to work |
| 6 | **Production deployment risk** | Low-to-moderate and **unquantified**: only material if production is skewed like 3306 (U3) **and** a mixed-collation comparison is actually executed (U4). No migration failure risk: collation never makes `migrate deploy` fail. Secondary risk: environments are **not** collation-identical, so a dump/restore between them can propagate or amplify the skew |
| 7 | **Minimal remediation options** | §3.4 A (accept+document), B (`ALTER … CONVERT TO` on the five tables), C (change the chain), D (verify collation in the deploy checklist) |
| 8 | **Recommended approach** | **A + D** now; **B** only on observed 1267, with verified backup + release window; **C rejected** |
| 9 | **Rollback** | None needed for A/D (no change). For B, the rollback is another `CONVERT TO` plus the pre-window backup restore — which is exactly why B is gated on a backup |
| 10 | **Remaining UNKNOWN** | U3 (production collation distribution), U4 (is 1267 reachable here? — §4 P7), U5 (per-table provenance of the five tables on 3306) |
| 11 | **Approval required** | Accepting A+D as the F-8 decision; any authorisation of B (requires backup + window); any future move to run §4 P5–P7 against 3306 |

---

# PART B — SAFETY, DECISIONS AND GATES

## 4. Operator read-only inspection pack (NOT executed by this audit)

Every statement below is **read-only** and safe to run in any order. Replace `‹DB›` with the target schema name
(`restaurant_app`, the deployed schema, …). **Never** run them with write flags, never on 3306/3307 unless the
operator owns that target, and never paste credentials into a shell history. The audit deliberately did **not**
execute any of these.

```sql
-- P1  Identity of the server/schema you are actually connected to
SELECT @@version, @@version_comment, @@collation_server, @@collation_database,
       @@time_zone, @@system_time_zone, DATABASE();

-- P2  Full migration ledger inventory (naive DATETIME literals; note the server tz from P1)
SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count
FROM `_prisma_migrations`
ORDER BY started_at, migration_name;

-- P3  Duplicates, unfinished and rolled-back rows (baseline / retry drift)
SELECT migration_name, COUNT(*) AS rows_
FROM `_prisma_migrations` GROUP BY migration_name HAVING rows_ > 1;
SELECT COUNT(*) AS unfinished FROM `_prisma_migrations` WHERE finished_at IS NULL;
SELECT migration_name, rolled_back_at FROM `_prisma_migrations` WHERE rolled_back_at IS NOT NULL;

-- P4  M-1 precondition: exactly ONE eligible F.5 row must exist
SELECT COUNT(*) AS eligible_f5
FROM `_prisma_migrations`
WHERE migration_name = '20260911143644_f5_order_item_cost_snapshot'
  AND finished_at IS NOT NULL AND rolled_back_at IS NULL;

-- P5  F-8: table collation distribution (expect 49x utf8mb4_unicode_ci for a chain-provisioned DB)
SELECT TABLE_COLLATION, COUNT(*) AS tables_
FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()
GROUP BY TABLE_COLLATION;
SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_COLLATION, TABLE_NAME;

-- P6  F-8: per-column collation of the five tables (confirms a table-level default, not per-column drift)
SELECT TABLE_NAME, COLUMN_NAME, COLLATION_NAME
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE() AND COLLATION_NAME IS NOT NULL
  AND TABLE_NAME IN ('auditlog','notification','orderitem','paymenttransaction','whatsappmessage')
ORDER BY TABLE_NAME, COLUMN_NAME;

-- P7  F-8: does the mix actually error? (read-only; ERROR 1267 would prove a live incompatibility)
SELECT COUNT(*) FROM `orderitem` oi JOIN `product` p ON oi.`productId` = p.`id`;
SELECT COUNT(*) FROM `orderitem` oi JOIN `order`   o ON oi.`orderId`   = o.`id`;
SELECT COUNT(*) FROM `auditlog`  a  JOIN `user`    u ON a.`userId`    = u.`id`;
```

```bash
# P8  Compare the ledger's checksums with the 22 local files (no DB write, no Prisma command)
sha256sum prisma/migrations/*/migration.sql     # then eyeball against P2's `checksum` column
```

```bash
# P9  AFTER a deployment window, the ONLY migration command allowed against an existing DB:
DATABASE_URL='‹explicit target for THIS environment›' npx prisma migrate deploy
#     Expected on an already-migrated DB: "22 migrations found ... No pending migrations to apply." exit 0
#     NEVER: migrate dev | db push | migrate reset | migrate resolve, and never UPDATE _prisma_migrations
```

## 5. Decision matrix

| Decision / action | **Safe to do now** | **Requires operator verification** | **Requires separate approval** | **PROHIBITED without backup + release window** |
|---|---|---|---|---|
| Keep the four-file F-7 patch as the target state | ✅ (already the working tree) | — | ✅ (as the *committed* target state) | — |
| Commit the four migration files + docs | — | — | ✅ **CK-1 (highest priority)** | — |
| This audit's reports (`STEP-2C-6-…md`, `ROADMAP.md`) | ✅ | — | — | — |
| Start `restaurant-mariadb-test` to restore the 3308 target for 2C.8 | — | ✅ (confirm identity start/restart-count, then start) | ✅ (container lifecycle is outside an audit) | — |
| Run `migrate status` on 3306 / the deployed DB | — | ✅ | — | — |
| Run `migrate deploy` on an existing DB | — | ✅ (only after P1–P4 + a verified backup) | ✅ | ✅ |
| Run `migrate dev` / `db push` / `migrate reset` on 3306 / production | — | — | — | 🚫 **NEVER** (CK-3) |
| `migrate resolve` / any `_prisma_migrations` write | — | — | — | 🚫 **NEVER** (falsified history) |
| Revert the four migration files to `HEAD` | — | — | — | ✅ (emergency only; re-breaks fresh provisioning, CK-8) |
| `ALTER TABLE … CONVERT TO` on the five collation tables | — | ✅ (P5–P7 first) | ✅ | ✅ (Option B; needs backup + window) |
| Change the migration chain's collation (Option C) | — | — | — | 🚫 rejected |
| Fresh replay from the *committed* tree on a throwaway DB | ✅ (isolated target only) | ✅ | ✅ | — |
| 2C.8 regression run against v3 | ✅ *once 3308 is up* | ✅ | ✅ (2C.8 is its own gate) | — |
| Any deployment / release | — | ✅ | ✅ | ✅ |

## 6. Pre-deployment checklist (fill in before any release)

| # | Item | Evidence required | Status |
|---|---|---|---|
| 1 | **Verified target identity** | P1 output + the environment's own `.env`/PM2 config; **written confirmation** that the target is the intended one (not the shared host DB, not the sibling project) | ☐ |
| 2 | **Verified backup and restore readiness** | A restore-tested dump of the target (timestamped), the exact restore command recorded, and someone named as owner | ☐ |
| 3 | **Migration ledger inspection** | P2 + P3: all 22 names present; list of duplicates/unfinished/rolled-back rows; the pre-existing `0_baseline` rows recorded as **known** (not to be "fixed") | ☐ |
| 4 | **Checksum compatibility** | P8 diff against P2: expected to show the **4** patched files (and, for a pre-`f835e13` DB, up to 4 more). Any *other* difference = **STOP** | ☐ |
| 5 | **Collation compatibility** | P5 (expect 49 × `utf8mb4_unicode_ci` on chain-provisioned DBs); P6 if skewed; P7 to confirm the mix is/isn't reachable. Skew recorded as a decision, not silently accepted | ☐ |
| 6 | **Expected SQL changes** | "No pending migrations" ⇒ **zero DDL**; for a fresh target, the 22 migrations with the relocation already reviewed (§2.3). Frozen statement multiset is the reference | ☐ |
| 7 | **Rollback / forward recovery** | Documented: which command, who runs it, how long, and what it costs. Forward path = P9; the backup from item 2 is the rollback of last resort | ☐ |
| 8 | **Post-migration verification** | Re-run P2/P4/P5 after the deploy; expected: same 22 names, **exactly one** eligible F.5 row, collation distribution unchanged, `migrate deploy` exit 0 | ☐ |

## 7. Verification actually performed in this phase

| # | Check | Method | Result |
|---|---|---|---|
| 7.1 | **Static migration inventory** | `readdir` of `prisma/migrations`; per-file statement extraction; count of migration dirs | **22 dirs** + `migration_lock.toml` (`provider="mysql"`, unmodified); apply order reconciled against the recorded replay; one punctuation-order discrepancy documented (§2.1) |
| 7.2 | **Checksum evidence comparison** | `sha256sum` of each file vs `git show HEAD:…`; comparison with the 2C.2D backup hash file; sha256 of the four pairs of moved files' **statement multisets** | Exactly **4 files differ**; all 4 `HEAD` hashes match the 2C.2D backup; both moved pairs are multiset-identical (44≡44, 16≡16) |
| 7.3 | **Config / target trace** | `.env` (masked), `.env.test`, `.env.test.example`, `prisma.config.ts`, `package.json`, `src/lib/prisma.ts`, `src/lib/database-url.ts`, `tests/setup.ts`, `docker-compose.yml`, `Dockerfile*`, `docker/nginx.conf`, `README.md` | The consumer matrix in §1.1; **no credential printed anywhere** (all values masked) |
| 7.4 | **Collation evidence comparison** | Migration DDL extraction for the five tables (CREATE + later ALTERs); explicit-`COLLATE` grep over all 22 files; `git log -S utf8mb4_unicode_ci` on the two owning files; host/container MariaDB versions; recorded §26.7 distribution | Chain **always** mandated `utf8mb4_unicode_ci` for those five tables; no charset-altering DDL exists; host server is MariaDB 11.8.8 (uca1400 default) |
| 7.5 | **`git diff --check`** | `git diff --check; echo $?` | **exit 0** (clean) — no whitespace errors introduced |
| 7.6 | **Initial vs final Git status** | `git status --porcelain | wc -l` at start and end; `git rev-parse HEAD` both times | **29 → 29**; HEAD still `e8d4aa3`; branch still `main`; the two changed files are `docs/accounting-hardening/STEP-2C-6-MIGRATION-COMPATIBILITY.md` (new) and `docs/accounting-hardening/ROADMAP.md` (edited) — both inside the already-untracked `docs/` entry, so the **entry count is unchanged** |
| 7.7 | **No executable file modified** | `git status` + `git diff --name-only` restricted to `src/`, `tests/`, `scripts/`, `prisma/`, `package.json`, configs; plus the phase's own write list | **Files written by this phase: exactly two, both documentation** — `docs/accounting-hardening/STEP-2C-6-MIGRATION-COMPATIBILITY.md` (new) and `docs/accounting-hardening/ROADMAP.md` (edited). Every executable entry that `git status` reports (the `src/`, `tests/`, `scripts/`, `prisma/seed.ts`, `src/lib/prisma.ts`, `report.service.ts` … set) was **already modified before this phase** and was **not touched**: the four `prisma/migrations` entries are byte-identical to their 2C.5 state (`sha256` re-verified in §2.2, unchanged from §25.5), and no file under `src/`, `tests/` or `scripts/` was opened for writing at all. `ACCOUNTING-INTEGRATION-TEST-PLAN.md` was **not** modified (mtime still 15:31, i.e. before this phase started) |
| 7.8 | **No database write or migration command executed** | Command log for the phase: `git`, `ls/find/grep`, `sha256sum`, `python3` (filesystem only), `docker ps/-a/inspect/volume ls`, `ss`, `ps`, `systemctl is-active`, `rpm/dpkg`, `mariadb --version` (client version string only), `strings` over a binary | **No DB connection, no `prisma` command of any kind, no migration command, no DDL, no ledger write, no container lifecycle action.** 3306 / 3307 / 3308 / v1 / v2 were **not contacted** |
| 7.9 | **Baseline integrity** | The 2C.5 baselines were **not re-run** and are **not re-claimed** | §0.3 — this phase asserts **no** test result |
| 7.10 | **Dependency order, first-hand** | Line-level extraction of the two relocated blocks from the current working tree; parent-table lookups; grep for leftover references | §2.3 — both blocks now sit **after** their parents (`promo` L21→L100/L103/L106 with `branch` L29 of an earlier migration; `purchase` L21→`purchaseingredient` L110 with `ingredient` L9 of an earlier migration); the old file retains **no** executable reference; no other migration references `purchaseingredient` |
| 7.11 | **Collation source attribution** | `grep -ciE 'collation\|charset' prisma/schema.prisma`; DDL extraction for the five tables; charset-DDL grep over all 22 migrations; host/container server versions | §3.2 — **0** collation attributes in the schema; all five `CREATE TABLE`s carry explicit `utf8mb4_unicode_ci`; **no** charset-altering DDL exists; server is MariaDB 11.8.8 (default `utf8mb4_uca1400_ai_ci`) |

## 8. Consolidated remaining UNKNOWNs

| ID | Unknown | Why it matters | How to close it |
|---|---|---|---|
| U1 | The **deployed/production** database identity (host, port, schema, user) and whether a real deployment ever runs `migrate deploy` | Determines whether CK-2/CK-6 apply at all, and whether production was provisioned by this chain or incrementally | §4 P1 + the VPS's own `.env`/PM2 config, by the operator |
| U2 | Production's `_prisma_migrations` contents and per-file checksums | CK-6: a pre-`f835e13` production DB may carry **up to 4 extra** differing checksums | §4 P2/P3 + P8 |
| U3 | Whether production's collations are uniform or skewed like 3306 | F-8's blast radius in the deployed environment | §4 P5/P6 |
| U4 | Whether the mixed collations actually produce error 1267 for this application's queries on 3306 | Determines whether F-8 is a documentation item or a live defect | §4 P7 (read-only) |
| U5 | The historical mechanism that produced the five `uca1400_ai_ci` tables on 3306 | Would tell us whether other environments share the property | §4 P6/P8 + whatever provisioning records exist on the host |
| U6 | Whether Prisma's `migrate deploy` is silent about the 4 modified applied migrations in a **real** run at 7.10.0 | §2.4 is a code-reading conclusion | §4 P9 on a disposable database, in a later phase |
| U7 | Whether the engine will keep ignoring checksums on a future Prisma upgrade | CK-9 | Re-audit after any Prisma version bump |
| U8 | The state of the 5 F-2 era `finished_at IS NULL` rows in production / on the shared host | These are pre-existing retry artefacts; they can affect `migrate status` output and future `resolve` decisions | §4 P3 |

## 9. STOP gate — explicit approval questions

**STEP 2C.6 is an audit and stops here. Nothing was implemented, edited, migrated, committed or deployed.**

1. **Target identity (F-6).** Do you accept §1's classification — 3306 = shared *dev-host* reference DB (not
   proven to be production), 3308 = the approved (currently **stopped**) test target, production = UNKNOWN —
   and that the deployed target will be established by the operator checklist (§4 P1 + the VPS config) rather
   than inferred here?
2. **Checksum strategy (F-6).** Do you approve **Option A as the target state** (keep the four-file relocation)
   together with the written prohibition of `migrate dev` / `db push` / `migrate reset` / `migrate resolve` /
   ledger writes on any DB that already has the migrations applied?
3. **Committing the fix (CK-1).** Do you approve a **separate, explicitly scoped commit** of the four migration
   files (plus the relevant docs) — the current uncommitted state means a deployment from `HEAD` would still
   fail? *(This audit performed no commit.)*
4. **Fresh-replay-from-committed-tree.** Do you want the first step of the next implementation phase to be a
   fresh replay from the **committed** tree on a throwaway database, so what is proven is what is shipped?
5. **F-8 decision.** Do you accept **Option A + D** (document the divergence; verify collation read-only in the
   pre/post-deploy checks) and leave the 3306 normalisation (**Option B**) as an evidence-triggered,
   backup-gated operation, to be attempted only after §4 P7 shows a real 1267?
6. **Test target availability (2C.8 blocker).** Do you authorise starting `restaurant-mariadb-test` (3308) —
   identity-verified first — so the v3 target is reachable again for the 2C.8 regression run?
7. **Scope confirmation.** Do you confirm that STEP 2C.7 (code quality/lint), 2C.8 (full regression/UAT) and
   2C.9 (production release) remain **NOT STARTED** and must not be started automatically?

## 10. Report policy compliance

* This report is a **new file**: `docs/accounting-hardening/STEP-2C-6-MIGRATION-COMPATIBILITY.md`.
* `docs/accounting-hardening/ROADMAP.md` was updated (2C.6 → CURRENT, audit only; 2C.7–2C.9 untouched).
* **Nothing was appended to `ACCOUNTING-INTEGRATION-TEST-PLAN.md`** (legacy archive, read-only since 2C.3B).
* Audit findings (§1–§3) appear **before** any proposed fix (§2.8, §3.5), and every proposed fix is behind an
  approval gate (§9).

---

# PART II — APPROVED LIMITED FOLLOW-UP

**Date:** 2026-10-14
**Mode:** 🟡 **LIMITED OPERATIONAL VERIFICATION + COMMIT READINESS GATE.** Part I's audit was accepted; this part
re-runs **nothing** of it. Only the explicitly approved operations were performed.
**Approved decisions executed:** **A1** read-only target verification (no assumption that 3306 is production);
**A2** Option A kept as target state, no SQL edit, no ledger rewrite, no `migrate resolve/dev/deploy` on an
existing DB; **A3** **no commit** — an exact manifest is prepared and the whole working tree reviewed; **A4** a
committed-tree replay is **prepared only**; **A5** F-8 = **Option A+D**, no `ALTER TABLE`/no collation
normalisation; **A6** the **existing** `restaurant-mariadb-test` container was started (after identity proof) —
no recreate/reset/remove/prune/volume deletion; **A7** STEP 2C.7–2C.9 untouched.
**Outcome:** v3 recovered and verified read-only (**all integrity expectations met and byte-identical to the
2C.2E record**); the 29-entry working tree fully classified with a per-file include/hold verdict; the release
gate and F-8 documentation consolidated. **No DDL, no ledger write, no migration command, no commit.**

## 11. Task 1 — v3 target recovery (A6) and read-only verification

### 11.1 Identity proof performed BEFORE the start (A6 precondition)

| Check | Recorded evidence (2C.2E §26.3 + Part I §1.5) | Measured now, before start | Match |
|---|---|---|---|
| Container ID | `bae65d9fc5879e87039abda62e0222be96ebd566615db93f8adafe6f359b2099` | **identical** | ✅ |
| Image | `mariadb:11.8` | `mariadb:11.8` | ✅ |
| Inner hostname | `bae65d9fc587` | `bae65d9fc587` | ✅ |
| Port binding | `{"3306/tcp":[{"HostIp":"127.0.0.1","HostPort":"3308"}]}` | **identical** (127.0.0.1 only) | ✅ |
| Volume | `restaurant-mariadb-test_data` → `/var/lib/mysql` | **same volume**, `rw=true`, type `volume`, driver `local` | ✅ |
| Volume identity | — | `CreatedAt=2026-10-14T09:15:21+07:00`, `Mountpoint=/var/lib/docker/volumes/restaurant-mariadb-test_data/_data` | ✅ persistent, pre-existing |
| Compose labels | none (standalone, unlike 3307) | `com.docker.compose.project/service/config_files` → **all empty** | ✅ |
| Restart policy | — | `no`, `MaximumRetryCount=0` | ✅ |
| Exit reason | clean stop | `Status=exited`, `ExitCode=0`, `Error=`, `OOMKilled=false`, `Dead=false` → **clean stop, not a crash** | ✅ |
| Restarts | 0 | 0 | ✅ |

**Identity matched on every axis → the approved action (start the existing container) was taken.** No image pull,
no `docker run`, no `compose up`, no recreate.

### 11.2 The start (A6) and after-state

```
$ docker start restaurant-mariadb-test          → restaurant-mariadb-test (exit 0)
$ mariadb-admin ping (inside container)          → ready after 4s
$ TCP 127.0.0.1:3308                             → OPEN
```

| After-state check | Value | Match with before-state |
|---|---|---|
| Container ID | `bae65d9fc587…b2099` (same full ID) | ✅ same instance |
| Image | `mariadb:11.8` | ✅ |
| Port binding | `{"3306/tcp":[{"HostIp":"127.0.0.1","HostPort":"3308"}]}` | ✅ |
| Mount | `volume:restaurant-mariadb-test_data->/var/lib/mysql rw=true` | ✅ |
| `RestartCount` | **0** (no crash-loop, no auto-restart) | ✅ |
| `State.StartedAt` | `2026-10-14T14:37:14Z` (new start timestamp — expected for a start) | ✅ |

**No other container was touched:** `restaurant-mariadb` (3307, sibling project), `restaurant-phpmyadmin`,
`restaurant-redis` kept running untouched; `restaurant-app`/`restaurant-worker` remain the sibling project's
exited containers. **Nothing was removed and no volume was pruned.**

> ### ⚠️ Finding U10 — the container's Docker healthcheck is misconfigured (pre-existing)
>
> `docker ps` reports the container as **`Up (unhealthy)`** while MariaDB is demonstrably serving. Cause, read
> first-hand: the healthcheck is `CMD-SHELL mysqladmin ping -h localhost`, but this image
> (`mariadb:11.8`, MariaDB 11.8.9) ships **`mariadb-admin`** and **no `mysqladmin`** → every probe exits **127**
> (`/bin/sh: 1: mysqladmin: not found`), so the health state is a false negative:
>
> ```
> Test=["CMD-SHELL","mysqladmin ping -h localhost"]  Interval=10s Timeout=5s Retries=3 StartPeriod=0s
> last probes: ExitCode=127  Output=/bin/sh: 1: mysqladmin: not found   (repeated)
> functional proof: SELECT 1 → 1 | 2026-10-14 14:42:30
> ```
>
> * **Not caused by this phase** — the healthcheck lives in the container's configuration; the state was simply
>   never observable while the container was stopped.
> * **Operational consequence for 2C.8:** do **not** gate on Docker health for 3308 (a `docker ps`- or
>   `until healthy`-style wait would never pass). Gate on the **TCP port / `mariadb-admin ping`**, which is exactly
>   what `tests/setup.ts` and this verification used.
> * **The fix** (aligning the test to `mariadb-admin ping`) requires **recreating** the container — explicitly
>   forbidden in Part II (A6). It is recorded as **U10** and left for a separately approved infrastructure step.
>   The sibling container on 3307 uses `healthcheck.sh --connect` and reports `healthy`, which is why the two
>   look different.

### 11.3 Read-only verification of v3 (every check performed inside the container; `SELECT`/`SHOW` only)

| # | Check | Expected | **Measured now** | Verdict |
|---|---|---|---|---|
| 1 | Server identity | MariaDB 11.8.x, tz UTC | `11.8.9-MariaDB-ubu2404`, `@@time_zone=SYSTEM`, `@@system_time_zone=UTC`, `@@collation_server=utf8mb4_uca1400_ai_ci` | ✅ matches §26.3/§26.10 |
| 2 | Schemas present | `restaurant_app_test` (v1), `…_v2`, `…_v3` | exactly those three (+ system schemas) | ✅ |
| 3 | v3 table count | 49 | **49** | ✅ |
| 4 | v3 collation distribution | 49 × `utf8mb4_unicode_ci` | **49 × `utf8mb4_unicode_ci`** (0 deviations) | ✅ exactly as §26.7 |
| 5 | v3 DB default collation | `utf8mb4` / `utf8mb4_uca1400_ai_ci` | identical | ✅ |
| 6 | v3 ledger rows | 22 | **22** | ✅ |
| 7 | Unfinished / rolled-back rows | 0 / 0 | **0 / 0** | ✅ |
| 8 | Distinct ledger names | 22 | **22** | ✅ |
| 9 | **Exactly one eligible F.5 row** (M-1 precondition) | 1 | **1** | ✅ |
| 10 | F.5 row content | checksum `f4234f86…`, `finished_at 2026-10-14 07:52:58.220` | `f4234f863da460f16677b2002011e8ab905d040acfcc8a47aa363c7f859e9428`, `started 07:52:58.188` / `finished 07:52:58.220`, `applied_steps_count=1` | ✅ **byte-identical to the 2C.2E record** |
| 11 | **Checksum reconciliation: ledger vs on-disk files** | 22 match / 0 differ / 0 missing | **22 / 0 / 0** | ✅ no drift in v3 |
| 12 | v3 FK columns | 105 | **105** | ✅ |
| 13 | **Residual rows across ALL 49 v3 tables** | 0 business rows | app tables **all 0**; only `_prisma_migrations` = 22 (the ledger). Total non-ledger rows = **0** | ✅ no test residue |
| 14 | The five F-8 tables' collation in v3 | all `utf8mb4_unicode_ci` | `auditlog`, `notification`, `orderitem`, `paymenttransaction`, `whatsappmessage` → **all `utf8mb4_unicode_ci`** | ✅ chain-consistent |

> Method note (accuracy): the first attempt at check 13 built its `UNION ALL` query through a nested shell and
> the backticks were consumed by the container's `sh`, so the query failed (syntax error) and the script printed a
> meaningless `0`. It was **re-run correctly** (SQL piped over stdin, identifiers back-quoted, 49 per-table counts
> returned) and only the **re-run** result is reported above. The failed attempt wrote nothing and is recorded here
> so the number above is not mistaken for the broken one.

### 11.4 Protected targets: untouched (re-verified read-only)

| Target | Recorded | **Measured now** | Verdict |
|---|---|---|---|
| v1 `restaurant_app_test` | 49 tables / 55 FK / 6 ledger rows | 49 tables / 55 FK / **6 ledger rows** | ✅ unchanged |
| v2 `restaurant_app_test_v2` | 24 tables / 42 FK / 6 ledger rows | 24 tables / 42 FK / **6 ledger rows** | ✅ unchanged |
| 3307 `/ 3306` | sibling project / shared host DB | **not contacted at any point** — no connection, no credential test, no statement | ✅ untouched |
| Production | UNKNOWN | **not contacted, not inferable** (A1 operator pack remains the route) | ✅ untouched |

`[Measured]` All v3 verification used `SELECT`/`SHOW` against `information_schema` and `_prisma_migrations`. No
`INSERT`/`UPDATE`/`DELETE`, no DDL, no Prisma command, and no integration test was executed in this part.

### 11.5 Independent re-verification (second pass, same session day)

The Part II working session ended unexpectedly, so **every** read-only measurement above was **re-measured
independently** instead of being carried over from the first pass. The container was **not** restarted in between:
`State.StartedAt` is **identical** (`2026-10-14T14:37:14.930869943Z`) and `RestartCount=0`, i.e. the same instance
on the same volume `restaurant-mariadb-test_data`.

| Re-checked independently | Second-pass value | vs §11.3 / §11.4 |
|---|---|---|
| Container ID / image / binding / volume / restarts | `bae65d9fc587…b2099` · `mariadb:11.8` · `127.0.0.1:3308` · `restaurant-mariadb-test_data` (rw) · `0` | ✅ identical |
| Server identity | `11.8.9-MariaDB-ubu2404`, `@@hostname=bae65d9fc587`, `@@collation_server=utf8mb4_uca1400_ai_ci`, tz `SYSTEM`/`UTC` | ✅ identical |
| v3 tables / collation distribution | **49** tables · **49 × `utf8mb4_unicode_ci`** (0 deviations) · DB default `utf8mb4`/`utf8mb4_uca1400_ai_ci` | ✅ identical |
| v3 ledger | **22** rows · **0** unfinished · **0** rolled-back · **22** distinct names | ✅ identical |
| Exactly one eligible F.5 row | `20260911143644_f5_order_item_cost_snapshot`, checksum `f4234f863da460f16677b2002011e8ab905d040acfcc8a47aa363c7f859e9428`, `started 07:52:58.188` / `finished 07:52:58.220`, `applied_steps_count=1` (**1** `%f5%` row, and it is eligible) | ✅ **byte-identical** |
| **Checksum reconciliation** (all 22 on-disk `sha256` vs ledger `checksum`) | **22/22 identical, 0 differ, 0 missing** | ✅ no drift |
| v3 FK columns | **105** | ✅ identical |
| The five F-8 tables in v3 | all `utf8mb4_unicode_ci` | ✅ identical |
| **Residual rows across all 49 v3 tables** (per-table `COUNT(*)`, SQL piped over stdin) | app tables **all 0**; only `_prisma_migrations` = 22 → **0** business/test rows | ✅ identical |
| v1 / v2 untouched | v1 49/55/6 · v2 24/42/6 | ✅ identical to record |
| Working tree | `git status --porcelain` = **29** (42 files with `-uall`), HEAD `e8d4aa3`, branch `main`, stash **0**, `git diff --check` exit **0** | ✅ unchanged |
| Statement-preservation, independent Python multiset scan | pair 1 HEAD **44** ≡ WT **44**; pair 2 HEAD **16** ≡ WT **16**; lost `[]`, added `[]` | ✅ re-proved |

`[Measured]` Both passes were `SELECT`/`SHOW`-only, made no write of any kind, ran no Prisma/migration command and
left no artefact outside this report and `ROADMAP.md`.

## 12. Task 2 — exact commit manifest (A3: nothing staged, nothing committed)

### 12.1 Working-tree inventory

`[Measured]` **29 porcelain entries = 42 files** (17 tracked modifications + 25 untracked files, of which the
`docs/` and `tests/` entries each cover a whole new directory). Branch `main`, HEAD `e8d4aa3`, `git status` count
**29** at the start and at the end of this part.

`[Measured]` **Provenance by mtime** separates pre-programme work from programme work and is used as the primary
classifier: **pre-programme** = 2026-10-10 / 2026-10-13; **programme** = 2026-10-14.

### 12.2 Per-entry manifest (all 29 entries)

| # | Entry | Group | Provenance (mtime) | Verdict | Reason |
|---|---|---|---|---|---|
| 1 | `.env.example` | **6 unrelated** | **2026-10-13 16:33** | ⛔ **HOLD** | Pre-programme dev edit (nobody in this programme wrote it): masks the URL placeholder (`root:password` → `root:***`) and adds a `TEST_DATABASE_URL=` note. Cosmetic/education only; needs an explicit owner decision, not a silent ride-along in the release commit |
| 2 | `.gitignore` | **4 test infra** | 2026-10-14 09:37 | ✅ **INCLUDE** | Adds `.env.test` — protects real test credentials from being committed. Tiny, high-value, directly supports §4/§6 of the release gate |
| 3 | `prisma/migrations/20260908030144_add_branch_multi_cabang/migration.sql` | **1 F-7 relocation** | 2026-10-14 14:29 | ✅ **INCLUDE — release-critical** | Removes the 3 `promo` statements that ran before `promo` existed |
| 4 | `prisma/migrations/20260909_add_customer_auth_promo/migration.sql` | **1 F-7 relocation** | 2026-10-14 14:29 | ✅ **INCLUDE — release-critical** | Receives them verbatim after `CREATE TABLE promo` |
| 5 | `prisma/migrations/20260911140000_add_purchasing_inventory_foundation/migration.sql` | **1 F-7 relocation** | 2026-10-14 14:29 | ✅ **INCLUDE — release-critical** | Receives `CREATE TABLE purchaseingredient` verbatim after `CREATE TABLE purchase` |
| 6 | `prisma/migrations/20260911_add_ingredient_purchasing_wac/migration.sql` | **1 F-7 relocation** | 2026-10-14 14:29 | ✅ **INCLUDE — release-critical** | Loses that block + gains an explanatory comment; its remaining SQL unchanged |
| 7 | `prisma/seed.ts` | **2 F-2 source** | 2026-10-14 16:11 | ✅ **INCLUDE** | 2C.4 F-2: uses `parseDatabaseUrl()` (decode-once) instead of raw `URL` getters |
| 8 | `scripts/backfill-branch.ts` | **2 F-2 source** | 2026-10-14 16:11 | ✅ **INCLUDE** | Same F-2 fix (`decodeCredential`); tracked operational script |
| 9 | `scripts/diag-p3018.mjs` | **2 F-2 source** | 2026-10-14 16:11 | ✅ **INCLUDE** | Same fix, inlined mirror (script runs on plain `node`). Diagnostic script, no runtime effect |
| 10 | `scripts/prisma-diag.mjs` | **2 F-2 source** | 2026-10-14 16:11 | ✅ **INCLUDE** | As row 9 |
| 11 | `src/app/api/reports/products/export/route.ts` | **2 accounting fix** | 2026-10-14 15:48 | ✅ **INCLUDE** | 2C.3B: comment corrected to the canonical revenue set (`revenueSetSql`); **comment-only** change |
| 12 | `src/lib/prisma.ts` | **2 F-2 source** | 2026-10-14 16:11 | ✅ **INCLUDE** | 2C.4 F-2 wiring; exports `createPrismaClient` so the regression suite drives the real path |
| 13 | `src/services/accounting/integrity.rules.ts` | **2 accounting fix** | 2026-10-14 16:46 | ✅ **INCLUDE** | M2 rules + 2C.5 M-1/M-2/M1-R pure functions (`selectLegacyCutoff`, `parseNaiveUtcDateTime`, disclosure) |
| 14 | `src/services/accounting/integrity.service.ts` | **2 accounting fix** | 2026-10-14 16:45 | ✅ **INCLUDE** | `resolveLegacyCutoff()` reads every ledger row (no `LIMIT 1`, no `ORDER BY` in SQL, `started_at` never a fallback); disclosure threaded |
| 15 | `src/services/accounting/integrity.types.ts` | **2 accounting fix** | 2026-10-14 16:44 | ✅ **INCLUDE** | Additive types: `LEGACY_CUTOFF_AMBIGUOUS`, `cutoffDisclosure` |
| 16 | `src/services/accounting/integrity.unit.test.ts` | **3 tests** | 2026-10-14 16:46 | ✅ **INCLUDE** | 57 → **78** unit cases (21 new cutoff cases); no case weakened, skipped or deleted |
| 17 | `src/services/report/report.service.ts` | **2 accounting fix** | 2026-10-14 15:51 | ✅ **INCLUDE** | 2C.3B: A-9 / A-11 / A-12 predicate drift fixed via `revenueSetSql` (3 sites, +4/−2 per hunk) |
| 18 | `.env.test.example` | **4 test infra** | 2026-10-14 15:12 | ✅ **INCLUDE** | Template for the single approved target; **secret-shape clean** (§12.4) |
| 19 | `ACCOUNTING-INTEGRATION-TEST-PLAN.md` | **5 reports** | 2026-10-14 15:31 | ✅ **INCLUDE** (reviewer may HOLD) | The evidence archive behind every phase (§1–§27); frozen since 2C.3B. 334 KB of audit history — valuable provenance, but if the reviewer wants a lean release commit it can be held |
| 20 | `ACCOUNTING-M2-SOLUTION-PROPOSAL.md` | **5 reports** | **2026-10-10 11:29** | ✅ **INCLUDE** (reviewer may HOLD) | Pre-programme input that 2C.5 Part I explicitly cites (cutoff/checksum evidence E6) |
| 21 | `HERMES-PROJECT-AUDIT.md` | **6 unrelated** | **2026-10-13 10:26** | ⛔ **HOLD** | Pre-programme audit artefact, not referenced by any phase report of this programme |
| 22 | `HERMES-ORDER-HPP-ACCOUNTING-AUDIT.md` | **6 unrelated** | **2026-10-13 10:49** | ⛔ **HOLD** | As row 21 |
| 23 | `HERMES-ACCOUNTING-CONFLICT-AUDIT.md` | **6 unrelated** | **2026-10-13 13:54** | ⛔ **HOLD** | As row 21 |
| 24 | `HERMES-ACCOUNTING-EVIDENCE-VALIDATION.md` | **6 unrelated** | **2026-10-13 14:15** | ⛔ **HOLD** | As row 21 |
| 25 | `INVENTORY-DESIGN-REVIEW.md` | **6 unrelated** | **2026-10-13 10:53** | ⛔ **HOLD** | Pre-programme design note; unrelated to F-6/F-7/F-8 |
| 26 | `docs/` (6 files) | **5 reports** | 2026-10-14 15:55 → 21:38 | ✅ **INCLUDE** | ROADMAP + the five phase reports (§12.3) |
| 27 | `src/lib/database-url.ts` | **2 F-2 source** | 2026-10-14 16:10 | ✅ **INCLUDE** | The F-2 decode-once helper itself (3483 B, no I/O, logs nothing) |
| 28 | `src/lib/database-url.unit.test.ts` | **3 tests** | 2026-10-14 16:12 | ✅ **INCLUDE** | 24 F-2 unit cases |
| 29 | `tests/` (9 files) | **3+4 tests/infra** | 2026-10-14 12:29 → 16:58 | ✅ **INCLUDE** | Five integration suites, the F-2 live suite, fixtures, `setup.ts`, `README.md` (§12.3) |

### 12.3 Members of the two directory entries

| File | Group | Verdict | Note |
|---|---|---|---|
| `docs/accounting-hardening/ROADMAP.md` | 5 | ✅ INCLUDE | Phase ledger; updated by this phase |
| `docs/accounting-hardening/STEP-2C-3A-REPORTING-AUDIT.md` | 5 | ✅ INCLUDE | Audit A-9/A-11 |
| `docs/accounting-hardening/STEP-2C-3B-REPORTING-FIX.md` | 5 | ✅ INCLUDE | Fix + regression evidence |
| `docs/accounting-hardening/STEP-2C-4-DATABASE-CONNECTION.md` | 5 | ✅ INCLUDE | F-2 audit + fix + verification |
| `docs/accounting-hardening/STEP-2C-5-CUTOFF-FINALIZATION.md` | 5 | ✅ INCLUDE | M-1/M-2 audit + implementation |
| `docs/accounting-hardening/STEP-2C-6-MIGRATION-COMPATIBILITY.md` | 5 | ✅ INCLUDE | This report (Part I + Part II) |
| `tests/setup.ts` | 4 | ✅ INCLUDE | Fail-closed approved-target guard (host/port/db/user, protected names **and** ports 3306/3307) |
| `tests/README.md` | 4 | ✅ INCLUDE | Target, counts, F-2 policy, corrected note |
| `tests/fixtures/accounting.ts` | 3 | ✅ INCLUDE | Deterministic factories + run cleanup helpers |
| `tests/accounting/cashbook.integration.test.ts` | 3 | ✅ INCLUDE | 15 tests (2B.1) |
| `tests/accounting/revenue.integration.test.ts` | 3 | ✅ INCLUDE | 21 tests (2B.2 + 2C.3B) |
| `tests/accounting/refund-profitability.integration.test.ts` | 3 | ✅ INCLUDE | 21 tests (2B.3) |
| `tests/accounting/pnl.integration.test.ts` | 3 | ✅ INCLUDE | 24 tests (2B.4) |
| `tests/accounting/integrity.integration.test.ts` | 3 | ✅ INCLUDE | 30 tests (2B.5 + 2C.5 case 30) |
| `tests/database-connection.integration.test.ts` | 3 | ✅ INCLUDE | 4 F-2 live tests (2C.4) |

### 12.4 Pre-commit safety scan (all 42 files) `[Measured]`

* **Credential scan:** every value from the two gitignored env files (`.env`, `.env.test`) was searched for in all
  42 changed/untracked files. **No password, API key, VA, or session secret appears in any of them.** The only
  matches were 6 **non-secret configuration values** that legitimately belong in an example file
  (`IPAYMU_ENV=sandbox`, the public sandbox `IPAYMU_BASE_URL`, `REDIS_URL=redis://localhost:6379`,
  `WHATSAPP_SESSION_DIR`, `PRODUCT_UPLOAD_DIR`).
* **`.env.test.example` shape:** placeholder host/port/db/user only; **0** lines containing a 32+ character token.
* **`.env.test`, `.env`, `.env.production`** are gitignored (`.gitignore` line 5 adds `.env.test`) and are **not**
  part of the manifest.
* **No scratch/probe artefacts** were left by this part: the only files written are this report and `ROADMAP.md`.

### 12.5 F-7 statement-preservation — re-proved in this part `[Measured]`

| Moved pair | HEAD statements | Working-tree statements | Multiset equal | Lost | Added |
|---|---|---|---|---|---|
| `20260908030144_add_branch_multi_cabang` + `20260909_add_customer_auth_promo` | 44 | 44 | ✅ **true** | **[]** | **[]** |
| `20260911_add_ingredient_purchasing_wac` + `20260911140000_add_purchasing_inventory_foundation` | 16 | 16 | ✅ **true** | **[]** | **[]** |

`[Measured]` The four files' sha256 values are **unchanged** from the Part I / 2C.5 record
(`97ee89d5…`, `019b42ed…`, `fac529c7…`, `47365a5c…`) — so the artefact that would be committed is exactly the
artefact that was audited. `git status -- prisma/` returns only those four plus `prisma/seed.ts` (row 7), i.e. no
fifth migration file and no schema change is in play.

### 12.6 Proposed commit sequence (PREPARED ONLY — **no commit is authorised**, A3)

| Order | Commit | Files | Why this order |
|---|---|---|---|
| **C1** | `fix(migrations): relocate two dependency blocks so an empty database can provision (F-7)` | rows 3–6 (**4 files**) | The **release-critical** unit: without it `HEAD` still fails at migration 6 (P3018) and no fresh environment (staging, production-by-`migrate deploy`) can be provisioned. Statement-preserving (§12.5), so existing DBs see a metadata-only delta. Must be reviewable **on its own** |
| **C2** | `fix(accounting): canonical revenue predicates and DB URL credential decoding (A-9/A-11/A-12, F-2)` | rows 7–17, 27, 28 (accounting source, F-2 source + its unit test, M2 unit test) | The production-behaviour changes, each with its regression coverage |
| **C3** | `test(accounting): M2/accounting integration suites, approved-target guard and F-2 live suite` | rows 18, 29 (+ `.gitignore` row 2) | Test infrastructure and the suites that prove C2 |
| **C4** | `docs(accounting-hardening): phase reports, ROADMAP and evidence archive` | rows 19, 20, 26 | Documentation only; safe to land last. Rows 21–25 are **not** proposed for any commit |

**Held back and NOT in any proposed commit:** row 1 (`.env.example`) and rows 21–25 (pre-programme HERMES/INVENTORY
audits). They need an explicit owner decision if they are ever to be committed.

**Nothing is staged.** `git add` was not run; no `commit`, `push`, `merge`, `reset`, `restore` or `stash` was run
in this part (A3).

## 13. Task 3 — deployment compatibility gate

The two provisioning paths must be treated as **separate procedures**. Running the existing-database procedure on a
fresh database (or vice versa) is itself a defect.

### 13.1 Mandatory target identity (operator-verified — A1)

Before **any** command, the operator records and confirms, for the environment being changed:

1. `SELECT @@version, @@version_comment, @@hostname, @@collation_server, @@time_zone, @@system_time_zone, DATABASE();`
2. The environment's own configuration (VPS `.env`/PM2 env/process manager) and **the host + port + schema it names**,
   with the credential masked in any pasted output.
3. An explicit written line: *"the target I am about to migrate is `<host:port>/<schema>`, owned by `<who>`, and it is
   `[dev|staging|production]`"*.
4. `localhost:3306` is **not** automatically production and must not be assumed to be (A1). The shared host DB hosts
   unrelated schemas (`airprod_test`, `ecommerce_iot`, `tinggalklik`, `toko`, `reksa`, …) — a wrong `DATABASE_URL`
   there would touch somebody else's data.

**STOP** if items 1–3 cannot be produced, or if the target is the sibling project on 3307, or if it is unknown.

### 13.2 Existing database (all 22 migrations already applied) — the normal case

| Step | Action | Expected / abort condition |
|---|---|---|
| E1 | Target identity | see §13.1 |
| E2 | **Full backup**, then a **restore rehearsal** into a scratch schema *on a disposable instance* | Backup must be timestamped and the restore must be *executed once* before the window. **STOP if the restore has never been proven** — a backup that has never been restored is not a backup |
| E3 | Ledger inventory (`P2`/`P3`) | All 22 migration names present. Record duplicates / unfinished / rolled-back rows **as pre-existing facts** (the shared host carries `0_baseline`×2, `product_recommendations`×2, `ingredient_f1`×4, and 5 unfinished retries `[Recorded]` §24.4) |
| E4 | **Checksum reconciliation** (`P8` vs `P2`) | Expect **exactly 4** differences — the C1 files. A pre-`f835e13` environment may add up to **4 more** (`f5_order_item_cost_snapshot`, `add_ingredient_f1`, `add_recipe_bom`, `add_inventory…`) `[Recorded]` §24.4/CK-6. **Any other difference = STOP and re-analyse** |
| E5 | Collation inspection (`P5`/`P6`) | Record the distribution; **skew is documented, not fixed** (A5) |
| E6 | Confirm zero pending migrations: `npx prisma migrate deploy` **with an explicit `DATABASE_URL` for this target only** | Expected: `22 migrations found in prisma/migrations` → `No pending migrations to apply.` **exit 0.** This is the *only* migration command allowed |
| E7 | Post-checks: `P2`/`P4`/`P5` again + application smoke (login, one order read, one report read) | Ledger names unchanged, **exactly one** eligible F.5 row, collation unchanged, no new warnings |

**E6 is a no-op on a fully migrated database** — that is the point: it proves nothing was pending and touches no
schema. If it reports pending migrations, the environment is **not** in the state §13.2 assumes → switch to the
§13.3 procedure after re-identifying the target.

### 13.3 Fresh database (empty schema) — provisioning

| Step | Action | Expected / abort condition |
|---|---|---|
| F1 | Target identity + **freshness** proof (`SHOW DATABASES`; the schema must not exist or must be verifiably empty) | **STOP** if it holds any table |
| F2 | Run from the **committed** tree (C1 landed) and record `git rev-parse HEAD` | **STOP** if `HEAD` still contains the pre-F-7 files — provisioning would fail at migration 6 |
| F3 | `DATABASE_URL=<explicit target> npx prisma migrate deploy` | Expect **22/22 applied, exit 0**, no warnings, `finished_at` non-null on all 22 rows |
| F4 | Structural parity check — **not** exit code: 49 tables, 105 FK columns, 5 FKs on `orderitemcostsnapshot`, identical unique-constraint and index sets, 49 × `utf8mb4_unicode_ci` | Compare against the 2C.2E reference measurement (method in §26.7). **STOP on any delta** |
| F5 | Ledger self-consistency: 22 rows, 22/22 checksums = on-disk sha256, **exactly one** eligible F.5 row | mirrors the v3 verification in §11.3, which is now a **live, repeatable** template |
| F6 | F.5 cutoff note: the replay stamps F.5 with the **apply time** | Record it. Do **not** rewrite it, do not mirror the production literal, do not install a second row (M-1 precondition) |

### 13.4 **`migrate deploy` exit 0 is NOT proof of schema compatibility**

Exit code 0 proves only that the *migration runner* completed: it does **not** prove that the resulting schema equals
the reference, that every FK/index/unique constraint exists, that no column type drifted, or that the data survived.
Compatibility must be proven by a **structural comparison** of `information_schema` against a reference (the
procedure used in 2C.2E §26.7 and re-applied as a live check in §11.3 of this part: tables, columns, PKs, FK columns,
referential rules, index rows, unique constraints, constraint names) **plus** post-deploy application checks. A fresh
replay is only
"successful" once its **schema** has been compared, not merely when its **exit code** is 0.

### 13.5 Historical migration drift — handling **without** falsifying the ledger

Four options exist. Two are legitimate; two are prohibited. This phase **chooses no automatic action** and does not
write the ledger (A2):

| Option | What it does | Consequence | Verdict |
|---|---|---|---|
| **(a) Accept the delta** — keep C1 and do nothing to the ledger | 4 rows keep the pre-patch checksum for all time; fresh DBs match exactly | Zero risk to data. The delta is visible only to checksum-aware tooling; `migrate deploy` (§2.4, `[Code]`) does not act on it and cannot fail because of it. Cost: the deviation must be documented and re-checked per environment (E4) | ✅ **chosen** |
| **(b) Revert the four files** to `HEAD` | checksum parity with every existing DB returns | **F-7 returns**: an empty database can no longer be provisioned (P3018 at migration 6). Emergency rollback only | ⛔ **not chosen** (CK-8) |
| **(c) `migrate resolve --applied <name>`** to re-align history | Marks migrations applied in the ledger | **Falsifies history**; can mark an unapplied migration as applied, and makes the ledger disagree with reality. Requires approval **and** is still the wrong tool | 🚫 **prohibited** |
| **(d) `UPDATE _prisma_migrations SET checksum = …`** | Silences the difference | **Forbidden by every phase rule of this programme** — rewriting the ledger is fabricated history and destroys the audit trail the deployment depends on | 🚫 **prohibited** |

Operator choices when the reconciliation is uncertain: **(a) proceed with (a) after §13.1–§13.4 are satisfied**;
**(b) treat the environment as unknown and re-analyse before deploying**; **(c) abort the window**. There is **no**
option in this report that writes the ledger automatically, and the four-file patch must never be "fixed" by
touching `_prisma_migrations`.

### 13.6 F-8 collation inspection at deploy time

`P5` / `P6` (read-only). Expected for any chain-provisioned DB: **49 × `utf8mb4_unicode_ci`**. A skew like 3306's
(5 tables at `utf8mb4_uca1400_ai_ci`) is **recorded as a known deviation and left untouched** (A5) — it is not a
deployment blocker and must not trigger `ALTER TABLE` inside a release window. If `P7` raises **error 1267** during
normal operation, that is the evidence trigger for the separate, backup-gated normalisation discussed in §3.4/§14.

### 13.7 Exact commands (after approval) and STOP conditions

```bash
# allowed against an EXISTING database (once, in the window):
DATABASE_URL='<explicit target URL>' npx prisma migrate deploy

# allowed ONLY on a disposable/empty target, for a provisioning rehearsal:
DATABASE_URL='<explicit disposable URL>' npx prisma migrate deploy
```

**Never**, on any environment with data: `npx prisma migrate dev`, `npx prisma db push`, `npx prisma migrate reset`,
`npx prisma migrate resolve`, or any `INSERT`/`UPDATE`/`DELETE` against `_prisma_migrations`.

**STOP conditions (abort the window, restore if anything already ran):**

1. Target identity cannot be proven (§13.1) or differs from the documented environment.
2. The backup has never been restore-tested, or the restore test fails.
3. Checksum reconciliation differs **beyond** the expected set (§13.2 E4).
4. Any migration other than "no pending" is reported on an existing database.
5. A fresh replay exits non-zero, or its structural comparison shows **any** delta (F4/F5).
6. Any command prompts for a **reset** (this is the `migrate dev` signature — abort immediately).
7. Anything requires a ledger write to proceed.
8. `migrate status` reports a **failed** migration (`failedMigrationNames`) — do not "resolve" it blind.

### 13.8 Recovery procedure if a migration fails mid-window

1. **Freeze**: stop the deploy, do not re-run, do not `resolve`, do not `reset`.
2. Capture the exact error (`P3018` + the SQL `errno`), the migration name, and the ledger rows (`P2`) as evidence.
3. Determine which of the two categories it is: (i) an **unfinished row** for a migration that failed → the ledger
   records it (`finished_at IS NULL`); (ii) a **corrupted/partial schema**. MariaDB DDL is non-transactional, so a
   partially applied migration can leave objects behind.
4. If the target was an **empty disposable** database: drop and recreate it, then re-run from F1 — nothing of value
   was lost. This is the default recovery for a provisioning rehearsal.
5. If the target **holds data**: **restore from the E2 backup** (the only sanctioned recovery), then re-analyse before
   attempting anything else. `migrate resolve --rolled-back` is a **last resort requiring explicit fresh approval**
   and is not part of this gate.
6. Re-verify after recovery: `P2`/`P4`, structural comparison, application smoke, and a written note in the phase
   record.

## 14. Task 4 — F-8 final decision (A5): documentation + verification only

**Decision:** **Option A+D is final for this programme.** The five existing collations are kept **exactly as they
are**; no `ALTER TABLE`, no `ALTER DATABASE`, no `CONVERT TO`, no data copy, no index rebuild.

1. **Documented:** the deviation, its direction (3306 has 5 tables at MariaDB 11.8's default
   `utf8mb4_uca1400_ai_ci`; the chain mandates `utf8mb4_unicode_ci`), its evidence class, and the four candidate
   sources with their verdicts (§3.2). Environments provisioned by the chain are **internally uniform** — which is
   what matters for correctness.
2. **Verified at deploy time:** `P5`/`P6` in the checklist (from §6) — expected distribution `49 × utf8mb4_unicode_ci`;
   any skew recorded, never silently normalised.
3. **Mixed-collation risk statement:** if a production environment turns out to be skewed **and** a query compares a
   skewed column with a non-skewed one, MariaDB raises **1267** (documented: two `IMPLICIT` collations, neither taking
   precedence `[Docs]`; real-world precedent: MariaDB 11.5+ default change `[Docs]`). Reachability is **UNKNOWN** here
   and is the trigger for normalisation — not the mere existence of the skew.
4. **Targeted read-only probe** (safe, run by the operator on the environment in question; results only, never pasted
   with credentials):

```sql
-- F-8 probe: does the mix actually error on THIS environment? (read-only)
SELECT COUNT(*) FROM `orderitem` oi JOIN `product` p ON oi.`productId` = p.`id`;
SELECT COUNT(*) FROM `orderitem` oi JOIN `order`   o ON oi.`orderId`   = o.`id`;
SELECT COUNT(*) FROM `auditlog`  a  JOIN `user`    u ON a.`userId`    = u.`id`;
SELECT COUNT(*) FROM `paymenttransaction` pt JOIN `payment` p ON pt.`paymentId` = p.`id`;
-- and the distribution itself:
SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN
  ('auditlog','notification','orderitem','paymenttransaction','whatsappmessage');
```

5. **Escalation rule:** normalisation (Option B) may be **proposed** only after (i) a real 1267 (or demonstrable
   sorting/lookup misbehaviour) is observed on the affected environment, **and** (ii) a verified backup and an agreed
   release window exist. Until then the correct action is **no action**.

## 15. Verification performed in Part II

| # | Check | Method | Result |
|---|---|---|---|
| 15.1 | `git diff --check` | `git diff --check; echo $?` | **exit 0** (clean; re-run after the last report edit) |
| 15.2 | Initial vs final Git status | `git status --porcelain \| wc -l`, `git rev-parse HEAD` at both ends | **29 → 29**, HEAD `e8d4aa3`, branch `main`, unchanged |
| 15.3 | Container identity before/after | `docker inspect` (ID, image, hostname, port binding, mounts, volume, restart policy, exit code) at both ends | **same instance** `bae65d9fc587…`, same volume `restaurant-mariadb-test_data`, same `127.0.0.1:3308` binding, `RestartCount=0` both times; only `State.StartedAt` advanced (expected for a start) |
| 15.4 | v3 read-only integrity | 14 checks in §11.3 (`information_schema` + `_prisma_migrations`, `SELECT`/`SHOW` only) | 49 tables · 49 × `utf8mb4_unicode_ci` · 22 ledger rows · 0 unfinished · 0 rolled-back · **exactly 1** eligible F.5 row (values byte-identical to 2C.2E) · 22/22 checksums match · 105 FK columns · **0** non-ledger rows across all 49 tables |
| 15.5 | v1 / v2 untouched | table / FK-column / ledger-row counts | v1 49/55/6, v2 24/42/6 — **identical to the recorded values** |
| 15.6 | No production database writes | Command log for the part: `git`, `stat`, `sha256sum`, `python3`, `docker inspect/start/exec`, `mariadb` **read-only SELECT/SHOW only** | **No write of any kind** to 3306, 3307, v1, v2, v3 (no `INSERT/UPDATE/DELETE/DDL`), no volume or container removal |
| 15.7 | No migration commands | No `prisma` binary was invoked in this part (no `migrate deploy/dev/status/resolve`, no `db push`, no `generate`) | **none executed** |
| 15.8 | No commit / push / deploy | `git add/commit/push/merge/reset/restore/stash` | **none executed**; `git status` identical before/after |
| 15.9 | Secret hygiene | All env values searched across the 42 manifest files; `.env.test.example` shape scan | clean (§12.4) — no credential in any file; nothing secret printed to the transcript |
| 15.10 | Regression claims | — | **No full regression is claimed.** No test was run in Part II; the 111/78/F-2 counts remain the **2C.5 historical baseline** only (see §0.3), and the only *new* evidence in this part is the read-only v3/container verification above |
| 15.11 | Second-pass re-verification (§11.5) | All read-only measurements re-run after the session restart: container identity, server identity, 49 tables, collation distribution, 22 ledger rows, the single F.5 row, 22/22 checksum reconciliation, 105 FK, 0 residual rows, v1/v2, git status/diff-check, statement-preservation | ✅ **every value identical** to §11.3/§11.4; container **not** restarted (`StartedAt` identical, `RestartCount=0`) |

## 16. Remaining UNKNOWNs after Part II

| ID | Status | Note |
|---|---|---|
| U1 | **OPEN** | Deployed/production DB identity and whether any deployment actually runs `migrate deploy` (A1 was approved as *read-only operator* verification, which cannot be performed from this workspace without the VPS config) |
| U2 | **OPEN** | Production ledger contents/checksums (§13.2 E3/E4 closes it in-window) |
| U3 | **OPEN** | Production collation distribution (§13.6 closes it at deploy time) |
| U4 | **OPEN** | Whether mixed collations actually raise 1267 on 3306 (probe in §14.4) |
| U5 | **OPEN** | Which historical mechanism created the five `uca1400_ai_ci` tables on 3306 |
| U6 | **PARTIALLY REDUCED** | `migrate deploy`'s silent behaviour on an existing DB is proven by CLI code (§2.4) but still not **executed** here; §13.2 E6 is the sanctioned way to observe it (a no-op run on a fully migrated DB) |
| U7 | **OPEN** | Whether a future Prisma upgrade starts validating checksums on deploy |
| U8 | **OPEN** | The 5 pre-existing `finished_at IS NULL` retry rows on the shared host and their production equivalents |
| **U9 (new)** | **OBSERVED** | The v3 test container was stopped by something **outside** this programme at `2026-10-14T10:06:31Z` (clean exit 0). It is running again, but the cause of the earlier stop is not recorded anywhere in this workspace — if it happens again mid-regression, 2C.8 must re-check container state before each suite |
| **U10 (new)** | **DIAGNOSED, NOT FIXED** | The test container's Docker healthcheck (`mysqladmin ping -h localhost`) exits **127** because the image provides `mariadb-admin` only → the container is permanently reported `unhealthy` although MariaDB serves correctly (§11.2). Any readiness gate must use TCP/`mariadb-admin ping`, never Docker health. A fix requires recreating the container — **forbidden under A6**, so it needs a separately approved infrastructure step |

## 17. Required next approvals

1. **C1 commit authorisation** (the minimal, statement-preserving F-7 patch, 4 files) — **without it no environment can be provisioned from `HEAD`.** *(A3 explicitly withheld this.)*
2. **Which of the proposed commits C2–C4 are in scope** for the release, and whether `.env.example` / the pre-programme `HERMES-*` and `INVENTORY-DESIGN-REVIEW.md` files are ever to be committed (currently **HELD**).
3. **A4 execution:** authorisation to run the committed-tree replay on a disposable database (the procedure in §13.3, on the now-available 3308 container).
4. **Any real deployment:** requires §13.1–§13.4 to be executed by the operator on the actual environment first, with the §6 checklist completed.
5. **STEP 2C.7–2C.9** remain NOT STARTED and must not begin automatically (A7).

## 18. Part II STOP gate

**Part II is complete and stops here.** Everything in §11 is read-only evidence; §12 is a **proposal** (nothing staged);
§13/§14 are procedures and decisions, not executed actions. **No commit, no push, no deploy, no migration command, no
DDL, no ledger write, and no STEP 2C.7 start.** The next action requires one of the approvals in §17.
