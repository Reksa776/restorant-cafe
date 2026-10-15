/**
 * Test Bootstrap - Fail-Closed Database Validation
 *
 * This module MUST be imported (as the FIRST import) before any test file that
 * accesses the database. It performs strict validation to prevent accidental
 * production database access.
 *
 * CHECK REQUIREMENTS:
 * 1. `.env.test` is loaded when TEST_DATABASE_URL is not already in the env.
 * 2. NODE_ENV != 'production'
 * 3. TEST_DATABASE_URL is set
 * 4. TEST_DATABASE_URL != DATABASE_URL, unless NODE_ENV=test (a test run may
 *    legitimately point both at the isolated test database)
 * 5. Database name is not a known production name
 * 6. Database name contains '_test' (warning only)
 * 7. DATABASE_URL is PINNED to TEST_DATABASE_URL, so the application Prisma
 *    singleton (@/lib/prisma) can never open the application database during a
 *    test run — even when the ambient DATABASE_URL points somewhere else.
 *
 * STEP 2C.2F — ADDED REQUIREMENTS (centralised approved-target guard):
 * 8.  Both TEST_DATABASE_URL and DATABASE_URL must be present and must resolve
 *     to the SAME target; a missing or disagreeing pair is a refusal.
 * 9.  The target must be EXACTLY the approved one — scheme mysql, host
 *     `127.0.0.1` (never `localhost`), port `3308`, database
 *     `restaurant_app_test_v3`, user `restaurant_test_v3`.
 * 10. Protected databases (`restaurant_app`, `restaurant_app_test`,
 *     `restaurant_app_test_v2`, `production`, `main`, `app`) and protected
 *     ports (3306, 3307) are rejected BY NAME and BY PORT.
 * 11. `assertLiveTestTarget()` adds the LIVE half (`SELECT DATABASE()`/
 *     `USER()`/`VERSION()` against the connection the suite actually opened) and
 *     is called from each suite's safety test.
 * 12. Credentials are never printed, logged or echoed.
 *
 * STEP 2B.1 note: the pin (7) is not theoretical. The local `.env.test` was
 * found shipping `DATABASE_URL="mysql://restaurant:***@localhost:3307/restaurant_app"`
 * (the APPLICATION database) while TEST_DATABASE_URL correctly pointed at the
 * isolated `restaurant_app_test`. Without the pin, importing any accounting
 * service would have opened the application database.
 */

import path from "node:path";
import { config as loadEnvFile } from "dotenv";

// ------------------------------------------------------------
// 1. Load `.env.test` (only when the runner did not already export a test URL).
// ------------------------------------------------------------
const TEST_ENV_FILE = path.resolve(process.cwd(), ".env.test");

if (!process.env.TEST_DATABASE_URL) {
  const loaded = loadEnvFile({ path: TEST_ENV_FILE, quiet: true });
  if (loaded.error) {
    console.warn(
      `[TEST SETUP] Could not load ${TEST_ENV_FILE} ` +
        `(${loaded.error.message}) — relying on the process environment.`
    );
  } else {
    console.log(`[TEST SETUP] Loaded test environment from ${TEST_ENV_FILE}`);
  }
}

// FAIL-CLOSED: Reject production environment
if (process.env.NODE_ENV === "production") {
  throw new Error(
    '[TEST SAFETY] Integration tests must NOT run in production environment. ' +
      'Set NODE_ENV=test and provide TEST_DATABASE_URL.'
  );
}

// FAIL-CLOSED: Require TEST_DATABASE_URL
if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    '[TEST SAFETY] TEST_DATABASE_URL must be set for integration tests. ' +
      'This prevents accidental use of production DATABASE_URL.'
  );
}

const testDbUrl = process.env.TEST_DATABASE_URL;
const mainDbUrl = process.env.DATABASE_URL;

// FAIL-CLOSED: Ensure test DB is different from main DB
// During integration tests (NODE_ENV=test), DATABASE_URL may legitimately
// point to the same test database as TEST_DATABASE_URL.
// Safety is maintained by requiring test database name validation below.
if (mainDbUrl && testDbUrl === mainDbUrl && process.env.NODE_ENV !== "test") {
  throw new Error(
    '[TEST SAFETY] TEST_DATABASE_URL must be different from DATABASE_URL. ' +
      'Using production database for tests is not allowed.'
  );
}

// FAIL-CLOSED: Verify test database name
try {
  const url = new URL(testDbUrl);
  const dbName = url.pathname.replace("/", "");

  // Reject production database names
  const productionNames = ["restaurant_app", "production", "main", "app"];
  if (productionNames.includes(dbName)) {
    throw new Error(
      `[TEST SAFETY] Database '${dbName}' appears to be production. ` +
        'Use a separate test database (e.g., restaurant_app_test).'
    );
  }

  // Warn if test database name doesn't follow convention
  if (!dbName.includes("_test") && !dbName.includes("_test_")) {
    console.warn(
      `[TEST SAFETY] Warning: Database name '${dbName}' does not follow test naming convention. ` +
        'Consider using a name like "restaurant_app_test" for clarity.'
    );
  }
} catch (e) {
  if (e instanceof Error && e.message.startsWith("[TEST SAFETY]")) {
    throw e;
  }
  throw new Error(
    `[TEST SAFETY] Invalid TEST_DATABASE_URL format: ${e instanceof Error ? e.message : String(e)}`
  );
}

// FAIL-CLOSED: credentials must not be percent-encoded.
//
// History (STEP 2C.4 / F-2): `@/lib/prisma` used to build the driver config with
// the raw `urlObj.username` / `urlObj.password`, which the WHATWG URL parser
// returns percent-encoded — a base64-style test password containing "+" / "="
// arrived at MariaDB still encoded and every query failed with a confusing
// `pool timeout` instead. That production defect is now FIXED: the credentials
// are decoded exactly once by `@/lib/database-url`. The guard below is kept on
// purpose (behaviour unchanged): fixture credentials stay URL-safe so a failure
// in this suite can never be confused with a credential-encoding problem.
{
  const parsed = new URL(testDbUrl);
  const ENCODED = /%[0-9A-Fa-f]{2}/;
  if (ENCODED.test(parsed.username) || ENCODED.test(parsed.password)) {
    throw new Error(
      "[TEST SAFETY] TEST_DATABASE_URL credentials are percent-encoded " +
        "(e.g. %2B / %3D). The application Prisma client passes URL credentials " +
        "to the driver without decoding, so such a credential can never " +
        "authenticate. Rotate the test user's password to a URL-safe value " +
        "and keep TEST_DATABASE_URL in that plain form."
    );
  }
}

// ============================================================
// 2. APPROVED-TARGET GUARD (STEP 2C.2F) — fail closed on anything else
//
// The ONLY approved integration-test target is the dedicated, disposable v3
// database on the isolated test container. Protected databases are rejected by
// name AND by port; an ambiguous or missing pair is rejected too. This lives
// here — not in each suite — so a new consumer cannot silently skip it.
// ============================================================

export const APPROVED_TEST_TARGET = {
  scheme: "mysql:",
  host: "127.0.0.1",
  port: "3308",
  database: "restaurant_app_test_v3",
  user: "restaurant_test_v3",
} as const;

/** Ports that are NEVER a valid test target. */
const PROTECTED_PORTS = [
  "3306", // shared HOST application database (system mariadb.service)
  "3307", // sibling project restorant-cafe2's container — a different project
] as const;

/** Database names that are NEVER a valid test target. */
const PROTECTED_DATABASES = [
  "restaurant_app", // the shared host application database
  "restaurant_app_test", // legacy isolated test DB (v1) — retained as evidence
  "restaurant_app_test_v2", // failed STEP 2C.2B evidence DB — never written again
  "production",
  "main",
  "app",
] as const;

interface ParsedTarget {
  host: string;
  port: string;
  database: string;
  user: string;
}

function parseTarget(label: string, raw: string): ParsedTarget {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`[TEST SAFETY] ${label} is not a valid URL.`);
  }
  if (url.protocol !== APPROVED_TEST_TARGET.scheme) {
    throw new Error(
      `[TEST SAFETY] ${label} must use the '${APPROVED_TEST_TARGET.scheme}' scheme.`
    );
  }
  return {
    host: url.hostname,
    port: url.port || "3306",
    database: url.pathname.replace(/^\//, ""),
    user: decodeURIComponent(url.username),
  };
}

/** Rejects every target that is not exactly the approved one. */
function assertApprovedTarget(label: string, raw: string | undefined): ParsedTarget {
  if (!raw || raw.trim() === "") {
    throw new Error(
      `[TEST SAFETY] ${label} is missing. Integration tests require an explicit connection ` +
        `string for the approved target ${APPROVED_TEST_TARGET.host}:${APPROVED_TEST_TARGET.port}` +
        `/${APPROVED_TEST_TARGET.database} (see .env.test.example).`
    );
  }
  const target = parseTarget(label, raw);
  if ((PROTECTED_DATABASES as readonly string[]).includes(target.database)) {
    throw new Error(
      `[TEST SAFETY] ${label} names the PROTECTED database '${target.database}' — refusing to run.`
    );
  }
  if ((PROTECTED_PORTS as readonly string[]).includes(target.port)) {
    throw new Error(
      `[TEST SAFETY] ${label} targets PROTECTED port ${target.port} — refusing to run.`
    );
  }
  if (target.host !== APPROVED_TEST_TARGET.host) {
    throw new Error(
      `[TEST SAFETY] ${label} host is '${target.host}' — only ` +
        `'${APPROVED_TEST_TARGET.host}' is approved. 'localhost' is rejected on purpose: it can ` +
        "resolve to ::1 or to a different daemon than the approved container."
    );
  }
  if (target.port !== APPROVED_TEST_TARGET.port) {
    throw new Error(
      `[TEST SAFETY] ${label} port is '${target.port}' — only ` +
        `${APPROVED_TEST_TARGET.port} is approved.`
    );
  }
  if (target.database !== APPROVED_TEST_TARGET.database) {
    throw new Error(
      `[TEST SAFETY] ${label} database is '${target.database}' — only ` +
        `'${APPROVED_TEST_TARGET.database}' is approved.`
    );
  }
  if (target.user !== APPROVED_TEST_TARGET.user) {
    throw new Error(
      `[TEST SAFETY] ${label} user is '${target.user}' — only the dedicated ` +
        `'${APPROVED_TEST_TARGET.user}' account is approved.`
    );
  }
  return target;
}

const approvedTest = assertApprovedTarget("TEST_DATABASE_URL", process.env.TEST_DATABASE_URL);
const approvedMain = assertApprovedTarget("DATABASE_URL", process.env.DATABASE_URL);

// Both effective connection strings must resolve to the SAME approved target.
// An ambiguous pair (e.g. TEST → the test DB, DATABASE → the host app DB) is a
// refusal, never a warning.
for (const key of ["host", "port", "database", "user"] as const) {
  if (approvedTest[key] !== approvedMain[key]) {
    throw new Error(
      `[TEST SAFETY] TEST_DATABASE_URL and DATABASE_URL disagree on '${key}' ` +
        `('${approvedTest[key]}' vs '${approvedMain[key]}') — refusing an ambiguous target.`
    );
  }
}

/** Minimal structural type so this module need not import Prisma types. */
export interface RawQueryable {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * The LIVE half of the approved-target guard.
 *
 * `@@port` is deliberately NOT asserted: inside the container the server listens
 * on 3306, and the host-side port 3308 was already enforced from the URL above.
 * Only the database and the dedicated account are asserted live.
 */
export async function assertLiveTestTarget(db: RawQueryable): Promise<{
  db: string;
  user: string;
  host: string;
  port: string;
  version: string;
}> {
  const rows = await db.$queryRaw<
    Array<{ db: string; user: string; host: string; port: string; version: string }>
  >`SELECT CAST(DATABASE() AS CHAR) AS db,
           CAST(USER() AS CHAR) AS user,
           CAST(@@hostname AS CHAR) AS host,
           CAST(@@port AS CHAR) AS port,
           CAST(VERSION() AS CHAR) AS version`;
  const identity = rows[0];
  if (!identity) {
    throw new Error("[TEST SAFETY] the live identity query returned no row.");
  }
  if (identity.db !== APPROVED_TEST_TARGET.database) {
    throw new Error(
      `[TEST SAFETY] live DATABASE() = '${identity.db}' — expected ` +
        `'${APPROVED_TEST_TARGET.database}'. This connection is NOT the approved test target.`
    );
  }
  if (!identity.user.startsWith(`${APPROVED_TEST_TARGET.user}@`)) {
    throw new Error(
      `[TEST SAFETY] live USER() = '${identity.user}' — expected the dedicated ` +
        `'${APPROVED_TEST_TARGET.user}' account.`
    );
  }
  if (!/MariaDB/i.test(identity.version)) {
    throw new Error(
      `[TEST SAFETY] live VERSION() = '${identity.version}' — expected MariaDB.`
    );
  }
  return identity;
}

// ------------------------------------------------------------
// 3. PIN the application connection string to the test database.
//
// `@/lib/prisma` reads process.env.DATABASE_URL WHEN IT IS FIRST IMPORTED, so
// this assignment must happen before any service/prisma import. Test files
// therefore import this module first.
// ------------------------------------------------------------
if (mainDbUrl && mainDbUrl !== testDbUrl) {
  console.warn(
    "[TEST SETUP] Ambient DATABASE_URL differed from TEST_DATABASE_URL — " +
      "pinned to the TEST_DATABASE_URL for this run (the application database " +
      "is never opened by integration tests)."
  );
}
process.env.DATABASE_URL = testDbUrl;

// At this point, all safety checks pass
const testDbConfig = new URL(testDbUrl);
console.log("[TEST SETUP] Database configuration validated against the approved target:");
console.log(`  Host: ${testDbConfig.hostname}:${testDbConfig.port}`);
console.log(`  Database: ${testDbConfig.pathname.replace("/", "")}`);
console.log(`  User: ${testDbConfig.username || "none"}`);
console.log(
  `  Approved target (STEP 2C.2F): ${APPROVED_TEST_TARGET.host}:${APPROVED_TEST_TARGET.port}` +
    `/${APPROVED_TEST_TARGET.database} as ${APPROVED_TEST_TARGET.user}`
);
console.log(
  "  Protected (rejected by name and port): restaurant_app, restaurant_app_test, " +
    "restaurant_app_test_v2, production, main, app; ports 3306, 3307"
);

/** Effective target the tests will use (never contains the password). */
export const EXPECTED_TEST_DB = {
  host: testDbConfig.hostname,
  port: testDbConfig.port,
  name: testDbConfig.pathname.replace("/", ""),
  user: testDbConfig.username,
} as const;

export { testDbConfig };
