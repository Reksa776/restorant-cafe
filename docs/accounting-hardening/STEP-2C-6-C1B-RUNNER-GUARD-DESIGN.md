# STEP 2C.6-C1B — MIGRATION RUNNER SAFETY GUARD (DESIGN)

**Subphase of 2C.6 · mode: AUDIT + DESIGN PROPOSAL ONLY · no implementation · C1 COMMIT REMAINS ON HOLD**

| | |
|---|---|
| Audit date | 2026-10-15 |
| Repository | `/home/reksa/restorant-cafe` |
| HEAD | `e8d4aa3d309f96239d4a96ca6ce818ee0fa1a3a0` |
| Branch | `main` |
| Prisma (installed) | `prisma` **7.10.0**, `@prisma/client` **7.10.0** |
| Node runtime (this host) | `v24.21.0`, `v8_enable_i18n_support=1`, `icu_small=false` → **full ICU**, ICU **78.3**, Unicode **17.0** |
| Default ICU locale | `en-US` (`LANG=en_US.UTF-8`, `LC_ALL`/`LC_COLLATE` unset) |
| Baseline reused | `STEP-2C-6-C1A-MIGRATION-ORDERING-AUDIT.md` (findings only; not re-audited) |
| Deliverable | a **design**; **no file was created or changed except this report and the ROADMAP line** |

> **Scope discipline (this phase).** Static inspection and read-only checks only. **No** guard script was written,
> **no** production source, `package.json`, README, migration SQL or migration directory name was changed, **no**
> new migration, **no** `prisma migrate dev|deploy|resolve|db push`, **no** replay, **no** ledger write, **no**
> database contact of any kind, and **no** `git add/commit/push/reset/restore/stash/merge/rebase/deploy`.
> STEP 2C.7 was **not** started. The only writes are this report and the ROADMAP status line.

**Evidence classes** (nothing is asserted above its class):

| Class | Meaning |
|---|---|
| `[Measured]` | Read first-hand on this host in this phase (node, git, filesystem) |
| `[Code]` | Read first-hand from the repository's executable/configuration files |
| `[Recorded]` | Carried from `STEP-2C-6-C1A` (not re-measured here) |
| `[Proposed]` | A design decision of this phase — **not implemented, not authorised** |
| `[Inferred]` | Follows from the evidence but is not itself observed |
| `[UNKNOWN]` | Not determinable here |

---

## 1. Root cause

`[Recorded]` C1A established the mechanism and the exposure; this phase does not re-audit them. In one paragraph:

**Prisma 7.10.0 decides migration apply order in the CLI, not in the repository, and not by file name bytes.**
`node_modules/prisma/build/cli.js` loads the migration directories and sorts them with
`u.sort((p, f) => p.path.localeCompare(f.path))` — JavaScript `String.prototype.localeCompare`, i.e. **ICU/CLDR
collation of the runtime that invokes the CLI** — then hands that already-ordered list to
`engine.applyMigrations({ migrationsList })`. The engine is not the sorter.

Two properties of *this* chain turn that into a provisioning hazard:

1. `[Recorded]` The 22 directories mix **two prefix widths** — 8-digit (`20260911_add_ingredient_f1`) and
   14-digit (`20260911140000_add_purchasing_inventory_foundation`). CLDR gives `_` a **lower** primary weight
   than a digit; byte comparison gives it a **higher** one (`'1'` = 0x31 < `'_'` = 0x5F). The two blocks
   therefore **swap order** between the two comparisons — **12 of 22 positions differ** between the effective
   (ICU) order and a plain byte sort.
2. `[Recorded]` The chain carries a **cross-migration DDL dependency**: `CREATE TABLE purchaseingredient`
   (now in `20260911140000_add_purchasing_inventory_foundation`) declares
   `FOREIGN KEY (ingredientId) REFERENCES ingredient`, and `ingredient` is created by a **different**
   migration, `20260911_add_ingredient_f1`. That FK is satisfied **only** under the ICU order.
   `[Recorded]` Under byte order the fixed tree still has **1** forward reference
   (`20260911140000 → ingredient`) → `P3018` / errno **1146**.

**Consequence.** Fresh-provisioning correctness is currently a property of the *runtime* (ICU presence + default
locale), **not** of the source tree. A correctly-built tree can be applied in an order that fails, with no
repository-side signal. The F-7 repair (C1) removes two *instances* of the enabling condition but does **not**
remove the condition. **A silent failure is the risk this design removes.**

**Why the existing runtime is (probably) safe here, and why that is not enough** `[Measured]`: this host runs a
**full-ICU** Node (`icu_small=false`, `v8_enable_i18n_support=1`), so `localeCompare` is ICU/CLDR-aware and the
effective order is the audited one. But nothing in the repository asserts that. `package.json` pins only
`engines.node >=20.9.0` — which does **not** pin the ICU mode (official Node ships full-ICU, but `small-icu` and
`--with-intl=none` builds exist, and `small-icu` still exposes only `en-US`; a `none` build degrades
`localeCompare` to code-unit comparison). `[Inferred]` Only a **no-ICU** runtime changes this chain's order; for
these ASCII names every tested locale agrees (`[Recorded]` C1A §2.4, 6 locales). So the guard's job is narrow but
essential: **detect a runtime whose collation cannot reproduce the audited order, before a migration runs.**

---

## 2. Proposed architecture `[Proposed]`

**A single, static, fail-closed preflight gate that runs *before* `prisma migrate deploy`, plus a versioned
baseline manifest that freezes the audited order and the audited file hashes.**

```
                ┌──────────────────────────────────────────────────────────┐
                │  prisma/migrations/*  (22 dirs, unchanged, frozen)       │
                └───────────────┬──────────────────────────────────────────┘
                                │ readdir + sort(localeCompare)   ← same 1-line comparator the CLI uses
                                ▼
   tools/migration-order.baseline.json ──►  tools/preflight-migrations.mjs
   (order[22] + sha256[22] + prismaVersion     (pure Node, no DB, no engine, no SQL)
    + node/ICU metadata; version-controlled)          │
                                                      ├─ PASS  → exit 0 → caller may run `prisma migrate deploy`
                                                      └─ FAIL  → exit ≠ 0 → migration MUST NOT start
```

Three design commitments:

1. **Static / offline.** The gate reads a directory, sorts strings, hashes files and compares JSON. It opens **no
   database connection**, reads **no ledger**, executes **no SQL** and shells out to **no** Prisma command.
   `[Proposed]` It can therefore run in CI, on a build box, or on the VPS *before any credential is used*.
2. **No duplicated migration engine.** The gate never applies, diffs or records migrations. It reproduces **only
   the one comparator line** that C1A proved is *the* ordering decision — nothing else of the migrator. All DDL,
   ledger writes and checksum bookkeeping stay inside Prisma.
3. **Fail-closed by default, with no silent bypass.** A mismatch stops the run. There is no `--force` in v1; an
   emergency path exists only as a **documented, explicit, separately-approved** flag (§5).

**Why "preflight script" is sufficient (task item 1).** `[Proposed]` Yes — because the failure being guarded is
*entirely decidable statically*: it is a function of (a) the runtime's collation behaviour and (b) the directory
names. Both are knowable before the first byte touches a database. No runtime interception, no engine patch, no
Prisma-internal change is needed. The only thing a preflight cannot do is *repair* an order-drifted runtime —
which is exactly why the correct action is to **refuse**, not to continue.

**Scope of the manifest (explicit).** The manifest freezes the **repository** state on purpose: it is the
committed expectation of order + content. It is deliberately **not** derived from a database, so it cannot be
satisfied by a stale ledger and cannot hide a repository-side edit.

---

## 3. Exact files that would need to be created / changed (later phase) `[Proposed]`

Nothing below was created or modified in this phase.

| # | Path | Action | Purpose |
|---|---|---|---|
| 1 | `tools/preflight-migrations.mjs` | **create** | The guard. Plain Node ESM (`.mjs`), imports only `node:fs`, `node:path`, `node:crypto`. No new dependency, no TS loader, runnable by `node` on any deployment host. |
| 2 | `tools/migration-order.baseline.json` | **create** | Versioned baseline: `schemaVersion`, `prismaVersion`, `nodeMajor`, `icu` metadata, `order[22]`, `checksums{}`, optional `capturedAt`. Holds **all 22** checksums (not just F-7's four). |
| 3 | `package.json` | **change** (scripts only) | Add `"db:preflight": "node tools/preflight-migrations.mjs"` and `"db:deploy": "node tools/preflight-migrations.mjs && prisma migrate deploy"`. Add `"db:baseline:update": "node tools/preflight-migrations.mjs --update"`. **`db:migrate` and `db:push` keep their present meaning.** |
| 4 | `README.md` | **change** (docs) | Add the guard to the Production (VPS) / migration section: `npm run db:deploy` is the only approved provisioning path; the preflight must pass first. |
| 5 | `tests/migration-ordering.unit.test.ts` | **create** | DB-free unit tests over fixture directory trees (§6), following the repo's `tsx --test` convention. |
| 6 | `.gitignore` | **change — only if** the team insists on `scripts/` | `[Measured]` `/scripts/*` (`.gitignore` line 18) ignores **new files and subdirectories** under `scripts/`. To keep the guard inside `scripts/`, an explicit negation (`!/scripts/preflight-migrations.mjs`) is required. **Preferred: avoid this and use `tools/`, which is not ignored.** |
| 7 | `docs/accounting-hardening/ROADMAP.md` | **change** (this phase only) | Status + blocker + link (done). |
| 8 | CI config (no CI exists here) | **change — if/when CI is added** | Run `db:preflight` on every PR that touches `prisma/migrations/**`. `[Measured]` No CI/CD or pipeline file exists in this repo, so this is a documented manual gate for now. |

**Explicitly NOT touched:** `prisma/schema.prisma`, any `prisma/migrations/**` SQL or directory name,
`src/lib/prisma.ts`, `prisma/seed.ts`, `prisma.config.ts`, and Node's/Prisma's internals.

**Why `tools/` and not `scripts/`** `[Measured]`: `git check-ignore -v scripts/x.mjs` → ignored by `.gitignore:18`;
`git check-ignore -v tools/x.mjs` → not ignored; `scripts/sub/x.mjs` is ignored as a whole directory too. A guard
that cannot be committed is useless, so the guard goes in a **new tracked** `tools/` directory. This is a real,
measured foot-gun that a naive implementation would hit.

---

## 4. Preflight algorithm `[Proposed]`

Deterministic, side-effect-free, exit-code based. Pseudocode (final implementation detail deferred to AP-C1B-1):

```
preflight(migrationsDir = "prisma/migrations", baselinePath = "tools/migration-order.baseline.json"):

  # 0. runtime capability canary — proves localeCompare is ICU/CLDR-aware
  assert typeof Intl === "object"
  assert "a_".localeCompare("a0") < 0                       # ICU: '_' < digit   (byte order gives > 0)
  assert "20260911_add_ingredient_f1"
           .localeCompare("20260911140000_add_purchasing_inventory_foundation") < 0   # the F-7-critical pair
  if canary fails  -> FAIL "runtime collation is not ICU/CLDR-compatible; effective order cannot be trusted"

  # 1. enumerate exactly as the CLI does (cli.js Bl(): readdir(withFileTypes) → keep directories)
  names = readdir(migrationsDir, { withFileTypes:true }).filter(isDirectory).map(name)

  # 2. reproduce the CLI's order using the SAME comparator (1 line; not a migration engine)
  effective = names.slice().sort((a, b) => a.localeCompare(b))

  # 3. load the versioned baseline
  baseline = JSON.parse(read(baselinePath))   # missing/corrupt/old schemaVersion -> FAIL

  # 4. set equality (missing / unexpected directories) -> FAIL, listing which
  # 5. ordered equality (effective vs baseline.order) -> FAIL, printing the FIRST divergence index + both windows
  # 6. per-file content equality: sha256(migrations/<n>/migration.sql) vs baseline.checksums[n] -> FAIL on mismatch
  #    (all 22 files; this is what makes an accidental edit to an *applied* migration impossible to miss)
  # 7. environment advisory (does not fail by default; AP-C1B-3 decides strict/fail):
  #    prismaVersion (from node_modules/prisma/package.json) vs baseline.prismaVersion
  #    nodeMajor + ICU metadata vs baseline
  # 8. print a one-line PASS summary (n=22, order hash, checksums ok) and exit 0

  exit 0 on PASS; exit 1 on any FAIL (never a warning-and-continue)
```

**Determinism of the ordering check (task item 3).** Two independent controls make it deterministic:

* **the canary** proves the *runtime primitive* (`localeCompare`) has the collation semantics the baseline was
  built on — it does not depend on the 22 names, so it also catches a wrong runtime on a future chain;
* **the ordered comparison** proves the *resulting list* equals the audited baseline, position by position.

`[Measured]` canary values on this host (ICU 78.3): `"a_".localeCompare("a0")` → **-1** (byte would be **+1**);
`"20260911_add_ingredient_f1".localeCompare("20260911140000_add_purchasing_inventory_foundation")` → **-1**
(byte **+1**). The canary is therefore a genuine discriminator, not a tautology.

**Consistency with the CLI `[Proposed risk control]`.** The comparator is copied, not called, because the CLI's
loader (`Bl`) is **not exported**. To bound that risk, the baseline records `prismaVersion` (step 7): any Prisma
change that could alter the loader surfaces as a baseline mismatch and forces a re-verification, rather than
silently drifting. `[Recorded]` This is the same mechanism C1A relied on, kept under version control.

**Baseline lifecycle `[Proposed]`.** `tools/migration-order.baseline.json` is updated **only** by
`--update`, which regenerates it from the tree, and the regenerated file is reviewed like a lockfile in the same
PR that adds/edits a migration. Adding a migration without updating the baseline makes `db:preflight` fail — by
design (fail-closed), and the failure message names the exact remedy.

---

## 5. Fail-closed conditions `[Proposed]`

The guard exits non-zero (and the deploy path stops) on **any** of:

| # | Condition | Rationale |
|---|---|---|
| F1 | ICU canary fails (no ICU / code-unit `localeCompare`) | The runtime cannot reproduce the audited order; provisioning may break at `20260911_add_ingredient_f1`/`20260911140000` |
| F2 | Effective order ≠ `baseline.order` (any position) | Unknown order = unknown schema; refuse before any DDL |
| F3 | A migration directory present on disk is **missing** from the baseline | New/untracked migration with unverified order/content |
| F4 | A baseline migration directory is **missing on disk** | Deleted/renamed migration → ledger/schema divergence |
| F5 | Any `sha256(migration.sql)` ≠ baseline checksum | An effective, applied migration was edited (comments/newline included) — the C1A §6.1 hazard |
| F6 | `baseline.json` missing, unparseable, or `schemaVersion` unknown | The gate cannot make a claim; fail closed, not open |
| F7 | `prisma/migrations` unreadable / zero migration directories | Nothing to provision; a "success" would be meaningless |
| F8 | *(policy, AP-C1B-3)* Prisma version differs from `baseline.prismaVersion` | The comparator is version-coupled; re-verify before trusting |

**Bypass policy `[Proposed]`.** v1 ships **no** bypass flag. If an emergency path is required, it must be a
single explicit flag **plus** an explicit environment acknowledgment, print a loud banner, be recorded in the
release log, and be **normatively prohibited for fresh provisioning**. `[Proposed]` The safe default is that a
failed preflight means "use a compliant runtime or fix the tree", never "press on".

**What the guard deliberately does NOT check** (kept out to avoid duplicating the engine): ledger state,
pending-migration count, drift, checksum-vs-`_prisma_migrations` (that is `migrate status`'s job), and actual SQL
result. Those remain Prisma's responsibility.

---

## 6. Test plan / test matrix `[Proposed]`

DB-free, `node:test` via `tsx` (repo convention). Fixtures are **temporary directory trees** + a **temporary
baseline JSON**, so no real migration is touched and no database is needed. The guard takes `--migrations-dir`
and `--baseline` arguments precisely to make this testable.

| # | Scenario | Fixture / injection | Expected |
|---|---|---|---|
| T1 | Happy path | real `prisma/migrations` + committed baseline | **exit 0**, PASS |
| T2 | Effective-order mismatch — reversed list | baseline.order reversed | **exit 1**, F2, prints first divergence |
| T3 | Effective-order mismatch — adjacent swap | swap `…ingredient_f1` / `…purchasing_inventory_foundation` | **exit 1**, F2 |
| T4 | Missing migration on disk | drop one dir from fixture | **exit 1**, F4 |
| T5 | Unexpected migration on disk | add `20990101_extra/` | **exit 1**, F3 |
| T6 | Checksum mismatch | append one `--` comment byte to a fixture `migration.sql` | **exit 1**, F5 |
| T7 | Checksum mismatch — newline only | append a trailing `\n` | **exit 1**, F5 (pins the C1A §6.1 point) |
| T8 | **ICU/Node matrix** — full-ICU | current host Node (`icu_small=false`) | canary PASS; order ≡ baseline |
| T9 | ICU/Node matrix — small-ICU | Node built `--with-intl=small-icu` (`en-US` only) | canary PASS expected (CLDR root); **record** result |
| T10 | ICU/Node matrix — **no ICU** | Node `--with-intl=none`, **or** injected comparator = byte compare | canary **FAIL** (F1) / order mismatch (F2) — must not pass |
| T11 | ICU/Node matrix — locale env | `LANG=C LC_ALL=C` (full ICU) | still PASS (order unchanged; C1A §2.4) |
| T12 | No `DATABASE_URL` set | run with the var unset | **exit 0** — proves the gate needs no DB |
| T13 | Corrupt / missing baseline | truncated JSON / deleted file | **exit 1**, F6 |
| T14 | Empty migrations dir | empty fixture | **exit 1**, F7 |
| T15 | Prisma-version policy | baseline `prismaVersion` altered | depends on AP-C1B-3 (warn vs **exit 1**, F8) |
| T16 | Idempotence / purity | run twice; confirm no filesystem writes, no network, no DB socket | identical output, exit 0 |

**Honest limits of the matrix** `[Measured]`: `[UNKNOWN]`/not-installable here — a no-ICU Node **binary** cannot
be installed in this environment, so **T10's no-ICU arm must be driven by injecting the comparator** (or by a
`--simulate-collation=byte` test hook), and T9 likewise depends on obtaining a `small-icu` build. The real-tree
integration assertion (T1) is the one that must additionally be exercised in the **implementation** phase.

---

## 7. Compatibility impact — fresh DB vs existing DB `[Proposed]` + `[Recorded]`

**Fresh / empty database (the case the guard exists for).**
* PASS → `prisma migrate deploy` applies **22/22** in the audited order (`[Recorded]` C1A: v3 ledger order ≡
  mechanism, 22/22). No behavioural change vs today's good path.
* FAIL → the deploy **never starts**; the fresh DB is left untouched (no partial schema, no half-applied migration,
  no `_prisma_migrations` row). This is strictly better than today, where a wrong runtime fails **mid-chain** at
  `20260911140000` with `P3018` / errno 1146 and leaves a failed ledger row to clean up.
* No new dependency on DB state, credentials, or ordering of other steps. `[Proposed]`

**Existing database where all 22 are applied.**
* The guard is **static**, so it passes or fails independently of the DB. `[Proposed]`
* PASS → `prisma migrate deploy` finds nothing pending → **no DDL, no data change**; the known pre-fix 4-row
  checksum delta (`[Recorded]` C1A §8: 18 match / 4 differ) is untouched, because `deploy` does not run the
  checksum-diagnose path.
* FAIL on a fully-migrated DB (e.g. an ICU change) → it blocks a **no-op** deploy. That is fail-closed and
  deliberate. `[Proposed]` It is a *false positive in consequence, not in principle* (the runtime really cannot
  reproduce the audited order), and the remedy is a compliant runtime — **not** a bypass, and **never**
  `migrate resolve` or a ledger write.
* `[Proposed]` The guard never reads or writes `_prisma_migrations`, so existing-row drift semantics are
  completely unchanged.

**Non-migration consumers.** `[Proposed]` None: the app, worker, seed and tests do not invoke the guard; it is
only on the migration/deploy path. `db:migrate` (dev) and `db:push` keep their present behaviour.

---

## 8. Regression risk `[Proposed]`

| ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| RG-1 | Future Prisma version changes the loader (`Bl`) sort, so the copied comparator drifts from the CLI | Low | High (guard would assert a wrong baseline) | Baseline records `prismaVersion`; step 7 re-verifies on any upgrade (F8 policy, AP-C1B-3) |
| RG-2 | Baseline becomes stale when a migration is added/edited | Medium | Medium (guard fails) | `--update` flow + PR review, lockfile-style; failure message names the fix |
| RG-3 | Guard placed under gitignored `scripts/` and silently never committed | Medium (measured foot-gun) | High | Use tracked `tools/`; if `scripts/` is required, add the `.gitignore` negation (§3 item 6) |
| RG-4 | Guard blocks a legitimate emergency deploy | Low | Medium | Documented, explicit, approved bypass only; never for fresh provisioning |
| RG-5 | Guard gives false confidence about *semantic* correctness | Low | Low | Its claim is scoped: order + file identity only; ledger/schema correctness stays with Prisma + the release checks |
| RG-6 | Extra moving part in the release path | Low | Low | Zero dependencies, milliseconds, static, offline; no DB, no engine |
| RG-7 | Node/ICU on the VPS differs from the dev host | Medium | High if unguarded, Low once guarded | This is precisely what the guard detects; `[Recorded]` 2C.6 found **no** deployment automation here, so the gate is the only automated control |

---

## 9. Alternative solutions considered `[Proposed]`

| Option | Description | Assessment |
|---|---|---|
| **A — Do nothing** | Rely on the dev host having full ICU | ❌ Rejected. Silent, environment-dependent provisioning failure (C1A-F1). |
| **B — Pin the Node runtime / ICU only** | Document & enforce a full-ICU Node (e.g. `engines`, an ops note), no order check | ⚠️ Partial. Reduces likelihood, provides **no evidence** and no fail-closed behaviour; a `none`-ICU or future-Prisma change still slips through. |
| **C — Preflight guard + baseline manifest (recommended)** | §2–§5 | ✅ **Recommended.** Static, deterministic, fail-closed, no engine duplication, no SQL/name change. |
| **D — Make the chain order-independent** | Remove every cross-migration DDL dependency so any order works (C1A-R1) | ⚠️ Durable **but out of scope**: requires editing **applied** migration SQL → ledger drift, and it changes history. A separate, later design; the guard is compatible with it and would still be useful. |
| **E — Rename directories to one prefix width** | Make ICU and byte order coincide (C1A-R4) | ❌ Rejected. Renaming changes `migration_name`; reconciling needs `migrate resolve`/ledger rewrite — prohibited. |
| **F — Wrap/patch the Prisma CLI sort** | Monkey-patch `cli.js` or inject a module | ❌ Rejected. "Do not change Prisma internals"; brittle and un-auditable. |
| **G — Parse `prisma migrate status` output** | Infer order/drift from the CLI | ❌ Rejected. DB-dependent, output-format-coupled, and `status` exits 1 on the **pre-existing** `0_baseline` condition — a poor gate. |
| **H — Force a locale/`LC_ALL`** | Pin collation via env | ❌ Rejected as insufficient. C1A §2.4: every tested **locale** agrees; only ICU **presence** changes the order, and `LC_ALL` cannot add ICU. (Kept as an optional *advisory* in step 7.) |
| **I — Guard as a git hook / pre-commit** | Catch drift locally | ⚠️ Nice-to-have, not the release control. Hooks are not run on the deploy host; the preflight path is. May be added later. |

---

## 10. Recommended implementation (for the next, separately-approved phase) `[Proposed]`

1. **Create `tools/migration-order.baseline.json`** capturing the audited state: the 22-name `order`
   (= the ICU order verified against the v3 ledger in C1A), `checksums` for **all 22** `migration.sql`,
   `prismaVersion: 7.10.0`, and Node/ICU metadata. `[Recorded]` The four F-7 checksums are
   `97ee89d54104…`, `019b42ed36c7…`, `fac529c7fbaf`→`fac529c73bcf…`, `47365a5cdbaf…` (full 64-char values in
   the C1A report §6).
2. **Create `tools/preflight-migrations.mjs`** implementing §4 exactly, with `--json`, `--update`,
   `--migrations-dir`, `--baseline`, and **no network/DB**.
3. **Add npm scripts** (no change to existing ones): `db:preflight`, `db:deploy`
   (`preflight && prisma migrate deploy`), `db:baseline:update`.
4. **Update `README.md`** Production (VPS) section: `db:deploy` is the only approved provisioning command; the
   preflight must pass; the four-row checksum drift expectation (`[Recorded]` C1A §8) is restated.
5. **Add `tests/migration-ordering.unit.test.ts`** covering §6 (T1–T16), driven by temp fixtures.
6. **Keep C1 and A4 where they are.** The guard is complementary to C1 (which fixes two concrete defects) and to
   A4 (a committed-tree replay); it does **not** replace either. Do not start A4 or STEP 2C.7 here.
7. **Full-ICU assumption, now asserted not assumed**: the guard's canary turns "this host happens to have full
   ICU" into an explicit, failing check.

**Sequencing note.** `[Proposed]` The guard can be implemented and merged independently of C1; it does not depend
on C1 being committed first, and C1 does not depend on it. Both are release-safety work, tracked separately.

---

## 11. Approval gate

| ID | Decision requested | Status |
|---|---|---|
| **AP-C1B-1** | Approve the **architecture** in §2/§4 (static preflight + versioned baseline; comparator replication over the alternatives in §9) | ⏸ open |
| **AP-C1B-2** | Approve the **file set / locations** in §3 (`tools/`, manifest path, npm scripts, README) — including the decision to keep the guard **out of** the gitignored `scripts/` | ⏸ open |
| **AP-C1B-3** | Decide the **Prisma-version policy** (F8): warn-only vs hard fail | ⏸ open |
| **AP-C1B-4** | Decide the **bypass policy** for v1 (recommended: none; emergency path documented + separately approved) | ⏸ open |
| **AP-C1B-5** | Authorise the **implementation phase** (create §3 files, add §6 tests) — *this phase implements nothing* | ⏸ open |
| AP-1 (carried) | **Commit C1** (the 4-file F-7 relocation) | ⏸ **WITHHELD — C1 stays on HOLD** |
| AP-3 (carried) | A4 (committed-tree replay) stays **prepared-only** | ⏸ open |
| AP-4 (carried) | Whether to open a follow-up to remove the collation dependency (C1A §11.2 / this report §9 option D) | ⏸ open |

**STOP.** No implementation, no commit, no migration, no replay, no deployment, no STEP 2C.7. Awaiting
**AP-C1B-1 … AP-C1B-5**.

---

## Appendix A — Checks executed in this phase

| Check | Command class | Result |
|---|---|---|
| Git identity/state (initial and final) | `git rev-parse`, `status --porcelain`, `diff --cached`, `stash list` | HEAD `e8d4aa3`, branch `main`, **29** entries, index **0**, stash **0** |
| Whitespace / conflict | `git diff --check` | **exit 0** |
| Runtime ICU capability | `node -e` (`process.versions.icu`, `process.config.variables`) | v24.21.0, **full ICU** (`icu_small=false`, i18n=1), ICU **78.3**, Unicode 17.0 |
| Collation canary values | `node -e` comparator probes | `a_ vs a0` → **-1** (byte **+1**); F-7 pair → **-1** (byte **+1**) |
| `.gitignore` behaviour | `git check-ignore -v` | `scripts/*` **ignores new files and subdirs**; `tools/*` **not** ignored |
| Existing scripts / conventions | `ls scripts/`, `package.json`, `tests/README.md` | `.mjs` scripts run on plain `node`; tests via `tsx --test`; **no CI config**, **no `db:deploy`** script |
| Prisma version source | `node_modules/prisma/package.json`, `npx prisma --version` | **7.10.0** |

**Read-only guarantee:** no database was contacted (3306/3307/3308/v1/v2/production all untouched), no `prisma`
command was executed, no migration file or directory name was modified, and no file was created apart from this
report. The only Git state change is the untracked report under the already-untracked `docs/` entry plus the
ROADMAP line, which does not alter the 29-entry porcelain count.
