import { NextResponse } from "next/server";
import { authCookieDomain } from "@/lib/auth-cookie";
import { normalizeRootDomain } from "@/lib/tenant-url";

/**
 * POST /api/auth/logout
 *
 * Host-agnostic sign-out. `signOut()` alone is not enough on a multi-tenant
 * subdomain deployment: a session cookie issued for `Domain=<ROOT_DOMAIN>` is
 * invisible to a host-only delete, and a cookie issued host-only on the root
 * domain is invisible to a delete from a tenant subdomain. Either way Auth.js'
 * own `DELETE`-style purge can leave the browser authenticated and `/login`
 * bounces straight back to `/admin` (the "ghost session" bug).
 *
 * This route therefore:
 *   1. Reads the request's `cookie` header and takes EVERY name the browser
 *      actually holds — including chunked Auth.js cookies
 *      (`authjs.session-token.0`, `__Secure-authjs.session-token.1`, …) — and
 *      unions it with the standard Auth.js / NextAuth cookie names.
 *   2. Derives the active host (`x-forwarded-host` → `host`, port stripped)
 *      and the deployment root domain (`ROOT_DOMAIN` env and the configured
 *      auth cookie domain).
 *   3. Emits one deletion `Set-Cookie` (`Value=""`, `Path=/`, `Max-Age=0`,
 *      epoch `Expires`, `HttpOnly`, `SameSite=Lax`, `Secure` for
 *      `__Secure-`/`__Host-` names or HTTPS) per name for every scope the
 *      cookie could have been written to:
 *        • host-only (no `Domain=`)
 *        • `Domain=<currentHost>`
 *        • `Domain=.<currentHost>`
 *        • `Domain=<ROOT_DOMAIN>`
 *        • `Domain=.<ROOT_DOMAIN>`
 *      `__Host-` cookies are host-only by spec, so they never get `Domain=`.
 *
 * It deliberately does NOT call the server-side `signOut()`: that mutates the
 * request cookie jar, and Next.js then re-serialises `Set-Cookie` by cookie
 * NAME — collapsing these same-name headers into one scope and re-issuing the
 * CSRF/callback cookies. The result would be a surviving host-only session
 * token, i.e. exactly the bug this route fixes. Auth.js' own sign-out still
 * runs client-side (`performLogout()` → `signOut({ redirect: false })`), and
 * this purge runs last, so whatever Auth.js re-issues is removed too.
 *
 * The route is same-site CORS-enabled (root domain and its subdomains only) so
 * a logout started on `*.ROOT_DOMAIN` can also purge the ROOT host's host-only
 * cookies — the request that writes a root cookie's deletion must be answered
 * by the root host itself.
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

const STANDARD_COOKIE_NAMES: readonly string[] = [
  ...SESSION_COOKIE_NAMES,
  ...SUPPORT_COOKIE_NAMES,
];

/** Hard cap so a hostile/huge `Cookie` header cannot explode the response. */
const MAX_COOKIE_NAMES = 32;

/** `host[:port]` (or a comma separated forwarded list) → lowercase hostname. */
function hostnameOf(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.split(",")[0].trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, ""); // protocol
  value = value.replace(/\/.*$/, ""); // path / query
  value = value.replace(/\.$/, ""); // trailing dot (FQDN)
  if (!value) return null;
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? value : value.slice(0, end + 1); // IPv6
  }
  value = value.replace(/:\d+$/, ""); // port
  return value || null;
}

/** The host this request was served on (`x-forwarded-host` wins behind a proxy). */
function requestHostname(request: Request): string | null {
  return (
    hostnameOf(request.headers.get("x-forwarded-host")) ??
    hostnameOf(request.headers.get("host"))
  );
}

/** True when the response is served over HTTPS (explicit `Secure` deletions). */
function requestIsSecure(request: Request): boolean {
  const forwarded = request.headers
    .get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    .toLowerCase();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  try {
    return new URL(request.url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Every root domain the session cookie may have been scoped to:
 * `NEXT_PUBLIC_ROOT_DOMAIN` and the domain Auth.js actually writes to.
 */
function rootDomains(): string[] {
  const domains = new Set<string>();
  for (const candidate of [
    normalizeRootDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN),
    authCookieDomain(),
  ]) {
    const domain = String(candidate ?? "")
      .trim()
      .toLowerCase()
      .replace(/^\.+/, "")
      .replace(/\.$/, "");
    if (domain) domains.add(domain);
  }
  return [...domains];
}

/** Cookie scopes to clear for one name: host-only, current host, root domain. */
function cookieScopes(name: string, hostname: string | null): (string | null)[] {
  // Browsers reject any `Domain=` attribute on a `__Host-` cookie.
  if (name.startsWith("__Host-")) return [null];

  const domains = new Set<string>();
  if (hostname) domains.add(hostname);
  for (const root of rootDomains()) domains.add(root);

  const scopes: (string | null)[] = [null];
  for (const domain of domains) {
    scopes.push(domain, `.${domain}`);
  }
  return scopes;
}

/** A single deletion `Set-Cookie` value for one name/scope pair. */
function clearedCookieHeader(
  name: string,
  domain: string | null,
  secureRequest: boolean
): string {
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
  if (
    secureRequest ||
    name.startsWith("__Secure-") ||
    name.startsWith("__Host-")
  ) {
    parts.push("Secure");
  }
  if (domain) parts.push(`Domain=${domain}`);
  return parts.join("; ");
}

/**
 * Cookie names to purge: everything the browser sent (chunked Auth.js cookies
 * included, plus their chunk base name) unioned with the standard list.
 */
function purgeCookieNames(cookieHeader: string | null): string[] {
  const names = new Set<string>(STANDARD_COOKIE_NAMES);
  for (const pair of (cookieHeader ?? "").split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (!name || names.has(name)) continue;
    names.add(name);
    // `authjs.session-token.0` → also clear `authjs.session-token`.
    const base = name.replace(/\.\d+$/, "");
    if (base !== name) names.add(base);
    if (names.size >= MAX_COOKIE_NAMES) break;
  }
  return [...names];
}

/**
 * Echo the request origin when it belongs to this deployment (root domain or
 * any of its subdomains), so `fetch(..., { credentials: "include" })` from a
 * store subdomain may purge the root host's cookies too.
 */
function trustedOrigin(
  origin: string | null,
  hostname: string | null
): string | null {
  if (!origin) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const originHost = parsed.hostname.toLowerCase();

  const domains = new Set<string>(rootDomains());
  if (hostname) domains.add(hostname);
  // Local development (`localhost`, `*.localhost`, `127.0.0.1`).
  domains.add("localhost");
  domains.add("127.0.0.1");
  domains.add("[::1]");

  for (const domain of domains) {
    if (originHost === domain || originHost.endsWith(`.${domain}`)) {
      return origin;
    }
  }
  return null;
}

function applyCors(
  response: NextResponse,
  request: Request,
  hostname: string | null
): NextResponse {
  const origin = trustedOrigin(request.headers.get("origin"), hostname);
  if (!origin) return response;
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.append("Vary", "Origin");
  return response;
}

export async function POST(request: Request) {
  // Purge-only on purpose — see the doc comment above: touching the cookie
  // jar here would collapse the multi-scope deletions below.
  const hostname = requestHostname(request);
  const secureRequest = requestIsSecure(request);
  const response = NextResponse.json(
    { ok: true, redirectTo: "/login" },
    { status: 200 }
  );
  response.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, max-age=0"
  );

  for (const name of purgeCookieNames(request.headers.get("cookie"))) {
    for (const domain of cookieScopes(name, hostname)) {
      response.headers.append(
        "Set-Cookie",
        clearedCookieHeader(name, domain, secureRequest)
      );
    }
  }

  return applyCors(response, request, hostname);
}

/** Preflight for the cross-subdomain credentialed purge. */
export async function OPTIONS(request: Request) {
  const hostname = requestHostname(request);
  const response = new NextResponse(null, { status: 204 });
  response.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type");
  response.headers.set("Access-Control-Max-Age", "600");
  response.headers.set("Cache-Control", "no-store");
  return applyCors(response, request, hostname);
}
