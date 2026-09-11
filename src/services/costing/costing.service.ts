import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "@/lib/errors";
import { assertBranchInScope } from "@/lib/auth-helpers";
import type { AuthenticatedContext } from "@/lib/auth-helpers";
import type {
  CostingListResponse,
  GetCostingListInput,
  CostStatus,
  CostingItemDto,
  CostingListItemDto,
  MissingReason,
} from "./costing.types";

// ============================================================
// Costing Engine Service (F.4) — CURRENT per-branch product HPP.
//
// HPP = Σ (RecipeItem.quantity × BranchIngredient.averageCost)
//
// - READ ONLY: reads Recipe / RecipeItem / Ingredient /
//   BranchIngredient / BranchProduct / Product / Category.
//   Never writes, never touches orders/payments/KDS/purchasing.
// - HPP is CURRENT (live WAC), never historical — F.5 territory.
// - All arithmetic is Prisma.Decimal; Number() is forbidden for
//   costing. Outputs are 2-dp decimal strings (ROUND_HALF_UP).
// - No cache: WAC changes (purchase RECEIVE) must be seen instantly.
// ============================================================

const ROUND = Prisma.Decimal.ROUND_HALF_UP;

/** Format a Decimal as a fixed 2-decimal string — the only rounding point. */
function money(value: Prisma.Decimal): string {
  return value.toDecimalPlaces(2, ROUND).toFixed(2);
}

interface IngredientCostRow {
  id: string;
  name: string;
  baseUnit: string;
  isActive: boolean;
  branchIngredients: Array<{ averageCost: Prisma.Decimal | null }>;
}

interface RecipeCostRow {
  id: string;
  items: Array<{
    quantity: Prisma.Decimal;
    unit: string;
    ingredient: IngredientCostRow;
  }>;
}

interface ProductCostRow {
  id: string;
  name: string;
  category: { id: string; name: string };
  price: Prisma.Decimal;
  recipe: RecipeCostRow | null;
  branchProducts: Array<{ priceOverride: Prisma.Decimal | null }>;
}

interface CostingComputation {
  sellingPrice: Prisma.Decimal;
  hpp: Prisma.Decimal | null;
  grossProfit: Prisma.Decimal | null;
  grossMarginPct: Prisma.Decimal | null;
  foodCostPct: Prisma.Decimal | null;
  costStatus: CostStatus;
  coveredItems: number;
  totalItems: number;
  recipeId: string | null;
  items: CostingItemDto[];
}

class CostingService {
  /**
   * Product → category → recipe(items) → ingredient → branchIngredients(branchId)
   * fetched in ONE query. No N+1: ingredient sub-query pulls only the branch's
   * averageCost row (1-to-1 per (branch, ingredient)).
   */
  private select(branchId: string): Prisma.ProductSelect {
    return {
      id: true,
      name: true,
      category: { select: { id: true, name: true } },
      price: true,
      recipe: {
        where: { isActive: true },
        select: {
          id: true,
          items: {
            select: {
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
            },
          },
        },
      },
      branchProducts: {
        where: { branchId },
        select: { priceOverride: true },
        take: 1,
      },
    } satisfies Prisma.ProductSelect;
  }

  /**
   * Core costing math — single source of truth for list AND detail.
   *
   * Cost completeness:
   * - No active recipe OR active recipe with no items   → NO_RECIPE (hpp null)
   * - Any item missing/inactive ingredient/missing WAC  → INCOMPLETE (hpp null,
   *   but covered ingredient costs are still returned so the admin sees what
   *   is missing)
   * - Else                                               → COMPLETE (hpp = sum)
   *
   * Missing WAC (no row or averageCost null) and INACTIVE_INGREDIENT are
   * never treated as 0. A literal averageCost = 0 IS a valid zero cost.
   */
  private compute(row: ProductCostRow): CostingComputation {
    const branchProduct = row.branchProducts[0] ?? null;
    const sellingPrice =
      branchProduct?.priceOverride != null ? branchProduct.priceOverride : row.price;

    const recipe = row.recipe;
    const recipeItems = recipe?.items ?? [];

    const base: CostingComputation = {
      sellingPrice,
      hpp: null,
      grossProfit: null,
      grossMarginPct: null,
      foodCostPct: null,
      costStatus: "NO_RECIPE",
      coveredItems: 0,
      totalItems: recipeItems.length,
      recipeId: recipe?.id ?? null,
      items: [],
    };

    if (!recipe || recipeItems.length === 0) {
      return base;
    }

    let sum = new Prisma.Decimal(0);
    let covered = 0;

    const items: CostingItemDto[] = recipeItems.map((item) => {
      const ingredient = item.ingredient;
      const branchIngredient = ingredient.branchIngredients[0] ?? null;

      let wac: Prisma.Decimal | null = null;
      let cost: Prisma.Decimal | null = null;
      let zeroCost = false;
      let missingReason: MissingReason | null = null;

      if (!ingredient.isActive) {
        missingReason = "INACTIVE_INGREDIENT";
      } else if (!branchIngredient || branchIngredient.averageCost == null) {
        missingReason = "MISSING_WAC";
      } else {
        wac = branchIngredient.averageCost;
        cost = item.quantity.mul(wac);
        zeroCost = wac.isZero();
        covered += 1;
        sum = sum.add(cost);
      }

      return {
        ingredientId: ingredient.id,
        ingredientName: ingredient.name,
        baseUnit: ingredient.baseUnit,
        quantity: item.quantity.toString(),
        unit: item.unit,
        wac: wac?.toString() ?? null,
        cost: cost?.toString() ?? null,
        zeroCost,
        missingReason,
      };
    });

    const costStatus: CostStatus = covered === items.length ? "COMPLETE" : "INCOMPLETE";
    const hpp = costStatus === "COMPLETE" ? sum : null;

    let grossProfit: Prisma.Decimal | null = null;
    let grossMarginPct: Prisma.Decimal | null = null;
    let foodCostPct: Prisma.Decimal | null = null;
    if (hpp && sellingPrice.greaterThan(0)) {
      grossProfit = sellingPrice.sub(hpp);
      grossMarginPct = grossProfit.div(sellingPrice).mul(100);
      foodCostPct = hpp.div(sellingPrice).mul(100);
    }

    return {
      sellingPrice,
      hpp,
      grossProfit,
      grossMarginPct,
      foodCostPct,
      costStatus,
      coveredItems: covered,
      totalItems: items.length,
      recipeId: recipe.id,
      items,
    };
  }

  /** Map a computed row to the list-item DTO (2-dp money/percent strings). */
  private toListItem(row: ProductCostRow): CostingListItemDto {
    const calc = this.compute(row);
    return {
      productId: row.id,
      name: row.name,
      categoryId: row.category.id,
      categoryName: row.category.name,
      sellingPrice: money(calc.sellingPrice),
      hpp: calc.hpp ? money(calc.hpp) : null,
      grossProfit: calc.grossProfit ? money(calc.grossProfit) : null,
      grossMarginPct: calc.grossMarginPct ? money(calc.grossMarginPct) : null,
      foodCostPct: calc.foodCostPct ? money(calc.foodCostPct) : null,
      costStatus: calc.costStatus,
      coveredItems: calc.coveredItems,
      totalItems: calc.totalItems,
    };
  }

  /**
   * GET /api/admin/costing/products
   * Paginated costing list for ONE branch. Admin only.
   *
   * - No `status` filter → plain SQL LIMIT/OFFSET (+ count): one efficient
   *   query, ideal for large restaurants.
   * - With `status` filter → status is a DERIVED value per product, so the
   *   matching products are materialized once (single query, no N+1), the
   *   derived status is computed in memory, then filtered + paginated.
   */
  async listCosting(
    input: GetCostingListInput,
    ctx: AuthenticatedContext
  ): Promise<CostingListResponse> {
    await assertBranchInScope(ctx, input.branchId);

    const { branchId, categoryId, search, status, page, limit } = input;
    const where: Prisma.ProductWhereInput = {
      restaurantId: ctx.restaurantId,
      isActive: true,
    };
    if (categoryId) where.categoryId = categoryId;
    if (search) {
      where.OR = [
        { name: { contains: search } },
        { description: { contains: search } },
      ];
    }

    if (status) {
      const rows = await prisma.product.findMany({
        where,
        select: this.select(branchId),
        orderBy: { name: "asc" },
      });
      const matches = rows
        .map((row) => ({ row, item: this.toListItem(row as unknown as ProductCostRow) }))
        .filter(({ item }) => item.costStatus === status)
        .map(({ item }) => item);

      const pageStart = (page - 1) * limit;
      return {
        items: matches.slice(pageStart, pageStart + limit),
        total: matches.length,
        page,
        limit,
        totalPages: Math.ceil(matches.length / limit),
      };
    }

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where,
        select: this.select(branchId),
        orderBy: { name: "asc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.product.count({ where }),
    ]);

    return {
      items: rows.map((row) => this.toListItem(row as unknown as ProductCostRow)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * GET /api/admin/costing/products/[productId]
   * Costing detail for one product in ONE branch. Admin only.
   * Product and branch are both re-validated against the caller's restaurant.
   * Foreign product → NotFound. Out-of-scope branch → Forbidden (via assert).
   */
  async getCostingDetail(
    productId: string,
    branchId: string,
    ctx: AuthenticatedContext
  ): Promise<CostingListItemDto & {
    recipeId: string | null;
    items: CostingItemDto[];
  }> {
    await assertBranchInScope(ctx, branchId);

    const row = await prisma.product.findFirst({
      where: { id: productId, restaurantId: ctx.restaurantId, isActive: true },
      select: this.select(branchId),
    });
    if (!row) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    const calc = this.compute(row as unknown as ProductCostRow);
    return {
      productId: row.id,
      name: row.name,
      categoryId: row.category.id,
      categoryName: row.category.name,
      sellingPrice: money(calc.sellingPrice),
      hpp: calc.hpp ? money(calc.hpp) : null,
      grossProfit: calc.grossProfit ? money(calc.grossProfit) : null,
      grossMarginPct: calc.grossMarginPct ? money(calc.grossMarginPct) : null,
      foodCostPct: calc.foodCostPct ? money(calc.foodCostPct) : null,
      costStatus: calc.costStatus,
      coveredItems: calc.coveredItems,
      totalItems: calc.totalItems,
      recipeId: calc.recipeId,
      items: calc.items,
    };
  }
}

export const costingService = new CostingService();