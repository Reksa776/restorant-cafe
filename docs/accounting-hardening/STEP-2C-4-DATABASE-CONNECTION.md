# STEP 2C.4 — F-2 Database Connection Hardening

**Project:** `/home/reksa/restorant-cafe`
**Mode:** AUDIT → APPROVAL GATE → **APPROVED MINIMAL IMPLEMENTATION + REGRESSION (done)**
**Phase status:** ✅ **COMPLETE** — A1-A5 approved (`A1 A2 A3 A4 A5 = APPROVED`), minimal fix implemented,
full sequential verification green. **STOPPED after 2C.4 for review** (2C.5 not started). No commit/push/merge/deploy.
**Report policy:** one phase = one report. `ACCOUNTING-INTEGRATION-TEST-PLAN.md` remains a read-only legacy archive and was **not** appended to.

---

## 1. Session recovery

| Item | Value |
|------|-------|
| ROADMAP | `docs/accounting-hardening/ROADMAP.md` — read; 2C.4 flipped to **CURRENT** at phase start |
| Previous phase | `docs/accounting-hardening/STEP-2C-3B-REPORTING-FIX.md` — **COMPLETE** (A-9/A-11/A-12 fixed, 110/110 integration, 21/21 revenue) |
| Legacy archive F-2 entries | `ACCOUNTING-INTEGRATION-TEST-PLAN.md` L450, L1148, L1558, L2130-2131, L2263, L2277 (`decodeURIComponent user/pass`, “Must fix”, assigned to 2C.2 → deferred ever since) |
| Branch / HEAD | `main` / `e8d4aa3` |
| Initial Git status | **22 entries** — identical to the 2C.3B exit state (12 ` M` + 10 `??`) |
| Production code touched in 2C.4 | **none** (audit + temporary probes only, all removed) |
| Migrations / schema / `.env` / test guard | **untouched** |

Locked sequence is unchanged: 2C.3A ✅ · 2C.3B ✅ · **2C.4 CURRENT** · 2C.5 · 2C.6 · 2C.7 · 2C.8 · 2C.9.

Environment for all evidence: Node **v24.21.0**, `mariadb` **3.5.3**, `@prisma/adapter-mariadb` **7.10.0**. Every live probe below was executed against the approved disposable target only (`127.0.0.1:3308 / restaurant_app_test_v3`), read-only (`SELECT`), with fail-closed guards.

---

## 2. Connection path trace (10 audit points)

| # | Stage | Where | Behaviour found |
|---|-------|-------|-----------------|
| 1 | `DATABASE_URL` loading | `src/lib/prisma.ts:9`, `prisma/seed.ts:7`, `.env*` | Read from `process.env`; missing → clear throw (`prisma.ts:10-12`). No other DB env var exists in `src/` or `prisma/`. |
| 2 | URL parsing | `src/lib/prisma.ts:15` `new URL(url)` | **WHATWG parser.** `.username`/`.password` return the **percent-encoded serialization**, not the decoded credential. |
| 3 | Adapter initialisation | `src/lib/prisma.ts:16-23` `new PrismaMariaDb({...})` | **Object** config → adapter `normalizeConfig` object branch adds `prepareCacheLength: 0` and hands the object to `mariadb.createPool` **verbatim**. |
| 4 | MariaDB driver config | `node_modules/mariadb/lib/config/connection-options.js` | Decoding happens **only in the connection-string branch** (`ls. 307-311, 321`: `decodeURIComponent(matchResults[...])`). An **object** config value is never decoded. |
| 5 | Percent-decoding responsibility | `src/lib/prisma.ts:19-20` | **Nobody decodes.** The app parses to an object and the driver therefore receives the encoded text. |
| 6 | Test-environment init | `tests/setup.ts` | Loads `.env.test`, pins `DATABASE_URL := TEST_DATABASE_URL` (`L320-330`), decodes **only the username** (`L198`), and **fails closed** if `TEST_DATABASE_URL` credentials are percent-encoded (`L120-140`). Fixture credential is URL-safe → test env never exercised the defect. |
| 7 | Runtime init | `src/lib/prisma.ts:34-36` | Singleton, cached on `globalThis.prisma` outside production. Malformed URL throws **at import time** (module initialisation). |
| 8 | Duplicate connection factories | 5 sites | `src/lib/prisma.ts:16`, `prisma/seed.ts:9`, `scripts/prisma-diag.mjs:29`, `scripts/diag-p3018.mjs:37`, `scripts/backfill-branch.ts:27` — all five repeat the same non-decoding parse. |
| 9 | Error handling | — | Missing env var: clear. Bad credential: **`P2010` “Raw query failed … pool timeout … after 10000ms”** — no auth error, 10 s stall, indistinguishable from a wrong password. Malformed URL: `ERR_INVALID_URL` whose `err.input` **contains the raw URL including the password** (see §5). |
| 10 | Credential exposure | — | No application log prints the credential. `src/lib/prisma.ts:27-30` enables `query` logging in development (SQL only). The three scripts carry a `mask()` helper (good). The only leak is the parse-failure property in §5. |

**Verified non-issues:** `prisma.config.ts` hands the CLI a **string** URL, and the adapter's string path runs `new URL()` → `rewriteConnectionString()` → `mariadb.createPool(<string>)`, which *does* decode — so `prisma migrate`/`db push` are unaffected and must not be “fixed”. `tests/accounting/integrity.integration.test.ts:399-400` already calls `decodeURIComponent` on both user and password.

---

## 3. Root cause (file/line evidence)

> **F-2 root cause.** `src/lib/prisma.ts:15-20` (duplicated at `prisma/seed.ts:8-13` and in three `scripts/*` files) builds the MariaDB pool config from `urlObj.username` / `urlObj.password`. Those getters return the URL's **percent-encoded userinfo**, and `@prisma/adapter-mariadb` passes an **object** config to `mariadb.createPool` without decoding, so any credential containing a character that the WHATWG userinfo serializer escapes arrives at MariaDB **still encoded** and authentication fails. The owner of the defect is therefore **application URL handling**, not the adapter, not the driver, and not the environment.

Two consequences the original finding did not capture:

* It is **not limited to `%XX` input.** Characters the WHATWG serializer escapes *even when written literally* — `=`, `:`, `;`, `/`, `@` (the userinfo percent-encode set) — are corrupted the same way.
* `decodeURIComponent(...)` **alone is not a safe fix**: a literal `%` password (e.g. `100%`) makes it throw `URIError` during module initialisation.

### 3.1 Measured parse matrix (`node -e`, synthetic values)

| `.env` password written as | `new URL(url).password` | → driver as today | after one `decodeURIComponent` |
|---|---|---|---|
| `simplepass` | `simplepass` | ✅ correct | ✅ |
| `a+b` (literal `+`) | `a+b` | ✅ correct | ✅ |
| `a%2Bb` | `a%2Bb` | ❌ **`a%2Bb` sent** | ✅ `a+b` |
| `a=b` (literal `=`) | `a%3Db` | ❌ **`a%3Db` sent** | ✅ `a=b` |
| `a%3Db` | `a%3Db` | ❌ **`a%3Db` sent** | ✅ `a=b` |
| `a@b` / `a%40b` | `a%40b` | ❌ **`a%40b` sent** | ✅ `a@b` |
| `a:b` (literal `:`) | `a%3Ab` | ❌ **`a%3Ab` sent** | ✅ `a:b` |
| `100%25` | `100%25` | ❌ **`100%25` sent** | ✅ `100%` |
| `100%` (bare) | `100%` | ✅ correct today | ⚠️ **throws `URIError`** |
| `a/b` (literal `/`) | — | ❌ **`new URL()` throws `ERR_INVALID_URL`** | — (unfixable by decoding) |

### 3.2 Live reproduction — through the real `src/lib/prisma.ts`, on `127.0.0.1:3308/restaurant_app_test_v3`

Same test account, same password; the “variant” is that password with its **first character percent-escaped** (no new credentials, no rotation, no writes):

| Case | Result |
|------|--------|
| **variant** (percent-encoded credential) | ❌ `PrismaClientKnownRequestError` **`P2010`** — `Raw query failed. Code: 45028. pool timeout: failed to retrieve a connection from pool after 10000ms (pool connections: active=0 idle=0 limit=5)`; error text contains neither the credential nor the URL |
| **control** (real credential) | ✅ `QUERY OK -> [{"db":"restaurant_app_test_v3","ok":1}]` |
| **wrong password** | ❌ **identical** `P2010` pool-timeout error — proving F-2 is indistinguishable from a wrong password at the application surface |

Raw-driver confirmation of the mechanism and of the fix:

| Probe | Result |
|-------|--------|
| `mariadb.createConnection({... password: new URL(variant).password })` (today's value) | `ER_ACCESS_DENIED_ERROR` (1045), error text does **not** contain the password |
| `mariadb.createConnection({... password: decodeURIComponent(new URL(variant).password) })` | ✅ **CONNECTED** |
| `mariadb.createConnection(<mariadb:// URI string with the same encoded credential>)` | ✅ **CONNECTED** — the driver decodes a URI string itself (explains why the Prisma **CLI** works while the app does not) |

---

## 4. Candidate fixes considered

| Option | Verdict |
|--------|---------|
| **A. Decode userinfo once in the app, guarded** (helper shared by `src/lib/prisma.ts` + `prisma/seed.ts`) | ✅ **RECOMMENDED** — smallest diff, keeps the existing object config (`connectionLimit: 5` semantics untouched), fixes every `%XX`, `=`, `:`, `;`, `@` case, cannot double-decode, does not crash on a bare `%`. |
| B. Pass the raw URL **string** to `PrismaMariaDb(url)` | ❌ Rejected — the driver's string parser is regex-based (`mariadb://` only), needs the adapter's `rewriteConnectionString` rewrite, silently returned `user/password: undefined` in one probe, throws `URIError` on a bare `%`, and moves pool settings (`connectionLimit: 5`) into query-string territory → **visible behaviour change** and a second parsing dialect. |
| C. Naive `decodeURIComponent(urlObj.password)` only | ❌ Rejected — crashes the process on a literal `%` password (`URIError` at module load) → would break a currently-working credential. |
| D. Re-encode the value / `URLSearchParams`-style unescape | ❌ Rejected — double-encoding and `+`→space conversion are both wrong for MariaDB passwords. |
| E. Drop credentials from the URL (separate env vars) | ❌ Rejected — environment/schema churn, out of scope, and the requested behaviour is “handle URL-encoded characters”. |

No second connection engine is introduced; the driver remains the single client and the app keeps one code path per process.

---

## 5. Related finding F-2b — credential exposure on a malformed URL

`new URL("mysql://user:pa/ss@127.0.0.1:3308/db")` throws `ERR_INVALID_URL`, and the thrown object carries an enumerable `input` property holding the **whole URL including the password**:

| Check | Result |
|-------|--------|
| `util.inspect(err)` contains the password | **true** |
| `JSON.stringify(err)` contains the password | **true** |
| `console.log(err)` (i.e. any framework error logger) leaks it | **true** |
| `String(err)` leaks it | false |

So a password containing `/` (or any other unparseable character) does not merely fail to connect — it can print the credential into application/Next.js logs on startup. The recommended fix therefore replaces the URL with a **sanitized** error message and deliberately does **not** attach `{ cause }` or the raw URL.

---

## 6. Minimal implementation proposal (to be applied **only after approval**)

**New file `src/lib/database-url.ts`** — pure parser, no I/O, no logging, no connection:

```ts
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/;

/** Decode a userinfo component exactly once; never throw, never double-decode. */
export function decodeCredential(value: string): string {
  if (!PERCENT_ESCAPE.test(value)) return value;   // covers a literal "100%" (% not escaped by URL)
  try {
    return decodeURIComponent(value);
  } catch {
    return value;                                  // malformed escape: keep today's behaviour
  }
}

export function parseDatabaseUrl(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Sanitized on purpose: the original error's `input` property carries the raw URL
    // (password included) and would be printed by most error loggers.
    throw new Error(
      "DATABASE_URL is not a valid connection URL — percent-encode special characters " +
        "in the password (`=` as %3D, `@` as %40, `%` as %25, `/` as %2F)."
    );
  }
  return {
    host: parsed.hostname,
    port: parseInt(parsed.port || "3306"),
    user: decodeCredential(parsed.username),
    password: decodeCredential(parsed.password),
    database: parsed.pathname.replace("/", ""),
  };
}
```

**`src/lib/prisma.ts`** (`ls. 8-23`): keep the missing-env-var throw, replace the inline parse with `parseDatabaseUrl(url)`, and expose the factory for the regression test:

```ts
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) { ... }
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
```

(Only a new default parameter and an `export`; runtime behaviour of the singleton is unchanged.)

**`prisma/seed.ts`** (`ls. 7-16`): identical substitution, keeping its existing fallback URL string.

Semantics deliberately preserved: `host`, `port` default `3306`, `database`, `connectionLimit: 5`, missing-var message, singleton/global caching, log configuration.

## 7. Exact files to change

| # | File | Change |
|---|------|--------|
| 1 | `src/lib/database-url.ts` | **NEW** — helper above |
| 2 | `src/lib/prisma.ts` | use helper; `export function createPrismaClient(databaseUrl = …)` |
| 3 | `prisma/seed.ts` | use helper |
| 4 | `src/lib/database-url.unit.test.ts` | **NEW** — unit matrix (no DB) |
| 5 | `tests/database-connection.integration.test.ts` | **NEW** — live F-2 regression against v3 |
| 6 | `tests/setup.ts` | **comment only** (L120-138): the note claiming “`@/lib/prisma` … never percent-decodes them” becomes stale. **Logic untouched** — the encoded-credential fail-closed guard stays exactly as it is. |
| 7 | `docs/accounting-hardening/STEP-2C-4-DATABASE-CONNECTION.md`, `ROADMAP.md` | verification section + status |
| 8 | *(opt-in, ask)* `scripts/prisma-diag.mjs:29`, `scripts/diag-p3018.mjs:37`, `scripts/backfill-branch.ts:27` | same one-line substitution via `decodeCredential` — identical defect, and `diag-p3018.mjs` exists precisely to diagnose the symptoms F-2 causes. **Recommended but optional**; say the word and it is included or dropped. |

Untouched by design: `prisma.config.ts`, `prisma/schema.prisma`, all migrations, `.env`, `.env.test`, `.env.example`, `tests/fixtures/*`, the five accounting suites, `src/services/report/report.service.ts` (2C.3B fix must stay byte-identical).

## 8. Regression test design

**Unit (`src/lib/database-url.unit.test.ts`, `node:test`, no DB, runs like the M2 unit suite):**

1. simple password → unchanged; 2. `%2B` → `+`; 3. `%3D` → `=`; 4. `%40` → `@`; 5. `%25` → `%`; 6. literal `=`, `@`, `:` → correct value; 7. literal `+` stays `+` (no space conversion); 8. bare `100%` → `100%` and **does not throw**; 9. `a%zz` (malformed escape) → unchanged, no throw; 10. encoded **username** decoded; 11. `%2525` → `%25` (decoded **exactly once**, no double-decode); 12. default port `3306` and explicit port; 13. database name parsing; 14. malformed URL (`/` in password) → sanitized `Error` whose message contains neither the URL nor the credential; 15. `prisma.ts`-level: missing `DATABASE_URL` still throws the original message.

**Integration (`tests/database-connection.integration.test.ts`, `node:test`, `import "./setup"` first, live v3, read-only):**

1. `createPrismaClient()` with the pinned `.env.test` credential → `SELECT DATABASE()` = `restaurant_app_test_v3` **and** `assertLiveTestTarget()` on the same connection — **existing behaviour unchanged**.
2. `createPrismaClient(<same credential, first char percent-escaped>)` → **must connect** (the F-2 proof; this is exactly the case that fails today).
3. Literal-special variant (`=`, `@`, `:` inside the credential) → **must connect**.
4. Deliberately wrong password → fails **safely**: `PrismaClientKnownRequestError`, and the serialized error contains **neither** the credential **nor** the URL.
5. Log exposure: `process.stderr.write` / `console.error` captured across cases 1-4 must never contain the credential (Prisma prints `prisma:error … pool timeout`).
6. Static guard: `tests/setup.ts` still fails closed (asserted by the guard running at import) and no test writes a row (no cleanup/residual delta expected; count parity asserted as in the accounting suites).
7. Mutation check: revert `src/lib/prisma.ts` to HEAD in a scratch copy → case 2 must fail (evidence that the test detects the defect), then restore and hash-verify.

No new DB user, password, container or credential is required by this design. Cases 2-3 reuse the existing test account's own password in a different URL encoding, and never alter it.

## 9. Database impact

* **None structural:** no schema change, no migration, no `CREATE/ALTER/DROP`, no new user, no password rotation, no writes at all — every statement in the new test is a `SELECT`.
* Reads/writes only ever target `127.0.0.1:3308 / restaurant_app_test_v3`. Ports **3306/3307**, `restaurant_app`, `restaurant_app_test` (v1) and `restaurant_app_test_v2` remain untouched and are still rejected by the centralized guard.
* Expected transient effect: 2-3 failed authentication attempts against the disposable container in the “wrong password” case. MariaDB counts per-account/per-host failures (`max_connect_errors`); the counter is reset by the successful connections in cases 1-3 and by the existing accounting suites.
* `A-9/A-11/A-12` reporting behaviour is untouched (no file in that path is edited).

## 10. Security impact

* Fixes authentication for credentials containing any userinfo-special or percent-encoded character, without logging anything from the helper.
* Adds **no** new secret surface; `.env`, `.env.test` and `.env.example` are not modified and no credential is printed by the new code or the new tests.
* **Reduces** exposure by replacing the `ERR_INVALID_URL` error object (whose `input` property leaks the full URL, §5) with a sanitized message carrying no `cause`.
* Keeps decoding **single-pass** (no double-decoding) and keeps the test guard enabled.

## 11. Rollback plan

* `git checkout -- src/lib/prisma.ts prisma/seed.ts` (and `tests/setup.ts` if the comment was updated), `rm src/lib/database-url.ts src/lib/database-url.unit.test.ts tests/database-connection.integration.test.ts`.
* No data, schema or migration state to unwind; no `.env` change to revert; no container/resource created. Rollback is instantaneous and leaves the pre-2C.4 tree (22-entry status) exactly as it is now.
* If only the integration test turns out to be flaky, it can be dropped independently — the production fix and the unit matrix stand alone.

## 12. Verification plan (after approval, sequentially)

1. `npx tsx --test src/lib/database-url.unit.test.ts` (new)
2. `npx tsx --test tests/database-connection.integration.test.ts` (new)
3. The five accounting suites, one file at a time — expect **110/110**: `cashbook` 15 · `revenue` 21 · `refund-profitability` 21 · `pnl` 24 · `integrity` 29
4. `npx tsx --test src/services/accounting/integrity.unit.test.ts` — expect **57/57**
5. `npx tsc --noEmit` · `npm run build` · `git diff --check` · eslint on the changed files only (project-wide lint debt left untouched)
6. Cleanup/parity check before vs after (`48` id-tables, `22` ledger rows, `0` business rows) and a 2C.3B-intact check (`git diff` of `src/services/report/report.service.ts` unchanged from HEAD-state)
7. Record real exit codes for every command; no commit/push/merge/deploy.

## 13. Approval gate — decisions requested

| # | Question | Recommendation |
|---|----------|----------------|
| A1 | Approve the root cause and the **minimal fix** (shared `parseDatabaseUrl`/`decodeCredential` helper, decode-once, guarded, sanitized parse error)? | Approve |
| A2 | Approve exposing `createPrismaClient(databaseUrl?)` from `src/lib/prisma.ts` so the regression can drive the **real** wiring instead of the driver directly? | Approve |
| A3 | Include the three `scripts/*` sites (§7 item 8)? | Include — same defect in ops tooling; one line each |
| A4 | Allow the **comment-only** correction in `tests/setup.ts` (guard logic untouched)? | Approve |
| A5 | Confirm the new files/names (`src/lib/database-url.ts`, `src/lib/database-url.unit.test.ts`, `tests/database-connection.integration.test.ts`) | Approve |

**Decision:** all five were **APPROVED** by the reviewer; see §16 for the implementation actually applied.
The audit above was produced with **no** production file modified (the phase had stopped at this gate).

## 14. Not done / out of scope (stated, not hidden)

* ~~No production code change, no verification run yet~~ — superseded by §16-§19 (implementation approved and verified).
* The optional six-site canonical-predicate cleanup from 2C.3B is still parked for 2C.7.
* F-5/M-1/M-2 (2C.5), F-6/F-8 (2C.6) untouched.
* F-2 does not explain the *deployed* environment: the production `DATABASE_URL` is not available to this audit, so it is unknown whether the live credential contains an affected character. The fix is required either way, because the defect is deterministic for any such credential.

## 15. Probe hygiene note (disclosed)

One temporary probe process (`tsx`, ESM import hoisting) created the Prisma client **before** the probe assigned `DATABASE_URL`, so it inherited the ambient `.env` value and issued

```sql
SELECT DATABASE(), 1
```

against `localhost:3306 / restaurant_app` — **a read-only constant `SELECT`; no write, no DDL, no data change**. The probe was discarded and re-run with an explicit `DATABASE_URL` **and** a fail-closed in-script guard that exits unless the target is exactly `127.0.0.1:3308 / restaurant_app_test_v3`. All evidence in §3.2/§5 was produced under that guard. Flagged here for the record rather than left implicit.

Second disclosure, same session: the read-only `SHOW GRANTS` inspection on the disposable v3 container printed the line

```
GRANT USAGE ON *.* TO `restaurant_test_v3`@`%` IDENTIFIED BY PASSWORD '<hash>'
```

into the terminal transcript. That is the MariaDB **hashed** (`mysql_native_password`) form of the **disposable test account's** password — not the password itself and not a connection string — and it concerns the throwaway test account only (never `.env`, `.env.test`, the application account or any production credential). Recorded because “no secret material was emitted” would be slightly too strong a claim: no *plaintext* password and no full connection string was ever printed, but one password **hash** of the test user was. No `SHOW GRANTS` (or any other hash-printing) statement was issued in the implementation/verification half of the phase.

---

# PART II — APPROVED IMPLEMENTATION AND VERIFICATION

## 16. Implementation (approved scope only)

| File | Change | Δ lines (`git diff --stat`) | File size |
|------|--------|------------------------------|-----------|
| `src/lib/database-url.ts` | **NEW** — `decodeCredential()` + `parseDatabaseUrl()`; pure, no I/O, no logging, no connection | +87 (untracked) | 87 |
| `src/lib/prisma.ts` | uses `parseDatabaseUrl(url)`; `createPrismaClient(databaseUrl = process.env.DATABASE_URL)` exported (A2). Missing-var message, `connectionLimit: 5`, log config and the `globalForPrisma` singleton are **unchanged** | 18 +, 10 − | 44 |
| `prisma/seed.ts` | uses `parseDatabaseUrl(url)`; the fallback URL string and `connectionLimit: 5` unchanged | 8 +, 7 − | 236 |
| `scripts/backfill-branch.ts` | imports the canonical `decodeCredential` (runs under `npx tsx`) | 4 +, 2 − | 233 |
| `scripts/prisma-diag.mjs`, `scripts/diag-p3018.mjs` | `user`/`password` decoded via a **local mirror** of `decodeCredential` | 14 +, 2 − each | 81 / 154 |
| `tests/setup.ts` | **comment only** (A4): history note that F-2 is fixed + why the guard stays | 8 comment lines replaced by 10 (L121-130); **0 code lines** — the guard block L131-143 is byte-identical | 357 |
| `src/lib/database-url.unit.test.ts` | **NEW** — 24 unit cases | +165 (untracked) | 165 |
| `tests/database-connection.integration.test.ts` | **NEW** — 4 live cases + in-test guard | +259 (untracked, inside untracked `tests/`) | 259 |

Totals for the tracked files: **58 insertions / 23 deletions across 5 files** (`src/lib/prisma.ts`, `prisma/seed.ts`,
three `scripts/*`), plus 3 new files and the comment-only `tests/setup.ts` edit.

**Deviation (documented, A3 scope respected).** The two `.mjs` diagnostics keep a **local mirror** of the decoder
instead of importing the TypeScript helper: their own headers document `node scripts/<file>.mjs` (plain Node), and
`package.json` still allows `node >= 20.9.0`, where importing `.ts` is not guaranteed. A JS copy of a 6-line pure
function was judged safer than changing how the ops scripts are launched. `scripts/backfill-branch.ts` is a `tsx`
script and therefore imports the canonical helper. Neither is a second connection engine.

**Guard untouched:** `tests/setup.ts` keeps `assertApprovedTarget`, the protected-port/database rejection and the
percent-encoded-credential fail-closed check byte-for-byte; only the explanatory comment above it changed.

## 17. Pre-implementation semantic validation (required before editing)

Measured on the shipped helper before it was wired in:

| Input written in the URL | `.password` today | driver received **before** | helper output | verdict |
|---|---|---|---|---|
| `simplepassword` | `simplepassword` | correct | `simplepassword` | unchanged |
| `a+b` (literal) | `a+b` | correct | `a+b` | unchanged — **no `+` → space** |
| `a%2Bb` | `a%2Bb` | ❌ `a%2Bb` | `a+b` | fixed |
| `a=b`, `a%3Db` | `a%3Db` | ❌ `a%3Db` | `a=b` | fixed |
| `a@b`, `a%40b` | `a%40b` | ❌ `a%40b` | `a@b` | fixed |
| `a:b`, `a;b`, `a\|b`, `a[b]`, `a b` | `%3A`/`%3B`/`%7C`/`%5B%5D`/`%20` | ❌ encoded | literal value | fixed |
| `100%25` | `100%25` | ❌ `100%25` | `100%` | fixed |
| `100%`, `%`, `%2`, `%2G`, `a%zz` | unchanged | works today | identical value, **no `URIError`** | **unchanged** |
| `50%off%20more` | unchanged | works today | identical value (decode abandoned whole, never partial) | **unchanged** |
| `%2525` | `%2525` | ❌ | `%25` | fixed, decoded **once** |
| `%2541` | `%2541` | ❌ | `%41` | fixed, decoded **once** (a double decode would yield `A`) |

**No STOP condition arose.** The fallback preserves every credential that works today; the only behaviour changes
are on inputs whose URL semantics already say “this is an escape”, i.e. exactly the defect being fixed. One
deliberate consequence is worth stating: a password that *intends* the literal characters `%41` must be written
`%2541` (a well-formed escape is always decoded once, as any URL consumer — including the driver's own URI parser —
would). Documented here rather than silently absorbed.

## 18. Regression coverage

**`src/lib/database-url.unit.test.ts` — 24 cases, no database.** Simple credential · empty credential · `%2B` ·
`%3D` · `%40` · `%25` · `%20` · `%5F` · mixed escapes · literal `+` preserved · bare `%` (`100%`, `%`, `50%off`) ·
malformed escapes (`%2`, `%2G`, `a%zz`) · malformed-inside-well-formed (`50%off%20more`, no partial decode) ·
exactly-once (`%2525`, `%252B`, `%2541`) · literal specials `= : ; @ | [ ] ^` and space · encoded username ·
default port 3306 · explicit port 3311 · database name · sanitized malformed-URL error (no URL, no host, no user,
no password in message/`inspect`/`JSON.stringify`, `cause === undefined`) · `createPrismaClient()` missing-var message.

**`tests/database-connection.integration.test.ts` — 4 live cases (read-only) + the mandated guard.**
Guard order: `./setup` (loads `.env.test`, validates, pins `DATABASE_URL`) → in-test re-validation of **both**
effective URLs (protected ports 3306/3307, protected names, host/port/database/dedicated user) → **then**
`await import("@/lib/prisma")` (dynamic, never a static import) → `assertLiveTestTarget()` live identity.

1. existing `.env.test` credential connects → `DATABASE()` = `restaurant_app_test_v3`, `USER()` = `restaurant_test_v3@…`, server `11.8.9-MariaDB-ubu2404`;
2. **equivalent percent-encoded credential connects** (same account, one character escaped) — the F-2 proof, 53 ms;
3. wrong credential fails safely (`P2010` pool timeout) with the credential, the `user:` prefix, the host:port and `mysql://` asserted **absent** from both the error and the captured stdout/stderr/console output;
4. no business-data writes: 21 monitored tables identical before/after, and **0 non-zero** rows in the approved database.

## 19. Mutation verification (isolated, working tree never reverted)

A temporary scratch script reproduced the pre-2C.4 parser (byte-equivalent to the removed `src/lib/prisma.ts`
lines) next to the real helper. Working-tree files were **not** modified or reverted; the scratch file was deleted
after the run.

| Check | Result |
|---|---|
| Unit-level: old parser vs the new expectations (`%2B`, `%3D`, `%40`, `%25`) | old value wrong in **4/4** cases (`a%2Bb`, `a%3Db`, `a%40b`, `100%25`) — the suite detects the defect |
| Live: old parser + encoded credential | ❌ `ER_ACCESS_DENIED_ERROR` |
| Live: fixed parser + encoded credential | ✅ CONNECTED |
| Live: fixed parser + real credential (control) | ✅ CONNECTED (behaviour unchanged) |

## 20. Verification results — real exit codes

Run sequentially, one suite file at a time, against **v3 only** (`127.0.0.1:3308`, banner printed by every suite).

| # | Command | Result | Exit |
|---|---------|--------|------|
| 1 | `npx tsx --test src/lib/database-url.unit.test.ts` | **24/24** pass, 0 fail, 0 skipped | **0** |
| 2 | `npx tsx --test tests/database-connection.integration.test.ts` | **4/4** pass, 0 fail, 0 skipped | **0** |
| 3 | `npx tsx --test tests/accounting/cashbook.integration.test.ts` | **15/15** | **0** |
| 4 | `npx tsx --test tests/accounting/revenue.integration.test.ts` | **21/21** | **0** |
| 5 | `npx tsx --test tests/accounting/refund-profitability.integration.test.ts` | **21/21** | **0** |
| 6 | `npx tsx --test tests/accounting/pnl.integration.test.ts` | **24/24** | **0** |
| 7 | `npx tsx --test tests/accounting/integrity.integration.test.ts` | **29/29** | **0** |
| 8 | `npx tsx --test src/services/accounting/integrity.unit.test.ts` | **57/57** | **0** |
| 9 | `npx tsc --noEmit` | clean | **0** |
| 10 | `npm run build` | compiled | **0** |
| 11 | `git diff --check` | clean | **0** |
| 12 | `npx eslint <6 changed files>` | clean | **0** |
| 12b | `npx eslint .` (project-wide) | **245 problems (106 errors / 139 warnings)** — identical to the 2C.3B pre-phase count | 1 (pre-existing debt, **0 new**) |

**Accounting baseline preserved: 110/110 integration** (15+21+21+24+29) and **57/57 M2 unit** — no regression.

`npm run build` regenerated the auto-generated `next-env.d.ts` (only the unrelated `./.next/dev/types/*` →
`./.next/types/*` reference switch); it was **restored to HEAD** afterwards, exactly as in 2C.3B. Its 6 Turbopack
warnings are pre-existing dynamic-filesystem-tracing warnings in the upload routes.

## 21. Database impact and cleanup

Read-only whole-database snapshot, taken immediately before and immediately after the entire verification sweep:

| Metric | Before | After |
|--------|--------|-------|
| tables in `restaurant_app_test_v3` | 49 | 49 |
| applied migrations (`_prisma_migrations`) | 22 | 22 |
| non-zero tables | `_prisma_migrations=22` | `_prisma_migrations=22` |
| business rows | **0** | **0** |

The two snapshots are **byte-identical** (`diff` empty): no residual rows, no ledger change, no schema or migration
change, no new user/database/container, no password rotation. Every statement issued to the database in this phase
was a `SELECT`. Ports 3306/3307, `restaurant_app`, `restaurant_app_test` (v1) and `restaurant_app_test_v2` were never
contacted and remain rejected by the centralized guard.

## 22. Security results

* **F-2b fixed:** a URL that cannot be parsed now throws a message naming only the fix (`percent-encode … in the
  password`) with no URL, no host, no user, no password and **no `cause`** — the leak path through
  `ERR_INVALID_URL.input` (`util.inspect` / `console.log` / `JSON.stringify` all printed it before) is gone and is
  asserted in the unit suite.
* **No exposure at runtime:** case 3 of the integration suite captures stdout + stderr + `console.*` while a failing
  connection logs `prisma:error … pool timeout` and asserts the real credential, its encoded form, the wrong
  credential, the `user:` prefix, the host:port and `mysql://` never appear.
* Decoding happens exactly once; a literal `+` is never converted to a space; no double decoding.
* `.env`, `.env.test`, `.env.example`, `prisma.config.ts`, `prisma/schema.prisma` and every migration: **untouched**.
* No secret (plaintext password, full URL, password hash) was printed anywhere in Part II.

## 23. Limitations and follow-ups

* `tests/README.md:97` still describes the **pre-fix** behaviour (“`src/lib/prisma.ts` passes URL credentials to the
  driver without decoding”). It is **outside the approved file scope**, so it was deliberately left as-is — it needs
  a one-line correction in the next approved touch (2C.7 candidates).
* The two `.mjs` mirrors must be kept in sync with `src/lib/database-url.ts` (they carry a comment saying so); they
  can be collapsed if the Node baseline is ever raised above 22.18 (default type stripping).
* The deployed/production `DATABASE_URL` remains unknown to this phase: whether the live credential contains an
  affected character cannot be determined from the repository.
* A credential that intends the *literal* characters of a well-formed escape must be written escaped (`%2541`), as
  described in §17 — a standards consequence, not a defect.
* Git working tree: **22 entries before the phase, 29 after** (+7: `src/lib/prisma.ts`, `prisma/seed.ts`, the three
  `scripts/*` files, `src/lib/database-url.ts`, `src/lib/database-url.unit.test.ts`;
  `tests/database-connection.integration.test.ts` lives inside the already-untracked `tests/` directory, and the
  build-generated `next-env.d.ts` was restored to HEAD). `git diff --summary` reports **no mode changes**.

**Phase 2C.4 ends here — no commit, no push, no merge, no deploy, and 2C.5 has not been started.**
