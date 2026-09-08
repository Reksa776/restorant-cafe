import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { tryGetCustomerSessionFromRequest } from "@/lib/customer-session.server";

// ============================================================
// GET /api/public/menu/recommendations
//   ?restaurantId=xxx&categoryId=yyy&productId=zzz&customerId=ccc&limit=10
//
// Product recommendations for the customer menu page — NO AI, pure
// server-side aggregation over existing order data:
//   1. Customer favorites (when customerId is provided — logged-in customer)
//   2. Frequently bought together with the currently viewed product
//      (when productId is provided)
//   3. Best sellers restaurant-wide / within the viewed category
//   4. Fallback: active products when there is not enough order data
//
// Always restaurant-scoped, only ACTIVE + AVAILABLE products, and never
// exposes customer PII or raw order history (only product info is returned).
// ============================================================

const MAX_LIMIT = 12;
const DEFAULT_LIMIT = 10;

// Product include shared with /api/public/menu so the menu page can reuse
// its existing ProductCard + Decimal normalization.
const productInclude = {
  category: {
    select: { id: true, name: true },
  },
  optionGroups: {
    where: { isActive: true },
    include: {
      options: {
        where: { isActive: true },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { sortOrder: "asc" },
  },
  addons: {
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  },
} as const;

/** Load full product rows for a set of ids (restaurant-scoped, active only). */
async function loadProducts(restaurantId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return prisma.product.findMany({
    where: {
      id: { in: ids },
      restaurantId,
      isActive: true,
      isAvailable: true,
    },
    include: productInclude,
  });
}

/** Aggregate the most-ordered products (quantity desc) for a restaurant. */
async function getBestSellers(
  restaurantId: string,
  opts?: { categoryId?: string; excludeIds?: string[]; take?: number }
) {
  const where: Record<string, unknown> = {
    // Exclude cancelled orders — a cancelled order did not actually sell.
    order: { is: { restaurantId, status: { not: "CANCELLED" } } },
  };
  if (opts?.categoryId) {
    where.product = { is: { categoryId: opts.categoryId } };
  }

  const grouped = await prisma.orderItem.groupBy({
    by: ["productId"],
    where,
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: Math.max(opts?.take ?? 30, 1),
  });

  let ids = grouped.map((g) => g.productId);
  if (opts?.excludeIds?.length) {
    const excluded = new Set(opts.excludeIds);
    ids = ids.filter((id) => !excluded.has(id));
  }

  const products = await loadProducts(restaurantId, ids);
  const qtyById = new Map(grouped.map((g) => [g.productId, g._sum.quantity ?? 0]));
  return products
    .map((p) => ({ product: p, qty: qtyById.get(p.id) ?? 0 }))
    .sort((a, b) => b.qty - a.qty)
    .map((r) => r.product);
}

/**
 * Products that are frequently ordered together with `targetProductId`:
 * other products appearing in the same (non-cancelled) orders.
 */
async function getBoughtTogether(
  restaurantId: string,
  targetProductId: string,
  opts?: { excludeIds?: string[]; take?: number }
) {
  // Bounded: look at the most recent orders containing the target product
  // (distinct orderIds) so the aggregation stays cheap.
  const rows = await prisma.orderItem.findMany({
    where: {
      productId: targetProductId,
      order: { is: { restaurantId, status: { not: "CANCELLED" } } },
    },
    select: { orderId: true },
    orderBy: { createdAt: "desc" },
    take: 200,
    distinct: ["orderId"],
  });

  const orderIds = rows.map((r) => r.orderId);
  if (orderIds.length === 0) return [];

  const grouped = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: {
      orderId: { in: orderIds },
      productId: { not: targetProductId },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: Math.max(opts?.take ?? 15, 1),
  });

  let ids = grouped.map((g) => g.productId);
  if (opts?.excludeIds?.length) {
    const excluded = new Set(opts.excludeIds);
    ids = ids.filter((id) => !excluded.has(id));
  }

  const products = await loadProducts(restaurantId, ids);
  const qtyById = new Map(grouped.map((g) => [g.productId, g._sum.quantity ?? 0]));
  return products
    .map((p) => ({ product: p, qty: qtyById.get(p.id) ?? 0 }))
    .sort((a, b) => b.qty - a.qty)
    .map((r) => r.product);
}

/** Products the customer has ordered most often (personalization). */
async function getCustomerFavorites(
  restaurantId: string,
  customerId: string,
  opts?: { excludeIds?: string[]; take?: number }
) {
  const grouped = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: {
      order: {
        is: { restaurantId, customerId, status: { not: "CANCELLED" } },
      },
    },
    _sum: { quantity: true },
    orderBy: { _sum: { quantity: "desc" } },
    take: Math.max(opts?.take ?? 15, 1),
  });

  let ids = grouped.map((g) => g.productId);
  if (opts?.excludeIds?.length) {
    const excluded = new Set(opts.excludeIds);
    ids = ids.filter((id) => !excluded.has(id));
  }

  const products = await loadProducts(restaurantId, ids);
  const qtyById = new Map(grouped.map((g) => [g.productId, g._sum.quantity ?? 0]));
  return products
    .map((p) => ({ product: p, qty: qtyById.get(p.id) ?? 0 }))
    .sort((a, b) => b.qty - a.qty)
    .map((r) => r.product);
}

/** Fallback: any active/available product, newest first. */
async function getFallbackProducts(
  restaurantId: string,
  opts?: { categoryId?: string; excludeIds?: string[]; take?: number }
) {
  const where: Record<string, unknown> = {
    restaurantId,
    isActive: true,
    isAvailable: true,
  };
  if (opts?.categoryId) where.categoryId = opts.categoryId;
  if (opts?.excludeIds?.length) {
    where.id = { notIn: opts.excludeIds };
  }

  return prisma.product.findMany({
    where,
    include: productInclude,
    orderBy: { createdAt: "desc" },
    take: Math.max(opts?.take ?? DEFAULT_LIMIT, 1),
  });
}

export async function GET(request: NextRequest) {
  try {
    assertRateLimit(
      rateLimitKey("public-menu-recommendations", request),
      240,
      60_000
    );

    const { searchParams } = new URL(request.url);
    const restaurantId = searchParams.get("restaurantId");
    const categoryId = searchParams.get("categoryId") || undefined;
    const productId = searchParams.get("productId") || undefined;
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit")) || DEFAULT_LIMIT, 1),
      MAX_LIMIT
    );

    // The logged-in customer is read from the httpOnly session cookie
    // (never trusted from a query param) — only used for personalization.
    const session = tryGetCustomerSessionFromRequest(request);
    const customerId = session?.customerId || undefined;

    if (!restaurantId) {
      throw new AppError("restaurantId is required", 400, "VALIDATION_ERROR");
    }

    const restaurant = await prisma.restaurant.findFirst({
      where: { id: restaurantId, isActive: true },
      select: { id: true },
    });
    if (!restaurant) {
      throw new AppError("Restaurant not found", 404, "NOT_FOUND");
    }

    // Sanitize: only a customer of THIS restaurant can be used for
    // personalization (never another tenant's history).
    let verifiedCustomerId: string | undefined;
    if (customerId) {
      const customer = await prisma.customer.findFirst({
        where: { id: customerId, restaurantId, isActive: true },
        select: { id: true },
      });
      if (customer) verifiedCustomerId = customer.id;
    }

    const recommended: Array<{ id: string }> = [];
    const seen = new Set<string>();

    const push = (products: Array<{ id: string }>) => {
      for (const p of products) {
        if (seen.has(p.id)) continue;
        seen.add(p.id);
        recommended.push(p);
        if (recommended.length >= limit) return;
      }
    };

    // 1. Personalized: the customer's own favorites (login only).
    if (verifiedCustomerId && recommended.length < limit) {
      push(
        await getCustomerFavorites(restaurantId, verifiedCustomerId, {
          take: limit,
        })
      );
    }

    // 2. Frequently bought together with the currently viewed product.
    if (productId && recommended.length < limit) {
      const target = await prisma.product.findFirst({
        where: { id: productId, restaurantId, isActive: true, isAvailable: true },
        select: { id: true },
      });
      if (target) {
        push(
          await getBoughtTogether(restaurantId, target.id, {
            excludeIds: [...seen],
            take: limit,
          })
        );
      }
    }

    // 3. Best sellers — within the viewed category when provided, else
    //    restaurant-wide.
    if (recommended.length < limit) {
      push(
        await getBestSellers(restaurantId, {
          categoryId,
          excludeIds: [...seen],
          take: limit * 3,
        })
      );
    }

    // 4. Fallback: any active product (restaurant new / no order data).
    if (recommended.length < limit) {
      push(
        await getFallbackProducts(restaurantId, {
          categoryId,
          excludeIds: [...seen],
          take: limit,
        })
      );
    }

    return successResponse({
      products: recommended.slice(0, limit),
      // Metadata for the UI (e.g. "Rekomendasi Untuk Kamu" vs "Produk Populer").
      source:
        verifiedCustomerId && seen.size > 0 ? "personalized" : "popular",
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching recommendations:", error);
    return errorResponse(
      "Failed to fetch recommendations",
      "INTERNAL_ERROR",
      500
    );
  }
}