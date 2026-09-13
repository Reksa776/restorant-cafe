import { Prisma, OrderItemCostStatus } from "@prisma/client";
import {
  aggregateSelectionCost,
  extractSelection,
  type ComponentReason,
  type ComponentRow,
  type SelectionCost,
} from "./customization-selection";

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
//
// H4.3 — the frozen cost now also includes the selected addon/option mini-BOM:
//   hppUnit  = baseHpp + addonHpp + optionHpp
//   hppTotal = hppUnit × OrderItem.quantity
// The selection comes from OrderItem.customizations (tolerant parse, IDs +
// quantities only) and is resolved against the SAME branch WAC. An incomplete
// selection (missing BOM/WAC, inactive ingredient/component, unknown id,
// malformed JSON) freezes NULL — never a base-only downgrade and never 0.
// ============================================================

const ROUND = Prisma.Decimal.ROUND_HALF_UP;

export interface SnapshotCandidateItem {
  orderItemId: string;
  productId: string;
  quantity: number;
  /**
   * H4.3 — the RAW stored `OrderItem.customizations` value (Json or the
   * double-encoded JSON string written by order creation). Only selected
   * addon/option IDs + quantities are trusted; display prices are ignored.
   */
  customizations?: unknown;
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
 * Product shape used for historical HPP resolution. Includes the branch's
 * BranchProduct row so the per-branch HPP method (G.1) can be honored.
 */
export interface HistoricalHppProduct {
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
  /** Row for the order's branch: costing mode + optional manual HPP. */
  branchProducts: Array<{
    costingMode: string;
    manualHpp: Prisma.Decimal | null;
  }>;
}

/**
 * Resolve recipe + WAC for a product set in ONE batched query and compute
 * the historical HPP per product (rounded ROUND_HALF_UP at the final
 * monetary boundary). Pure function of the DB rows — no I/O here.
 *
 * G.1 — when the branch uses MANUAL costing, the frozen HPP IS
 * BranchProduct.manualHpp and Recipe/WAC are not consulted (0 is valid).
 * INGREDIENT mode keeps the existing F.5 computation byte-for-byte.
 */
export function computeHistoricalHpp(
  products: HistoricalHppProduct[]
): Map<string, { hpp: Prisma.Decimal | null; status: OrderItemCostStatus }> {
  const map = new Map<
    string,
    { hpp: Prisma.Decimal | null; status: OrderItemCostStatus }
  >();

  for (const product of products) {
    // G.1 — MANUAL mode bypasses Recipe/WAC for NEW snapshots only. A missing
    // manual value is an incomplete cost (never coerced to 0).
    const branchProduct = product.branchProducts?.[0] ?? null;
    if (branchProduct?.costingMode === "MANUAL") {
      const manual = branchProduct.manualHpp;
      map.set(product.id, {
        hpp:
          manual != null
            ? (manual.toDecimalPlaces(2, ROUND) as Prisma.Decimal)
            : null,
        status: manual != null ? "SNAPSHOTTED" : "MISSING_WAC",
      });
      continue;
    }

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
  >,
  perItemSelection?: Map<string, SelectionCost>
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

    // H4.3 — fold the selected addon/option mini-BOM into the frozen cost.
    // Items with no customization selection keep the exact F.5/G.1 result.
    let status: OrderItemCostStatus = cost.status;
    const selection = perItemSelection?.get(item.orderItemId);
    if (selection && selection.hasSelection) {
      if (hppUnit == null) {
        // Base cost already unresolvable — keep the existing base status.
        status = cost.status;
      } else if (
        selection.complete &&
        selection.addonHpp != null &&
        selection.optionHpp != null
      ) {
        const unit = hppUnit
          .add(selection.addonHpp)
          .add(selection.optionHpp)
          .toDecimalPlaces(2, ROUND) as Prisma.Decimal;
        hppUnit = unit;
        hppTotal = unit
          .mul(new Prisma.Decimal(item.quantity))
          .toDecimalPlaces(2, ROUND) as Prisma.Decimal;
        status = "SNAPSHOTTED";
      } else {
        // Incomplete customization → UNKNOWN cost: never base-only, never 0.
        hppUnit = null;
        hppTotal = null;
        status = selectionStatusFromReasons(selection.reasons);
      }
    }

    return {
      orderItemId: item.orderItemId,
      branchId,
      productId: item.productId,
      quantity: item.quantity,
      hppUnit,
      hppTotal,
      status,
    };
  });
}

/**
 * Map the H4.2 component reasons onto the existing OrderItemCostStatus enum
 * (no schema change). Every component fault means "cost data unavailable",
 * which the enum expresses as MISSING_WAC; only a genuinely inactive
 * INGREDIENT maps to INACTIVE_INGREDIENT. H2 coverage treats all of these as
 * UNCOVERED (never as zero COGS), which is the financial requirement.
 */
function selectionStatusFromReasons(
  reasons: ComponentReason[]
): OrderItemCostStatus {
  if (reasons.includes("INACTIVE_INGREDIENT")) return "INACTIVE_INGREDIENT";
  return "MISSING_WAC";
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

  const perProduct = await loadPerProductHpp(tx, input);
  // H4.3 — selected addon/option mini-BOMs (one batched lookup, scoped to the
  // order's branch WAC). No branch → nothing to resolve (NO_BRANCH applies).
  const perItemSelection = branchId
    ? await loadSelectionCosts(tx, { branchId, items })
    : undefined;

  const rows = buildSnapshotRows(items, branchId, perProduct, perItemSelection);

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
/**
 * H4.3 — minimal BOM sub-select: the line quantity + its ingredient with the
 * ORDER BRANCH's WAC (one row).
 */
function bomSelect(branchId: string) {
  return {
    quantity: true,
    unit: true,
    ingredient: {
      select: {
        id: true,
        name: true,
        baseUnit: true,
        isActive: true,
        branchIngredients: {
          where: { branchId },
          select: { averageCost: true },
          take: 1,
        },
      },
    },
  } as const;
}

interface ScopedComponentRow {
  productId: string;
  /** For an option, the product reached through its option group. */
  component: ComponentRow;
}

/**
 * H4.3 — resolve every selected addon/option for the order in FOUR bounded
 * queries (one per component type across the whole order, never per item):
 *
 *   1. productAddon  WHERE id IN (selected addon ids) AND productId IN (order products)
 *   2. productOption WHERE id IN (selected option ids) AND optionGroup.productId IN (order products)
 *
 * `productId` scoping enforces tenant isolation transitively (the products
 * came from a restaurant-scoped order) and prevents a foreign addon/option
 * from ever costing this item. The branch WAC is bound in the sub-select.
 */
async function loadSelectionCosts(
  tx: Prisma.TransactionClient,
  input: { branchId: string; items: SnapshotCandidateItem[] }
): Promise<Map<string, SelectionCost>> {
  const result = new Map<string, SelectionCost>();
  const parsed = input.items.map((item) => ({
    item,
    selection: extractSelection(item.customizations),
  }));

  const addonIds = [
    ...new Set(parsed.flatMap((p) => p.selection.addons.map((a) => a.addonId))),
  ];
  const optionIds = [
    ...new Set(parsed.flatMap((p) => p.selection.options.map((o) => o.optionId))),
  ];
  const anyMalformed = parsed.some((p) => p.selection.malformed);
  if (addonIds.length === 0 && optionIds.length === 0 && !anyMalformed) {
    return result;
  }

  const productIds = [...new Set(input.items.map((i) => i.productId))];
  const bom = bomSelect(input.branchId);

  const [addons, options] = await Promise.all([
    addonIds.length
      ? tx.productAddon.findMany({
          where: { id: { in: addonIds }, productId: { in: productIds } },
          select: {
            id: true,
            productId: true,
            name: true,
            price: true,
            isActive: true,
            ingredients: { select: bom },
          },
        })
      : Promise.resolve([]),
    optionIds.length
      ? tx.productOption.findMany({
          where: {
            id: { in: optionIds },
            group: { productId: { in: productIds } },
          },
          select: {
            id: true,
            name: true,
            priceAdjustment: true,
            isActive: true,
            group: { select: { productId: true } },
            ingredients: { select: bom },
          },
        })
      : Promise.resolve([]),
  ]);

  const addonById = new Map<string, ScopedComponentRow>(
    addons.map((a) => [
      a.id,
      {
        productId: a.productId,
        component: {
          id: a.id,
          name: a.name,
          isActive: a.isActive,
          // Selling price only — never used as cost.
          sellingPrice: a.price,
          ingredients: a.ingredients as unknown as ComponentRow["ingredients"],
        },
      },
    ])
  );
  const optionById = new Map<string, ScopedComponentRow>(
    options.map((o) => [
      o.id,
      {
        productId: o.group.productId,
        component: {
          id: o.id,
          name: o.name,
          isActive: o.isActive,
          sellingPrice: o.priceAdjustment,
          ingredients: o.ingredients as unknown as ComponentRow["ingredients"],
        },
      },
    ])
  );

  for (const { item, selection } of parsed) {
    // Scope each selected component to THIS order item's product.
    const scopedAddons = new Map<string, ComponentRow>();
    for (const a of selection.addons) {
      const row = addonById.get(a.addonId);
      if (row && row.productId === item.productId) {
        scopedAddons.set(a.addonId, row.component);
      }
    }
    const scopedOptions = new Map<string, ComponentRow>();
    for (const o of selection.options) {
      const row = optionById.get(o.optionId);
      if (row && row.productId === item.productId) {
        scopedOptions.set(o.optionId, row.component);
      }
    }
    result.set(
      item.orderItemId,
      aggregateSelectionCost(selection, scopedAddons, scopedOptions)
    );
  }

  return result;
}

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
      // G.1 — the order's branch HPP method decides manual vs ingredient.
      branchProducts: {
        where: { branchId: input.branchId },
        select: { costingMode: true, manualHpp: true },
        take: 1,
      },
    },
  });

  return computeHistoricalHpp(products as unknown as HistoricalHppProduct[]);
}