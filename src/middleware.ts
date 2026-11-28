import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import authConfig from "@/auth.config";
import {
  AUTH_SESSION_COOKIE,
  AUTH_SESSION_COOKIE_SECURE,
  authCookieDomain,
} from "@/lib/auth-cookie";
import {
  buildTenantPublicUrl,
  extractSubdomainSlug,
  isPathTenantUrl,
} from "@/lib/tenant-url";

const { auth } = NextAuth(authConfig);

const TENANT_COOKIE = "tenant_slug";
const TENANT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

/** Session claims read from the JWT (see `auth.config.ts`). */
interface SessionClaims {
  user?: { restaurantSlug?: string | null };
}

/**
 * Drop any Auth.js session cookie for this host — both the plain and the
 * `__Secure-` variant, with and without the shared root-domain scope. Used
 * when a session from another tenant is presented.
 */
function clearSessionCookies(response: NextResponse) {
  const domain = authCookieDomain();
  const variants = [
    { name: AUTH_SESSION_COOKIE, secure: false },
    { name: AUTH_SESSION_COOKIE_SECURE, secure: true },
  ];
  for (const { name, secure } of variants) {
    const base = {
      path: "/",
      maxAge: 0,
      httpOnly: true,
      sameSite: "lax" as const,
      secure,
    };
    response.cookies.set(name, "", base);
    if (domain) response.cookies.set(name, "", { ...base, domain });
  }
}

/**
 * Where an authenticated user continues when they open `/login` again.
 *
 * An owner session (or any tenant session) seen on the ROOT domain is sent to
 * its own store subdomain — the root is the owner portal, not an admin
 * surface. A tenant session already on its own subdomain goes to /admin.
 */
function loggedInDestination(req: NextRequest & { auth?: unknown }): URL {
  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? null;
  const currentSlug = extractSubdomainSlug(
    host,
    process.env.NEXT_PUBLIC_ROOT_DOMAIN
  );
  const sessionSlug =
    (req.auth as SessionClaims | null | undefined)?.user?.restaurantSlug
      ?.trim()
      .toLowerCase() || null;

  if (sessionSlug && !currentSlug) {
    const base = buildTenantPublicUrl(sessionSlug, req.headers);
    if (!isPathTenantUrl(base, sessionSlug)) {
      return new URL(`${base.replace(/\/+$/, "")}/admin/dashboard`);
    }
  }
  return new URL("/admin/dashboard", req.url);
}

/**
 * Edge middleware — auth guard + multi-tenant subdomain resolution.
 *
 * For EVERY request:
 *   1. Read `x-forwarded-host` / `host`.
 *   2. Extract `<slug>` from `<slug>.<ROOT_DOMAIN>` (reserved hosts such as
 *      `www`, `admin`, `api` and raw IP hosts yield null).
 *   3. Forward `x-tenant-slug` to the app so Server Components / API routes
 *      recognize the tenant immediately, without waiting for the cookie.
 *      Any client-supplied `x-tenant-slug` is dropped first.
 *   4. STRICT SESSION ISOLATION: a session whose `restaurantSlug` claim does
 *      not match the subdomain is rejected (cookie cleared → /login), so a
 *      cookie shared with the root domain can never mix tenants.
 *   5. Sync the `tenant_slug` cookie when it differs from the subdomain.
 *   6. Rewrite the storefront root `/` to `/menu` (URL stays clean).
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isAuthPage = pathname === "/login";
  const isApiAuth = pathname.startsWith("/api/auth");
  const isPublicApi = pathname.startsWith("/api/webhooks");
  const isAdminRoute = pathname.startsWith("/admin");

  // The user arrived on /login because a cookie was JUST removed:
  //   • `signedOut=1` — explicit logout (POST /api/auth/logout)
  //   • `switch=1`    — a cross-tenant session was rejected and purged above
  // Never bounce back to /admin/dashboard in that case, even if a stale token
  // survived the purge (e.g. a cookie written with a different Domain).
  const isPostLogoutLanding =
    isAuthPage &&
    (req.nextUrl.searchParams.get("signedOut") === "1" ||
      req.nextUrl.searchParams.get("switch") === "1");

  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? null;
  const subdomainSlug = extractSubdomainSlug(
    host,
    process.env.NEXT_PUBLIC_ROOT_DOMAIN
  );
  const sessionSlug =
    (req.auth as unknown as SessionClaims | null)?.user?.restaurantSlug
      ?.trim()
      .toLowerCase() || null;

  // A logged-in session belongs to exactly ONE tenant. When the browser is on
  // a different store subdomain, the shared cookie is unusable there.
  const isCrossTenantSession = Boolean(
    subdomainSlug && isLoggedIn && sessionSlug !== subdomainSlug
  );

  // Never trust an inbound x-tenant-slug (only this middleware may set it).
  const requestHeaders = new Headers(req.headers);
  requestHeaders.delete("x-tenant-slug");
  if (subdomainSlug) {
    requestHeaders.set("x-tenant-slug", subdomainSlug);
  }

  let response: NextResponse;

  if (isApiAuth || isPublicApi) {
    // Allow auth API and webhook routes.
    response = NextResponse.next({ request: { headers: requestHeaders } });
  } else if (isCrossTenantSession) {
    // Force a clean re-login on THIS host: clear the foreign session cookie.
    const url = new URL("/login", req.url);
    url.search = "";
    url.searchParams.set("switch", "1");
    response = NextResponse.redirect(url);
    clearSessionCookies(response);
  } else if (isAuthPage && isLoggedIn && !isPostLogoutLanding) {
    // Already signed in (and on the right host) → straight to the dashboard.
    response = NextResponse.redirect(loggedInDestination(req));
  } else if (isAdminRoute && !isLoggedIn) {
    // If trying to access admin without login.
    response = NextResponse.redirect(new URL("/login", req.url));
  } else if (subdomainSlug && pathname === "/") {
    // Storefront root on a tenant subdomain → the tenant's menu.
    const url = req.nextUrl.clone();
    url.pathname = "/menu";
    url.search = "";
    response = NextResponse.rewrite(url, {
      request: { headers: requestHeaders },
    });
  } else {
    response = NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Cookie is host-only (no `domain`), so it never leaks across subdomains;
  // it is simply re-pointed at whichever storefront the visitor is on now.
  if (subdomainSlug && req.cookies.get(TENANT_COOKIE)?.value !== subdomainSlug) {
    response.cookies.set(TENANT_COOKIE, subdomainSlug, {
      path: "/",
      sameSite: "lax",
      httpOnly: false, // readable by the customer UI for tenant-aware links
      secure: process.env.NODE_ENV === "production",
      maxAge: TENANT_COOKIE_MAX_AGE_SECONDS,
    });
  }

  return response;
});

export const config = {
  // Everything except Next internals, uploaded files and static assets.
  // Broad on purpose: tenant recognition must also cover API routes and the
  // customer storefront, not just /admin and /login.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|uploads/|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|woff|woff2|ttf|otf)$).*)",
  ],
};
