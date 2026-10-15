/**
 * STEP 2C.4 — F-2 unit coverage for the DATABASE_URL credential parser.
 *
 * Pure: no database, no container, no filesystem, no application .env. Every URL
 * below is synthetic (`db.example`), so nothing here can reach a real server.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { inspect } from "node:util";
import { decodeCredential, parseDatabaseUrl } from "./database-url";

const HOST = "db.example";
const PORT = "3310";
const DB = "appdb";

/** Synthetic URL (never a live target) with `password` written verbatim. */
const urlWith = (password: string, user = "app_user") =>
  `mysql://${user}:${password}@${HOST}:${PORT}/${DB}`;

describe("decodeCredential — one guarded decode, no surprises", () => {
  const matrix: Array<[name: string, encoded: string, expected: string]> = [
    ["simple credential", "simplepassword", "simplepassword"],
    ["empty credential", "", ""],
    ["encoded plus (%2B)", "a%2Bb", "a+b"],
    ["encoded equals (%3D)", "a%3Db", "a=b"],
    ["encoded at-sign (%40)", "a%40b", "a@b"],
    ["encoded percent (%25)", "100%25", "100%"],
    ["encoded space (%20)", "a%20b", "a b"],
    ["encoded username separator (%5F)", "app%5Fuser", "app_user"],
    ["mixed escapes", "j%2Bd%3D8%40x%25", "j+d=8@x%"],
  ];

  for (const [name, encoded, expected] of matrix) {
    it(`decodes ${name}`, () => {
      assert.equal(decodeCredential(encoded), expected);
    });
  }

  it("preserves a literal plus sign (never becomes a space)", () => {
    assert.equal(decodeCredential("a+b"), "a+b");
    assert.equal(decodeCredential("a+b+c+d"), "a+b+c+d");
  });

  it("preserves a bare percent sign without throwing", () => {
    assert.equal(decodeCredential("100%"), "100%");
    assert.equal(decodeCredential("%"), "%");
    assert.equal(decodeCredential("50%off"), "50%off");
  });

  it("preserves malformed escapes without throwing", () => {
    assert.equal(decodeCredential("%2"), "%2");
    assert.equal(decodeCredential("%2G"), "%2G");
    assert.equal(decodeCredential("a%zz"), "a%zz");
  });

  it("abandons the whole decode when a malformed escape is present (never partial)", () => {
    // `%20` is well-formed but `%of` is not: the value is kept exactly as written
    // instead of being partially decoded.
    assert.equal(decodeCredential("50%off%20more"), "50%off%20more");
  });

  it("decodes exactly once — %2525 becomes %25, not %", () => {
    assert.equal(decodeCredential("%2525"), "%25");
    assert.equal(decodeCredential("%252B"), "%2B");
    // A double decode would turn this into 'A'; one decode yields the literal %41.
    assert.equal(decodeCredential("%2541"), "%41");
  });
});

describe("parseDatabaseUrl — credential + URL semantics", () => {
  it("parses simple credentials unchanged", () => {
    const parsed = parseDatabaseUrl(urlWith("simplepassword", "app_user"));
    assert.deepEqual(parsed, {
      host: HOST,
      port: 3310,
      user: "app_user",
      password: "simplepassword",
      database: DB,
    });
  });

  it("decodes the password once for every required escape", () => {
    for (const [password, expected] of [
      ["a%2Bb", "a+b"],
      ["a%3Db", "a=b"],
      ["a%40b", "a@b"],
      ["100%25", "100%"],
    ] as const) {
      assert.equal(parseDatabaseUrl(urlWith(password)).password, expected, password);
    }
  });

  it("decodes literal special characters the URL serializer escapes", () => {
    // The WHATWG userinfo serializer escapes these even when they are written
    // literally (measured): they must survive the round trip.
    for (const literal of ["a=b", "a:b", "a;b", "a@b", "a|b", "a[b]", "a^b", "a b"]) {
      assert.equal(parseDatabaseUrl(urlWith(literal)).password, literal, literal);
    }
  });

  it("keeps a literal plus and a bare percent", () => {
    assert.equal(parseDatabaseUrl(urlWith("a+b")).password, "a+b");
    assert.equal(parseDatabaseUrl(urlWith("100%")).password, "100%");
  });

  it("decodes an encoded username", () => {
    assert.equal(parseDatabaseUrl(urlWith("p", "app%5Fuser")).user, "app_user");
  });

  it("decodes credentials exactly once", () => {
    assert.equal(parseDatabaseUrl(urlWith("%2525")).password, "%25");
  });

  it("defaults the port to 3306 and keeps an explicit port", () => {
    assert.equal(parseDatabaseUrl(`mysql://app_user:p@${HOST}/${DB}`).port, 3306);
    assert.equal(parseDatabaseUrl(`mysql://app_user:p@${HOST}:3311/${DB}`).port, 3311);
  });

  it("parses the database name", () => {
    assert.equal(parseDatabaseUrl(`mysql://app_user:p@${HOST}:${PORT}/restaurant_app_test_v3`).database, "restaurant_app_test_v3");
    assert.equal(parseDatabaseUrl(urlWith("p")).database, DB);
  });

  it("fails with a sanitized error when the URL cannot be parsed", () => {
    const secret = "pa/ss-word";               // a literal '/' makes the URL unparseable
    const rawUrl = urlWith(secret);

    let caught: unknown;
    try {
      parseDatabaseUrl(rawUrl);
    } catch (error) {
      caught = error;
    }

    assert.ok(caught instanceof Error, "an Error must be thrown");
    const message = (caught as Error).message;
    assert.match(message, /DATABASE_URL/);
    assert.match(message, /percent-encode/);

    // Never the raw URL, the credential, the host or the original error object.
    const rendered = `${message} ${inspect(caught)} ${JSON.stringify(caught)}`;
    assert.ok(!rendered.includes(secret), "the password must not appear in the error");
    assert.ok(!rendered.includes(HOST), "the host must not appear in the error");
    assert.ok(!rendered.includes("app_user"), "the username must not appear in the error");
    assert.equal((caught as Error).cause, undefined);
  });

  it("keeps the 'DATABASE_URL environment variable is not set' behaviour of src/lib/prisma.ts", async () => {
    const previous = process.env.DATABASE_URL;
    // Placeholder target only so the module import cannot fail for another
    // reason. No connection is opened: the adapter connects lazily on first query.
    process.env.DATABASE_URL = `mysql://nobody:placeholder@${HOST}:${PORT}/${DB}`;
    try {
      const { createPrismaClient } = await import("@/lib/prisma");
      delete process.env.DATABASE_URL;
      assert.throws(
        () => createPrismaClient(),
        /DATABASE_URL environment variable is not set/
      );
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});
