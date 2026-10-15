/**
 * STEP 2C.4 — F-2: DATABASE_URL credential parsing.
 *
 * Why this module exists
 * ----------------------
 * `new URL(databaseUrl).username` / `.password` return the URL's
 * **percent-encoded** userinfo, and `@prisma/adapter-mariadb` hands an object
 * config to `mariadb.createPool` without decoding (only the driver's own
 * connection-string form is decoded). Passing those getters straight to the
 * driver therefore sends a still-encoded credential to MariaDB, and every query
 * then fails with a confusing `pool timeout` (Prisma `P2010`):
 *
 *   user:a+b==@host   →  driver receives `a+b%3D%3D`
 *   user:a%2Bb@host   →  driver receives `a%2Bb`
 *   user:100%25@host  →  driver receives `100%25`
 *
 * Rules implemented here (each one covered by `database-url.unit.test.ts`):
 *   1. decode a credential exactly once — never twice (`%2525` → `%25`);
 *   2. never turn a literal `+` into a space (`decodeURIComponent` does not);
 *   3. never throw on a malformed escape: a password such as `100%`, `%2` or
 *      `a%zz` keeps the value it has today (the URL parser does not escape a
 *      bare `%`, while `decodeURIComponent` would raise `URIError` on it);
 *   4. fail with a **sanitized** error when the URL itself cannot be parsed —
 *      `ERR_INVALID_URL` carries the raw URL (password included) on its
 *      enumerable `input` property, which error loggers print.
 *
 * This module performs no I/O, logs nothing and opens no connection.
 */

/** A well-formed percent escape: `%` followed by two hex digits. */
const PERCENT_ESCAPE = /%[0-9A-Fa-f]{2}/;

/**
 * Decode one userinfo component (username or password) exactly once.
 *
 * A value without a well-formed escape is returned untouched, so a literal `%`
 * (`100%`) or a malformed escape (`%2`, `%2G`, `a%zz`) behaves exactly as it did
 * before this fix. A value containing at least one well-formed escape is passed
 * to `decodeURIComponent`; if the same value also contains a malformed escape the
 * decode is abandoned as a whole and the raw value is kept — decoding is never
 * partial, so a credential is never silently reinterpreted.
 */
export function decodeCredential(value: string): string {
  if (!PERCENT_ESCAPE.test(value)) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface DatabaseConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

/**
 * Parse a `mysql://` connection URL into the driver config the MariaDB adapter
 * expects, with credentials decoded exactly once.
 */
export function parseDatabaseUrl(url: string): DatabaseConnection {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Deliberately sanitized: the original `ERR_INVALID_URL` object exposes the
    // full URL — password included — as an enumerable `input` property that
    // `util.inspect` / `console.log` / `JSON.stringify` all print. No `cause` is
    // attached for exactly the same reason.
    throw new Error(
      "DATABASE_URL is not a valid connection URL — percent-encode special " +
        "characters in the password (`=` as %3D, `@` as %40, `:` as %3A, " +
        "`/` as %2F, `%` as %25)."
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
