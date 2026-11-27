import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import authConfig from "@/auth.config";
import { extractSubdomainSlug } from "@/lib/tenant-url";

const { auth } = NextAuth(authConfig);

const TENANT_COOKIE = "tenant_slug";
const TENANT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

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
 *   4. Sync the `tenant_slug` cookie when it differs from the subdomain, so
 *      moving between two merchant storefronts never keeps the previous
 *      tenant's context (and cart) around.
 *   5. Rewrite the storefront root `/` to `/menu` (URL stays clean).
 *
 * The existing `/admin` + `/login` guards are unchanged and work on the main
 * domain as well as on any merchant subdomain.
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;
  const isLoggedIn = !!req.auth;
  const isAuthPage = pathname === "/login";
  const isApiAuth = pathname.startsWith("/api/auth");
  const isPublicApi = pathname.startsWith("/api/webhooks");
  const isAdminRoute = pathname.startsWith("/admin");

  const host =
    req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? null;
  const subdomainSlug = extractSubdomainSlug(
    host,
    process.env.NEXT_PUBLIC_ROOT_DOMAIN
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
  } else if (isAuthPage && isLoggedIn) {
    // If on login page and already logged in, redirect to admin.
    response = NextResponse.redirect(new URL("/admin/dashboard", req.url));
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
