// ============================================================
// PURE TENANT URL HELPERS (subdomain multi-tenant)
//
// This module is deliberately dependency-free: it is imported by
//   • `src/middleware.ts`      → Edge Runtime (no Prisma, no Node APIs)
//   • client components        → /register preview, /admin/settings
//   • server code              → re-exported from `@/lib/tenant`
//
// Tenant address model:
//   1. PREFERRED — `https://<slug>.<ROOT_DOMAIN>` (NEXT_PUBLIC_ROOT_DOMAIN).
//   2. FALLBACK  — `<origin>/r/<slug>` when the app is reached through a raw
//      IP (127.0.0.1, 100.x Tailscale, LAN) or no root domain is derivable.
//
// Nothing here reads the database; a slug is only a HOST hint. The caller
// (middleware / resolver) decides what to do with it.
// ============================================================

/** Slugs that can never belong to a merchant (infrastructure + app routes). */
export const RESERVED_SLUGS = [
  "www",
  "app",
  "admin",
  "api",
  "mail",
  "smtp",
  "ftp",
  "cdn",
  "static",
  "assets",
  "billing",
  "dashboard",
  "staging",
  "dev",
  "test",
  "support",
  "help",
  "status",
  "docs",
  "blog",
  "login",
  "register",
  "auth",
] as const;

const RESERVED_SLUG_SET: ReadonlySet<string> = new Set(RESERVED_SLUGS);

/** Multi-label public suffixes — the registrable domain is 3 labels, not 2. */
const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  "co.id",
  "web.id",
  "ac.id",
  "or.id",
  "co.uk",
  "org.uk",
  "com.au",
  "net.au",
  "co.jp",
  "com.sg",
  "com.my",
  "co.in",
  "com.br",
  "co.nz",
  "com.hk",
]);

/**
 * Shared hosting suffixes: `<app>.<platform>` is NOT a tenant subdomain, so
 * with no explicit root domain configured the whole host is the root.
 */
const SHARED_PLATFORM_SUFFIXES: ReadonlySet<string> = new Set([
  "vercel.app",
  "netlify.app",
  "onrender.com",
  "railway.app",
  "fly.dev",
  "herokuapp.com",
  "ngrok-free.app",
  "ngrok.io",
  "trycloudflare.com",
  "azurewebsites.net",
  "pages.dev",
  "workers.dev",
  "deno.dev",
]);

/** One DNS label that is a legal merchant slug. */
const TENANT_LABEL_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

// ------------------------------------------------------------
// Slug generation
// ------------------------------------------------------------

/** URL-safe slug from a merchant name: "Warung Bu Sri!" → "warung-bu-sri". */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return base || "resto";
}

/** True when a slug is reserved for the platform (never a merchant). */
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUG_SET.has(slug.trim().toLowerCase());
}

/**
 * Best-effort slug preview for a merchant name. Reserved words get a
 * `-resto` suffix so a restaurant literally named "Admin" still gets a
 * usable storefront address (`admin-resto.<root>`). Uniqueness is enforced
 * separately by `generateUniqueSlug` inside the registration transaction.
 */
export function previewTenantSlug(name: string): string {
  const base = slugify(name);
  return isReservedSlug(base) ? `${base}-resto` : base;
}

// ------------------------------------------------------------
// Host parsing
// ------------------------------------------------------------

function normalizeHostValue(raw: string | null | undefined): string {
  if (!raw) return "";
  let value = raw.split(",")[0].trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, ""); // protocol
  value = value.replace(/\/.*$/, ""); // path / query
  value = value.replace(/\.$/, ""); // trailing dot (FQDN)
  return value;
}

/** Split `host[:port]` (IPv6 aware). */
function splitHost(value: string): { hostname: string; port: string | null } {
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end === -1) return { hostname: value, port: null };
    const hostname = value.slice(0, end + 1);
    const rest = value.slice(end + 1).replace(/^:/, "");
    return { hostname, port: rest || null };
  }
  const match = value.match(/^(.*):(\d+)$/);
  if (match) return { hostname: match[1], port: match[2] };
  return { hostname: value, port: null };
}

function isIpHost(hostname: string): boolean {
  if (hostname.startsWith("[")) return true; // IPv6
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);
}

/** Strip protocol / path / trailing slash from a configured root domain. */
export function normalizeRootDomain(raw: string | null | undefined): string | null {
  const value = normalizeHostValue(raw);
  return value || null;
}

/**
 * Root domain of the current deployment.
 *
 * Explicit `NEXT_PUBLIC_ROOT_DOMAIN` always wins. Otherwise it is inferred
 * from the request host (`kopisenja.domainlo.com` → `domainlo.com`,
 * `kopisenja.localhost:3000` → `localhost:3000`). Raw IP hosts and shared
 * platform hosts have no tenant-capable root → null (path fallback).
 */
export function resolveRootDomain(
  host: string | null | undefined,
  rootDomain?: string | null
): string | null {
  const configured = normalizeRootDomain(
    rootDomain ?? process.env.NEXT_PUBLIC_ROOT_DOMAIN
  );
  if (configured) return configured;

  const value = normalizeHostValue(host);
  if (!value) return null;
  const { hostname, port } = splitHost(value);
  if (!hostname || isIpHost(hostname)) return null;

  const guessed = guessRootHostname(hostname);
  if (!guessed) return null;
  return guessed === "localhost" && port ? `${guessed}:${port}` : guessed;
}

function guessRootHostname(hostname: string): string | null {
  if (hostname === "localhost") return "localhost";
  if (hostname.endsWith(".localhost")) return "localhost";

  const labels = hostname.split(".").filter(Boolean);
  if (labels.length < 2) return null;

  const lastTwo = labels.slice(-2).join(".");
  // `myapp.vercel.app` — the whole host is the deployment, not a tenant.
  if (SHARED_PLATFORM_SUFFIXES.has(lastTwo)) return hostname;
  // `kopisenja.kafe.co.id` — root is the last three labels.
  if (labels.length >= 3 && MULTI_LABEL_SUFFIXES.has(lastTwo)) {
    return labels.slice(-3).join(".");
  }
  return lastTwo;
}

/**
 * Extract `<slug>` from a request host.
 *
 *   kopisenja.domainlo.com  (root: domainlo.com)  → "kopisenja"
 *   kopisenja.localhost:3000                      → "kopisenja"
 *   domainlo.com / www.domainlo.com / admin.…     → null
 *   127.0.0.1:3000 / 100.88.79.104:3000           → null
 *
 * Reserved labels are ignored so `admin.<root>` (and similar infrastructure
 * hosts) never resolve a merchant tenant.
 */
export function extractSubdomainSlug(
  host: string | null | undefined,
  rootDomain?: string | null
): string | null {
  const value = normalizeHostValue(host);
  if (!value) return null;

  const { hostname } = splitHost(value);
  if (!hostname || isIpHost(hostname) || hostname === "localhost") return null;

  const root = resolveRootDomain(value, rootDomain);
  if (!root) return null;

  const rootHostname = splitHost(root).hostname;
  if (!rootHostname || hostname === rootHostname) return null;
  if (!hostname.endsWith(`.${rootHostname}`)) return null;

  const label = hostname.slice(0, hostname.length - rootHostname.length - 1);
  // Exactly ONE label: `a.b.<root>` is not a tenant address.
  if (!label || label.includes(".")) return null;
  if (!TENANT_LABEL_REGEX.test(label)) return null;
  if (isReservedSlug(label)) return null;

  return label;
}

// ------------------------------------------------------------
// URL building
// ------------------------------------------------------------

function requestHost(reqHeaders?: Headers | null): string {
  if (reqHeaders) {
    return (
      normalizeHostValue(reqHeaders.get("x-forwarded-host")) ||
      normalizeHostValue(reqHeaders.get("host"))
    );
  }
  if (typeof window !== "undefined") {
    return normalizeHostValue(window.location.host);
  }
  return "";
}

function requestProtocol(reqHeaders: Headers | undefined, hostname: string): string {
  const forwarded = reqHeaders
    ?.get("x-forwarded-proto")
    ?.split(",")[0]
    ?.trim()
    ?.toLowerCase();
  if (forwarded === "http" || forwarded === "https") return forwarded;
  if (typeof window !== "undefined") {
    return window.location.protocol === "http:" ? "http" : "https";
  }
  if (hostname === "localhost" || isIpHost(hostname)) return "http";
  return "https";
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * Full public storefront URL of a tenant.
 *
 *   root domain configured / derivable → `https://kopisenja.domainlo.com`
 *   local development                  → `http://kopisenja.localhost:3000`
 *   raw IP / no root domain            → `http://<host>/r/kopisenja`
 *
 * `reqHeaders` should be the incoming request headers on the server. When
 * omitted (client components / middleware-less calls) the current
 * `window.location` is used.
 */
export function buildTenantPublicUrl(slug: string, reqHeaders?: Headers): string {
  const cleanSlug = slug.trim().toLowerCase();
  const host = requestHost(reqHeaders);
  const { hostname, port } = splitHost(host);
  const protocol = requestProtocol(reqHeaders, hostname);

  const rootDomain = resolveRootDomain(host || null);
  if (!rootDomain) {
    const origin = host
      ? `${protocol}://${host}`
      : stripTrailingSlash(
          process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
        );
    return `${origin}/r/${encodeURIComponent(cleanSlug)}`;
  }

  const root = splitHost(rootDomain);
  const effectivePort = root.port ?? port;
  const tenantHost = effectivePort
    ? `${cleanSlug}.${root.hostname}:${effectivePort}`
    : `${cleanSlug}.${root.hostname}`;
  const scheme =
    root.hostname === "localhost" || isIpHost(root.hostname) ? "http" : "https";
  return `${scheme}://${tenantHost}`;
}

/** True when `buildTenantPublicUrl` produced the `/r/<slug>` path fallback. */
export function isPathTenantUrl(url: string, slug: string): boolean {
  try {
    return (
      new URL(url).pathname ===
      `/r/${encodeURIComponent(slug.trim().toLowerCase())}`
    );
  } catch {
    return false;
  }
}

/**
 * Append a customer path to an ALREADY-resolved tenant base URL.
 *
 *   subdomain base → `<base>/t/PUSAT/12`
 *   path base      → `<base>?next=%2Ft%2FPUSAT%2F12` (handled by /r/[slug])
 *
 * Used by the QR generator, which resolves the tenant base from the admin's
 * current origin instead of request headers.
 */
export function appendTenantPath(
  baseUrl: string,
  slug: string,
  path: string
): string {
  const target = path.startsWith("/") ? path : `/${path}`;
  if (isPathTenantUrl(baseUrl, slug)) {
    return `${baseUrl}?next=${encodeURIComponent(target)}`;
  }
  return `${stripTrailingSlash(baseUrl)}${target}`;
}

/**
 * Public URL for a customer-facing path inside a tenant (e.g. a table QR).
 *
 *   subdomain hosting → `https://kopisenja.domainlo.com/t/PUSAT/12`
 *   path fallback     → `https://host/r/kopisenja?next=%2Ft%2FPUSAT%2F12`
 *
 * The `next` parameter is honored by `/r/[slug]` so a QR scanned through the
 * fallback still lands on the table, not just the menu.
 */
export function buildTenantTableUrl(
  slug: string,
  tablePath: string,
  reqHeaders?: Headers
): string {
  return appendTenantPath(
    buildTenantPublicUrl(slug, reqHeaders),
    slug,
    tablePath
  );
}
