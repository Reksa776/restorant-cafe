import axios from "axios";
import { performLogout } from "./logout-client";

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
// Fix: on 401, purge the session FIRST through the same cross-domain logout
// path the sidebar uses (`@/lib/logout-client` → POST /api/auth/logout) and
// only then hard-navigate to /login. With the cookie gone, the middleware
// allows /login through and the loop is broken.

// True while a 401-driven session clear is in progress, so several
// simultaneous 401s (e.g. the dashboard firing /auth/session, /orders and
// /orders/dashboard/stats at once) trigger exactly ONE session clear and
// ONE navigation instead of a cascade of signouts/redirects.
let authRecoveryInFlight = false;

/**
 * Public/customer endpoints never trigger admin session recovery: they are
 * unauthenticated by design, so their failures must not send customers to
 * /login. Only requests to authenticated/admin APIs may recover.
 */
function isPublicRequest(url: string | undefined): boolean {
  return !!url && url.includes("/public/");
}

/**
 * One-shot session recovery: `performLogout()` deletes every Auth.js cookie
 * in both the host-only and the shared root-domain scope, signs the Auth.js
 * client out, then hard-navigates to `/login?signedOut=1`. It uses native
 * fetch and a full page load — never this axios instance — so it cannot
 * recursively re-enter this interceptor, and the middleware will not bounce
 * the just-purged session back to /admin/dashboard.
 */
function recoverFromUnauthorized(): void {
  if (authRecoveryInFlight) return;
  authRecoveryInFlight = true;
  void performLogout().finally(() => {
    authRecoveryInFlight = false;
  });
}

// ============================================================
// Branch context header (multi-branch admin)
// ============================================================
// The admin UI stores the currently-selected branch in localStorage
// ("admin_branch_id"). Every authenticated admin/cashier request carries it
// as `x-branch-id` so the server can scope queries to that branch. Public
// (customer) requests must NOT include it — the server derives the branch
// from the QR/table context instead.
const BRANCH_STORAGE_KEY = "admin_branch_id";

function currentBranchId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BRANCH_STORAGE_KEY);
  } catch {
    return null;
  }
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

    // Attach the active branch to admin requests only.
    if (
      !isPublicRequest(config.url) &&
      !config.headers.has("x-branch-id")
    ) {
      const branchId = currentBranchId();
      if (branchId) {
        config.headers.set("x-branch-id", branchId);
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