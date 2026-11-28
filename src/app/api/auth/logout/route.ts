import { NextResponse } from "next/server";
import { authCookieDomain } from "@/lib/auth-cookie";
import { normalizeRootDomain } from "@/lib/tenant-url";

/**
 * POST /api/auth/logout
 *
 * Host-agnostic sign-out. `signOut()` alone is not enough on a multi-tenant
 * subdomain deployment: a session cookie issued for `Domain=<ROOT_DOMAIN>` is
 * invisible to a host-only delete, so `DELETE`-style purges done by Auth.js
 * can leave the browser authenticated and `/login` bounces straight back to
 * `/admin` (the "stuck on dashboard" bug).
 *
 * This route therefore emits an explicit `Set-Cookie` deletion (`Max-Age=0`
 * + epoch `Expires`) for EVERY session/CSRF/callback cookie name, in every
 * scope the cookie could have been written to:
 *   • host-only (no `Domain=`)
 *   • `Domain=<ROOT_DOMAIN>`
 *   • `Domain=.<ROOT_DOMAIN>`
 * `__Host-` prefixed cookies are host-only by spec and never receive a
 * `Domain=` attribute.
 *
 * It deliberately does NOT call the server-side `signOut()`: that mutates the
 * request cookie jar, and Next.js then re-serialises `Set-Cookie` by cookie
 * NAME — collapsing these same-name headers into one scope and re-issuing the
 * CSRF/callback cookies. The result would be a surviving host-only session
 * token, i.e. exactly the bug this route fixes. Auth.js' own sign-out still
 * runs client-side (`performLogout()` → `signOut({ redirect: false })`), and
 * this purge runs last, so whatever Auth.js re-issues is removed too.
 *
 * Returns `{ ok: true, redirectTo: "/login" }` with `Cache-Control: no-store`
 * so the caller can hard-navigate to a clean `/login`.
 */
export const dynamic = "force-dynamic";

const CLEARED_EXPIRES = "Thu, 01 Jan 1970 00:00:00 GMT";

/** Auth.js / NextAuth session cookie names (current + legacy, dev + prod). */
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
  "next-auth.session-token",
  "__Secure-next-auth.session-token",
] as const;

/**
 * Support cookies that keep a half-signed-in client alive: CSRF tokens,
 * callback URLs and PKCE verifiers (all Auth.js and legacy NextAuth names).
 */
const SUPPORT_COOKIE_NAMES = [
  "authjs.csrf-token",
  "__Host-authjs.csrf-token",
  "authjs.callback-url",
  "__Secure-authjs.callback-url",
  "authjs.pkce.code_verifier",
  "__Secure-authjs.pkce.code_verifier",
  "next-auth.csrf-token",
  "__Host-next-auth.csrf-token",
  "next-auth.callback-url",
  "__Secure-next-auth.callback-url",
  "next-auth.pkce.code_verifier",
  "__Secure-next-auth.pkce.code_verifier",
] as const;

/**
 * Every root domain the session cookie may have been scoped to.
 *
 * `authCookieDomain()` is the scope actually used when the cookie was issued;
 * `NEXT_PUBLIC_ROOT_DOMAIN` is included as well so a cookie shared by an
 * earlier release (or a deployment where APP_URL still points at localhost)
 * is still deleted.
 */
function rootDomains(): string[] {
  const domains = new Set<string>();
  for (const candidate of [
    authCookieDomain(),
    normalizeRootDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN),
  ]) {
    if (candidate) domains.add(candidate);
  }
  return [...domains];
}

/** Cookie scopes to clear for one name: host-only, root, and dotted root. */
function cookieScopes(name: string): (string | null)[] {
  // Browsers reject any `Domain=` attribute on a `__Host-` cookie.
  if (name.startsWith("__Host-")) return [null];

  const scopes: (string | null)[] = [null];
  for (const domain of rootDomains()) {
    scopes.push(domain, `.${domain}`);
  }
  return scopes;
}

/** A single deletion `Set-Cookie` value for one name/scope pair. */
function clearedCookieHeader(name: string, domain: string | null): string {
  const parts = [
    `${name}=`,
    "Path=/",
    "Max-Age=0",
    `Expires=${CLEARED_EXPIRES}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  // `__Secure-` / `__Host-` cookies are only written over HTTPS, and a
  // deletion without `Secure` is ignored by the browser for them.
  if (name.startsWith("__Secure-") || name.startsWith("__Host-")) {
    parts.push("Secure");
  }
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

export async function POST() {
  // Purge-only on purpose — see the doc comment above: touching the cookie
  // jar here would collapse the multi-scope deletions below.
  const response = NextResponse.json(
    { ok: true, redirectTo: "/login" },
    { status: 200 }
  );
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );

  for (const name of [...SESSION_COOKIE_NAMES, ...SUPPORT_COOKIE_NAMES]) {
    for (const domain of cookieScopes(name)) {
      response.headers.append("Set-Cookie", clearedCookieHeader(name, domain));
    }
  }

  return response;
}
