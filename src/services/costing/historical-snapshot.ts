import { Prisma, OrderItemCostStatus } from "@prisma/client";

// ============================================================
// F.5 — HISTORICAL COGS SNAPSHOT (server-side, in-transaction)
//
// Called ONLY from inside the guarded READY → COMPLETED order
// transaction (order.service updateOrderStatus) via
// `createOrderItemCostSnapshots`. It is independent of the F.4
// costing engine: F.5 stores a frozen historical cost; F.4 computes
// CURRENT potential HPP. Neither depends on the other (F.5 never
// calls the F.4 service / API — it recomputes from scratch with its
// own batched query so the computation is transaction-safe).
//
// Semantics (spec-locked):
// - One snapshot PER OrderItem (`orderItemId` unique).
// - hppUnit = Σ(RecipeItem.quantity × BranchIngredient.averageCost)
//   using the CURRENT recipe + CURRENT WAC at completion time.
// - hppTotal = hppUnit × OrderItem.quantity.
// - NO_RECIPE / MISSING_WAC / INACTIVE_INGREDIENT / NO_BRANCH
//   snapshots store NULL hpp — never 0.
// - WAC of literal 0 IS a valid zero cost (SNAPSHOTTED, hpp 0).
// - Batched single query → no N+1; snapshot rows inserted via one
//   createMany.
// ============================================================

const ROUND = Prisma.Decimal.ROUND_HALF_UP;

export interface SnapshotCandidateItem {
  orderItemId: string;
  productId: string;
  quantity: number;
}

interface ComputedSnapshot {
  orderItemId: string;
  branchId: string | null;
  productId: string;
  quantity: number;
  hppUnit: Prisma.Decimal | null;
  hppTotal: Prisma.Decimal | null;
  status: OrderItemCostStatus;
}

/**
 * Resolve recipe + WAC for a product set in ONE batched query and compute
 * the historical HPP per product (rounded ROUND_HALF_UP at the final
 * monetary boundary). Pure function of the DB rows — no I/O here.
 */
export function computeHistoricalHpp(
  products: Array<{
    id: string;
    recipe: {
      items: Array<{
        quantity: Prisma.Decimal;
        ingredient: {
          id: string;
          isActive: boolean;
          branchIngredients: Array<{ averageCost: Prisma.Decimal | null }>;
        };
      }>;
    } | null;
  }>
): Map<string, { hpp: Prisma.Decimal | null; status: OrderItemCostStatus }> {
  const map = new Map<
    string,
    { hpp: Prisma.Decimal | null; status: OrderItemCostStatus }
  >();

  for (const product of products) {
    const recipe = product.recipe;
    const items = recipe?.items ?? [];

    if (!recipe || items.length === 0) {
      map.set(product.id, { hpp: null, status: "NO_RECIPE" });
      continue;
    }

    let incomplete = false;
    const missingReason: "INACTIVE_INGREDIENT" | "MISSING_WAC" | null = null;

    let sum = new Prisma.Decimal(0);
    let covered = 0;

    for (const item of items) {
      const ingredient = item.ingredient;
      const branchIngredient = ingredient.branchIngredients[0] ?? null;

      if (!ingredient.isActive) {
        map.set(product.id, { hpp: null, status: "INACTIVE_INGREDIENT" });
        incomplete = true;
        break;
      }
      if (!branchIngredient || branchIngredient.averageCost == null) {
        map.set(product.id, { hpp: null, status: "MISSING_WAC" });
        incomplete = true;
        break;
      }

      sum = sum.add(item.quantity.mul(branchIngredient.averageCost));
      covered += 1;
    }

    if (incomplete) continue;

    if (covered === items.length) {
      // Zero is a VALID cost (averageCost = 0). Only under-coverage is not.
      map.set(product.id, {
        hpp: sum.toDecimalPlaces(2, ROUND) as Prisma.Decimal,
        status: "SNAPSHOTTED",
      });
    } else {
      map.set(product.id, { hpp: null, status: "MISSING_WAC" });
    }
  }

  return map;
}

/**
 * Build one snapshot per OrderItem. Incomplete statuses store NULL (never 0).
 */
export function buildSnapshotRows(
  items: SnapshotCandidateItem[],
  branchId: string | null,
  perProduct: Map<
    string,
    { hpp: Prisma.Decimal | null; status: OrderItemCostStatus }
  >
): ComputedSnapshot[] {
  // No branch → WAC cannot be resolved. NEW orders short on branch context get
  // NO_BRANCH (never LEGACY — LEGACY is reserved for pre-F.5 orders, which
  // have no snapshot row at all).
  if (!branchId) {
    return items.map((item) => ({
      orderItemId: item.orderItemId,
      branchId: null,
      productId: item.productId,
      quantity: item.quantity,
      hppUnit: null,
      hppTotal: null,
      status: "NO_BRANCH" as OrderItemCostStatus,
    }));
  }

  return items.map((item) => {
    const cost = perProduct.get(item.productId) ?? {
      hpp: null,
      status: "NO_RECIPE" as OrderItemCostStatus,
    };
    let hppUnit: Prisma.Decimal | null = null;
    let hppTotal: Prisma.Decimal | null = null;
    if (cost.status === "SNAPSHOTTED" && cost.hpp != null) {
      hppUnit = cost.hpp;
      hppTotal = cost.hpp
        .mul(new Prisma.Decimal(item.quantity))
        .toDecimalPlaces(2, ROUND) as Prisma.Decimal;
    }
    return {
      orderItemId: item.orderItemId,
      branchId,
      productId: item.productId,
      quantity: item.quantity,
      hppUnit,
      hppTotal,
      status: cost.status,
    };
  });
}

/**
 * Load active recipes + WAC for a product+ingredient set in ONE batched query
 * and create one OrderItemCostSnapshot per OrderItem in the SAME transaction.
 */
export async function createOrderItemCostSnapshots(
  tx: Prisma.TransactionClient,
  input: {
    restaurantId: string;
    orderId: string;
    branchId: string | null;
    items: SnapshotCandidateItem[];
  }
): Promise<void> {
  const { restaurantId, orderId, branchId, items } = input;
  if (items.length === 0) return;

  const rows = buildSnapshotRows(items, branchId, await loadPerProductHpp(tx, input));

  await tx.orderItemCostSnapshot.createMany({
    data: rows.map((r) => ({
      restaurantId,
      orderId,
      orderItemId: r.orderItemId,
      branchId: r.branchId,
      productId: r.productId,
      quantity: r.quantity,
      hppUnit: r.hppUnit,
      hppTotal: r.hppTotal,
      status: r.status,
      completedAt: new Date(),
    })),
  });
}

/**
 * Batched recipe + WAC resolution — one query, no per-item round trips.
 * Only ACTIVE recipes contribute; Product.recipe returns at most one row
 * (productId is unique).
 */
async function loadPerProductHpp(
  tx: Prisma.TransactionClient,
  input: { restaurantId: string; branchId: string | null; items: SnapshotCandidateItem[] }
): Promise<
  Map<string, { hpp: Prisma.Decimal | null; status: OrderItemCostStatus }>
> {
  const productIds = [...new Set(input.items.map((i) => i.productId))];

  // No branch → nothing to resolve; NO_BRANCH applied in buildSnapshotRows.
  if (!input.branchId) {
    return new Map();
  }

  const products = await tx.product.findMany({
    where: { id: { in: productIds }, restaurantId: input.restaurantId },
    select: {
      id: true,
      recipe: {
        where: { isActive: true },
        select: {
          items: {
            select: {
              quantity: true,
              ingredient: {
                select: {
                  id: true,
                  isActive: true,
                  branchIngredients: {
                    where: { branchId: input.branchId },
                    select: { averageCost: true },
                    take: 1,
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  return computeHistoricalHpp(
    products as unknown as Array<{
      id: string;
      recipe: {
        items: Array<{
          quantity: Prisma.Decimal;
          ingredient: {
            id: string;
            isActive: boolean;
            branchIngredients: Array<{ averageCost: Prisma.Decimal | null }>;
          };
        }>;
      } | null;
    }>
  );
}