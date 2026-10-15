# STEP 2C.6 — A4 PRE-EXECUTION READINESS (committed-tree migration replay)

**Subphase of 2C.6 · mode: READ-ONLY PREPARATION · A4 NOT EXECUTED · NO DATABASE CONTACT · AP-C4 ≠ AP-3**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| Branch | `main` |
| **Committed HEAD** | **`eb313bb13d2670b45a2aeb73a7b370d554931321`** (C4) |
| Closed boundaries | C1 `350afec` · C1B `cd3d849` · C2 `7dc2496` · C3 `4550d28` · C4 `eb313bb` — never amended |
| Index / stash | **empty / empty** · `git diff --check` **exit 0** |
| Static evidence | `npm run db:preflight` **PASS exit 0** · independent checksum verification **22/22, 0 mismatch** |
| Verdict | ⚠️ **A4 READY TO EXECUTE — NOT EXECUTED. Awaiting AP-3.** |

> **Scope of this document.** Preparation and evidence only. **No** database contact of any kind (no client, no `SELECT`,
> no `CREATE DATABASE`, no `migrate deploy`, no `migrate status`), no container operation, no migration file edit, no commit,
> no push, no deployment, no STEP 2C.7. A4 is a **replay of the committed migration chain onto a new disposable target**;
> it is **not** authorised by AP-C4.

---

## 1. Current committed state `[Measured]`

```
HEAD        eb313bb13d2670b45a2aeb73a7b370d554931321
log          eb313bb docs(accounting): consolidate hardening evidence and roadmap   (C4)
             4550d28 test(accounting): add isolated accounting regression coverage  (C3)
             7dc2496 feat(accounting): correct F-2 credential parsing and canonical revenue predicates (C2)
             cd3d849 chore(migrations): add fail-closed migration preflight guard    (C1B)
             350afec fix(migrations): correct historical F7 dependency ordering      (C1)
             e8d4aa3 fix selesai orderan
index/stash  0 / 0        git diff --check  exit 0
worktree     8 entries = 6 HELD + 2 EXCLUDE (no source/test/migration/schema dirty)
```

The **committed tree** is the replay source: `prisma/migrations/**` is byte-identical to what the ledger of a fresh replay
must record (the C1 F-7 relocation is committed, so provisioning from `HEAD` no longer fails at migration 6/11).

---

## 2. Migration preflight evidence `[Measured]`

```
$ npm run db:preflight
[preflight] project root : /home/reksa/restorant-cafe
[preflight] migrations   : …/prisma/migrations
[preflight] baseline     : …/tools/migration-order.baseline.json
[preflight] runtime      : node v24.21.0, icu 78.3, locale en-US, smallIcu false
[preflight] prisma       : installed 7.10.0, baseline 7.10.0
[preflight] migrations   : 22 on disk, 22 in baseline
[preflight] PASS — effective order matches the baseline and every checksum is identical.
PREFLIGHT_EXIT=0
```

The guard is **static and fail-closed** (`tools/preflight-migrations.mjs`): no database, no ledger, no SQL — only `node:`
built-ins. `db:deploy` = `preflight && prisma migrate deploy`, so a failing preflight blocks **before** any DDL.
F8 hard-fails a Prisma version mismatch; there is **no bypass flag**; `--update` is explicit and never automatic.

---

## 3. 22/22 migration checksum + order verification `[Measured]`

Independent re-verification (not the guard — a separate `sha256` pass over every `migration.sql` vs the baseline):

```
checksums ok=22  mismatch=0  missing=0
on_disk_dirs=22  baseline_order=22
order_matches_on_disk=true      (localeCompare order ≡ baseline order, the order Prisma actually applies)
```

Baseline shape: `schemaVersion=1`, `prismaVersion=7.10.0`, `order=22`, `checksums=22`.
The C1 (F-7) files as **committed** hash to the values already recorded in the v3 ledger:
`97ee89d5…` (`…_branch_multi_cabang`) · `019b42ed…` (`20260909_add_customer_auth_promo`) ·
`fac529c7…` (`…_add_ingredient_purchasing_wac`) · `47365a5c…` (`20260911140000_add_purchasing_inventory_foundation`).
(`20260911_add_ingredient_f1` = `003d7699…` is a **different**, untouched file.)

### 3.1 Expected apply order (must appear verbatim)

```
 1 0000_init_schema                                  12 20260911_add_recipe_bom
 2 20260904_add_qris_payment_fields                  13 20260911120000_add_promousage_branch_id
 3 20260904155600_add_rbac_shifts_approvals          14 20260911130000_add_stock_branchproduct
 4 20260907_hardening_session_payment                15 20260911140000_add_purchasing_inventory_foundation
 5 20260908_add_restaurant_branding                  16 20260911143644_f5_order_item_cost_snapshot
 6 20260908030144_add_branch_multi_cabang            17 20260912_add_branchproduct_costing_mode
 7 20260908040000_table_unique_per_branch            18 20260913_add_addon_option_bom
 8 20260909_add_customer_auth_promo                  19 20260913_add_refund_item_allocation
 9 20260910_add_product_recommendations              20 20260915_add_reservation
10 20260911_add_ingredient_f1                        21 20260920_add_floor_layout
11 20260911_add_ingredient_purchasing_wac           22 20261009_add_expense_management
```

This matches the order **empirically observed** in the 2C.2E rehearsal (`ACCOUNTING-INTEGRATION-TEST-PLAN.md` §26.5) for
all 22 positions, including the two that previously failed with `P3018`/errno 1146 (steps 6 and 11).

---

## 4. Target identity requirements `[Measured]` / `[Policy]`

A4 may touch **one new disposable database on the existing 3308 container** and nothing else.

| Requirement | Value / rule |
|---|---|
| Container | `restaurant-mariadb-test`, image `mariadb:11.8`, `127.0.0.1:3308->3306/tcp`, `RestartCount=0`, volume `restaurant-mariadb-test_data` |
| New database | `restaurant_app_test_v4` — **must not already exist** (`SHOW DATABASES` guard) |
| Charset/collation | `CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci` (mirrors the 3306 default; keeps F-8 from confounding the comparison) |
| New user | `restaurant_test_v4@%` (new only), `GRANT ALL` on that database only — never on `*.*` |
| Credential location | gitignored `.env.test` as an inert line only; **never** on argv, never printed, never read by `tests/setup.ts` |
| Identity assertions before any DDL | live `DATABASE()='restaurant_app_test_v4'`, `USER()` starts with `restaurant_test_v4@`, `VERSION()` matches MariaDB `11.8.9` |
| **PROTECTED — never contacted** | `127.0.0.1:3306/restaurant_app` (host app DB), `127.0.0.1:3307` (sibling project), v1 `restaurant_app_test`, v2 `restaurant_app_test_v2`, v3 `restaurant_app_test_v3` (evidence database) |
| Forbidden operations | `migrate dev`, `migrate reset`, `db push`, `migrate resolve`, any ledger `UPDATE`/hand-written row, any `DROP`/`ALTER` outside the new v4 database, container recreate, volume deletion/rename |

**Risk R-1 (must be neutralised by the guard):** `prisma.config.ts` → `env("DATABASE_URL")` points at **3306** when nothing
is overridden, so a bare `npx prisma migrate deploy` from the repo root would hit the **protected host database**. Every
A4 command therefore carries an **explicit** override, and the guard refuses to spawn Prisma unless the resolved target is
exactly `127.0.0.1:3308/restaurant_app_test_v4`.

---

## 5. Exact replay commands (to be run only under AP-3)

Precedent: 2C.2E §26.4 used a guard script (`/tmp/c2c2e-replay.mjs`) that re-asserted scheme/host/port/database before
spawning Prisma, injected `DATABASE_URL` into the **child environment** (never argv) and stripped `TEST_DATABASE_URL` so the
test suites' pin could not interfere. A4 repeats that shape, one step at a time, with each step's output captured.

All shell steps run from the repo root; every SQL step runs against **`127.0.0.1:3308` only**, as an admin credential of the
**test** container (the application credential must never be used for DDL). `DATABASE_URL` is always injected into the
**child environment**, never into argv.

```bash
# --- S0. static pre-gates (no DB) -------------------------------------------------
cd /home/reksa/restorant-cafe
git rev-parse HEAD                      # expect eb313bb13d2670b45a2aeb73a7b370d554931321
git status --porcelain                  # expect only the HELD/EXCLUDE + post-C4 doc entries
git diff --cached --name-only | wc -l    # expect 0
npm run db:preflight                     # expect PASS 22/22, exit 0

# --- S1. container + target guards (read-only) -------------------------------------
docker ps -a --filter name=restaurant-mariadb-test \
  --format '{{.Names}} | {{.Image}} | {{.Status}} | {{.Ports}}'   # expect mariadb:11.8, 127.0.0.1:3308->3306

# --- S1b. v4 must be ABSENT — this needs a SERVER-level admin connection with NO default
#          database. Do NOT point it at v4 (it does not exist yet): a client that tries to
#          select the missing database aborts with "Unknown database".
#          Run with the container's admin credential, never on argv:
#              SHOW DATABASES LIKE 'restaurant_app_test_v4';        -- expect 0 rows

# --- S2b. identity probe, AFTER the database exists (S2) and BEFORE the replay (S3) ---
# scripts/prisma-diag.mjs takes NO arguments: it reads DATABASE_URL from the environment
# (dotenv never overrides an already-set variable), prints a MASKED target and runs a
# read-only SELECT DATABASE()/SHOW TABLES plus two model reads. It performs no writes,
# and its model reads fail harmlessly (caught) against the still-empty schema.
DATABASE_URL=<v4 url> node scripts/prisma-diag.mjs
#   assert: masked target = 127.0.0.1:3308/restaurant_app_test_v4
#   assert: the SELECT DATABASE() line returns restaurant_app_test_v4  → gate G5 PASS

# --- S3. guarded replay FROM THE COMMITTED TREE -------------------------------------
DATABASE_URL=<v4 url> npx prisma migrate deploy     # DATABASE_URL in the CHILD ENV, never in argv
#   guard aborts unless the resolved target is exactly 127.0.0.1:3308/restaurant_app_test_v4
#   expected stderr/stdout includes:  Datasource "db": MySQL database "restaurant_app_test_v4" at "127.0.0.1:3308"
#                                     22 migrations found in prisma/migrations
#                                     All migrations have been successfully applied.
```

```sql
-- --- S2. create the disposable target (the ONLY writes in A4) ---------------------
CREATE DATABASE `restaurant_app_test_v4` CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci;
CREATE USER 'restaurant_test_v4'@'%' IDENTIFIED BY '<32-byte random hex>';
GRANT ALL PRIVILEGES ON `restaurant_app_test_v4`.* TO 'restaurant_test_v4'@'%';
FLUSH PRIVILEGES;
--   credential appended to the gitignored .env.test as an inert DISPOSABLE_TEST_V4_URL line

-- --- S4. post-replay verification (read-only on v4) --------------------------------
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='restaurant_app_test_v4';   -- expect 49
SELECT COUNT(*) AS total,
       SUM(finished_at IS NOT NULL) AS finished,
       SUM(finished_at IS NULL AND rolled_back_at IS NULL) AS unfinished
  FROM `restaurant_app_test_v4`.`_prisma_migrations`;                                         -- expect 22 / 22 / 0
SELECT migration_name, checksum FROM `restaurant_app_test_v4`.`_prisma_migrations` ORDER BY started_at;
SHOW TABLES FROM `restaurant_app_test_v4`;                                                    -- expect the 49 expected names
SELECT COUNT(*) FROM `restaurant_app_test_v4`.`<business table>`;                             -- 0 rows each (repeat per table)
```

Order is mandatory: **S1 → S1b (v4 absent) → S2 (create) → S2b (identity) → S3 (replay) → S4 (verify)**. The ledger
checksums printed by the S4 `SELECT` are compared against the on-disk `sha256` values from §3 — a fresh replay must show
**22/22**, not the 18/4 drift of a pre-F-7 environment.

The replay must be executed **one command at a time**, each with its **real exit code** captured (`set -o pipefail`; a
filtered summary never counts as a pass).

---

## 6. Safety gates (all must hold before S3; any failure = STOP)

| # | Gate | Expected |
|---|---|---|
| G1 | Committed tree clean, HEAD `eb313bb…`, index 0, stash 0 | exact |
| G2 | `npm run db:preflight` | **PASS 22/22, exit 0** |
| G3 | Independent checksum/order verification | **22/22 ok, order ≡ baseline** |
| G4 | Container identity (image/port/volume/RestartCount) | `mariadb:11.8`, `3308→3306`, `RestartCount=0` |
| G5 | v4 absent; active user = `restaurant_test_v4@…`; live `DATABASE()` = v4 | exact |
| G6 | 3306/3307 never addressed; no bare Prisma CLI invocation | asserted by the guard |
| G7 | No `migrate dev` / `reset` / `db push` / `resolve` / ledger write | asserted before S3 |

**STOP conditions:** any gate fails · the guard resolves a target other than v4 · v4 already exists · Prisma reports a
version different from `7.10.0` · a migration fails (`P3018`/errno 1146) · table count ≠ 49 · ledger ≠ 22/22/0 · any
3306/3307 contact · any unexpected write outside v4.

---

## 7. Expected outputs `[Policy]`

```
S3  migrate deploy exit code = 0
    22 migrations found in prisma/migrations
    All migrations have been successfully applied.
S4  49 tables · ledger 22 rows (22 finished, 0 unfinished, 0 rolled-back)
    the F.5 row `20260911143644_f5_order_item_cost_snapshot` present exactly once
    ledger checksums ≡ on-disk sha256 for all 22 (a fresh DB must show NO drift, unlike a pre-F-7 environment: 18/4)
    0 business rows in every business table
```

Deliberate non-claim: a fresh `migrate deploy` records F.5 with the **apply time (now)**, not production's literal
`2026-09-11T16:06:57.831Z` — that cutoff difference is a **known, documented** characteristic, not a defect
(archive §24/§28). `migrate deploy exit 0` is **not** by itself proof of schema compatibility: the structural comparison in
S4 is the proof.

---

## 8. Cleanup / recovery plan `[Policy]`

| Step | Action |
|---|---|
| C1 | Post-A4, leave `restaurant_app_test_v4` in place as **read-only evidence** (same treatment as v1/v2). Dropping it is an owner decision. |
| C2 | Do **not** drop the `restaurant_test_v4` user without an explicit instruction; if dropped, revoke on that database only. |
| C3 | Leave the `.env.test` v4 line inert; never make it the active `TEST_DATABASE_URL` (that stays v3). |
| C4 | Container: **no recreate, no volume operation, no prune**. If the owner wants the pre-programme state restored, `docker stop restaurant-mariadb-test` (it was `Exited(0)` before the C3 run) — never `rm`. |
| C5 | On any failure: **stop**, capture the exact error + exit code, leave the partial v4 in place for forensics, and report. Recovery for a partial schema is `DROP DATABASE restaurant_app_test_v4` **plus** a fresh re-creation — **never** `migrate resolve` and never a hand-written ledger row. |

---

## 9. Rollback considerations `[Policy]`

* **Blast radius is a single new database.** No existing database, table, row or ledger entry is read-modify-written; v1,
  v2 and v3 are untouched, and 3306/3307 are never contacted. Therefore "rollback" = drop the disposable v4 database and
  its user; there is nothing else to undo.
* **No repository rollback is needed:** A4 writes **no** file in the repo except (optionally) an inert, gitignored
  `.env.test` line. A closed boundary (C1–C4) is never amended.
* **Not reversible-by-design (acceptable):** a fresh replay's F.5 apply timestamp differs from production's literal — this
  affects only the new disposable database's metadata, never production.
* **Do not** "fix" a failed replay by `migrate resolve`, ledger `UPDATE`, `migrate reset`, or `db push`.

---

## 10. Known environment issue — broken container healthcheck `[Measured]`

```
restaurant-mariadb-test | mariadb:11.8 | Up 57 minutes (unhealthy) | 127.0.0.1:3308->3306/tcp
RestartCount=0  Health=unhealthy  Volume=restaurant-mariadb-test_data
```

Docker reports **unhealthy** because the image's healthcheck calls `mysqladmin`, **which the image does not ship**
(`/bin/sh: 1: mysqladmin: not found`, exit **127**). This is a **broken healthcheck definition, not a database fault**:
identity PASS, 49 tables, 22/22 ledger rows and every connecting suite are green. Per directive it is **not repaired** in
this programme; A4 therefore uses **TCP readiness + live identity assertions** as its readiness evidence instead of the
healthcheck flag.

---

## 11. STOP

**A4 readiness is complete; A4 was NOT executed.** No database was contacted, no migration was run, no container was
operated, nothing was pushed, and STEP 2C.7 was not started.

**Next approval gate: AP-3** — authorise the A4 replay on the new disposable target `restaurant_app_test_v4`
(§4–§7). AP-C4 does **not** imply AP-3.
