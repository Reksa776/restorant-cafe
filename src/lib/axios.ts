import axios from "axios";
import { signOut } from "next-auth/react";

const api = axios.create({
  baseURL: "/api",
  timeout: 30000,
});

// Remove the default Content-Type header so the browser can set it
// appropriately for different request types (JSON, FormData, etc.)
delete api.defaults.headers.common["Content-Type"];

// ============================================================
// Stale-session recovery (401 redirect-loop guard)
// ============================================================
//
// Root cause of the historical infinite loop:
//   stale-but-valid JWT -> middleware lets /admin through -> API 401
//   (DB user no longer exists) -> naive `window.location.href = "/login"`
//   -> middleware sees the same valid JWT -> 307 back to /admin/dashboard
//   -> same 401 -> repeat forever.
//
// Fix: on 401, clear the Auth.js/NextAuth session cookie FIRST via the
// project's existing sign-out mechanism, then navigate to /login. With the
// cookie gone, the middleware allows /login through and the loop is broken.

const LOGIN_PATH = "/login";

// True while a 401-driven session clear is in progress, so several
// simultaneous 401s (e.g. the dashboard firing /auth/session, /orders and
// /orders/dashboard/stats at once) trigger exactly ONE session clear and
// ONE navigation instead of a cascade of signouts/redirects.
let authRecoveryInFlight = false;

// Auth.js/NextAuth session cookie names (JWT strategy) for the client-side
// fallback purge — dev and production (`__Secure-` prefix) variants.
const SESSION_COOKIE_NAMES = [
  "authjs.session-token",
  "__Secure-authjs.session-token",
];

/**
 * Public/customer endpoints never trigger admin session recovery: they are
 * unauthenticated by design, so their failures must not send customers to
 * /login. Only requests to authenticated/admin APIs may recover.
 */
function isPublicRequest(url: string | undefined): boolean {
  return !!url && url.includes("/public/");
}

/** Client-side cookie purge used only when the sign-out endpoint is unusable. */
function clearSessionCookies(): void {
  for (const name of SESSION_COOKIE_NAMES) {
    document.cookie = `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
  }
}

/**
 * One-shot session recovery: sign out through the project's existing Auth.js
 * mechanism (next-auth/react `signOut`). It uses native fetch internally —
 * never this axios instance — so it cannot recursively re-enter this
 * interceptor. Navigation happens only AFTER the server has cleared the
 * session cookie.
 */
function recoverFromUnauthorized(): void {
  if (authRecoveryInFlight) return;
  authRecoveryInFlight = true;

  signOut({ redirectTo: LOGIN_PATH, redirect: false })
    .then((result) => {
      // On success Auth.js resolves { url: "/login" } after clearing the
      // session cookie server-side. Navigate only now — full navigation is
      // preferred because authentication state/cookies have changed.
      if (result?.url && result.url.startsWith(LOGIN_PATH)) {
        window.location.href = result.url;
        return;
      }
      // Sign-out responded but not with the expected target (e.g. a CSRF or
      // server error page), so the cookie may still be present. Purge it
      // client-side before navigating, or the middleware would bounce /login
      // back to /admin/dashboard again.
      clearSessionCookies();
      window.location.href = LOGIN_PATH;
    })
    .catch(() => {
      // Sign-out endpoint unreachable/failed: purge the cookie client-side
      // and still land on /login. Without the session cookie the middleware
      // lets /login through, so there is no redirect loop.
      clearSessionCookies();
      window.location.href = LOGIN_PATH;
    })
    .finally(() => {
      authRecoveryInFlight = false;
    });
}

// Request interceptor
api.interceptors.request.use(
  (config) => {
    // For FormData requests, let the browser set the Content-Type
    // (multipart/form-data with boundary). For JSON requests, set
    // application/json if not already set.
    if (!(config.data instanceof FormData)) {
      if (!config.headers.has("Content-Type")) {
        config.headers.set("Content-Type", "application/json");
      }
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    if (
      typeof window !== "undefined" &&
      error?.response?.status === 401 &&
      !isPublicRequest(error?.config?.url)
    ) {
      recoverFromUnauthorized();
    }
    return Promise.reject(error);
  }
);

export default api;