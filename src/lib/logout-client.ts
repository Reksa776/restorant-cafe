"use client";

import { signOut } from "next-auth/react";

/**
 * Client sign-out that works on the root domain AND on every tenant
 * subdomain, where the session cookie is shared with `Domain=<ROOT_DOMAIN>`.
 *
 *   1. `signOut({ redirect: false })` — Auth.js' own sign-out (clears its
 *      cookie on the configured scope and keeps other tabs in sync).
 *   2. `POST /api/auth/logout` — deterministic purge of every session / CSRF /
 *      callback cookie in the host-only AND root-domain scopes. It runs LAST
 *      so the CSRF/callback cookies Auth.js re-issues are removed as well.
 *   3. Hard navigation to `/login?signedOut=1` — a full page load, so React
 *      state, the Next.js router cache and `req.auth` are rebuilt from scratch.
 *      The `signedOut` marker tells the middleware not to bounce a surviving
 *      token straight back to `/admin/dashboard` (see `src/middleware.ts`).
 */
export async function performLogout(): Promise<void> {
  try {
    await signOut({ redirect: false });
  } catch (error) {
    // An expired/revoked session must not block the purge below.
    console.warn("[logout] signOut failed:", error);
  }

  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    // Network failure must not trap the user inside the dashboard.
    console.warn("[logout] purge endpoint unreachable:", error);
  }

  window.location.assign("/login?signedOut=1");
}
