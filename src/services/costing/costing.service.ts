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
  CostingDetailDto,
  CostingComponentDto,
  CostingComponentItemDto,
  SelectionCostingDto,
  CostingMode,
  ComponentReason,
  MissingReason,
} from "./costing.types";
import {
  computeComponentCost,
  extractSelection,
  type ComponentCost,
  type ComponentRow,
  type CustomizationSelection,
} from "./customization-selection";

// ============================================================
// Costing Engine Service (F.4 + G.1 + H4.2) — CURRENT per-branch HPP.
//
// HPP = baseHpp + addonHpp + optionHpp
//   baseHpp   = Σ (RecipeItem.quantity × BranchIngredient.averageCost)   INGREDIENT
//             | BranchProduct.manualHpp                                 MANUAL
//   addonHpp  = Σ (AddonIngredient.quantity  × WAC) × selected addon quantity
//   optionHpp = Σ (OptionIngredient.quantity × WAC)   (option quantity ≡ 1)
//
// - READ ONLY: reads Recipe/RecipeItem/Ingredient/BranchIngredient/
//   BranchProduct/Product/Category/ProductAddon/AddonIngredient/
//   ProductOption/OptionIngredient. Never writes, never touches
//   orders/payments/KDS/purchasing/stock.
// - HPP is CURRENT (live WAC), never historical — F.5/H4.3 territory.
// - All arithmetic is Prisma.Decimal; Number() is forbidden for costing.
//   Rounding happens ONLY at the money() boundary (2dp, ROUND_HALF_UP).
// - H4.2 does NOT change the historical snapshot (base-only until H4.3).
// - No cache: WAC changes (purchase RECEIVE) must be seen instantly.
// - Batch queries only: one product query resolves the product, its base
//   recipe and every configured addon/option BOM. No N+1.
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

interface BomLineRow {
  quantity: Prisma.Decimal;
  unit: string;
  ingredient: IngredientCostRow;
}

interface AddonCostRow {
  id: string;
  name: string;
  price: Prisma.Decimal;
  isActive: boolean;
  ingredients: BomLineRow[];
}

interface OptionCostRow {
  id: string;
  name: string;
  priceAdjustment: Prisma.Decimal;
  isActive: boolean;
  ingredients: BomLineRow[];
}

interface ProductCostRow {
  id: string;
  name: string;
  category: { id: string; name: string };
  price: Prisma.Decimal;
  recipe: RecipeCostRow | null;
  branchProducts: Array<{
    priceOverride: Prisma.Decimal | null;
    costingMode: CostingMode;
    manualHpp: Prisma.Decimal | null;
  }>;
  /** Present only when the query was made with `withComponents` (detail). */
  addons?: AddonCostRow[];
  optionGroups?: Array<{ id: string; name: string; options: OptionCostRow[] }>;
}

interface BaseComputation {
  sellingPrice: Prisma.Decimal;
  /** Base HPP only (recipe × WAC, or manualHpp) — no customization. */
  baseHpp: Prisma.Decimal | null;
  costStatus: CostStatus;
  coveredItems: number;
  totalItems: number;
  recipeId: string | null;
  items: CostingItemDto[];
  costingMode: CostingMode;
  manualHpp: Prisma.Decimal | null;
}

interface SelectedComponentResult {
  dto: CostingComponentDto;
  /** unitHpp × selected quantity; null when the component is incomplete. */
  contribution: Prisma.Decimal | null;
}

class CostingService {
  /** BOM line sub-select shared by addons + options (branch WAC, 1 row). */
  private bomSelect(branchId: string) {
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

  /**
   * Product → category → recipe(items) → ingredient → branchIngredients(branchId)
   * fetched in ONE query. No N+1: each ingredient sub-query pulls only the
   * branch's averageCost row.
   *
   * H4.2 — `withComponents` additionally pulls the active addon/option
   * mini-BOMs. It is OFF for the list (the list only needs the base HPP) so
   * the existing list query cost is unchanged, and ON for the detail page
   * and the selection-aware HPP.
   */
  private select(
    branchId: string,
    opts: { withComponents?: boolean } = {}
  ): Prisma.ProductSelect {
    const bom = this.bomSelect(branchId);
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
        select: { priceOverride: true, costingMode: true, manualHpp: true },
        take: 1,
      },
      // H4.2 — addon/option mini-BOMs (only ACTIVE customizations are shown
      // in the product-level catalog).
      ...(opts.withComponents
        ? {
            addons: {
              where: { isActive: true },
              select: {
                id: true,
                name: true,
                price: true,
                isActive: true,
                ingredients: { select: bom },
              },
              orderBy: { sortOrder: "asc" },
            },
            optionGroups: {
              select: {
                id: true,
                name: true,
                options: {
                  where: { isActive: true },
                  select: {
                    id: true,
                    name: true,
                    priceAdjustment: true,
                    isActive: true,
                    ingredients: { select: bom },
                  },
                  orderBy: { sortOrder: "asc" },
                },
              },
              orderBy: { sortOrder: "asc" },
            },
          }
        : {}),
    } satisfies Prisma.ProductSelect;
  }

  /**
   * BASE costing — single source of truth for both the list/detail and the
   * selection-aware HPP.
   *
   * Cost completeness (unchanged from F.4/G.1):
   * - No active recipe OR active recipe with no items   → NO_RECIPE (hpp null)
   * - Any item missing/inactive ingredient/missing WAC  → INCOMPLETE (hpp null,
   *   but covered ingredient costs are still returned so the admin sees what
   *   is missing)
   * - Else                                               → COMPLETE (hpp = sum)
   *
   * G.1 — MANUAL mode short-circuits the automatic engine: HPP is exactly
   * BranchProduct.manualHpp (recipe/WAC are NOT consulted). manualHpp = 0 is
   * valid (COMPLETE); a missing manual value (null) is INCOMPLETE, never 0.
   *
   * Missing WAC (no row or averageCost null) and INACTIVE_INGREDIENT are never
   * treated as 0. A literal averageCost = 0 IS a valid zero cost.
   */
  private computeBase(row: ProductCostRow): BaseComputation {
    const branchProduct = row.branchProducts[0] ?? null;
    const sellingPrice =
      branchProduct?.priceOverride != null ? branchProduct.priceOverride : row.price;

    const costingMode: CostingMode = branchProduct?.costingMode ?? "INGREDIENT";
    const manualHpp = branchProduct?.manualHpp ?? null;

    if (costingMode === "MANUAL") {
      return {
        sellingPrice,
        baseHpp: manualHpp,
        costStatus: manualHpp != null ? "COMPLETE" : "INCOMPLETE",
        coveredItems: 0,
        totalItems: 0,
        recipeId: null,
        items: [],
        costingMode: "MANUAL",
        manualHpp,
      };
    }

    const recipe = row.recipe;
    const recipeItems = recipe?.items ?? [];

    const base: BaseComputation = {
      sellingPrice,
      baseHpp: null,
      costStatus: "NO_RECIPE",
      coveredItems: 0,
      totalItems: recipeItems.length,
      recipeId: recipe?.id ?? null,
      items: [],
      costingMode: "INGREDIENT",
      manualHpp,
    };

    if (!recipe || recipeItems.length === 0) return base;

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

    return {
      ...base,
      baseHpp: costStatus === "COMPLETE" ? sum : null,
      costStatus,
      coveredItems: covered,
      totalItems: items.length,
      items,
    };
  }

  /** Map a component row (addon/option) into the shared cost shape. */
  private toComponentRow(
    kind: "ADDON" | "OPTION",
    row: AddonCostRow | OptionCostRow
  ): ComponentRow {
    return {
      id: row.id,
      name: row.name,
      isActive: row.isActive,
      sellingPrice:
        kind === "ADDON"
          ? (row as AddonCostRow).price
          : (row as OptionCostRow).priceAdjustment,
      ingredients: row.ingredients,
    };
  }

  /** Component DTO with `hpp` rounded at the money boundary. */
  private toComponentDto(
    cost: ComponentCost,
    extraReasons: ComponentReason[] = []
  ): CostingComponentDto {
    const reasons = [...new Set([...cost.reasons, ...extraReasons])];
    const items: CostingComponentItemDto[] = cost.items.map((i) => ({
      ingredientId: i.ingredientId,
      ingredientName: i.ingredientName,
      baseUnit: i.baseUnit,
      quantity: i.quantity,
      unit: i.unit,
      wac: i.wac?.toString() ?? null,
      cost: i.cost?.toString() ?? null,
      zeroCost: i.zeroCost,
      missingReason: i.missingReason,
    }));
    return {
      kind: cost.kind,
      id: cost.id,
      name: cost.name,
      sellingPrice: money(cost.sellingPrice),
      hpp: reasons.length === 0 && cost.unitHpp ? money(cost.unitHpp) : null,
      status: reasons.length === 0 ? "COMPLETE" : "INCOMPLETE",
      reasons,
      items,
    };
  }

  /** A selected addon/option that no longer exists / is no longer active. */
  private unresolvedComponent(
    kind: "ADDON" | "OPTION",
    id: string,
    reason: ComponentReason
  ): CostingComponentDto {
    return {
      kind,
      id,
      name: "",
      sellingPrice: "0.00",
      hpp: null,
      status: "INCOMPLETE",
      reasons: [reason],
      items: [],
    };
  }

  /**
   * H4.2 — resolve the selected addons/options against the DB rows and
   * compute their contribution. Only IDs + quantities from the stored
   * customization are used; stored `price`/`priceAdjustment`/`name` are
   * ignored (the DB is the source of truth).
   *
   * A component whose cost cannot be resolved contributes NULL (never 0), so
   * the resulting HPP becomes INCOMPLETE instead of silently understated.
   */
  private applySelection(
    selection: CustomizationSelection,
    addonRows: Map<string, AddonCostRow>,
    optionRows: Map<string, OptionCostRow>
  ): {
    addonHpp: Prisma.Decimal | null;
    optionHpp: Prisma.Decimal | null;
    reasons: ComponentReason[];
    addons: CostingComponentDto[];
    options: CostingComponentDto[];
  } {
    const reasons = new Set<ComponentReason>();

    if (selection.malformed) reasons.add("MALFORMED_CUSTOMIZATION");

    const addons: CostingComponentDto[] = [];
    let addonSum = new Prisma.Decimal(0);
    let addonComplete = !selection.malformed;

    for (const selected of selection.addons) {
      const row = addonRows.get(selected.addonId);
      if (!row || !row.isActive) {
        const reason: ComponentReason = row ? "INACTIVE_COMPONENT" : "NOT_FOUND";
        reasons.add(reason);
        addonComplete = false;
        addons.push(this.unresolvedComponent("ADDON", selected.addonId, reason));
        continue;
      }
      const cost = computeComponentCost("ADDON", this.toComponentRow("ADDON", row));
      const extra: ComponentReason[] = selected.invalidQuantity
        ? ["INVALID_QUANTITY"]
        : [];
      const dto = this.toComponentDto(cost, extra);
      if (dto.status !== "COMPLETE") {
        dto.reasons.forEach((r) => reasons.add(r));
        addonComplete = false;
      } else {
        addonSum = addonSum.add(cost.unitHpp!.mul(selected.quantity));
      }
      addons.push(dto);
    }

    const options: CostingComponentDto[] = [];
    let optionSum = new Prisma.Decimal(0);
    let optionComplete = !selection.malformed;

    for (const selected of selection.options) {
      const row = optionRows.get(selected.optionId);
      if (!row || !row.isActive) {
        const reason: ComponentReason = row ? "INACTIVE_COMPONENT" : "NOT_FOUND";
        reasons.add(reason);
        optionComplete = false;
        options.push(this.unresolvedComponent("OPTION", selected.optionId, reason));
        continue;
      }
      const cost = computeComponentCost("OPTION", this.toComponentRow("OPTION", row));
      const dto = this.toComponentDto(cost);
      if (dto.status !== "COMPLETE") {
        dto.reasons.forEach((r) => reasons.add(r));
        optionComplete = false;
      } else {
        optionSum = optionSum.add(cost.unitHpp!);
      }
      options.push(dto);
    }

    const addonHpp =
      selection.addons.length === 0
        ? new Prisma.Decimal(0)
        : addonComplete
          ? addonSum
          : null;
    const optionHpp =
      selection.options.length === 0
        ? new Prisma.Decimal(0)
        : optionComplete
          ? optionSum
          : null;

    return { addonHpp, optionHpp, reasons: [...reasons], addons, options };
  }

  /**
   * Product-level computation (no customization selection): base HPP is the
   * authoritative `hpp`, and the active addons/options are returned as a
   * per-1-unit cost CATALOG. addonHpp/optionHpp are a real 0 here because no
   * addon/option is selected for the product itself.
   */
  private compute(row: ProductCostRow): {
    base: BaseComputation;
    addonHpp: Prisma.Decimal;
    optionHpp: Prisma.Decimal;
    totalHpp: Prisma.Decimal | null;
    addons: CostingComponentDto[];
    options: CostingComponentDto[];
  } {
    const base = this.computeBase(row);
    const addons = (row.addons ?? []).map((a) =>
      this.toComponentDto(computeComponentCost("ADDON", this.toComponentRow("ADDON", a)))
    );
    const options = (row.optionGroups ?? []).flatMap((g) =>
      g.options.map((o) =>
        this.toComponentDto(computeComponentCost("OPTION", this.toComponentRow("OPTION", o)))
      )
    );
    return {
      base,
      addonHpp: new Prisma.Decimal(0),
      optionHpp: new Prisma.Decimal(0),
      totalHpp: base.baseHpp,
      addons,
      options,
    };
  }

  /** Margin/food-cost trio — only computed when the HPP is fully known. */
  private metrics(
    sellingPrice: Prisma.Decimal,
    hpp: Prisma.Decimal | null
  ): {
    grossProfit: Prisma.Decimal | null;
    grossMarginPct: Prisma.Decimal | null;
    foodCostPct: Prisma.Decimal | null;
  } {
    if (hpp != null && sellingPrice.greaterThan(0)) {
      const grossProfit = sellingPrice.sub(hpp);
      return {
        grossProfit,
        grossMarginPct: grossProfit.div(sellingPrice).mul(100),
        foodCostPct: hpp.div(sellingPrice).mul(100),
      };
    }
    return { grossProfit: null, grossMarginPct: null, foodCostPct: null };
  }

  /** Map a computed row to the list-item DTO (2-dp money/percent strings). */
  private toListItem(row: ProductCostRow): CostingListItemDto {
    const calc = this.compute(row);
    const { base } = calc;
    const m = this.metrics(base.sellingPrice, base.baseHpp);
    return {
      productId: row.id,
      name: row.name,
      categoryId: row.category.id,
      categoryName: row.category.name,
      sellingPrice: money(base.sellingPrice),
      hpp: base.baseHpp ? money(base.baseHpp) : null,
      grossProfit: m.grossProfit ? money(m.grossProfit) : null,
      grossMarginPct: m.grossMarginPct ? money(m.grossMarginPct) : null,
      foodCostPct: m.foodCostPct ? money(m.foodCostPct) : null,
      costStatus: base.costStatus,
      coveredItems: base.coveredItems,
      totalItems: base.totalItems,
      costingMode: base.costingMode,
      manualHpp: base.manualHpp != null ? money(base.manualHpp) : null,
      // H4.2 breakdown — product-level view has no selection.
      baseHpp: base.baseHpp ? money(base.baseHpp) : null,
      addonHpp: money(calc.addonHpp),
      optionHpp: money(calc.optionHpp),
      totalHpp: calc.totalHpp ? money(calc.totalHpp) : null,
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
   *
   * H4.2 — also returns the active addon/option cost catalog (per 1 unit)
   * so the admin sees how customizations contribute to HPP.
   */
  async getCostingDetail(
    productId: string,
    branchId: string,
    ctx: AuthenticatedContext
  ): Promise<CostingDetailDto> {
    await assertBranchInScope(ctx, branchId);

    const row = await prisma.product.findFirst({
      where: { id: productId, restaurantId: ctx.restaurantId, isActive: true },
      select: this.select(branchId, { withComponents: true }),
    });
    if (!row) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    const calc = this.compute(row as unknown as ProductCostRow);
    const item = this.toListItem(row as unknown as ProductCostRow);
    return {
      ...item,
      recipeId: calc.base.recipeId,
      items: calc.base.items,
      addons: calc.addons,
      options: calc.options,
    };
  }

  /**
   * H4.2 — SELECTION-AWARE current HPP.
   *
   * Resolves the product + base cost + ONLY the selected addon/option BOMs in
   * one batched query, then returns:
   *   totalHpp = baseHpp + addonHpp + optionHpp
   *
   * The `customizations` argument is the RAW stored `OrderItem.customizations`
   * value (object or JSON string) — it is parsed tolerantly and only IDs +
   * quantities are trusted.
   *
   * Tenant/branch safety: product is scoped by `restaurantId`, the branch by
   * `assertBranchInScope`, addons by belonging to that product, options by
   * belonging to a group of that product, and every ingredient WAC by the
   * order's own branch. Nothing from the client is trusted as authority.
   *
   * unit HPP only — OrderItem.quantity is NOT part of this value.
   */
  async getSelectionCosting(
    productId: string,
    branchId: string,
    customizations: unknown,
    ctx: AuthenticatedContext
  ): Promise<SelectionCostingDto> {
    await assertBranchInScope(ctx, branchId);

    const selection = extractSelection(customizations);
    const addonIds = [...new Set(selection.addons.map((a) => a.addonId))];
    const optionIds = [...new Set(selection.options.map((o) => o.optionId))];
    const bom = this.bomSelect(branchId);

    // ONE query: base recipe + branch product + only the selected BOMs.
    const row = await prisma.product.findFirst({
      where: { id: productId, restaurantId: ctx.restaurantId, isActive: true },
      select: {
        id: true,
        name: true,
        price: true,
        category: { select: { id: true, name: true } },
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
          select: { priceOverride: true, costingMode: true, manualHpp: true },
          take: 1,
        },
        // Scoping addons to THIS product also enforces tenant isolation
        // (product was already matched by restaurantId). isActive is NOT
        // filtered so an addon deactivated after the order was placed is
        // reported as INACTIVE_COMPONENT rather than silently dropped.
        addons: {
          where: { id: { in: addonIds } },
          select: { id: true, name: true, price: true, isActive: true, ingredients: { select: bom } },
        },
        optionGroups: {
          select: {
            id: true,
            options: {
              where: { id: { in: optionIds } },
              select: {
                id: true,
                name: true,
                priceAdjustment: true,
                isActive: true,
                ingredients: { select: bom },
              },
            },
          },
        },
      },
    });
    if (!row) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    const full = row as unknown as ProductCostRow;
    const base = this.computeBase(full);

    const addonRows = new Map((full.addons ?? []).map((a) => [a.id, a]));
    const optionRows = new Map(
      (full.optionGroups ?? []).flatMap((g) => g.options).map((o) => [o.id, o])
    );

    const selected = this.applySelection(selection, addonRows, optionRows);

    const baseOk = base.baseHpp != null && base.costStatus === "COMPLETE";
    const complete =
      baseOk &&
      selected.addonHpp != null &&
      selected.optionHpp != null &&
      !selection.malformed;

    const totalHpp = complete
      ? base.baseHpp!.add(selected.addonHpp!).add(selected.optionHpp!)
      : null;
    const costStatus: CostStatus = complete
      ? "COMPLETE"
      : base.costStatus === "NO_RECIPE"
        ? "NO_RECIPE"
        : "INCOMPLETE";

    return {
      productId: row.id,
      branchId,
      costingMode: base.costingMode,
      sellingPrice: money(base.sellingPrice),
      // `baseHpp` is reported whenever the BASE alone is resolvable, even if a
      // customization component is incomplete — the admin can still see it.
      baseHpp: base.baseHpp != null ? money(base.baseHpp) : null,
      addonHpp: selected.addonHpp != null ? money(selected.addonHpp) : null,
      optionHpp: selected.optionHpp != null ? money(selected.optionHpp) : null,
      totalHpp: totalHpp ? money(totalHpp) : null,
      costStatus,
      reasons: selected.reasons,
      addons: selected.addons,
      options: selected.options,
      customizationHpp:
        selected.addonHpp != null && selected.optionHpp != null
          ? money(selected.addonHpp.add(selected.optionHpp))
          : null,
    };
  }
}

export const costingService = new CostingService();
