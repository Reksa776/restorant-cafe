// ============================================================
// AUTH SESSION COOKIE SCOPE (pure — safe for the Edge middleware)
//
// The Auth.js session cookie is HOST-ONLY by default. To let an owner sign
// in on the platform root domain and land on their store subdomain already
// authenticated, the cookie is shared with `*.<ROOT_DOMAIN>` — but ONLY when
// the deployment actually declares a public root origin:
//   • AUTH_COOKIE_DOMAIN is set explicitly, OR
//   • NEXT_PUBLIC_ROOT_DOMAIN is a real registrable domain AND
//     NEXT_PUBLIC_APP_URL / AUTH_URL points at that domain.
//
// Cookie sharing is NOT the isolation boundary. A shared cookie is always
// re-validated against the host: middleware and requireRestaurantContext
// reject a session whose `restaurantSlug` claim differs from the subdomain
// the request arrived on (see `login-scope.ts` and `middleware.ts`).
//
// Localhost, raw IPs and path-fallback deployments keep the old host-only
// cookie because a `Domain=` attribute cannot be set for them.
// ============================================================

import { normalizeRootDomain } from "./tenant-url";

/** Auth.js session cookie names (JWT strategy) — dev/prod variants. */
export const AUTH_SESSION_COOKIE = "authjs.session-token";
export const AUTH_SESSION_COOKIE_SECURE = "__Secure-authjs.session-token";

/** Strip protocol / path / port / leading dot from a cookie-domain value. */
function normalizeCookieDomain(raw: string | null | undefined): string | null {
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

/** A real registrable domain — never localhost, an IP or a single label. */
function isRegistrableDomain(hostname: string): boolean {
  if (!hostname.includes(".") || !/[a-z]/.test(hostname)) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  return true;
}

function appOriginHostname(): string | null {
  const raw = process.env.NEXT_PUBLIC_APP_URL || process.env.AUTH_URL || "";
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Cookie `Domain=` value, or null for the legacy host-only cookie.
 *
 * Returning null keeps every existing deployment (localhost, IP/Tailscale,
 * no root domain) byte-for-byte identical to the previous behaviour.
 */
export function authCookieDomain(): string | null {
  const explicit = normalizeCookieDomain(process.env.AUTH_COOKIE_DOMAIN);
  if (explicit) return explicit;

  const root = normalizeRootDomain(process.env.NEXT_PUBLIC_ROOT_DOMAIN);
  if (!root) return null;

  const rootHostname = normalizeCookieDomain(root);
  if (!rootHostname || !isRegistrableDomain(rootHostname)) return null;

  // Only share the cookie when the app knows it is served from that domain —
  // never when APP_URL still points at localhost (dev/tests) while a root
  // domain is configured for production.
  const appHostname = appOriginHostname();
  if (!appHostname) return null;
  if (appHostname !== rootHostname && !appHostname.endsWith(`.${rootHostname}`)) {
    return null;
  }

  return rootHostname;
}

/**
 * True when the deployment is served over HTTPS (Auth.js `__Secure-` cookie).
 * Mirrors Auth.js' own rule: the configured public auth URL wins, otherwise
 * production is assumed to be HTTPS.
 */
export function authCookieSecure(): boolean {
  const raw =
    process.env.AUTH_URL || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "";
  if (raw) {
    try {
      return new URL(raw).protocol === "https:";
    } catch {
      /* fall through to NODE_ENV */
    }
  }
  return process.env.NODE_ENV === "production";
}

/** Session cookie name matching the current deployment's security scope. */
export function authSessionCookieName(): string {
  return authCookieSecure() ? AUTH_SESSION_COOKIE_SECURE : AUTH_SESSION_COOKIE;
}

/**
 * Auth.js `cookies.sessionToken` entry — the SINGLE source of truth for the
 * name and the `Domain=`/`Secure` scope of the session cookie.
 *
 * Used by BOTH `src/auth.config.ts` (edge middleware, which READS the cookie)
 * and `src/auth.ts` (Node runtime, which WRITES it on `signIn`). Keeping one
 * rule guarantees the browser never ends up holding two session cookies with
 * different scopes (host-only AND `.ROOT_DOMAIN`), which is what made logout
 * leave a "ghost" session behind on the other host.
 *
 * `domain` is simply omitted when the deployment is host-only, so Auth.js
 * writes exactly one cookie — never a duplicate host-only/root pair.
 */
export function authSessionTokenCookie() {
  const domain = authCookieDomain();
  return {
    name: authSessionCookieName(),
    options: {
      httpOnly: true as const,
      sameSite: "lax" as const,
      path: "/",
      secure: authCookieSecure(),
      maxAge: 30 * 24 * 60 * 60,
      ...(domain ? { domain } : {}),
    },
  };
}
