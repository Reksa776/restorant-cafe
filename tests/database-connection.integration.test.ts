/**
 * STEP 2C.4 — F-2 live regression: DATABASE_URL credential encoding.
 *
 * Scope and safety
 * ----------------
 * Read-only (`SELECT`), single suite file, approved disposable target ONLY
 * (`127.0.0.1:3308 / restaurant_app_test_v3` as `restaurant_test_v3`).
 *
 * `./setup` is imported first: it loads `.env.test`, rejects protected ports
 * (3306 / 3307) and protected database names, validates the dedicated test user,
 * and pins `DATABASE_URL` to `TEST_DATABASE_URL`. On top of that, this file
 * re-validates both effective URLs *in the test process* and imports the
 * production Prisma module **dynamically, only after that validation passes** —
 * an inherited application `.env` value must never become the target.
 *
 * The percent-encoded case is built from the SAME test credential by escaping
 * one character, so no new user, password, database, container or migration is
 * involved, and nothing is ever printed.
 */
import {
  APPROVED_TEST_TARGET,
  EXPECTED_TEST_DB,
  assertLiveTestTarget,
} from "./setup"; // MUST stay first (see the module header of tests/setup.ts)

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { snapshotCounts, type ScopedCounts } from "./fixtures/accounting";

// ------------------------------------------------------------
// Guard: fail closed on anything that is not the approved target.
// Messages never echo the URL or the credential.
// ------------------------------------------------------------
const PROTECTED_PORTS = ["3306", "3307"];
const PROTECTED_DATABASES = [
  "restaurant_app",
  "restaurant_app_test",
  "restaurant_app_test_v2",
  "production",
  "main",
  "app",
];

function assertApprovedTarget(label: string, raw: string | undefined): URL {
  if (!raw || raw.trim() === "") {
    throw new Error(`[F-2 GUARD] ${label} is missing.`);
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`[F-2 GUARD] ${label} is not a valid URL.`);
  }
  const port = parsed.port || "3306";
  const database = parsed.pathname.replace(/^\//, "");

  if (PROTECTED_PORTS.includes(port)) {
    throw new Error(`[F-2 GUARD] ${label} targets protected port ${port} — refusing.`);
  }
  if (PROTECTED_DATABASES.includes(database)) {
    throw new Error(`[F-2 GUARD] ${label} names a protected database — refusing.`);
  }
  if (parsed.protocol !== APPROVED_TEST_TARGET.scheme) {
    throw new Error(`[F-2 GUARD] ${label} must use '${APPROVED_TEST_TARGET.scheme}'.`);
  }
  if (parsed.hostname !== APPROVED_TEST_TARGET.host) {
    throw new Error(`[F-2 GUARD] ${label} host is not the approved host — refusing.`);
  }
  if (port !== APPROVED_TEST_TARGET.port) {
    throw new Error(`[F-2 GUARD] ${label} port is not the approved port — refusing.`);
  }
  if (database !== APPROVED_TEST_TARGET.database) {
    throw new Error(`[F-2 GUARD] ${label} database is not the approved database — refusing.`);
  }
  if (decodeURIComponent(parsed.username) !== APPROVED_TEST_TARGET.user) {
    throw new Error(`[F-2 GUARD] ${label} user is not the dedicated test user — refusing.`);
  }
  return parsed;
}

const testUrl = process.env.TEST_DATABASE_URL!;
const approvedTest = assertApprovedTarget("TEST_DATABASE_URL", testUrl);
assertApprovedTarget("DATABASE_URL", process.env.DATABASE_URL);

/** Credential actually written in `.env.test` for the dedicated test account. */
const realPassword = approvedTest.password;

/** Same URL, same account, but with `password` substituted verbatim. */
function urlWithPassword(password: string): string {
  const copy = new URL(approvedTest.toString());
  copy.password = password;
  return copy.toString();
}

/** Same credential with its first character percent-escaped (an equivalent URL). */
const encodedPassword =
  "%" +
  realPassword.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0") +
  realPassword.slice(1);
const encodedCredentialUrl = urlWithPassword(encodedPassword);
assertApprovedTarget("derived percent-encoded variant", encodedCredentialUrl);
assert.ok(
  decodeURIComponent(new URL(encodedCredentialUrl).password) === realPassword,
  "the variant must encode the same credential"
);

const wrongCredentialUrl = urlWithPassword("deliberately-wrong-password");
assertApprovedTarget("derived wrong-credential variant", wrongCredentialUrl);

type StreamWrite = typeof process.stdout.write;

/**
 * Replace a stream's `write` with a copy-and-forward tap. The original is bound
 * to its stream on purpose: the writable internals need their receiver.
 */
function tapStream(stream: NodeJS.WriteStream, sink: (text: string) => void): StreamWrite {
  const original: StreamWrite = stream.write.bind(stream);
  const patchedWrite = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ): boolean => {
    sink(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return typeof encodingOrCallback === "function"
      ? original(chunk, undefined, encodingOrCallback)
      : original(chunk, encodingOrCallback, callback);
  };
  // The single cast of the suite: `write` is overloaded, the tap is not.
  stream.write = patchedWrite as unknown as StreamWrite;
  return original;
}

/** Run `fn`, capturing (and still forwarding) everything written to the process output. */
async function captureOutput<T>(fn: () => Promise<T>): Promise<{ error?: unknown; output: string }> {
  let output = "";
  const stdoutWrite = tapStream(process.stdout, (text) => { output += text; });
  const stderrWrite = tapStream(process.stderr, (text) => { output += text; });
  const consoleError = console.error;
  const consoleLog = console.log;
  console.error = (...args: unknown[]) => {
    output += args.map(String).join(" ");
    consoleError(...args);
  };
  console.log = (...args: unknown[]) => {
    output += args.map(String).join(" ");
    consoleLog(...args);
  };

  try {
    await fn();
    return { output };
  } catch (error) {
    return { error, output };
  } finally {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
    console.error = consoleError;
    console.log = consoleLog;
  }
}

describe("STEP 2C.4 / F-2 — DATABASE_URL credential decoding", () => {
  let prisma: PrismaClient;
  let countsBefore: ScopedCounts;

  before(async () => {
    // Only now — after every guard above has passed — load the production module.
    const { createPrismaClient } = await import("@/lib/prisma");
    prisma = createPrismaClient();

    const identity = await assertLiveTestTarget(prisma);
    console.log(
      `[F-2] live target confirmed: database=${identity.db} user=${identity.user} ` +
        `server=${identity.version}`
    );
    console.log(
      `[F-2] approved target: ${APPROVED_TEST_TARGET.host}:${APPROVED_TEST_TARGET.port}` +
        `/${APPROVED_TEST_TARGET.database} as ${APPROVED_TEST_TARGET.user}` +
        ` | expected database=${EXPECTED_TEST_DB.name}`
    );

    countsBefore = await snapshotCounts(prisma);
  });

  after(async () => {
    if (!prisma) return;
    const countsAfter = await snapshotCounts(prisma);
    assert.deepEqual(countsAfter, countsBefore, "no business row counts may change");
    await prisma.$disconnect();
  });

  it("1 — the existing .env.test credential still connects (behaviour unchanged)", async () => {
    const rows = await prisma.$queryRaw<
      Array<{ db: string; ok: number }>
    >`SELECT CAST(DATABASE() AS CHAR) AS db, 1 AS ok`;

    assert.equal(rows[0]?.db, EXPECTED_TEST_DB.name);
    assert.deepEqual(rows[0]?.ok, 1);
    await assertLiveTestTarget(prisma);
  });

  it("2 — an equivalent percent-encoded credential connects (the F-2 fix)", async () => {
    const { createPrismaClient } = await import("@/lib/prisma");
    const client = createPrismaClient(encodedCredentialUrl);
    try {
      const rows = await client.$queryRaw<
        Array<{ db: string; ok: number }>
      >`SELECT CAST(DATABASE() AS CHAR) AS db, 1 AS ok`;
      assert.equal(rows[0]?.db, APPROVED_TEST_TARGET.database);
    } finally {
      await client.$disconnect();
    }
  });

  it("3 — a wrong credential fails safely, with no credential or URL in the error or the logs", async () => {
    const { createPrismaClient } = await import("@/lib/prisma");
    const client = createPrismaClient(wrongCredentialUrl);
    try {
      const { error, output } = await captureOutput(
        () => client.$queryRaw`SELECT 1 AS ok`
      );

      assert.ok(error, "a wrong credential must not connect");
      const text = [
        (error as Error).name,
        (error as { code?: string }).code,
        (error as Error).message,
        JSON.stringify((error as { meta?: unknown }).meta ?? null),
      ].join(" ");

      for (const secret of [realPassword, encodedPassword, "deliberately-wrong-password"]) {
        assert.ok(!text.includes(secret), "the error must not expose the credential");
        assert.ok(!output.includes(secret), "the captured output must not expose the credential");
      }
      for (const needle of [
        `${APPROVED_TEST_TARGET.user}:`,
        `${APPROVED_TEST_TARGET.host}:${APPROVED_TEST_TARGET.port}`,
        `mysql://`,
      ]) {
        assert.ok(!text.includes(needle), `the error must not contain '${needle}'`);
      }
    } finally {
      await client.$disconnect();
    }
  });

  it("4 — the suite performs no business-data writes (no residual rows)", async () => {
    const countsNow = await snapshotCounts(prisma);
    assert.deepEqual(countsNow, countsBefore, "snapshot before/after must be identical");

    const nonZero = Object.entries(countsNow).filter(([, count]) => count > 0);
    console.log(
      `[F-2] business row counts: ${Object.keys(countsNow).length} tables monitored, ` +
        `${nonZero.length} non-zero (${nonZero.map(([table, count]) => `${table}=${count}`).join(", ") || "none"})`
    );
    assert.deepEqual(nonZero, [], "the approved test database must hold no business rows");
  });
});
