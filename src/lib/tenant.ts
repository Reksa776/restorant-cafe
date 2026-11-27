import { Prisma } from "@prisma/client";
import type { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  buildTenantPublicUrl,
  buildTenantTableUrl,
  extractSubdomainSlug,
  isReservedSlug,
  previewTenantSlug,
  RESERVED_SLUGS,
  resolveRootDomain,
  slugify,
} from "@/lib/tenant-url";

// Subdomain helpers are pure (Edge/client safe) and live in tenant-url.ts so
// middleware and client components can import them without pulling Prisma
// into their bundle. They are re-exported here for server callers.
export {
  buildTenantPublicUrl,
  buildTenantTableUrl,
  extractSubdomainSlug,
  isReservedSlug,
  previewTenantSlug,
  RESERVED_SLUGS,
  resolveRootDomain,
  slugify,
};

// ============================================================
// PHASE 2 — TRUE SAAS MULTI-TENANT HELPERS
//
// Every tenant (merchant) is a `Restaurant` row. Two rules keep tenants
// isolated:
//   1. PUBLIC routes must resolve an EXPLICIT tenant (slug / restaurantId /
//      table / cookie set by the tenant's QR or store URL). The old
//      "first active restaurant" fallback is gone — it silently showed
//      merchant A's menu to merchant B's customers.
//   2. ADMIN routes already derive `restaurantId` from the session
//      (requireRoles/requireAdmin) and every service query filters by it.
//      Child models without their own `restaurantId` (OrderItem, RecipeItem,
//      ProductOption, …) are only reachable through a tenant-scoped parent.
//      `assertTenantRecord()` gives routes a single, auditable ownership
//      check for the few places that receive a raw UUID from the client.
// ============================================================

/** Cookie carrying the tenant the customer is currently shopping in. */
export const TENANT_COOKIE = "tenant_slug";

const TENANT_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

export interface ActiveTenant {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  email: string | null;
}

function randomSuffix(length = 5): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/**
 * Generate a slug that is unique across ALL tenants. The plain slug is tried
 * first (nice URLs); collisions get a short random suffix. Must run inside the
 * caller's transaction so a concurrent registration cannot claim the same
 * slug between the check and the insert — the unique index is the final
 * backstop.
 */
export async function generateUniqueSlug(
  client: Pick<Prisma.TransactionClient, "restaurant">,
  name: string
): Promise<string> {
  // Reserved labels (admin, api, www, …) are infrastructure hosts and can
  // never be a merchant subdomain, so a restaurant named "Admin" is
  // registered as `admin-resto` instead.
  const base = previewTenantSlug(name);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${randomSuffix()}`;
    if (isReservedSlug(candidate)) continue;
    const existing = await client.restaurant.findUnique({
      where: { slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
  }
  // Extremely unlikely: fall back to a timestamped suffix (still unique).
  return `${base}-${Date.now().toString(36)}`;
}

/** Resolve an ACTIVE tenant by explicit slug or id. Returns null if absent. */
export async function resolveActiveTenant(hints: {
  slug?: string | null;
  id?: string | null;
}): Promise<ActiveTenant | null> {
  const slug = hints.slug?.trim().toLowerCase();
  const id = hints.id?.trim();
  if (!slug && !id) return null;

  return prisma.restaurant.findFirst({
    where: {
      isActive: true,
      ...(slug ? { slug } : { id }),
    },
    select: {
      id: true,
      slug: true,
      name: true,
      address: true,
      phone: true,
      email: true,
    },
  });
}

/** One legal DNS label (mirrors the middleware/slug rules). */
function isSafeSlugLabel(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/.test(value);
}

/**
 * Tenant slug carried by the request HOST (`kopisenja.domainlo.com`).
 *
 * Priority: the `x-tenant-slug` header set by the middleware (it strips any
 * client-supplied value first), then the host headers themselves so a request
 * that bypasses the matcher still resolves its tenant. Returns null for the
 * main domain, reserved hosts (`www`, `admin`, `api`, …) and raw IP hosts.
 */
export function tenantSlugFromHost(headers: Headers): string | null {
  const forwarded = headers.get("x-tenant-slug")?.trim().toLowerCase();
  if (forwarded && isSafeSlugLabel(forwarded) && !isReservedSlug(forwarded)) {
    return forwarded;
  }

  const host =
    headers.get("x-forwarded-host") ?? headers.get("host") ?? null;
  return extractSubdomainSlug(host, process.env.NEXT_PUBLIC_ROOT_DOMAIN);
}

/**
 * Tenant slug hinted by the request: merchant subdomain → ?slug= → cookie.
 * Explicit subdomains always win so a link opened inside one merchant's
 * storefront can never be resolved against another merchant.
 */
export function tenantSlugFromRequest(request: NextRequest): string | null {
  const subdomainSlug = tenantSlugFromHost(request.headers);
  if (subdomainSlug) return subdomainSlug;
  const querySlug = request.nextUrl.searchParams.get("slug")?.trim();
  if (querySlug) return querySlug;
  const cookieSlug = request.cookies.get(TENANT_COOKIE)?.value?.trim();
  return cookieSlug || null;
}

/**
 * Resolve the tenant of a public request.
 *
 * Priority (highest first):
 *   1. The merchant SUBDOMAIN of the host (`kopisenja.domainlo.com`) — it is
 *      the storefront the browser is actually on, so nothing else may
 *      override it. An unknown subdomain resolves to null (404), never to a
 *      different merchant.
 *   2. Explicit hints: `slug`/`id` arguments → ?slug= → ?restaurantId=.
 *   3. The `tenant_slug` cookie (ambient context of the last storefront).
 *
 * Returns null when no tenant can be resolved — callers decide the HTTP
 * status (400 for "missing tenant context", 404 for "tenant not found").
 * There is deliberately NO "first active restaurant" fallback.
 */
export async function resolveRequestTenant(
  request: NextRequest,
  hints: { slug?: string | null; id?: string | null } = {}
): Promise<ActiveTenant | null> {
  // 1. Host subdomain is authoritative. Returning here (even null) is what
  //    keeps `kopisenja.domainlo.com` from ever reading another tenant's
  //    data through a stale ?slug= or cookie.
  const subdomainSlug = tenantSlugFromHost(request.headers);
  if (subdomainSlug) {
    return resolveActiveTenant({ slug: subdomainSlug });
  }

  // Explicit hints (argument or query string) ALWAYS win over the cookie: a
  // stale cookie from merchant A must never override an explicit link to
  // merchant B. The cookie is only the ambient context for the tenant the
  // customer last entered through.
  const explicitSlug =
    hints.slug?.trim() || request.nextUrl.searchParams.get("slug")?.trim() || null;
  const explicitId =
    hints.id?.trim() ||
    request.nextUrl.searchParams.get("restaurantId")?.trim() ||
    null;

  if (explicitSlug || explicitId) {
    return resolveActiveTenant({ slug: explicitSlug, id: explicitId });
  }

  const cookieSlug = request.cookies.get(TENANT_COOKIE)?.value?.trim() || null;
  return resolveActiveTenant({ slug: cookieSlug });
}

/**
 * Same as `resolveRequestTenant` but throws a 400 when the request carries no
 * tenant context at all. Use when the response must NEVER fall back to a
 * different merchant's data.
 */
export async function requireRequestTenant(
  request: NextRequest,
  hints: { slug?: string | null; id?: string | null } = {}
): Promise<ActiveTenant> {
  const tenant = await resolveRequestTenant(request, hints);
  if (!tenant) {
    throw new ValidationError(
      "Konteks restoran tidak ditemukan. Pindai QR meja atau gunakan link restoran."
    );
  }
  return tenant;
}

/** Persist the current tenant on the browser (set from /r/[slug] or a QR scan). */
export function setTenantCookie(response: NextResponse, slug: string): void {
  response.cookies.set(TENANT_COOKIE, slug, {
    path: "/",
    sameSite: "lax",
    httpOnly: false, // readable by the customer UI for tenant-aware links
    secure: process.env.NODE_ENV === "production",
    maxAge: TENANT_COOKIE_MAX_AGE_SECONDS,
  });
}

// ============================================================
// TENANT OWNERSHIP GUARD (IDOR defense for raw client-supplied UUIDs)
//
// Only root tenant models are listed: every child row (OrderItem,
// RecipeItem, ProductOption, AddonIngredient, RefundItem, PurchaseItem, …) is
// reachable exclusively through one of these parents, so validating the
// parent is sufficient — and is the pattern used across the services.
// ============================================================

type TenantLookup = (
  id: string,
  restaurantId: string
) => Promise<{ id: string } | null>;

const tenantLookups = {
  restaurant: async (id) => prisma.restaurant.findUnique({ where: { id }, select: { id: true } }),
  branch: (id, restaurantId) =>
    prisma.branch.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  user: (id, restaurantId) =>
    prisma.user.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  category: (id, restaurantId) =>
    prisma.category.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  product: (id, restaurantId) =>
    prisma.product.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  table: (id, restaurantId) =>
    prisma.table.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  tableLayout: (id, restaurantId) =>
    prisma.tableLayout.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  order: (id, restaurantId) =>
    prisma.order.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  payment: (id, restaurantId) =>
    prisma.payment.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  customer: (id, restaurantId) =>
    prisma.customer.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  promo: (id, restaurantId) =>
    prisma.promo.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  refund: (id, restaurantId) =>
    prisma.refund.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  shift: (id, restaurantId) =>
    prisma.cashierShift.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  ingredient: (id, restaurantId) =>
    prisma.ingredient.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  supplier: (id, restaurantId) =>
    prisma.supplier.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  purchase: (id, restaurantId) =>
    prisma.purchase.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  expense: (id, restaurantId) =>
    prisma.expense.findFirst({ where: { id, restaurantId }, select: { id: true } }),
  expenseCategory: (id, restaurantId) =>
    prisma.expenseCategory.findFirst({ where: { id, restaurantId }, select: { id: true } }),
} satisfies Record<string, TenantLookup>;

export type TenantModel = keyof typeof tenantLookups;

/**
 * Ensure `id` belongs to `restaurantId`, throwing 404 otherwise (a 404, not a
 * 403, so a merchant cannot probe which UUIDs exist in other tenants).
 *
 * `restaurant` itself only checks existence of the id, because the caller
 * passes the session's own restaurantId — a mismatch check is meaningless
 * there; use `assertCurrentTenant` below for that.
 */
export async function assertTenantRecord(
  model: TenantModel,
  id: string,
  restaurantId: string
): Promise<void> {
  const row = await tenantLookups[model](id, restaurantId);
  if (!row) {
    throw new NotFoundError("Data tidak ditemukan pada restoran ini");
  }
}

/** Forbid operating on another restaurant's id (403-free 404 semantics). */
export function assertCurrentTenant(
  sessionRestaurantId: string,
  targetRestaurantId: string
): void {
  if (sessionRestaurantId !== targetRestaurantId) {
    throw new NotFoundError("Data tidak ditemukan pada restoran ini");
  }
}

/**
 * Tenant-scoped `where` builder. Use for queries on models that carry a
 * direct `restaurantId` column so a forgotten filter is visually obvious.
 */
export function tenantWhere(restaurantId: string): { restaurantId: string } {
  return { restaurantId };
}
