import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractSubdomainSlug } from "@/lib/tenant-url";

export const dynamic = "force-dynamic";

/**
 * GET /api/public/tenant-by-host
 *
 * Public host identity used by `/login` to render the OWNER portal (root
 * domain) or the STORE staff portal (tenant subdomain). Only public brand
 * fields are returned.
 *
 *   subdomain  → { isRootDomain: false, notFound: false, tenant: {...} }
 *   unknown    → { isRootDomain: false, notFound: true }          (404)
 *   root domain→ { isRootDomain: true,  notFound: false, tenant: null }
 */
export async function GET(request: NextRequest) {
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const slug = extractSubdomainSlug(host, process.env.NEXT_PUBLIC_ROOT_DOMAIN);

  // No tenant subdomain → the platform's own (owner) portal.
  if (!slug) {
    return NextResponse.json({
      isRootDomain: true,
      notFound: false,
      tenant: null,
    });
  }

  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { slug },
      select: {
        id: true,
        name: true,
        slug: true,
        address: true,
        isActive: true,
        settings: { select: { logoUrl: true } },
      },
    });

    if (!restaurant || !restaurant.isActive) {
      return NextResponse.json(
        {
          isRootDomain: false,
          notFound: true,
          tenant: null,
          message: "Toko tidak ditemukan",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      isRootDomain: false,
      notFound: false,
      tenant: {
        id: restaurant.id,
        name: restaurant.name,
        slug: restaurant.slug,
        logoUrl: restaurant.settings?.logoUrl ?? null,
        address: restaurant.address,
      },
    });
  } catch (error) {
    console.error("GET /api/public/tenant-by-host failed:", error);
    return NextResponse.json(
      { isRootDomain: false, notFound: true, tenant: null },
      { status: 500 }
    );
  }
}
