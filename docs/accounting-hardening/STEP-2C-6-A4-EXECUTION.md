# STEP 2C.6 — A4 COMMITTED-TREE REPLAY — EXECUTION

**Subphase of 2C.6 · mode: AUTHORISED EXECUTION (AP-3 CONDITIONAL) · ONE NEW DISPOSABLE DATABASE · NO PUSH / NO COMMIT / NO 2C.7**

| | |
|---|---|
| Date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD (before **and** after) | `eb313bb13d2670b45a2aeb73a7b370d554931321` (C4) — unchanged |
| Branch / index / stash | `main` · **0** · **0** |
| Inputs | `STEP-2C-6-A4-PRE-EXECUTION-READINESS.md` (§4–§9), `ROADMAP.md`, `EXECUTION-STATE.md` |
| Target | **`restaurant_app_test_v4`** on `restaurant-mariadb-test` (`127.0.0.1:3308`), `utf8mb4_uca1400_ai_ci` |
| Verdict | ✅ **A4 COMMITTED-TREE REPLAY SUCCESS — STEP 2C.6 EXECUTION COMPLETE** |

---

## 1. Pre-execution gates `[Measured]`

| # | Gate | Expected | **Actual** | Result |
|---|---|---|---|---|
| G1 | HEAD · index · stash | `eb313bb…` / 0 / 0 | `eb313bb13d2670b45a2aeb73a7b370d554931321` / 0 / 0 | ✅ |
| G2 | `npm run db:preflight` | PASS 22/22, exit 0 | 22 on disk / 22 in baseline, **exit 0** | ✅ |
| G3 | Independent checksums + order | 22/22, order ≡ baseline | **22/22, 0 mismatch, order identical** | ✅ |
| G4 | Container identity | `mariadb:11.8`, `3308→3306` | `mariadb:11.8`, `127.0.0.1:3308->3306/tcp`, `RestartCount=0`, volume `restaurant-mariadb-test_data` | ✅ |
| G5 | v4 absent → then identity | 0 rows → exact | `v4_absent` **0 rows**; after S2: `DATABASE()=restaurant_app_test_v4`, `USER()=restaurant_test_v4@172.18.0.1`, `VERSION()=11.8.9-MariaDB` | ✅ |
| G6 | 3306/3307 never addressed | asserted by guard | guard `D8_NO_PROTECTED_PORT=true`, `D9_NOT_PROTECTED_DB=true` | ✅ |
| G7 | No `dev`/`reset`/`push`/`resolve`/ledger write | asserted | only `prisma migrate deploy` invoked; no ledger write by hand | ✅ |

Server-level console: `11.8.9-MariaDB-ubu2404`, host `bae65d9fc587`, `PORT=3306` (in-container), databases before S2 =
`restaurant_app_test` · `restaurant_app_test_v2` · `restaurant_app_test_v3` (**v4 absent**). v3 baseline at gate time:
**49** tables, ledger **22 / 22 finished / 0 unfinished**.

## 2. Credential safety `[Measured]`

* Admin access used only the container's **own** `MYSQL_ROOT_PASSWORD` via `MYSQL_PWD` **inside** the container
  (`docker exec … sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mariadb -u root'`) — password never on argv, never printed,
  never read on the host.
* New account `restaurant_test_v4@%` with a `openssl rand -hex 32` credential (64 hex chars, **value never printed**);
  injected into children as `DATABASE_URL` via the **environment**, parsed from the gitignored `.env.test`
  (`DISPOSABLE_TEST_V4_URL`) so it never appears in any command line or report.
* `GRANT ALL` scoped to `restaurant_app_test_v4`.\* only — audited: **20** schema privileges
  (`ALTER`, `ALTER ROUTINE`, `CREATE`, `CREATE ROUTINE`, `CREATE TEMPORARY TABLES`, `CREATE VIEW`, `DELETE`,
  `DELETE HISTORY`, `DROP`, `EVENT`, `EXECUTE`, `INDEX`, `INSERT`, `LOCK TABLES`, `REFERENCES`, `SELECT`,
  `SHOW CREATE ROUTINE`, `SHOW VIEW`, `TRIGGER`, `UPDATE`), **`v4_global_privs=0`**
  (no `SUPER`/`GRANT`/global `CREATE`).
* Application `.env` **untouched**; `.env.test` is gitignored (`git check-ignore` → YES) and its active
  `TEST_DATABASE_URL` still points at **v3**.

## 3. Execution — exact approved order, real exit codes `[Measured]`

| Step | Command shape | **Actual result / exit** |
|---|---|---|
| S1/S1b | container guard + server-level `SHOW DATABASES LIKE 'restaurant_app_test_v4'` | v4 absent, server `11.8.9-MariaDB`, **exit 0** |
| **S2** | `CREATE DATABASE`/`CREATE USER`/`GRANT` (SQL via **stdin**) | v4 exists, `utf8mb4_uca1400_ai_ci`, user exact 1, grants v4-only — **exit 0** |
| **S2b** | `node scripts/prisma-diag.mjs` (no argv) + live identity assertion | masked target `mysql://restaurant_test_v4:***@127.0.0.1:3308/restaurant_app_test_v4`; `DATABASE()=restaurant_app_test_v4`; **exit 0**; identity checks **4/4 PASS**; `tables_before_replay=0` |
| **S3** | `node /tmp/a4-replay-guard.mjs` → `npx prisma migrate deploy` | guard `D1_HEAD=true`, `D2_INDEX=0`, `D3_WORKTREE=12`, `D4–D9` true, `D10_PRISMA_VERSION=7.10.0` → **GUARD PASS**; `Datasource "db": MySQL database "restaurant_app_test_v4" at "127.0.0.1:3308"`, `22 migrations found`, `All migrations have been successfully applied.` → **`MIGRATE_DEPLOY_EXIT=0` / `S3_EXIT=0`** |
| **S4** | read-only verification script + container-admin read-only v3 queries | **`S4_EXIT=0`**, **8/8 checks PASS** |

Guard shape follows the 2C.2E §26.4 precedent: it re-asserts tree identity, scheme/host/port/database, protected ports,
Prisma version, then spawns Prisma with `DATABASE_URL` in the **child environment** and `TEST_DATABASE_URL` **stripped**.
**R-1 neutralised:** `prisma.config.ts` (`env("DATABASE_URL")` + `dotenv/config`, which never overrides a pre-set variable)
therefore resolved **only** the injected v4 URL — proven by the replay's own datasource banner.

## 4. Acceptance — actual results `[Measured]`

| # | Criterion | Expected | **Actual** | Result |
|---|---|---|---|---|
| A | Replay exit | 0 | **0** | ✅ |
| B | Applied migrations | 22/22 | **22/22 applied**, in frozen baseline order (`firstDiff=none`) | ✅ |
| C | Ledger | 22 finished, 0 unfinished | **22 / 22 / 0 / 0** (incl. 0 rolled-back) | ✅ |
| D | Tables | 49 | **49** base tables; set **identical** to v3 (`only_v4=[] only_v3=[]`) | ✅ |
| E | Checksum mismatch | 0 | **0** — every ledger checksum ≡ on-disk `sha256(migration.sql)` (22/22, preflight's own method) | ✅ |
| F | F.5 row | exactly once | **1** — `20260911143644_f5_order_item_cost_snapshot` | ✅ |
| G | Business rows | 0 | **0** across all **48** non-ledger tables (`nonEmpty=[]`) | ✅ |
| H | `lower_case_table_names` | 0 | **0** | ✅ |
| I | v3 modification | none | **49** tables, ledger **22/22/0**, anchors `expense/expensecategory/order/orderitem/orderitemcostsnapshot/orderstatushistory/payment/paymenttransaction/refund/refunditem` all **0 rows**, last applied still **2026-10-14 07:52:58.866** (unchanged) | ✅ |
| J | Protected 3306/3307 | never accessed | no A4 command ever referenced them (guard D8/D9 true) | ✅ |

Replay window: **08:24:31 → 08:24:36** (2026-10-15, Asia/Jakarta) — ~5 s for 22 migrations, exit 0.
Applied order 1–22 equals the baseline array positionally; F.5 sits at position **16**.

Deliberate non-claim (as pre-registered): a fresh replay stamps F.5 with the **apply time**, not production's literal
`2026-09-11T16:06:57.831Z` — a known, documented characteristic, not a defect. `exit 0` alone is not proof of schema
compatibility; the S4 structural comparison (D/E/F/G) is the proof.

## 5. Repo and environment state after A4 `[Measured]`

* **Repository untouched by A4:** HEAD still `eb313bb13d2670b45a2aeb73a7b370d554931321`, index **0** (verified by the
  guard before the replay: worktree **12** entries = 6 HELD + 2 EXCLUDE + 4 then-uncommitted post-C4 docs; **13** after
  this report was written — 5 docs). No migration SQL, Prisma schema, source, test, or guard file was
  read-modify-written; A4's only filesystem writes were this report, the two tracking-doc updates and the inert,
  gitignored `.env.test` line.
* **Container:** `restaurant-mariadb-test | mariadb:11.8 | Up About an hour (unhealthy) | 127.0.0.1:3308->3306/tcp`,
  `RestartCount=0`, volume intact. No recreate, no prune, no volume operation.
* **Schemas now:** `restaurant_app_test`, `…_v2`, `…_v3`, **`…_v4`** (new).
* **Cleanup / recovery state (§8 C1–C5 of readiness, honoured):** `restaurant_app_test_v4` **left in place as
  read-only evidence** (same treatment as v1/v2) — dropping it is an owner decision; the `restaurant_test_v4` account is
  **kept**; the `.env.test` v4 line stays **inert**; no destructive cleanup was run. A4 was a clean run, so the §8
  failure path (drop + re-create, never `migrate resolve`, never a hand-written ledger row) was **not** exercised.

## 6. Historical exceptions — recorded, not claimed as PASS `[Policy]`

1. **C4 whitespace waiver (historical exception, NOT a PASS).** `git diff --cached --check` failed at **exit 2** during
   C4 with **49 flags**, all inside two **frozen** documents (legacy archive: 48 Markdown two-space hard breaks; 2C.5
   report: 1 EOF blank line); **0** from newly authored content. The owner ruled *"waive for this class, then commit"* —
   recorded in `STEP-2C-6-C4-COMMIT-EXECUTION.md` §7.4. C1/C1B/C2/C3 all passed that gate at **exit 0**; this is **not a
   precedent**. A4 itself stages nothing, so the gate was not exercised here.
2. **Broken container healthcheck (environment limitation).** Docker reports `unhealthy` because the image's healthcheck
   calls `mysqladmin`, absent from the image (`/bin/sh: 1: mysqladmin: not found`, exit **127**). Not a database fault —
   identity, 49 tables, 22/22 ledger and every S-step succeeded. Not repaired (by directive); A4 used **TCP readiness +
   live identity assertions** instead.
3. **Post-C4 documents still uncommitted (by design).** `STEP-2C-6-C4-COMMIT-EXECUTION.md`,
   `STEP-2C-6-A4-PRE-EXECUTION-READINESS.md`, this report, and the `ROADMAP.md` / `EXECUTION-STATE.md` updates — **no
   second commit was made** and none is authorised. They need their own future approval.

## 7. STOP boundary — honoured

No `git push` · no deploy · no additional documentation commit · **STEP 2C.7 not started** · HELD/EXCLUDE untouched ·
Order/Payment/Cashier/QRIS not touched · no `migrate dev`/`reset`/`db push`/`resolve` · no `db:baseline:update` ·
no migration SQL or Prisma schema change · no modification outside `restaurant_app_test_v4`.

## 8. Verdict

**A4 COMMITTED-TREE REPLAY SUCCESS — STEP 2C.6 EXECUTION COMPLETE**

C1 `350afec` → C1B `cd3d849` → C2 `7dc2496` → C3 `4550d28` → C4 `eb313bb` → **A4 replay exit 0, 22/22, 49 tables,
ledger 22/22/0, checksums 22/22, 0 business rows, v3 unmodified, 3306/3307 never contacted.**

**Next:** the FINAL STEP 2C.6 REPORT (C1–C4 + A4) and a single follow-up documentation commit for the uncommitted
post-C4 reports — each requiring its **own** approval. Next gate remains **AP-3 closed / AP-FINAL open**; STEP 2C.7 is
**not** started.
