# STEP 2C.5 — F-5 / M-1 / M-2 Cutoff Finalization

**Project:** `/home/reksa/restorant-cafe`
**Mode:** STRICT AUDIT (Part I, complete) + **APPROVED MINIMAL IMPLEMENTATION + REGRESSION** (Part II — A1-A5 granted)
**Phase status:** ✅ **COMPLETE — implementation + full regression verified (Part II), STOP gate held. 2C.6 NOT started.**
**Report policy:** one phase = one report. `ACCOUNTING-INTEGRATION-TEST-PLAN.md` remains a read-only legacy archive and was **not** appended to.

---

## 1. Session recovery

| Item | Value |
|------|-------|
| ROADMAP | read; 2C.4 marked **COMPLETE** (accepted), 2C.5 flipped to **CURRENT** at phase start |
| Previous phase | `docs/accounting-hardening/STEP-2C-4-DATABASE-CONNECTION.md` — F-2 fixed, 24 + 4 new tests, 110/110 + 57/57 re-verified |
| Archive sections read | §20.14.2 / §21.5 (F-5 first statement), §22.6 + §22.7 (F-5 quantified, M-1 first statement), §24.8, §26.7–§26.12 (replay + the F-5 decision plan), §27.7 (M-2 live evidence), §27.14 (carried-forward table), §28 (2C.3B) |
| Ledger handling read | `src/services/accounting/integrity.service.ts:128-175` (`resolveLegacyCutoff`), `src/services/accounting/integrity.rules.ts:37,382` (`LEGACY_CUTOFF_MIGRATION`, `buildCutoffEvidence`), `src/services/accounting/integrity.types.ts:112-160` |
| M2 tests read | `tests/accounting/integrity.integration.test.ts` (29 cases; `before()`/`after()` ledger assertions, `at()` cutoff-relative mapping), `src/services/accounting/integrity.unit.test.ts` (57 cases) |
| v3 config read | `tests/setup.ts` (approved-target guard), `tests/README.md` (target policy), `.env.test.example` |
| Branch / HEAD | `main` / `e8d4aa3` |
| Initial Git status | **29 entries** — identical to the 2C.4 exit state |
| Files changed in this phase | **none** (read-only probes only, all removed — see §12) |

Every live statement in this phase was a `SELECT`. The approved target guard was applied *before* any Prisma-initialising import (§11).

---

## 2. F-5 findings

### 2.1 What F-5 actually is (three layers, only one still open)

| Layer | State |
|-------|-------|
| **Structural hybrid of v1** (`restaurant_app_test`) — 55 vs 105 FK columns, 0 vs 5 FKs on `orderitemcostsnapshot`, 0 `CONSTRAINT` clauses | **Closed by replacement.** v3 was provisioned by a clean `prisma migrate deploy` replay (22/22, exit 0) with exact structural parity (§26). v1 is no longer a target. |
| **v3 completeness** | **Proven** (§26, re-confirmed every phase since): 22/22 ledger rows, 105/105 FK columns, 49 tables. |
| **Cutoff metadata parity** (production literal `2026-09-11 16:06:57.831` vs v3 apply time `2026-10-14 07:52:58.220`) | 🟠 **OPEN — this is the only remaining F-5 decision.** The archive has deferred it since §26.12. Not a defect; a choice. |

### 2.2 Deterministic test-database policy (evidence)

| Question from the audit brief | Finding (evidence) |
|---|---|
| Exact current role of v1 / v2 / v3 | v3 = the **only** active integration target (guard-enforced). v1 = the retired legacy hybrid, kept as evidence. v2 = the failed STEP 2C.2B evidence DB, never written again. |
| Which tests/scripts still depend on v1/v2 | **None.** Repo-wide grep: the only remaining references are (a) `tests/setup.ts:171-172` — the guard's *protected-name* list (i.e. they are explicitly **rejected**), (b) `.env.test.example:30-31` — inert `LEGACY_TEST_V1_URL` / `DISPOSABLE_TEST_V2_URL` lines kept for a two-line rollback, (c) `tests/README.md:36,41-42,113` — the policy table, (d) the legacy archive itself. No test, script, service, migration or config reads them. |
| Does v3 fully replace their purpose | Yes: v3 is the structural-parity replay target the v1 hybrid could never be, and 110/110 + 57/57 run against it. |
| Historical evidence that must be retained | v1 (the F-4/F-5 hybrid evidence) and v2 (the failed bootstrap) — retained as-is; nothing in this phase removes, dumps or rewrites them. |
| Data operation needed to retire v1/v2 | **None.** Retirement is a *policy* outcome: no consumer exists, so no drop, dump, migration or backfill is required or proposed. |
| Does the guard already enforce v3 | **Yes.** `tests/setup.ts` fails closed on scheme/host/port/database/user, rejects protected ports 3306/3307 and protected names, and every suite prints the approved-target banner. Measured in 2C.4 too. |
| Stale references in docs/scripts | `tests/README.md:97` still describes the **pre-F-2** parsing behaviour (recorded in 2C.4 §23, out of that phase's scope). Everything else naming v1/v2 is intentional (rejection list / inert rollback lines). Nothing stale was rewritten in *this* phase (no edits authorised yet). |
| Current existence of v1/v2 on the container | **UNKNOWN from this phase.** The dedicated test account can see only `information_schema` and `restaurant_app_test_v3` (`SHOW DATABASES`), so v1/v2 cannot be observed — let alone touched — through the approved connection. Their existence rests on earlier-phase evidence in the archive. Marked UNKNOWN rather than assumed. |

### 2.3 Recommended F-5 resolution

**Documentation + policy, no code, no data operation:**

1. **Adopt the apply-time value as the test baseline** (already implemented in 2C.2F: the suite reads the genuine ledger row and derives every fixture instant from it by millisecond offsets). Do **not** mirror or rewrite the production literal; never compare a v3 cutoff with a production literal.
2. **Publish the test-DB policy explicitly** (v3 active / v1+v2 retained read-only evidence / no data operation / guard-enforced) in the phase report, `ROADMAP.md`, and — *optional, docs-only* — a short policy note in `tests/README.md`.
3. Record the structural F-5 layer as **closed by replacement** (v3), and the cutoff layer as **decided** (apply-time baseline), i.e. **F-5 = RESOLVED (decision + policy)** with no code change.

---

## 3. M-1 findings

### 3.1 Code trace (`src/services/accounting/integrity.service.ts:139-175`)

```sql
SELECT finished_at, started_at
FROM _prisma_migrations
WHERE migration_name = ${LEGACY_CUTOFF_MIGRATION}
LIMIT 1
```
then `const applied = row?.finished_at ?? row?.started_at ?? null;`

| Property | Finding |
|---|---|
| Ordering | **None.** `LIMIT 1` over an unordered result: MySQL returns whichever row the access path yields (in practice PK/insertion order, but that is *not* contractual). |
| Eligibility filter | **None.** A row with `finished_at IS NULL` (failed/in-flight attempt) and/or `rolled_back_at IS NOT NULL` (rolled back) is eligible. |
| Fallback | `finished_at ?? started_at` — an **unfinished** attempt can therefore become the "proven cutoff" through its `started_at`. |
| Cardinality | Not validated. 0 rows → unresolved ✓; 1 → resolved ✓; ≥2 → **silently arbitrary**. |
| Error handling | `catch` → unresolved (`appliedAt: null`, `resolved: false`) ✓ — never guesses. |
| Consumers | `checkCompletedItemsWithoutSnapshot()` (C2) only; single-source per report (K3). |
| Existing coverage | The M2 integration suite asserts **exactly one** ledger row for the migration **before and after** every run (`resolveGenuineCutoff()` + `after()`), i.e. the determinism *precondition* is asserted; the selection logic itself has **no** test. |

### 3.2 The risk is not hypothetical (project evidence)

`F8-FULL-REGRESSION.md` §21 records, as its own finding **F8-B (P3)**, that the project's migration ledger **really does contain a duplicate-name pair**: a rolled-back `20260911_add_ingredient_f1` (`rolled_back_at = 2026-09-11 07:38:27`, **`finished_at = NULL`**) followed by a successful re-apply. That is precisely the shape that defeats M-1's query:

* the rolled-back row is *eligible* today (no filter);
* if `LIMIT 1` picks it, the fallback uses its **`started_at`** — the start of a **failed** attempt — as the proven cutoff;
* a cutoff from a failed attempt (or 7 h off, see §4.4) silently shifts the legacy/anomaly boundary for every tenant.

The same `finished_at IS NULL` + `rolled_back_at` pattern is therefore a **documented, observed** class in this project, not a theoretical one.

### 3.3 Live v3 ledger facts (read-only)

| Metric | Value |
|---|---|
| rows in `_prisma_migrations` | **22** |
| distinct migration names | **22** (no duplicates anywhere) |
| rows with `finished_at IS NULL` | **0** |
| rows with `rolled_back_at IS NOT NULL` | **0** |
| F.5 rows | **exactly 1** — `started_at 2026-10-14 07:52:58.188`, `finished_at 2026-10-14 07:52:58.220`, `rolled_back_at NULL`, `applied_steps_count 1` |
| state of the ledger in **production** (3306) | ❓ **UNKNOWN** — not inspected in this phase (protected target; no reads taken). The F8-B precedent above is the only evidence available. |

### 3.4 Required remediation: **both** — eligibility + determinism + cardinality

1. **Eligibility:** only `rolled_back_at IS NULL AND finished_at IS NOT NULL` rows may supply a cutoff. (This removes the `started_at`-of-a-failed-attempt hazard *and* the mixed-convention hazard in §4.4.)
2. **Determinism:** order by `finished_at ASC, id ASC` (total order; no ties possible).
3. **Cardinality:** distinguish 0 / 1 / ≥2 explicitly instead of silently picking blind.
4. **Behaviour for ≥2 eligible rows — the open decision** (see §6.2 for the two options and the recommendation).

**Intentional semantic change to flag:** today a *failed* F.5 attempt can yield a cutoff through `started_at`; after the fix it yields **unresolved** (C2 → `unknownCompletion`, status `UNKNOWN`). No false `OK` is possible either way; the change only removes a silent guess. Production has 1 healthy F.5 row (per the apply-time evidence chain), so the expected production outcome is unchanged.

---

## 4. M-2 findings

### 4.1 Measured environment (v3, read-only)

| Fact | Value |
|---|---|
| Server `@@system_time_zone` / `@@session.time_zone` / `@@global.time_zone` | `UTC` / `SYSTEM` / `SYSTEM` |
| Server clock as *strings* (no client conversion) | `NOW(3) = UTC_TIMESTAMP(3) = CURRENT_TIMESTAMP(3) = 2026-10-14 09:29:05.959` |
| Shell UTC at the same moment | `2026-10-14T09:29:05.964Z` (“node local rendering” `16:29 GMT+0700`) |
| Node process TZ | `TZ` unset, `Intl = Asia/Jakarta`, `getTimezoneOffset = -420` |
| Column type | `finished_at datetime(3) NULL`, `started_at datetime(3) NOT NULL DEFAULT current_timestamp(3)` |

### 4.2 The two client paths disagree (reproduced)

| Reader | Value for the stored literal `2026-10-14 07:52:58.220` |
|---|---|
| **Prisma driver adapter** (used by the service and the suite) | `2026-10-14T07:52:58.220Z` — naive literal taken as **UTC** |
| **raw `mariadb` driver** (diagnostics + out-of-band reads) | `2026-10-14T00:52:58.220Z` — naive literal re-interpreted in the **process** TZ (`+07:00`) |

Delta = exactly the process offset (7 h) — the same 7-hour delta the archive recorded in §27.7.

### 4.3 DECISIVE cross-check: which reading is the true instant?

The archive (§26.10, §27.7) characterised the literal as *“a naive local literal”* and M-2 as *informational*. A read-only cross-check **corrects that characterisation**:

| Evidence | Value |
|---|---|
| `information_schema.TABLES.CREATE_TIME` for the tables created by the replay (a TIMESTAMP, rendered in the session TZ = UTC) | **`2026-10-14 07:52:52`** (earliest table), `_prisma_migrations` updated `2026-10-14 07:52:58` |
| → true UTC instant of the replay | **07:52:52–07:52:58 UTC** |
| Stored F.5 literal | `2026-10-14 07:52:58.220` |
| Independent corroboration of the same clock | the `restaurant` table's `UPDATE_TIME` = `2026-10-14 09:15:03` UTC = **16:15 local** — exactly when the 2C.4 integration suites ran on this machine |
| Conclusion | The literal **is** the true UTC instant → **Prisma's UTC reading is correct** and the **raw driver's `−7 h` reading is wrong** in this environment. A “naive local literal” would have required the replay to have happened at 00:52 UTC, which `CREATE_TIME` refutes (and which the migration chain's own 6-second span and the `restaurant.updated` cross-check corroborate). |

### 4.4 Write/bind convention (why the service is nevertheless correct today)

| Probe (read-only `SELECT`) | Result |
|---|---|
| `SELECT CAST(${new Date("2026-10-14T00:52:58.220Z")} AS CHAR)` | `2026-10-14 00:52:58.220` → the adapter **binds Dates as UTC wall clock** |
| Comparison of the stored literal against a bound Date | consistent with UTC binding |
| Round trip of the service's own cutoff: read `finished_at` → re-bind | literal identical to the stored one, `=` comparison returns **1** (equal) |
| `started_at` (DEFAULT `current_timestamp(3)`, server-generated) vs `finished_at` (engine-written) | v3 has **no** convention gap (both `07:52:5x`) *because the server TZ is UTC* — in a server whose session TZ is **not** UTC these two columns are written in **different** conventions |

Consequence: cutoff **and** completion timestamps are both read and re-bound by the same Prisma connection, in one convention (UTC wall clock) → **no misclassification today**, which matches the 29/29 suite with exact ±1 ms boundary assertions.

### 4.5 Residual hazards (what M-2 really is)

1. **Raw-driver reads** of any naive `DATETIME` are offset by the process TZ (`−7 h` here) — a value printed by `scripts/*` or read by a test helper must never be compared with a Prisma value.
2. **`started_at` is server-generated** (`DEFAULT current_timestamp(3)`) while `finished_at` is engine-written; on a server whose session TZ ≠ UTC those two columns denote instants in different conventions. Today `resolveLegacyCutoff()` may fall back to `started_at` → that is a second, independent reason for the M-1 eligibility filter.
3. **Cross-environment comparison** of a v3 cutoff against a production literal is meaningless (different apply instants *and* not comparable across environments).
4. The M2 suite itself is safe: it reads the ledger **through Prisma** and derives all fixtures by millisecond offsets from that `Date` (never a literal).

### 4.6 Recommended M-2 resolution (no historical reinterpretation)

1. **Make the convention explicit in code**: read the cutoff as a **string** (`CAST(finished_at AS CHAR)`) and parse it with a new pure helper `parseNaiveUtcDateTime(literal)` (→ `Date` by appending the UTC designator). This is **value-identical** to today's adapter read (proven in §4.4: the round trip is equal) and removes reliance on adapter-internal interpretation; it is unit-testable and TZ-independent by construction.
2. **Never use the raw driver for date comparison or cutoffs** — documented rule next to the only raw-driver helper in the suite and in the scripts' headers.
3. **Pin the convention with a regression**: assert that the **Prisma** read equals the explicit UTC parse of the raw literal, and that the **raw driver** read differs by *exactly* the process offset. This turns M-2 from a prose caveat into a failing test if the environment or the adapter's behaviour ever changes.
4. **No data rewrite, no mirroring, no literal substitution** — the stored value stays exactly as the migration engine wrote it.

---

## 5. What is *not* wrong (stated to avoid over-remediation)

* `classifyCompletionBucket` / `classifyCompletionBucketV2` / `carveWindow` / bucket partitioning: pure, cutoff-instance-based, timezone-agnostic (compare `getTime()`); they never parse a string with an implicit zone. Unit-covered.
* C2's SQL comparisons: cutoff **and** `done` are bound by the same adapter → one convention.
* The four-bucket partition and severity rules (`completedWithoutSnapshotStatusV3`) must not change.
* The tests' `REF_*` constants: explicitly **reference-only**; the suite maps them onto the DB's own clock.

---

## 6. Proposed minimal implementation (after approval)

### 6.1 Files

| File | Change |
|------|--------|
| `src/services/accounting/integrity.rules.ts` | **add** pure `selectLegacyCutoff(rows)` + `parseNaiveUtcDateTime(literal)` (+ M1-R: `buildCutoffAmbiguityDisclosure(...)`) |
| `src/services/accounting/integrity.service.ts` | `resolveLegacyCutoff()`: read **all** rows for the migration (no `LIMIT 1`), select through the pure rule, parse via the explicit UTC helper, attach the ambiguity disclosure (M1-R) |
| `src/services/accounting/integrity.types.ts` | **only for M1-R**: `IntegrityDisclosureCode` + `"LEGACY_CUTOFF_AMBIGUOUS"`, and one additive nullable field on the C2 check (`cutoffDisclosure`) so the marker disclosure is never displaced. **M1-F needs no type change.** |
| `src/services/accounting/integrity.unit.test.ts` | new unit cases (§7) — target ≈ +15–20 cases (57 → ~72–77) |
| `tests/accounting/integrity.integration.test.ts` | add the M-2 convention assertions and move the "exactly one row" precondition to "exactly one **eligible** row"; keep all 29 existing cases and the fixture numbers |
| `docs/accounting-hardening/STEP-2C-5-CUTOFF-FINALIZATION.md`, `ROADMAP.md` | this report's verification half + status |
| *(optional, docs-only)* `tests/README.md` | policy note (v3 active / v1+v2 evidence / cutoff-parity decision / naive-DATETIME rule) + the stale pre-F-2 line |

Out of scope / untouched: `report.service.ts` (A-9/A-11/A-12), `src/lib/*` (F-2), schema, every migration, the ledger itself, `.env*`, `prisma.config.ts`, the five other suites.

### 6.2 The one open sub-decision (M-1, ≥2 eligible rows)

| Option | Behaviour | Cost/benefit |
|---|---|---|
| **M1-F — fail closed** (fallback for a strict reading) | ≥2 eligible rows → `resolved: false` (C2 → `unknownCompletion`, status `UNKNOWN`). No type changes. | Strictly non-guessing; consistent with “never guess”; but the whole C2 check degrades to UNKNOWN, losing the anomaly view exactly when the ledger is odd. |
| **M1-R — deterministic + disclosed** (**recommended**) | ≥2 eligible rows → cutoff = the **earliest** successful `finished_at` (the instant the snapshot schema first provably existed = the most conservative boundary) **and** a `LEGACY_CUTOFF_AMBIGUOUS` disclosure stating how many eligible rows exist. | Deterministic, non-silent, keeps classification visible; costs one enum member + one additive nullable field. |

In both options: 0 eligible → unresolved (unchanged); 1 eligible → resolved (unchanged); `finished_at IS NULL` / `rolled_back_at IS NOT NULL` rows are never used.

### 6.3 Alternatives considered and rejected

* **Order only** (`ORDER BY finished_at DESC LIMIT 1`) — deterministic but still arbitrary (no eligibility filter, still silently discards a rolled-back/failed row's meaning).
* **Assert the invariant instead of fixing the query** (keep `LIMIT 1`, require exactly one row) — documents the hazard without removing it; the F8-B precedent shows real ledgers carry duplicates.
* **Rebuild/extend the ledger fixture to test multiple rows** — forbidden (no manual ledger writes) and would pollute the target.
* **Rewrite/mirror the F.5 literal, or `CONVERT_TZ` the cutoff** — forbidden (silent reinterpretation of historical data) and unnecessary now that the convention is proven to be UTC.
* **Change the schema/column type** — out of scope, no migration allowed.

---

## 7. Regression plan (existing vs new)

| Required case | Status |
|---|---|
| Genuine F.5 migration ledger row | ✅ exists (integration `before()`: `resolveGenuineCutoff()` + live identity) — keep; strengthen to “exactly one **eligible** row” |
| Zero matching migration rows | 🆕 **new** — pure rule (`selectLegacyCutoff([])` → `{ appliedAt: null, resolved: false }`) |
| Exactly one matching row | ✅ exists (integration) + 🆕 pure rule |
| Multiple matching rows | 🆕 **new** — 2 eligible (earliest wins per M1-R / unresolved per M1-F), 3 eligible, and eligible+ineligible mixes |
| Unfinished migration | 🆕 **new** — `finished_at IS NULL` is ineligible; an unfinished-only ledger is unresolved (**no** `started_at` guess) |
| Deterministic cutoff selection | 🆕 **new** — shuffled row order → identical result; `rolled_back_at` set + later successful apply → the **successful** row wins; equal `finished_at` → `id` tiebreak |
| Timestamp timezone equivalence | 🆕 **new** — unit: `parseNaiveUtcDateTime` (with/without ms, null, invalid, TZ-independence); integration: Prisma read == explicit UTC parse **and** raw-driver read differs by exactly the process offset |
| Boundary milliseconds before/at/after cutoff | ✅ exists (±1 ms integration cases + unit boundary tests) — extend to the explicitly parsed cutoff |
| Legacy classification consistency | ✅ exists (`classifyCompletionBucket*`, bucket partition, severity table) |
| Existing 29 M2 integration cases | ✅ must stay green (no re-baseline expected: values are unchanged) |
| Existing 57 M2 unit cases | ✅ must stay green |

Mutation check will follow the 2C.4 pattern (isolated scratch module, working tree never reverted).

---

## 8. Database impact

* **Read-only.** No INSERT/UPDATE/DELETE/DDL, no migration command, no ledger edit, no `CONNECT` to 3306/3307/v1/v2; the M-1/M-2 changes read the **same** row and produce the **same** cutoff value.
* New queries are `SELECT`s over `_prisma_migrations` (≤1 row today) — no index or schema change needed.
* The regression writes only the fixtures the M2 suite already writes (and deletes them in `after()`); the "no residual rows" and "exactly one ledger row" assertions stay.
* No data operation for F-5 (v1/v2 untouched, nothing dropped or dumped).

## 9. Security impact

Neutral-to-positive: no new secrets, no credential handling change (F-2 code untouched), no new logging; the only new output is an ambiguity **disclosure** carrying a *count* (never a credential, never a URL). Probe hygiene as in §12.

## 10. Migration compatibility impact

**None.** No migration file, no `_prisma_migrations` write, no schema change; `prisma migrate status/deploy` behaviour is unaffected (the fix only *reads* the ledger more strictly). F-6 (deployed target UNKNOWN) and F-8 (collation drift) remain untouched.

## 11. Rollback plan

* Revert the two/three source files (`integrity.rules.ts`, `integrity.service.ts`, and `integrity.types.ts` only under M1-R) and the two test files; delete the new report if the phase is abandoned.
* No data, schema, migration or ledger state to unwind; `.env` untouched; no container/database created or altered → rollback is instantaneous.
* Documentation-only parts (F-5 policy) carry no runtime risk.

## 12. Risks and unresolved unknowns

| # | Item |
|---|------|
| U1 | **Production `_prisma_migrations` state is UNKNOWN** (no 3306 reads this phase). The F8-B precedent (a rolled-back duplicate for `20260911_add_ingredient_f1`) is the only evidence that duplicates occur in practice; whether an F.5 duplicate exists in production cannot be determined from the repository. |
| U2 | **v1/v2 existence on the container is UNKNOWN** through the approved account (privilege-limited); earlier-phase evidence stands unmodified. |
| U3 | The **migrate-host timezone convention in production is UNKNOWN**; in v3 the ledger literal is proven UTC (§4.3). The proposed M-1 eligibility filter *removes* the mixed-convention hazard by never using the server-generated `started_at`. |
| R1 | M-1's fix changes behaviour for a failed-only F.5 ledger (unresolved instead of a `started_at` guess) → C2 becomes `UNKNOWN`. Deliberate, non-guessing, flagged here. |
| R2 | M1-R adds one enum member + one nullable field to the C2 payload. Additive; UI consumers ignore unknown fields — to be re-checked at implementation time (grep for `disclosure` consumers). |
| R3 | The M-2 integration assertion pins the *current* adapter behaviour; if a dependency upgrade changes DATETIME handling, the test will fail loudly (intended) and the rule must be re-decided, not silently patched. |
| R4 | No performance requirement was specified; the new ledger read returns ≤1 row today and the added SQL is a `SELECT` on a 22-row table. |
| P1 | **Probe hygiene:** four temporary read-only probes were created and deleted (`.c25-probe{,2,3,4}.ts`); all targeted v3 only, all guard-checked before the dynamic Prisma import, and none wrote data. One probe's internal `=== 1n` comparison printed “NOT EQUAL” for an equality-1 result returned as a JS number — a **probe bug**, corrected in §4.4 (the round trip is equal). |

---

## 13. Approval gate — decisions requested

**A1 — F-5.** Approve the resolution as **policy + documentation only** (adopt the apply-time baseline — already implemented; publish the v3-only test-DB policy; declare v1/v2 retired read-only evidence; close the structural layer by replacement), with **no code and no data operation**? (Optional: allow the docs-only `tests/README.md` policy note + stale-line correction.)

**A2 — M-1 approach.** Approve **eligibility + determinism + cardinality** as the required remediation (only `rolled_back_at IS NULL AND finished_at IS NOT NULL`; `ORDER BY finished_at ASC, id ASC`; explicit 0/1/≥2 handling; **no** `started_at` fallback for ineligible rows)?

**A3 — M-1 multiple-row behaviour.** Choose **M1-R** (earliest eligible + `LEGACY_CUTOFF_AMBIGUOUS` disclosure — *recommended*) or **M1-F** (fail closed to unresolved, no type changes)?

**A4 — M-2 approach.** Approve the **explicit UTC parse** (`CAST(finished_at AS CHAR)` + `parseNaiveUtcDateTime`) plus the “never compare raw-driver reads” rule and the timezone-equivalence regression — with **no** rewrite or mirroring of the stored literal?

**A5 — Files/scope.** Approve the file list in §6.1 (and whether `tests/README.md` is included).

**Nothing will be edited until you answer.** The phase stops here.

---

## 14. Not done / out of scope (stated, not hidden)

* No production code change, no test change, no verification run — the gate blocks them by instruction.
* No production/v1/v2 inspection (UNKNOWN, §12 U1/U2); no migration command; no ledger write; no schema change.
* F-6 (deployed/production target) and F-8 (5-table collation drift) untouched; A-9/A-11/A-12 and F-2 untouched; the 2C.3B predicate-duplication cleanup still parked for 2C.7.
* Production readiness remains 🚫 **NOT READY** (F-6/F-8 open — the 2C.5 blockers themselves are now closed).

---

# PART II — APPROVED IMPLEMENTATION AND VERIFICATION

## 15. Approval decisions as executed

| # | Decision | Executed as |
|---|----------|-------------|
| A1 | F-5 → policy + documentation only | ✅ v3 declared the canonical isolated baseline **in the report + `tests/README.md`** (already enforced by the fail-closed guard, §16.4); v1/v2 stay retired read-only evidence and **remain rejected by the guard**; **no** database was dropped, modified or migrated; **no** historical migration metadata was fabricated |
| A2 | M-1 → eligibility + determinism + cardinality | ✅ `selectLegacyCutoff()` — eligibility `finished_at IS NOT NULL AND rolled_back_at IS NULL`, order `finished_at ASC, id ASC`, `started_at` **never** a fallback |
| A3 | M1-R with conditions | ✅ earliest eligible row + additive disclosure (`cutoffDisclosure` / `LEGACY_CUTOFF_AMBIGUOUS`); severity/classification semantics untouched; contract-impact assessment in §20 (**no STOP condition arose**) |
| A4 | M-2 → explicit UTC parse | ✅ `parseNaiveUtcDateTime()`; v3 cutoff **value-identical**; no `CONVERT_TZ`, no ledger rewrite, no backfill, no app-wide timezone change |
| A5 | Minimal file list + optional docs-only `tests/README.md` | ✅ exactly the approved files (§16.1); nothing unrelated touched |

## 16. Implementation (approved scope only)

### 16.1 Files

| File | Change | Final size (Δ vs audit) |
|------|--------|--------------------------|
| `src/services/accounting/integrity.rules.ts` | **M-2** `parseNaiveUtcDateTime(literal)` + `NAIVE_DATETIME_LITERAL`; **M-1** `LegacyCutoffLedgerRow`, `LegacyCutoffSelection`, `selectLegacyCutoff(rows)`; **M1-R** `buildCutoffAmbiguityDisclosure(eligibleRows)` — all pure, no I/O | 548 lines (+155) |
| `src/services/accounting/integrity.service.ts` | `resolveLegacyCutoff()`: reads **every** ledger row (`CAST(… AS CHAR)`, no `LIMIT 1`, no SQL `ORDER BY`), selects through the pure rule, attaches the disclosure; `cutoffDisclosure` threaded into the C2 payload; module header + rule docs updated. **No second engine, no other M2 rule touched** | 702 lines (+30) |
| `src/services/accounting/integrity.types.ts` | `IntegrityDisclosureCode` +`"LEGACY_CUTOFF_AMBIGUOUS"`; `CompletedItemsWithoutSnapshotCheck.cutoffDisclosure: IntegrityDisclosure \| null` (additive, separate from the marker `disclosure`) | 246 lines (+13) |
| `src/services/accounting/integrity.unit.test.ts` | +21 cases (2 new `describe`s: `2C.5 / M-1 — selectLegacyCutoff`, `2C.5 / M1-R — buildCutoffAmbiguityDisclosure`; `2C.5 / M-2 — parseNaiveUtcDateTime`; the F2 boundary `describe` gains one case re-derived from the **parsed** cutoff). **All 57 pre-existing cases kept — none deleted, weakened or re-baselined** | 1114 lines (+238) |
| `tests/accounting/integrity.integration.test.ts` | new case **30** (M-1 selection over the live ledger, M1-R `cutoffDisclosure === null`, M-2 three readings + round-trip bind); `resolveGenuineCutoff()` now also asserts eligibility/rows-read and the UTC-parse equality; `F5_LEDGER_METADATA` captured in `before()` and re-asserted in `after()`. **All 29 existing cases and every fixture number kept** | 2238 lines (+134) |
| `tests/README.md` *(docs-only, A5)* | F-2 guard note (cause fixed in 2C.4, guard **kept** deliberately), corrected suite/totals counts, stale `finished_at` `00:52:58.220Z` → `07:52:58.220` (UTC), M-1/M-2/M1-R policy bullets, M-1 parenthetical corrected | 436 lines |
| `docs/accounting-hardening/STEP-2C-5-CUTOFF-FINALIZATION.md`, `ROADMAP.md` | this Part II + status | — |

**`git diff --check`: exit 0** (no whitespace errors in any changed file).

### 16.2 M-1 — the actual defect and the fix

Before: `… WHERE migration_name = ? LIMIT 1` — no eligibility filter, no ordering, no cardinality
handling. A failed attempt (`finished_at IS NULL`) or a rolled-back attempt (`rolled_back_at IS NOT NULL`)
could supply the “proven” cutoff, and with several rows the winner was arbitrary.

After (§`integrity.service.ts:149-201`):

```sql
SELECT id, CAST(finished_at AS CHAR) AS finished_at, CAST(rolled_back_at AS CHAR) AS rolled_back_at
FROM _prisma_migrations WHERE migration_name = ?      -- every row, no LIMIT, no ORDER BY in SQL
```

and the decision is made by the pure `selectLegacyCutoff()`:

```
eligible  = finished_at IS NOT NULL AND rolled_back_at IS NULL AND parseable as a naive DATETIME
order     = earlier instant first, ties broken by id  (deterministic, input-order independent)
selected  = eligible[0].appliedAt            → 0 eligible ⇒ null (unresolved, NOT guessed)
```

### 16.3 M-2 — the actual defect and the fix

Before: the raw driver value was trusted as-is. Measured on v3: the stored literal
`2026-10-14 07:52:58.220` is **UTC wall clock**, which the Prisma adapter reports as
`2026-10-14T07:52:58.220Z`, while the raw `mariadb` driver re-interprets it in the **process** time zone
(here UTC+07:00 → `2026-10-14T00:52:58.220Z`, exactly −7 h).

After: the ledger is read as **text** (`CAST(… AS CHAR)`) and converted by
`parseNaiveUtcDateTime()` — an absolute `Date.UTC(...)` construction that never touches the process time
zone, preserves **millisecond** precision, accepts a `T` separator / whitespace / second precision, and
rejects out-of-range components (month 13, Feb 30, hour 24 …) by returning an **invalid Date** so the
caller degrades to “no cutoff” instead of guessing.

**The v3 cutoff value is unchanged**: `2026-10-14 07:52:58.220` → `2026-10-14T07:52:58.220Z` (the exact
instant the adapter already produced). No literal was rewritten, mirrored or `CONVERT_TZ`-ed.

### 16.4 F-5 resolution (policy only, no data operation)

* The cutoff baseline is the F.5 **migration apply time** (`_prisma_migrations.finished_at`) — the only
  provable boundary; `codeDeployUnproven` stays `true`.
* **`127.0.0.1:3308/restaurant_app_test_v3` is the canonical isolated test baseline** — already the only
  target the fail-closed guard accepts (`tests/setup.ts`): exact host/port/database/user, protected names
  *including* `restaurant_app_test` (v1) and `restaurant_app_test_v2`, ports 3306/3307 rejected, plus the
  live `SELECT DATABASE(), USER()` identity per suite.
* v1/v2 remain **retired read-only evidence** — nothing was dropped, dumped, recreated or migrated, and
  neither database is accepted as a test target.
* **No** historical migration metadata was fabricated and the v3 ledger was **not** touched (§19).
* The policy is now published in `tests/README.md` (§16.1) instead of living only in the archive.

## 17. Regression coverage (required §3 list → where it is pinned)

| # | Required case | Pinned by |
|---|---------------|-----------|
| 1 | No matching migration | unit: `selectLegacyCutoff([])` → `{appliedAt:null, eligibleRows:0, rowsRead:0}` |
| 2 | One successful migration | unit (value + counts) **and** integration 30 (live ledger) |
| 3 | Multiple successful migrations | unit: earliest wins, input order irrelevant, `eligibleRows=2` |
| 4 | Failed-only migration | unit: `finished_at IS NULL` ineligible → unresolved (explicitly **no `started_at` fallback**) |
| 5 | Rolled-back migration | unit: `rolled_back_at` set is excluded **even though it carries a `finished_at`** |
| 6 | Failed (and rolled-back) attempt followed by a successful apply | unit: the successful row wins, `eligibleRows=1`, not flagged ambiguous |
| 7 | Equal `finished_at` → deterministic `id` tie-break | unit: order-independent; plus a case proving **time dominates** the tie-break |
| 8 | UTC parsing | unit `2C.5 / M-2`: value, `Date.UTC` equivalence, ms padding/truncation, second precision, `T` separator, whitespace, 7 invalid inputs |
| 9 | Prisma / raw-driver timezone equivalence after normalization | integration 30: explicit UTC parse **==** adapter read; raw driver **==** adapter read **+ process offset** (documented, never a cutoff source); `CAST(literal AS DATETIME(3)) = CAST(cutoff AS DATETIME(3))` round trip `= 1` |
| 10 | before / at / after cutoff millisecond boundaries | unit: F2 boundary `describe` incl. a case re-derived from the **parsed** cutoff; integration ±1 ms cases unchanged |
| 11 | Existing legacy classifications | all 29 pre-existing integration cases and 57 unit cases kept green and unmodified in meaning |
| 12 | No fabricated cutoff from `started_at` | unit 4 + the cutoff SQL selects **only** `id`, `finished_at`, `rolled_back_at` (`started_at` appears exclusively in explanatory comments — grep-verified in both `integrity.service.ts` and `integrity.rules.ts`) |
| 13 | Ambiguity disclosure | unit `M1-R`: silent for 0/1, states the count for 2/5, states the earliest-row rule, never an input to a severity rule |
| 14 | Genuine v3 F.5 ledger row | integration `before()`: exactly one row, exactly one **eligible**, selector returns the row's own instant, UTC parse equals the adapter read; `after()` re-asserts byte-identical stored metadata |

**No assertion was weakened, skipped or deleted** to make anything pass; the only edits to existing tests were
the strengthened ledger precondition and the captured metadata.

## 18. Verification results — real exit codes

Run sequentially, one suite file at a time, against **v3 only** (`127.0.0.1:3308`), **after the final
executable edit** (only the docs and the restored generated file changed afterwards, §19).

| # | Command | Result | Exit |
|---|---------|--------|------|
| 1 | `npx tsx --test src/services/accounting/integrity.unit.test.ts` (57 M2 + 21 new 2C.5) | **78/78** pass, 0 fail, 0 skipped | **0** |
| 2 | `npx tsx --test tests/accounting/integrity.integration.test.ts` (29 + new 30) | **30/30** pass, 0 fail | **0** |
| 3 | `npx tsx --test tests/accounting/cashbook.integration.test.ts` | **15/15** | **0** |
| 4 | `npx tsx --test tests/accounting/revenue.integration.test.ts` | **21/21** | **0** |
| 5 | `npx tsx --test tests/accounting/refund-profitability.integration.test.ts` | **21/21** | **0** |
| 6 | `npx tsx --test tests/accounting/pnl.integration.test.ts` | **24/24** | **0** |
| 7 | `npx tsx --test tests/database-connection.integration.test.ts` (F-2) | **4/4** | **0** |
| 8 | `npx tsx --test src/lib/database-url.unit.test.ts` (F-2) | **24/24** | **0** |
| 9 | `npx tsc --noEmit` (before and after restoring `next-env.d.ts`) | clean | **0** / **0** |
| 10 | `npm run build` | compiled | **0** |
| 11 | `git diff --check` | clean | **0** |
| 12 | `npx eslint <5 changed files>` | clean | **0** |
| 12b | `npx eslint .` (project-wide) | **245 problems (106 errors / 139 warnings)** — identical to the 2C.3B/2C.4 count | 1 (pre-existing debt, **0 new**) |

**Totals: accounting integration 111/111 (baseline 110/110 + the new M2 case 30); M2 unit 78/78 (baseline
57/57 + 21 new cutoff cases); F-2 24/24 + 4/4 unchanged.**

`npm run build` again regenerated the auto-generated `next-env.d.ts` (only the unrelated
`./.next/dev/types/*` → `./.next/types/*` reference switch). It was **restored to HEAD** afterwards — the same
handling as 2C.3B/2C.4 — and `tsc --noEmit` was **re-run after that restore** (exit 0, row 9).

## 19. Database impact and cleanup

Read-only checks against the approved target only (`127.0.0.1:3308/restaurant_app_test_v3`, account
`restaurant_test_v3`, server `11.8.9-MariaDB-ubu2404`, `SELECT DATABASE(), USER()` verified):

| Metric | Value | Expected |
|--------|-------|----------|
| tables | **49** | 49 (unchanged) |
| applied migrations (`_prisma_migrations`) | **22** | 22 (no row added/removed) |
| F.5 rows for `20260911143644_f5_order_item_cost_snapshot` | **1** (id `ed74c992-…`) | 1 (genuine `prisma migrate deploy` row) |
| F.5 `finished_at` | `2026-10-14 07:52:58.220` | unchanged — **not rewritten** |
| F.5 `rolled_back_at` / `started_at` | `NULL` / `2026-10-14 07:52:58.188` | unchanged |
| **eligible** F.5 rows (`finished_at NOT NULL AND rolled_back_at IS NULL`) | **1** | ⇒ live v3 is unambiguous |
| `order` / `orderitem` / `orderitemcostsnapshot` | **0 / 0 / 0** | 0 (no residual fixtures) |
| run-prefixed leftovers | **0** | 0 |

* Every suite asserts its own before/after row counts; the live check above confirms it independently.
* **No** `INSERT`/`UPDATE`/`DELETE`/DDL was issued by the implementation or its tests against the ledger;
  the new SQL is a `SELECT` over a 22-row table.
* 3306 / 3307 / `restaurant_app` / v1 / v2 were **never contacted**; `prisma migrate` was **never** run; no
  database was reset; `prisma/schema.prisma` and every migration file are **untouched**.
* Production ledger state remains **UNKNOWN** (§22 U1).

## 20. Contract / API impact of the additive field (A3 condition)

A3 required a STOP if the additive enum/nullable field affected a public API contract or a business rule.
Assessed, **no STOP condition arose**:

* `cutoffDisclosure` is **new, nullable and additive** on the C2 check type; it is a sibling of the existing
  marker `disclosure` (so it can never displace it).
* `GET /api/admin/accounting/integrity` returns the report as JSON (`successResponse`) — an extra nullable
  field is backward-compatible for any consumer that reads named fields; no existing field was renamed,
  removed or retyped.
* The only widening is the `IntegrityDisclosureCode` union (+`"LEGACY_CUTOFF_AMBIGUOUS"`). A project-wide
  search finds **no** consumer that switches exhaustively over that union (`src` references: the type module,
  the service and the unit test only) — and `tsc --noEmit` is clean, which is the mechanical proof.
* **No business-rule change:** the disclosure is display-only, takes only a **count** as input (it has no
  parameter that could reach a severity rule), and `statusCutoffOnly` / bucket / severity logic is
  unmodified — asserted in the `M1-R` unit case.

## 21. Security and migration impact

* **Security:** neutral-to-positive. No new secret, no credential-handling change (F-2 code untouched), no
  new logging, no new endpoint. The only new output is a disclosure carrying a **count** — never a
  credential, a URL or a host. The read-only SQL is parameterised (no string interpolation of the
  migration name).
* **Migration compatibility:** none. No migration file, no `_prisma_migrations` write, no schema or column
  change, so `prisma migrate status/deploy` behaviour is unaffected — the fix only *reads* the ledger more
  strictly. F-6 (deployed target UNKNOWN) and F-8 (collation drift) stay open for 2C.6.
* **Rollback:** revert the three source files + the two test files (and the docs); there is **no** data,
  schema, migration or ledger state to unwind, so rollback is instantaneous.

## 22. Remaining unknowns and limitations

| # | Item |
|---|------|
| U1 | **Production `_prisma_migrations` state remains UNKNOWN** — no 3306 read was performed. The F8-B precedent (a rolled-back duplicate for `20260911_add_ingredient_f1`) is still the only evidence that duplicate rows occur in practice; whether an F.5 duplicate exists in production cannot be determined from the repository. |
| U2 | **v1/v2 existence/contents UNKNOWN** through the approved account (privilege-limited). Nothing was read or written; earlier-phase evidence stands unmodified. |
| U3 | The **production migrate-host timezone convention is UNKNOWN**. In v3 the ledger literal is proven UTC, so the explicit-UTC parse is correct *there*; if a production host writes a non-UTC literal, that is a separate 2C.6 question (the fix does not guess). |
| R1 | Behaviour change for a *failed-only* F.5 ledger: unresolved (C2 → `UNKNOWN`) instead of an arbitrary/`started_at` guess. Deliberate and approved (A2), stated here rather than silently absorbed. |
| R2 | The M-2 integration assertion pins the *current* adapter behaviour: a future driver upgrade that changes naive-DATETIME handling fails **loudly** (intended) and the rule must be re-decided rather than patched quietly. |
| R3 | The multiple-eligible-row **disclosure path is covered at the pure-rule level only** — the canonical v3 ledger genuinely holds one eligible row and writing a second one is forbidden (no manual ledger writes, no fake F.5 history), so there is no live end-to-end test of a 2-row ledger. |
| R4 | No performance requirement was specified; the added work is one `SELECT` over a 22-row table (≤1 row today) plus a pure sort — not measurable at this scale. |
| R5 | `ACCOUNTING-INTEGRATION-TEST-PLAN.md` was **not** appended to (legacy archive, read-only) — per the one-phase-one-report policy. The 2C.4 follow-up (its stale pre-F-2 note in `tests/README.md`) **is** now corrected (§16.1). |

## 23. Git status

* Branch `main`, HEAD `e8d4aa3` — **no commit, no push, no merge, no deploy** was performed.
* Working tree: **29 entries** at phase entry (`git status --porcelain`, as recorded in §1) and **29 entries**
  after the implementation and verification (the changes landed *inside* entries that were already modified —
  the four `integrity.*` files — or inside the already-untracked `tests/`, `docs/` trees).
* Only the four `integrity.*` files are newly modified relative to phase entry; `src/lib/*`, `prisma/*`,
  `scripts/*`, the report files and every other pre-existing modification are as they were.
* The only untracked additions this phase are documents: `docs/accounting-hardening/STEP-2C-5-CUTOFF-FINALIZATION.md`
  (this file) and the `ROADMAP.md` update.
* The build's regenerated `next-env.d.ts` was restored to HEAD (§18); no scratch/probe file remains.

## 24. Restriction compliance

No unrelated refactoring · no F-2 change · no A-9/A-11/A-12 change · no schema change · no historical migration
edit · no database reset · no manual ledger rewrite · no global lint cleanup · no commit/push/merge/deploy ·
2C.6 **not** started · no second Integrity engine · no change to any existing severity/classification semantic.

## 25. STOP gate

**STEP 2C.5 is COMPLETE and stops here for review.** STEP 2C.6 (F-6 / F-8 / migration compatibility) is
**not** started and requires separate explicit approval.

