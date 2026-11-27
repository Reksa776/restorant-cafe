import { NextRequest, NextResponse } from "next/server";
import { resolveActiveTenant, setTenantCookie } from "@/lib/tenant";

/**
 * Only same-app paths may be used as the post-redirect target: reject
 * protocol-relative (`//evil.com`) and absolute URLs (open redirect).
 */
function safeNextPath(raw: string | null): string | null {
  if (!raw) return null;
  if (!raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

/**
 * GET /r/[slug] — the tenant's public storefront URL.
 *
 * Validates the slug against an ACTIVE restaurant, stores it in the tenant
 * cookie, then redirects to the customer menu. Every public customer API the
 * menu/checkout calls resolves the tenant from that cookie — a customer who
 * opens merchant A's link can never see merchant B's menu.
 *
 * Unknown/inactive slug → 404 (no fallback to another restaurant).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const tenant = await resolveActiveTenant({ slug });

  if (!tenant) {
    const notFoundUrl = new URL("/", request.url);
    notFoundUrl.searchParams.set("tenant", "not-found");
    return NextResponse.redirect(notFoundUrl);
  }

  // A table QR generated through the path fallback carries its destination
  // (`/t/<branch>/<table>`) as `next`, so the customer still lands on the
  // table instead of just the menu.
  const nextPath = safeNextPath(request.nextUrl.searchParams.get("next"));

  // switchTenant tells /menu to drop the previously saved cart/table/branch
  // context (e.g. merchant A) before loading, so the new store never renders
  // with the old tenant's selected branch or cart.
  const destination = nextPath ?? "/menu";
  const url = new URL(destination, request.url);
  if (!nextPath) url.searchParams.set("switchTenant", "1");
  const response = NextResponse.redirect(url);
  setTenantCookie(response, tenant.slug);
  return response;
}
