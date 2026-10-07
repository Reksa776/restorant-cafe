import { prisma } from "@/lib/prisma";

// ============================================================
// TEST-ONLY fixtures for the RESERVATION PURCHASE flow.
//
// A public reservation now CARRIES its own purchase, so the tests need a real
// product to order: restaurant → category → product (+ optional option group /
// addon) and, when a branch is given, a BranchProduct row carrying the stock
// the order engine enforces.
//
// This module is imported by tests only; no app code depends on it.
// ============================================================

let sequence = 0;

export interface ReservationProductOverrides {
  /** Branch whose BranchProduct row carries stock (needed to order). */
  branchId?: string | null;
  /**
   * Extra branches that should also carry this product (same price). Suites
   * that seed one shared product for many branches pass them here instead of
   * seeding a product per branch.
   */
  branchIds?: string[];
  price?: number;
  /** Branch stock for the seeded product (default 50). */
  stock?: number;
  /** REQUIRED single-select option group with one option (paket/variant). */
  requiredOption?: { name: string; priceAdjustment?: number };
  /** Optional addon. */
  addon?: { name: string; price?: number };
}

export interface ReservationProductFixture {
  productId: string;
  categoryId: string;
  /** Ready-to-send `items[]` entry (quantity 1). */
  item: { productId: string; quantity: number };
  optionId?: string;
  optionGroupId?: string;
  addonId?: string;
  price: number;
}

export async function seedReservationProduct(
  restaurantId: string,
  overrides: ReservationProductOverrides = {}
): Promise<ReservationProductFixture> {
  sequence += 1;
  const stamp = `${Date.now()}-${sequence}`;
  const price = overrides.price ?? 25000;

  const category = await prisma.category.create({
    data: { restaurantId, name: `QA Menu ${stamp}`, sortOrder: 0 },
  });
  const product = await prisma.product.create({
    data: {
      restaurantId,
      categoryId: category.id,
      name: `QA Produk ${stamp}`,
      price,
    },
  });

  let optionGroupId: string | undefined;
  let optionId: string | undefined;
  if (overrides.requiredOption) {
    const group = await prisma.productOptionGroup.create({
      data: {
        productId: product.id,
        name: overrides.requiredOption.name,
        type: "SINGLE",
        isRequired: true,
        minSelect: 1,
        maxSelect: 1,
      },
    });
    const option = await prisma.productOption.create({
      data: {
        optionGroupId: group.id,
        name: `${overrides.requiredOption.name} A`,
        priceAdjustment: overrides.requiredOption.priceAdjustment ?? 0,
      },
    });
    optionGroupId = group.id;
    optionId = option.id;
  }

  let addonId: string | undefined;
  if (overrides.addon) {
    const addon = await prisma.productAddon.create({
      data: {
        productId: product.id,
        name: overrides.addon.name,
        price: overrides.addon.price ?? 5000,
      },
    });
    addonId = addon.id;
  }

  const branchIds = [
    ...new Set(
      [overrides.branchId ?? null, ...(overrides.branchIds ?? [])].filter(
        (id): id is string => Boolean(id)
      )
    ),
  ];
  for (const branchId of branchIds) {
    await prisma.branchProduct.create({
      data: {
        branchId,
        productId: product.id,
        isAvailable: true,
        stock: overrides.stock ?? 50,
      },
    });
  }

  return {
    productId: product.id,
    categoryId: category.id,
    item: { productId: product.id, quantity: 1 },
    optionGroupId,
    optionId,
    addonId,
    price,
  };
}

/** Remove the seeded purchase graph (call BEFORE deleting customers). */
export async function cleanupPurchases(restaurantIds: string[]): Promise<void> {
  const ids = restaurantIds.filter(Boolean);
  if (ids.length === 0) return;

  // Payments/refunds/status-history carry an FK to the order and are NOT
  // cascade-deleted, so they must go first.
  await prisma.refundItem.deleteMany({
    where: { refund: { order: { restaurantId: { in: ids } } } },
  });
  await prisma.refund.deleteMany({
    where: { order: { restaurantId: { in: ids } } },
  });
  await prisma.cancellationRequest.deleteMany({
    where: { order: { restaurantId: { in: ids } } },
  });
  await prisma.paymentTransaction.deleteMany({
    where: { payment: { order: { restaurantId: { in: ids } } } },
  });
  await prisma.payment.deleteMany({
    where: { order: { restaurantId: { in: ids } } },
  });
  await prisma.orderStatusHistory.deleteMany({
    where: { order: { restaurantId: { in: ids } } },
  });
  await prisma.orderItem.deleteMany({
    where: { order: { restaurantId: { in: ids } } },
  });
  await prisma.order.deleteMany({ where: { restaurantId: { in: ids } } });
  // Deleting products cascades their BranchProduct/option/addon rows.
  await prisma.product.deleteMany({ where: { restaurantId: { in: ids } } });
  await prisma.category.deleteMany({ where: { restaurantId: { in: ids } } });
}
