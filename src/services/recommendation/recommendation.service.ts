import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

// ============================================================
// Recommendation service (F3/F4) — tenant-scoped.
//
// ADMIN side: curates ProductRecommendation rows ("product A recommends
// product B"). One row per pair; sortOrder + isActive per row. The save
// is a transactional replace so reorder / enable / disable / remove all
// happen atomically.
//
// PUBLIC side: the tiered recommendation engine (highest priority first):
//   1. MANUAL admin recommendations (active rows, target product must be
//      active + available)
//   2. Personalized (logged-in customer's favorites)
//   3. Frequently bought together (when a productId context is given)
//   4. Best sellers (restaurant-wide or within a category)
//   5. Active product fallback
//
// getBestSellers() is shared with the "🔥 Terlaris" section (F4). It is
// parameterized with requirePaid so the Terlaris section counts REAL sales
// (PAID orders only) while the recommendation engine keeps its existing
// non-cancelled semantics.
// ============================================================

// Product include shared with the public menu routes so ProductCards and
// Decimal normalization keep working unchanged.
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

/** Load full product rows for a set of ids (restaurant-scoped, active+available). */
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

export class RecommendationService {
  // ============================================================
  // ADMIN — curated recommendations (ADMIN role, tenant-scoped).
  // ============================================================

  /** Active products of a restaurant, for the admin pickers. */
  async listActiveProducts(restaurantId: string, excludeIds: string[] = []) {
    return prisma.product.findMany({
      where: {
        restaurantId,
        isActive: true,
        ...(excludeIds.length > 0 ? { id: { notIn: excludeIds } } : {}),
      },
      select: {
        id: true,
        name: true,
        category: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Admin list: recommendations configured FOR `productId`, joined with the
   * recommended product so the UI can render name / availability / active.
   */
  async listRecommendationsAdmin(restaurantId: string, productId?: string) {
    if (!productId) {
      return { product: null, recommendations: [] };
    }

    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId, isActive: true },
      select: { id: true, name: true },
    });
    if (!product) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    const rows = await prisma.productRecommendation.findMany({
      where: { restaurantId, productId },
      include: {
        recommendedProduct: {
          select: {
            id: true,
            name: true,
            imageUrl: true,
            isAvailable: true,
            isActive: true,
          },
        },
      },
      orderBy: { sortOrder: "asc" },
    });

    return {
      product,
      recommendations: rows.map((r) => ({
        id: r.id,
        recommendedProductId: r.recommendedProductId,
        name: r.recommendedProduct.name,
        imageUrl: r.recommendedProduct.imageUrl,
        isAvailable: r.recommendedProduct.isAvailable,
        recommendedIsActive: r.recommendedProduct.isActive,
        isActive: r.isActive,
        sortOrder: r.sortOrder,
      })),
    };
  }

  /**
   * Admin save: transactionally REPLACE the recommendation list for one
   * source product. The array order becomes sortOrder. Handles add,
   * reorder, enable/disable and remove in a single atomic write.
   *
   * Validation (never trusts the client):
   *  - source product exists, is active and belongs to the restaurant
   *  - every recommended product exists, is ACTIVE + AVAILABLE and belongs
   *    to the SAME restaurant (cross-restaurant config is impossible)
   *  - a product cannot recommend itself
   *  - duplicate recommended ids are rejected
   */
  async saveRecommendations(
    restaurantId: string,
    productId: string,
    entries: Array<{ recommendedProductId: string; isActive: boolean }>
  ) {
    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId, isActive: true },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    if (entries.length > 0) {
      const ids = entries.map((e) => e.recommendedProductId);
      if (new Set(ids).size !== ids.length) {
        throw new ValidationError("Produk rekomendasi duplikat");
      }
      if (ids.includes(productId)) {
        throw new ValidationError("Produk tidak bisa merekomendasikan dirinya sendiri");
      }

      // Every target must belong to THIS restaurant and be active+available.
      const targets = await prisma.product.findMany({
        where: {
          id: { in: ids },
          restaurantId,
          isActive: true,
          isAvailable: true,
        },
        select: { id: true },
      });
      if (targets.length !== ids.length) {
        throw new ValidationError(
          "Produk rekomendasi tidak valid, tidak aktif, atau tidak tersedia"
        );
      }
    }

    await prisma.$transaction(async (tx) => {
      const existing = await tx.productRecommendation.findMany({
        where: { restaurantId, productId },
        select: { id: true, recommendedProductId: true },
      });
      const existingByTarget = new Map(
        existing.map((e) => [e.recommendedProductId, e.id])
      );

      const keepTargets = new Set(entries.map((e) => e.recommendedProductId));

      // Remove recommendations that are no longer in the list.
      const toDelete = existing
        .filter((e) => !keepTargets.has(e.recommendedProductId))
        .map((e) => e.id);
      if (toDelete.length > 0) {
        await tx.productRecommendation.deleteMany({
          where: { id: { in: toDelete } },
        });
      }

      // Upsert the rest with their new sortOrder / isActive.
      for (const [index, entry] of entries.entries()) {
        const existingId = existingByTarget.get(entry.recommendedProductId);
        if (existingId) {
          await tx.productRecommendation.update({
            where: { id: existingId },
            data: { sortOrder: index, isActive: entry.isActive },
          });
        } else {
          await tx.productRecommendation.create({
            data: {
              restaurantId,
              productId,
              recommendedProductId: entry.recommendedProductId,
              sortOrder: index,
              isActive: entry.isActive,
            },
          });
        }
      }
    });

    return this.listRecommendationsAdmin(restaurantId, productId);
  }

  // ============================================================
  // PUBLIC — shared aggregations (no PII, restaurant-scoped).
  // ============================================================

  /**
   * Best sellers by aggregated quantity sold.
   * - `requirePaid` true → only orders with paymentStatus PAID and status
   *   != CANCELLED (the "real sales" definition used by Terlaris, F4).
   * - `requirePaid` false → the existing recommendation-engine definition
   *   (status != CANCELLED) — kept unchanged to avoid altering the current
   *   recommendation behavior.
   * Only ACTIVE + AVAILABLE products are ever returned.
   */
  async getBestSellers(
    restaurantId: string,
    opts?: {
      categoryId?: string;
      excludeIds?: string[];
      take?: number;
      requirePaid?: boolean;
    }
  ) {
    const orderWhere: Record<string, unknown> = {
      restaurantId,
      status: { not: "CANCELLED" },
    };
    if (opts?.requirePaid) {
      orderWhere.paymentStatus = "PAID";
    }
    const where: Record<string, unknown> = { order: { is: orderWhere } };
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
  async getBoughtTogether(
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
  async getCustomerFavorites(
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
  async getFallbackProducts(
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
      take: Math.max(opts?.take ?? 10, 1),
    });
  }

  /**
   * MANUAL admin recommendations that are eligible for public display:
   * active row AND the recommended product is active + available
   * (restaurant-scoped). When `productId` is given, only that product's
   * curated list is used; otherwise ALL curated rows for the restaurant
   * are collected (deduped) — this is what drives the menu page when no
   * product context exists.
   */
  async getManualRecommendations(
    restaurantId: string,
    productId?: string,
    opts?: { excludeIds?: string[]; take?: number }
  ) {
    const rows = await prisma.productRecommendation.findMany({
      where: {
        restaurantId,
        isActive: true,
        ...(productId ? { productId } : {}),
        recommendedProduct: { is: { isActive: true, isAvailable: true } },
      },
      include: {
        recommendedProduct: { select: { id: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      take: Math.max(opts?.take ?? 50, 1),
    });

    let ids = rows.map((r) => r.recommendedProduct.id);
    if (opts?.excludeIds?.length) {
      const excluded = new Set(opts.excludeIds);
      ids = ids.filter((id) => !excluded.has(id));
    }

    return loadProducts(restaurantId, ids);
  }

  /**
   * The full tiered public recommendation engine. `customerId` must be a
   * VERIFIED customer of this restaurant (the route verifies the session
   * before passing it). Manual recommendations always have highest priority.
   */
  async getRecommendations(
    restaurantId: string,
    opts: {
      categoryId?: string;
      productId?: string;
      customerId?: string;
      limit: number;
    }
  ) {
    const limit = opts.limit;
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

    // 1. MANUAL admin recommendations (highest priority).
    if (recommended.length < limit) {
      push(
        await this.getManualRecommendations(restaurantId, opts.productId, {
          excludeIds: [...seen],
          take: limit,
        })
      );
    }

    // 2. Personalized: the customer's own favorites (login only).
    if (opts.customerId && recommended.length < limit) {
      push(
        await this.getCustomerFavorites(restaurantId, opts.customerId, {
          excludeIds: [...seen],
          take: limit,
        })
      );
    }

    // 3. Frequently bought together with the currently viewed product.
    if (opts.productId && recommended.length < limit) {
      const target = await prisma.product.findFirst({
        where: {
          id: opts.productId,
          restaurantId,
          isActive: true,
          isAvailable: true,
        },
        select: { id: true },
      });
      if (target) {
        push(
          await this.getBoughtTogether(restaurantId, target.id, {
            excludeIds: [...seen],
            take: limit,
          })
        );
      }
    }

    // 4. Best sellers — within the viewed category when provided, else
    //    restaurant-wide (existing non-cancelled semantics).
    if (recommended.length < limit) {
      push(
        await this.getBestSellers(restaurantId, {
          categoryId: opts.categoryId,
          excludeIds: [...seen],
          take: limit * 3,
        })
      );
    }

    // 5. Fallback: any active product (restaurant new / no order data).
    if (recommended.length < limit) {
      push(
        await this.getFallbackProducts(restaurantId, {
          categoryId: opts.categoryId,
          excludeIds: [...seen],
          take: limit,
        })
      );
    }

    return recommended.slice(0, limit);
  }
}

export const recommendationService = new RecommendationService();