"use client";

import { signOut } from "next-auth/react";

/**
 * Client sign-out that works on the root domain AND on every tenant
 * subdomain, where cookies may live in several scopes at once (host-only on
 * the store subdomain, `Domain=<ROOT_DOMAIN>` shared, or a leftover host-only
 * cookie on the root domain from an earlier release).
 *
 *   1. Clear every non-HttpOnly cookie visible to `document.cookie` on this
 *      host for every candidate scope (host-only, `<host>`, `.<host>`,
 *      `<ROOT_DOMAIN>`, `.<ROOT_DOMAIN>`). `__Host-` names stay host-only.
 *   2. `signOut({ redirect: false })` — Auth.js' own sign-out (clears its
 *      cookie on the configured scope and keeps other tabs in sync).
 *   3. `POST /api/auth/logout` on THIS origin — deterministic purge of every
 *      session / CSRF / callback / chunked cookie in the host-only AND
 *      root-domain scopes. It runs LAST so the CSRF/callback cookies Auth.js
 *      re-issues are removed as well.
 *   4. On a store subdomain, `POST https://<ROOT_DOMAIN>/api/auth/logout` as
 *      well, with credentials: a deletion for the root host's HOST-ONLY cookie
 *      is only honoured when the ROOT host writes it. Without this step the
 *      browser stays signed in on `ROOT_DOMAIN` and "Masuk" on the landing
 *      page bounces straight back to `/admin/dashboard`.
 *   5. Hard navigation to `/login?signedOut=1` — a full page load, so React
 *      state, the Next.js router cache and `req.auth` are rebuilt from scratch.
 *      The `signedOut` marker tells the middleware not to bounce a surviving
 *      token straight back to `/admin/dashboard` (see `src/middleware.ts`).
 */
const CLEARED_EXPIRES = "Thu, 01 Jan 1970 00:00:00 GMT";
const PURGE_TIMEOUT_MS = 4000;

function normalizeDomain(raw: string | null | undefined): string | null {
  const value = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "")
    .replace(/^\.+/, "")
    .replace(/\.$/, "");
  return value || null;
}

/**
 * Root domain a session cookie may have been scoped to: the configured public
 * root domain, falling back to the public app URL's hostname.
 */
function rootDomains(): string[] {
  const configured = normalizeDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN);
  if (configured) return [configured];

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) return [];
  try {
    const hostname = new URL(appUrl).hostname.toLowerCase();
    return hostname ? [hostname] : [];
  } catch {
    return [];
  }
}

function scopesFor(hostname: string, rootDomain: string | null): (string | null)[] {
  const domains = new Set<string>();
  if (hostname) domains.add(hostname);
  if (rootDomain) domains.add(rootDomain);

  const scopes: (string | null)[] = [null];
  for (const domain of domains) {
    scopes.push(domain, `.${domain}`);
  }
  return scopes;
}

/** Cookie names currently readable from the browser (non-HttpOnly only). */
function documentCookieNames(): string[] {
  if (typeof document === "undefined" || !document.cookie) return [];
  const names = new Set<string>();
  for (const pair of document.cookie.split(";")) {
    const name = pair.split("=")[0]?.trim();
    if (!name) continue;
    names.add(name);
    // `authjs.session-token.0` → also clear `authjs.session-token`.
    names.add(name.replace(/\.\d+$/, ""));
  }
  return [...names];
}

/**
 * Expire every readable cookie for the given names in every candidate scope.
 * HttpOnly cookies are untouched by design — the server route owns those.
 */
function clearDocumentCookies(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  const hostname = window.location.hostname.toLowerCase().replace(/\.$/, "");
  const secure = window.location.protocol === "https:";
  const scopes = scopesFor(hostname, rootDomains()[0] ?? null);
  const names = documentCookieNames();
  if (!names.length) return;

  for (const name of names) {
    // Browsers reject `Domain=` on `__Host-` cookies (host-only by spec).
    const nameScopes = name.startsWith("__Host-")
      ? [null]
      : scopes;
    for (const domain of nameScopes) {
      const attributes = [
        "Path=/",
        "Max-Age=0",
        `Expires=${CLEARED_EXPIRES}`,
        "SameSite=Lax",
      ];
      if (secure || name.startsWith("__Secure-") || name.startsWith("__Host-")) {
        attributes.push("Secure");
      }
      if (domain) attributes.push(`Domain=${domain}`);
      document.cookie = `${name}=; ${attributes.join("; ")}`;
    }
  }
}

/** Timeout signal without assuming `AbortSignal.timeout` exists everywhere. */
function abortAfter(ms: number): AbortSignal | undefined {
  try {
    if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal) {
      return AbortSignal.timeout(ms);
    }
  } catch {
    /* fall through */
  }
  return undefined;
}

async function purgeSessionCookies(origin: string): Promise<void> {
  try {
    await fetch(`${origin}/api/auth/logout`, {
      method: "POST",
      // Credentials so a ROOT-domain purge request carries (and thus may
      // delete) the root host's own host-only cookies.
      credentials: "include",
      cache: "no-store",
      signal: abortAfter(PURGE_TIMEOUT_MS),
    });
  } catch (error) {
    // Network failure / timeout must not trap the user inside the dashboard.
    console.warn(`[logout] purge endpoint unreachable (${origin}):`, error);
  }
}

export async function performLogout(): Promise<void> {
  const { hostname, origin, protocol } = window.location;
  const currentHost = hostname.toLowerCase().replace(/\.$/, "");
  const rootDomain = rootDomains()[0] ?? null;

  // A store subdomain (`caffe-indo.<root>`) — the root host keeps its own,
  // host-only cookie that only the root host can delete.
  const isTenantHost = Boolean(
    rootDomain &&
      currentHost !== rootDomain &&
      currentHost.endsWith(`.${rootDomain}`)
  );

  // 1. Non-HttpOnly cookies (tenant_slug, callback hints, …) in every scope.
  clearDocumentCookies();

  // 2. Auth.js' own sign-out.
  try {
    await signOut({ redirect: false });
  } catch (error) {
    // An expired/revoked session must not block the purge below.
    console.warn("[logout] signOut failed:", error);
  }

  // 3. Deterministic purge on this origin (last, so re-issued cookies die too).
  await purgeSessionCookies(origin);

  // 4. Cross-subdomain purge: let the ROOT host delete its host-only cookies.
  if (isTenantHost && rootDomain) {
    const port = window.location.port ? `:${window.location.port}` : "";
    await purgeSessionCookies(`${protocol}//${rootDomain}${port}`);
  }

  // 5. Anything the browser re-created during the round trips.
  clearDocumentCookies();

  window.location.assign("/login?signedOut=1");
}
