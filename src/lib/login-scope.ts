// ============================================================
// STRICT SUBDOMAIN-SCOPED LOGIN
//
// ONE place decides whether a set of credentials may sign in on the host the
// request arrived on:
//
//   tenant.<root>  → the host names a tenant. The tenant must exist and be
//                    active, and the user MUST belong to it. Applies to every
//                    role (ADMIN / CASHIER / KITCHEN).
//   <root>         → the owner portal. Only ADMIN may sign in; the response
//                    carries the store subdomain to continue to. Staff are
//                    told to use their own store link.
//   unscoped       → localhost / raw IP / no derivable root domain (single
//                    host or path fallback). No subdomain isolation is
//                    possible, so the legacy behaviour is kept (any role).
//
// Both `POST /api/auth/login` and the Auth.js `authorize()` callback call
// `authenticateLogin`, so a direct POST to the Auth.js callback cannot skip
// the host rules.
// ============================================================

import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import {
  buildTenantPublicUrl,
  extractSubdomainSlug,
  normalizeRootDomain,
  resolveRootDomain,
} from "./tenant-url";

/** Messages surfaced verbatim by the login API / login page. */
export const LOGIN_MESSAGES = {
  tenantNotFound:
    "Toko tidak ditemukan. Periksa kembali alamat subdomain toko Anda.",
  tenantInactive: "Toko ini sedang tidak aktif. Hubungi pemilik bisnis.",
  wrongTenant:
    "Akun Anda tidak terdaftar di toko ini. Silakan login melalui subdomain toko Anda sendiri.",
  staffOnRoot:
    "Akun Kasir & Dapur wajib login melalui link subdomain toko masing-masing.",
  invalidCredentials: "Email atau password salah.",
  missingFields: "Email dan password wajib diisi.",
} as const;

export type LoginScopeKind = "tenant" | "root" | "unscoped";

export interface LoginScope {
  kind: LoginScopeKind;
  /** Raw host of the request (`x-forwarded-host` / `host`), maybe null. */
  host: string | null;
  /** Root domain of the deployment, when derivable/configured. */
  rootDomain: string | null;
  /** `<slug>` when the request arrived on a merchant subdomain. */
  tenantSlug: string | null;
}

function hostnameOf(value: string | null | undefined): string {
  if (!value) return "";
  let out = value
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/\.$/, "");
  if (out.startsWith("[")) {
    const end = out.indexOf("]");
    return end === -1 ? out : out.slice(0, end + 1);
  }
  out = out.replace(/:\d+$/, "");
  return out;
}

function isRegistrableDomain(hostname: string): boolean {
  if (!hostname.includes(".") || !/[a-z]/.test(hostname)) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  return true;
}

/** True when the host IS the platform root (`root` or `www.root`). */
function isRootHost(host: string | null, rootDomain: string | null): boolean {
  if (!host || !rootDomain) return false;
  const hostname = hostnameOf(host);
  const rootHostname = hostnameOf(normalizeRootDomain(rootDomain));
  if (!hostname || !rootHostname) return false;
  // Localhost / raw IP roots stay "unscoped": a single-host dev deployment
  // must keep letting cashiers sign in (no subdomain is available there).
  if (!isRegistrableDomain(rootHostname)) return false;
  // Anything under the root that is NOT a tenant subdomain (apex, `www`, a
  // reserved label like `admin`, or a multi-label host) belongs to the
  // platform itself → owner portal rules apply there too.
  return hostname === rootHostname || hostname.endsWith(`.${rootHostname}`);
}

/** Classify the request host into a login scope (pure, no DB access). */
export function resolveLoginScope(headers: Headers): LoginScope {
  const host = headers.get("x-forwarded-host") ?? headers.get("host") ?? null;
  const rootDomain = resolveRootDomain(
    host,
    process.env.NEXT_PUBLIC_ROOT_DOMAIN
  );
  const tenantSlug = extractSubdomainSlug(
    host,
    process.env.NEXT_PUBLIC_ROOT_DOMAIN
  );

  if (tenantSlug) {
    return { kind: "tenant", host, rootDomain, tenantSlug };
  }
  if (isRootHost(host, rootDomain)) {
    return { kind: "root", host, rootDomain, tenantSlug: null };
  }
  return { kind: "unscoped", host, rootDomain, tenantSlug: null };
}

/**
 * Absolute `/admin` URL of a tenant, built from the SAME request headers so
 * localhost keeps `http` and a proxied deployment keeps `https`.
 */
export function tenantAdminUrl(slug: string, headers: Headers): string {
  const base = buildTenantPublicUrl(slug, headers).replace(/\/+$/, "");
  return `${base}/admin`;
}

export interface ScopedLoginUser {
  id: string;
  name: string;
  email: string;
  role: string;
  sessionVersion: number;
  restaurantId: string;
  restaurantSlug: string;
}

export type LoginOutcome =
  | { ok: true; user: ScopedLoginUser; redirectUrl: string }
  | { ok: false; status: 400 | 401 | 403 | 404; code: string; message: string };

interface AuthenticateInput {
  email: string;
  password: string;
  scope: LoginScope;
  /** Request headers used to build the cross-subdomain redirect URL. */
  headers: Headers;
}

/**
 * Validate credentials AGAINST THE HOST. Password verification happens
 * before tenant/role rules so an attacker cannot enumerate accounts by
 * probing the tenant error messages.
 */
export async function authenticateLogin({
  email,
  password,
  scope,
  headers,
}: AuthenticateInput): Promise<LoginOutcome> {
  const normalizedEmail = email.trim();
  if (!normalizedEmail || !password) {
    return {
      ok: false,
      status: 400,
      code: "VALIDATION_ERROR",
      message: LOGIN_MESSAGES.missingFields,
    };
  }

  // 1. The store subdomain must name an existing, active tenant — checked
  //    BEFORE touching credentials so an unknown host can never authenticate.
  let tenant: { id: string; slug: string; isActive: boolean } | null = null;
  if (scope.kind === "tenant") {
    tenant = await prisma.restaurant.findUnique({
      where: { slug: scope.tenantSlug as string },
      select: { id: true, slug: true, isActive: true },
    });
    if (!tenant) {
      return {
        ok: false,
        status: 404,
        code: "TENANT_NOT_FOUND",
        message: LOGIN_MESSAGES.tenantNotFound,
      };
    }
    if (!tenant.isActive) {
      return {
        ok: false,
        status: 403,
        code: "TENANT_INACTIVE",
        message: LOGIN_MESSAGES.tenantInactive,
      };
    }
  }

  // 2. Credentials.
  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    select: {
      id: true,
      name: true,
      email: true,
      password: true,
      role: true,
      isActive: true,
      sessionVersion: true,
      restaurantId: true,
      restaurant: { select: { slug: true, isActive: true } },
    },
  });

  const passwordValid =
    !!user && user.isActive
      ? await bcrypt.compare(password, user.password)
      : false;

  if (!user || !user.isActive || !passwordValid) {
    return {
      ok: false,
      status: 401,
      code: "INVALID_CREDENTIALS",
      message: LOGIN_MESSAGES.invalidCredentials,
    };
  }

  const scopedUser: ScopedLoginUser = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    sessionVersion: user.sessionVersion,
    restaurantId: user.restaurantId,
    restaurantSlug: user.restaurant.slug,
  };

  // 3. Host ↔ tenant isolation (the actual boundary).
  if (tenant) {
    if (user.restaurantId !== tenant.id) {
      return {
        ok: false,
        status: 403,
        code: "TENANT_MISMATCH",
        message: LOGIN_MESSAGES.wrongTenant,
      };
    }
    return { ok: true, user: scopedUser, redirectUrl: "/admin/dashboard" };
  }

  // 4. Root domain = owner portal only.
  if (scope.kind === "root") {
    if (user.role !== "ADMIN") {
      return {
        ok: false,
        status: 403,
        code: "STAFF_ON_ROOT_DOMAIN",
        message: LOGIN_MESSAGES.staffOnRoot,
      };
    }
    if (!user.restaurant.isActive) {
      return {
        ok: false,
        status: 403,
        code: "TENANT_INACTIVE",
        message: LOGIN_MESSAGES.tenantInactive,
      };
    }
    return {
      ok: true,
      user: scopedUser,
      redirectUrl: `${tenantAdminUrl(user.restaurant.slug, headers)}/dashboard`,
    };
  }

  // 5. Unscoped host (localhost / raw IP / no root domain): legacy behaviour.
  if (!user.restaurant.isActive) {
    return {
      ok: false,
      status: 403,
      code: "TENANT_INACTIVE",
      message: LOGIN_MESSAGES.tenantInactive,
    };
  }
  return { ok: true, user: scopedUser, redirectUrl: "/admin/dashboard" };
}
