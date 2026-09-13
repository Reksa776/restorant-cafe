import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, IngredientCompletionError, NotFoundError, ValidationError } from "@/lib/errors";
import { extractSelection } from "@/services/costing/customization-selection";

// ============================================================
// Ingredient Stock Service
//
// Follows the same atomic pattern as applyStockMovement():
//   1. FOR UPDATE row lock on BranchIngredient
//   2. Compute balanceAfter = current + delta
//   3. Reject if balanceAfter < 0
//   4. Upsert BranchIngredient.stock
//   5. Append IngredientStockMovement ledger row
//   6. All in same transaction
// ============================================================

export const IngredientStockRefType = {
  STOCK_ADJUSTMENT: "STOCK_ADJUSTMENT",
  PURCHASE_RECEIVE: "PURCHASE_RECEIVE",
  // H1 — an Order reaching COMPLETED consumes the recipe/BOM of its products
  // (INGREDIENT costing mode only). refId = orderId.
  ORDER_COMPLETED: "ORDER_COMPLETED",
} as const;

export type IngredientMovementType = "IN" | "OUT" | "ADJUSTMENT";

interface ApplyIngredientMovementInput {
  restaurantId: string;
  branchId: string;
  ingredientId: string;
  type: IngredientMovementType;
  /** Signed Decimal — positive for IN, negative for OUT/ADJUSTMENT decrease */
  quantity: number;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  userId?: string | null;
}

function validateIngredientQuantity(type: IngredientMovementType, quantity: number): void {
  if (typeof quantity !== "number" || Number.isNaN(quantity)) {
    throw new ValidationError("Jumlah pergerakan stok harus berupa angka");
  }
  if (type === "IN" && quantity <= 0) {
    throw new ValidationError("Stok masuk harus bernilai positif");
  }
  if (type === "OUT" && quantity >= 0) {
    throw new ValidationError("Stok keluar harus bernilai negatif");
  }
  if (type === "ADJUSTMENT" && quantity === 0) {
    throw new ValidationError("Penyesuaian stok tidak boleh nol");
  }
}

/**
 * Apply one ingredient stock movement + BranchIngredient balance atomically.
 *
 * MUST be called inside an interactive transaction (prisma.$transaction).
 * The branchingredient row is locked FOR UPDATE so concurrent movements
 * serialize. A movement that would drive stock below 0 throws ConflictError.
 *
 * Precondition: branchId and ingredientId belong to restaurantId.
 * Ownership validated by caller (service layer).
 */
export async function applyIngredientStockMovement(
  tx: Prisma.TransactionClient,
  input: ApplyIngredientMovementInput
): Promise<{ balanceAfter: number }> {
  const { restaurantId, branchId, ingredientId, type, quantity } = input;

  validateIngredientQuantity(type, quantity);

  // Row lock — same pattern as applyStockMovement
  let rows = await tx.$queryRaw<Array<{ stock: number | bigint | string }>>(
    Prisma.sql`SELECT \`stock\` FROM \`branchingredient\`
      WHERE \`branchId\` = ${branchId} AND \`ingredientId\` = ${ingredientId}
      FOR UPDATE`
  );

  if (!rows.length) {
    // Auto-create BranchIngredient row if it doesn't exist yet
    try {
      await tx.branchIngredient.create({
        data: { branchId, ingredientId, stock: 0 },
      });
    } catch (e) {
      // Unique violation: concurrent create — proceed to re-lock
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
    rows = await tx.$queryRaw<Array<{ stock: number | bigint | string }>>(
      Prisma.sql`SELECT \`stock\` FROM \`branchingredient\`
        WHERE \`branchId\` = ${branchId} AND \`ingredientId\` = ${ingredientId}
        FOR UPDATE`
    );
  }

  // stock is Decimal(18, 3) — resolve it to a Decimal and compute balanceAfter
  // with Decimal arithmetic so fractional stock never drifts through float64.
  let current: Prisma.Decimal;
  const stockValue = rows.length ? rows[0].stock : null;
  if (stockValue === null || stockValue === undefined) {
    current = new Prisma.Decimal(0);
  } else if (typeof stockValue === "bigint") {
    current = new Prisma.Decimal(stockValue.toString());
  } else if (typeof stockValue === "string") {
    current = new Prisma.Decimal(stockValue);
  } else {
    current = new Prisma.Decimal(stockValue);
  }

  const balanceAfter = current.add(quantity);

  if (balanceAfter.lessThan(0)) {
    throw new ConflictError("Stok bahan baku tidak mencukupi untuk pergerakan ini");
  }

  // Upsert balance
  await tx.branchIngredient.upsert({
    where: { branchId_ingredientId: { branchId, ingredientId } },
    update: { stock: balanceAfter },
    create: { branchId, ingredientId, stock: balanceAfter },
  });

  // Append ledger row
  await tx.ingredientStockMovement.create({
    data: {
      restaurantId,
      branchId,
      ingredientId,
      type,
      quantity,
      balanceAfter,
      reason: input.reason ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      userId: input.userId ?? null,
    },
  });

  return { balanceAfter: Number(balanceAfter) };
}

// ============================================================
// H1 — Order BOM consumption
// ============================================================

export interface OrderConsumptionItem {
  productId: string;
  quantity: number;
  /**
   * H4.4 — the RAW stored `OrderItem.customizations` value (Json or the
   * double-encoded JSON string written by order creation). Only selected
   * addon/option IDs + quantities are trusted; display prices are ignored.
   */
  customizations?: unknown;
}

interface AggregatedRequirement {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  /** Total required quantity in the ingredient's baseUnit (Decimal maths). */
  quantity: Prisma.Decimal;
}

/** BOM line shape needed for consumption (WAC is irrelevant to stock). */
interface ConsumptionBomLine {
  quantity: Prisma.Decimal;
  ingredient: { id: string; name: string; baseUnit: string; isActive: boolean } | null;
}

interface AddonConsumptionRow {
  id: string;
  productId: string;
  name: string;
  isActive: boolean;
  ingredients: ConsumptionBomLine[];
}

interface OptionConsumptionRow {
  id: string;
  name: string;
  isActive: boolean;
  group: { productId: string };
  ingredients: ConsumptionBomLine[];
}

/** Addon/option mini-BOM sub-select shared by both component queries. */
const CONSUMPTION_BOM_SELECT = {
  quantity: true,
  ingredient: {
    select: { id: true, name: true, baseUnit: true, isActive: true },
  },
} as const;

/** Trim a Decimal to its plain string form (2.000 → "2", 2.500 → "2.5"). */
function formatQty(value: Prisma.Decimal): string {
  return value.toFixed();
}

/**
 * H1 — consume the recipe/BOM of every ordered product when an order reaches
 * COMPLETED.
 *
 * MUST be called inside the SAME interactive transaction as the guarded
 * READY → COMPLETED transition (order.service updateOrderStatus). Every check
 * and every ledger write below is part of that transaction, so a failure
 * throws and rolls back the WHOLE completion — the order stays READY, no HPP
 * snapshot, no product stock movement, no ingredient stock movement.
 *
 * Rules (Phase H1 + H4.4 spec):
 * - costingMode INGREDIENT → an ACTIVE recipe with at least one item is
 *   REQUIRED, and every referenced ingredient must exist and be ACTIVE.
 *   Missing/inactive configuration BLOCKS completion (never silently skipped,
 *   never treated as an empty BOM).
 * - costingMode MANUAL → the BASE recipe is NOT consumed (manualHpp is
 *   financial costing only, a manualHpp of 0 stays valid), but ADDON and
 *   OPTION mini-BOMs ARE still consumed.
 * - Selected addons/options come ONLY from the stored
 *   OrderItem.customizations (tolerant parse; IDs + quantities only). An
 *   unknown, inactive or foreign component, a missing BOM, a malformed
 *   payload or an unusable addon quantity BLOCKS completion — never silently
 *   ignored, never a base-only downgrade.
 * - required = Σ RecipeItem.qty × OrderItem.qty
 *            + Σ AddonIngredient.qty × addon qty × OrderItem.qty
 *            + Σ OptionIngredient.qty × OrderItem.qty        (option qty ≡ 1)
 *   aggregated per ingredient across ALL order items (ONE movement each).
 * - BranchIngredient.stock is read under the existing `FOR UPDATE` lock; a
 *   shortage BLOCKS completion with a detailed message (never negative
 *   stock). The balance + ledger write is delegated to the single existing
 *   engine, applyIngredientStockMovement().
 *
 * No migration: the ledger's refType is a free string.
 */
export async function consumeOrderIngredients(
  tx: Prisma.TransactionClient,
  input: {
    restaurantId: string;
    branchId: string;
    items: OrderConsumptionItem[];
    refId?: string | null;
    reason?: string | null;
    userId?: string | null;
  }
): Promise<void> {
  const { restaurantId, branchId, items } = input;
  if (items.length === 0) return;

  const productIds = [...new Set(items.map((i) => i.productId))];

  // Parse the stored customization of every item (IDs + quantities only).
  const parsed = items.map((item) => ({
    item,
    selection: extractSelection(item.customizations),
  }));
  const addonIds = [
    ...new Set(parsed.flatMap((p) => p.selection.addons.map((a) => a.addonId))),
  ];
  const optionIds = [
    ...new Set(parsed.flatMap((p) => p.selection.options.map((o) => o.optionId))),
  ];

  // ONE batched query per table: product + recipe + items + ingredient flags +
  // the ORDER BRANCH's costing mode, plus the SELECTED addon/option mini-BOMs.
  // Scoping by `productId IN (order products)` enforces tenant isolation
  // transitively and prevents a cross-product / cross-tenant component from
  // ever consuming stock. No N+1.
  const [productRows, addonRows, optionRows] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: productIds }, restaurantId },
      select: {
        id: true,
        name: true,
        recipe: {
          select: {
            id: true,
            isActive: true,
            items: {
              select: {
                quantity: true,
                ingredient: {
                  select: { id: true, name: true, baseUnit: true, isActive: true },
                },
              },
            },
          },
        },
        branchProducts: {
          where: { branchId },
          select: { costingMode: true },
          take: 1,
        },
      },
    }),
    addonIds.length
      ? tx.productAddon.findMany({
          where: { id: { in: addonIds }, productId: { in: productIds } },
          select: {
            id: true,
            productId: true,
            name: true,
            isActive: true,
            ingredients: { select: CONSUMPTION_BOM_SELECT },
          },
        })
      : Promise.resolve([] as never[]),
    optionIds.length
      ? tx.productOption.findMany({
          where: { id: { in: optionIds }, group: { productId: { in: productIds } } },
          select: {
            id: true,
            name: true,
            isActive: true,
            group: { select: { productId: true } },
            ingredients: { select: CONSUMPTION_BOM_SELECT },
          },
        })
      : Promise.resolve([] as never[]),
  ]);

  const products = productRows;
  const addons = addonRows as unknown as AddonConsumptionRow[];
  const options = optionRows as unknown as OptionConsumptionRow[];

  const productById = new Map(products.map((p) => [p.id, p]));
  const addonById = new Map(addons.map((a) => [a.id, a]));
  const optionById = new Map(options.map((o) => [o.id, o]));

  // Aggregate the required quantity per ingredient (Decimal maths only).
  const required = new Map<string, AggregatedRequirement>();

  const addRequirement = (
    ingredient: { id: string; name: string; baseUnit: string },
    quantity: Prisma.Decimal
  ) => {
    const existing = required.get(ingredient.id);
    if (existing) {
      existing.quantity = existing.quantity.add(quantity);
      return;
    }
    required.set(ingredient.id, {
      ingredientId: ingredient.id,
      ingredientName: ingredient.name,
      baseUnit: ingredient.baseUnit,
      quantity,
    });
  };

  const requireIngredientActive = (
    ingredient: ConsumptionBomLine["ingredient"],
    label: string
  ): { id: string; name: string; baseUnit: string } => {
    if (!ingredient) {
      throw new IngredientCompletionError(
        "INGREDIENT_NOT_FOUND",
        `Bahan baku pada ${label} tidak ditemukan — pesanan tidak dapat diselesaikan.`
      );
    }
    if (!ingredient.isActive) {
      throw new IngredientCompletionError(
        "INGREDIENT_INACTIVE",
        `Bahan baku ${ingredient.name} tidak aktif — aktifkan kembali bahan tersebut sebelum pesanan bisa diselesaikan.`
      );
    }
    return ingredient;
  };

  for (const { item, selection } of parsed) {
    const product = productById.get(item.productId);
    if (!product) {
      // An ordered product that cannot be resolved here is an unresolved BOM —
      // completion is blocked rather than assuming an empty recipe.
      throw new IngredientCompletionError(
        "INGREDIENT_RECIPE_REQUIRED",
        "Resep bahan baku untuk produk yang dipesan tidak ditemukan — pesanan tidak dapat diselesaikan."
      );
    }

    // ---- BASE recipe — skipped entirely in MANUAL mode. ------------------
    const costingMode = product.branchProducts[0]?.costingMode ?? "INGREDIENT";
    if (costingMode !== "MANUAL") {
      const recipe = product.recipe;
      if (!recipe) {
        throw new IngredientCompletionError(
          "INGREDIENT_RECIPE_REQUIRED",
          `Resep untuk ${product.name} belum dibuat — produk ini memakai HPP dari bahan baku, jadi resep wajib diisi sebelum pesanan bisa diselesaikan.`
        );
      }
      if (!recipe.isActive) {
        throw new IngredientCompletionError(
          "INGREDIENT_RECIPE_INACTIVE",
          `Resep untuk ${product.name} tidak aktif — aktifkan resep atau ubah metode HPP menjadi Manual sebelum pesanan bisa diselesaikan.`
        );
      }
      if (recipe.items.length === 0) {
        throw new IngredientCompletionError(
          "INGREDIENT_RECIPE_REQUIRED",
          `Resep untuk ${product.name} belum memiliki bahan — lengkapi resep sebelum pesanan bisa diselesaikan.`
        );
      }

      const orderQty = new Prisma.Decimal(item.quantity);
      for (const recipeItem of recipe.items) {
        const ingredient = requireIngredientActive(
          recipeItem.ingredient,
          `resep ${product.name}`
        );
        addRequirement(ingredient, recipeItem.quantity.mul(orderQty));
      }
    }

    // A non-empty payload that cannot be interpreted at all is an unresolved
    // BOM — never treated as "no customization".
    if (selection.malformed) {
      throw new IngredientCompletionError(
        "MALFORMED_CUSTOMIZATION",
        `Data pilihan pada ${product.name} tidak dapat dibaca — pesanan tidak dapat diselesaikan.`
      );
    }

    // ---- ADDON mini-BOM (consumed in BOTH costing modes). ----------------
    const orderQty = new Prisma.Decimal(item.quantity);
    for (const selected of selection.addons) {
      const addon = addonById.get(selected.addonId);
      if (!addon || addon.productId !== item.productId) {
        throw new IngredientCompletionError(
          "ADDON_NOT_FOUND",
          `Addon pada ${product.name} tidak ditemukan — pesanan tidak dapat diselesaikan.`
        );
      }
      if (!addon.isActive) {
        throw new IngredientCompletionError(
          "ADDON_INACTIVE",
          `Addon ${addon.name} tidak aktif — aktifkan kembali atau ubah pilihan sebelum pesanan bisa diselesaikan.`
        );
      }
      if (selected.invalidQuantity) {
        throw new IngredientCompletionError(
          "INVALID_ADDON_QUANTITY",
          `Jumlah addon ${addon.name} tidak valid — pesanan tidak dapat diselesaikan.`
        );
      }
      if (addon.ingredients.length === 0) {
        throw new IngredientCompletionError(
          "ADDON_BOM_REQUIRED",
          `Komposisi bahan addon ${addon.name} belum diisi — pesanan tidak dapat diselesaikan.`
        );
      }

      const addonQty = new Prisma.Decimal(selected.quantity);
      for (const line of addon.ingredients) {
        const ingredient = requireIngredientActive(
          line.ingredient,
          `addon ${addon.name}`
        );
        addRequirement(ingredient, line.quantity.mul(addonQty).mul(orderQty));
      }
    }

    // ---- OPTION mini-BOM (option selection quantity is implicitly 1). ----
    for (const selected of selection.options) {
      const option = optionById.get(selected.optionId);
      if (!option || option.group.productId !== item.productId) {
        throw new IngredientCompletionError(
          "OPTION_NOT_FOUND",
          `Pilihan pada ${product.name} tidak ditemukan — pesanan tidak dapat diselesaikan.`
        );
      }
      if (!option.isActive) {
        throw new IngredientCompletionError(
          "OPTION_INACTIVE",
          `Pilihan ${option.name} tidak aktif — aktifkan kembali atau ubah pilihan sebelum pesanan bisa diselesaikan.`
        );
      }
      if (option.ingredients.length === 0) {
        throw new IngredientCompletionError(
          "OPTION_BOM_REQUIRED",
          `Komposisi bahan pilihan ${option.name} belum diisi — pesanan tidak dapat diselesaikan.`
        );
      }

      for (const line of option.ingredients) {
        const ingredient = requireIngredientActive(
          line.ingredient,
          `pilihan ${option.name}`
        );
        addRequirement(ingredient, line.quantity.mul(orderQty));
      }
    }
  }

  if (required.size === 0) return;

  // Deterministic order (sorted ingredientId) so concurrent completions take
  // the BranchIngredient row locks in the SAME order → no deadlock.
  const requirements = [...required.values()].sort((a, b) =>
    a.ingredientId < b.ingredientId ? -1 : a.ingredientId > b.ingredientId ? 1 : 0
  );

  // Lock every needed BranchIngredient row, then validate, then apply. The
  // read is separate from the write ONLY to produce the detailed shortage
  // message (available vs required); the write itself is delegated to
  // applyIngredientStockMovement so there is exactly one stock-mutation engine.
  const ingredientIds = requirements.map((r) => r.ingredientId);
  const lockedRows = await tx.$queryRaw<
    Array<{ ingredientId: string; stock: number | bigint | string }>
  >(Prisma.sql`SELECT \`ingredientId\`, \`stock\` FROM \`branchingredient\`
      WHERE \`branchId\` = ${branchId}
        AND \`ingredientId\` IN (${Prisma.join(ingredientIds)})
      FOR UPDATE`);

  const stockByIngredient = new Map<string, Prisma.Decimal>();
  for (const row of lockedRows) {
    const raw = row.stock;
    stockByIngredient.set(
      row.ingredientId,
      raw === null || raw === undefined
        ? new Prisma.Decimal(0)
        : new Prisma.Decimal(typeof raw === "bigint" ? raw.toString() : raw)
    );
  }

  for (const req of requirements) {
    if (req.quantity.isZero()) continue;
    const available =
      stockByIngredient.get(req.ingredientId) ?? new Prisma.Decimal(0);
    if (available.lessThan(req.quantity)) {
      throw new IngredientCompletionError(
        "INSUFFICIENT_INGREDIENT_STOCK",
        `Stok bahan baku ${req.ingredientName} tidak cukup. Tersedia ${formatQty(available)} ${req.baseUnit}, diperlukan ${formatQty(req.quantity)} ${req.baseUnit}.`
      );
    }
  }

  // Apply one OUT movement per ingredient through the single existing engine
  // (it re-acquires the same rows this transaction already locked).
  for (const req of requirements) {
    if (req.quantity.isZero()) continue;
    await applyIngredientStockMovement(tx, {
      restaurantId,
      branchId,
      ingredientId: req.ingredientId,
      type: "OUT",
      quantity: -Number(req.quantity),
      refType: IngredientStockRefType.ORDER_COMPLETED,
      refId: input.refId ?? null,
      reason: input.reason ?? null,
      userId: input.userId ?? null,
    });
  }
}

// ============================================================
// Read operations
// ============================================================

/**
 * List ingredient stock for a branch.
 * Returns each ingredient with its current stock level.
 */
export async function listIngredientStock(
  restaurantId: string,
  branchFilters: string[] | undefined,
  branchId?: string | null
) {
  const branchWhere = branchId
    ? { branchId }
    : branchFilters?.length
      ? { branchId: { in: branchFilters } }
      : {};

  const rows = await prisma.branchIngredient.findMany({
    where: {
      branch: { restaurantId },
      ...branchWhere,
      ingredient: { restaurantId, isActive: true },
    },
    include: {
      ingredient: { select: { id: true, name: true, baseUnit: true, isActive: true } },
      branch: { select: { id: true, name: true, code: true } },
    },
    orderBy: { ingredient: { name: "asc" } },
  });

  return rows.map((r) => ({
    id: r.id,
    branchId: r.branch.id,
    branchName: r.branch.name,
    branchCode: r.branch.code,
    ingredientId: r.ingredient.id,
    ingredientName: r.ingredient.name,
    baseUnit: r.ingredient.baseUnit,
    stock: Number(r.stock),
    // G.3 — cost visibility for the Bahan Baku stock screen (admin-only API).
    averageCost: r.averageCost != null ? Number(r.averageCost) : null,
    lastPurchaseCost: r.lastPurchaseCost != null ? Number(r.lastPurchaseCost) : null,
    isActive: r.ingredient.isActive,
  }));
}

/**
 * Get single ingredient stock across all branches.
 */
export async function getIngredientStockDetail(
  restaurantId: string,
  ingredientId: string,
  branchFilters: string[] | undefined
) {
  const ingredient = await prisma.ingredient.findFirst({
    where: { id: ingredientId, restaurantId },
  });
  if (!ingredient) {
    throw new NotFoundError("Bahan baku tidak ditemukan");
  }

  const stocks = await prisma.branchIngredient.findMany({
    where: {
      ingredientId,
      branch: { restaurantId },
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    },
    include: {
      branch: { select: { id: true, name: true, code: true } },
    },
    orderBy: { branch: { name: "asc" } },
  });

  return {
    ingredient: {
      id: ingredient.id,
      name: ingredient.name,
      baseUnit: ingredient.baseUnit,
    },
    stocks: stocks.map((s) => ({
      branchId: s.branch.id,
      branchName: s.branch.name,
      branchCode: s.branch.code,
      stock: Number(s.stock),
    })),
  };
}

/**
 * Adjust ingredient stock (admin only).
 * Calculates delta from target, applies movement, returns new balance.
 */
export async function adjustIngredientStock(
  restaurantId: string,
  ingredientId: string,
  branchId: string,
  targetStock: number,
  reason: string,
  userId: string,
  branchFilters?: string[] | null
) {
  // Validate ingredient exists and belongs to restaurant
  const ingredient = await prisma.ingredient.findFirst({
    where: { id: ingredientId, restaurantId },
  });
  if (!ingredient) {
    throw new NotFoundError("Bahan baku tidak ditemukan");
  }

  // Validate branch is authorized
  if (branchFilters?.length && !branchFilters.includes(branchId)) {
    throw new ConflictError("Anda tidak memiliki akses ke cabang ini");
  }

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, restaurantId },
  });
  if (!branch) {
    throw new NotFoundError("Cabang tidak ditemukan");
  }

  // Calculate delta from current stock in Decimal space — target is a client
  // number, stock is Decimal(18, 3); subtracting them as float64 could drift.
  const existing = await prisma.branchIngredient.findUnique({
    where: { branchId_ingredientId: { branchId, ingredientId } },
  });
  const currentStockD = existing?.stock ?? new Prisma.Decimal(0);
  const currentStock = Number(currentStockD);
  const deltaD = new Prisma.Decimal(targetStock).sub(currentStockD);

  if (deltaD.isZero()) {
    throw new ValidationError("Nilai stok tidak berubah");
  }

  const movementType: IngredientMovementType = deltaD.greaterThan(0) ? "IN" : "OUT";
  const quantity = Number(deltaD); // signed: positive for IN, negative for OUT

  const result = await prisma.$transaction(async (tx) => {
    return applyIngredientStockMovement(tx, {
      restaurantId,
      branchId,
      ingredientId,
      type: movementType,
      quantity,
      reason,
      refType: IngredientStockRefType.STOCK_ADJUSTMENT,
      refId: null,
      userId,
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

  return {
    ingredientId,
    ingredientName: ingredient.name,
    baseUnit: ingredient.baseUnit,
    branchId,
    branchName: branch.name,
    previousStock: currentStock,
    targetStock,
    delta: quantity,
    movementType,
    newBalance: result.balanceAfter,
  };
}

/**
 * List ingredient stock movements (ledger). Branch-scoped.
 */
export async function listIngredientStockMovements(
  restaurantId: string,
  branchFilters: string[] | undefined,
  filters: {
    branchId?: string | null;
    ingredientId?: string | null;
    type?: IngredientMovementType | null;
    startDate?: string | null;
    endDate?: string | null;
    limit?: number;
  } = {}
) {
  const limit = Math.min(Math.max(filters.limit ?? 100, 1), 500);

  const where: Record<string, unknown> = { restaurantId };

  if (filters.branchId) {
    where.branchId = filters.branchId;
  } else if (branchFilters?.length) {
    where.branchId = { in: branchFilters };
  }

  if (filters.ingredientId) {
    where.ingredientId = filters.ingredientId;
  }

  if (filters.type) {
    where.type = filters.type;
  }

  if (filters.startDate || filters.endDate) {
    const createdAt: Record<string, Date> = {};
    if (filters.startDate) {
      const d = new Date(filters.startDate);
      d.setHours(0, 0, 0, 0);
      createdAt.gte = d;
    }
    if (filters.endDate) {
      const d = new Date(filters.endDate);
      d.setHours(23, 59, 59, 999);
      createdAt.lte = d;
    }
    where.createdAt = createdAt;
  }

  const rows = await prisma.ingredientStockMovement.findMany({
    where,
    include: {
      branch: { select: { code: true, name: true } },
      ingredient: { select: { name: true, baseUnit: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((m) => ({
    id: m.id,
    branchId: m.branchId,
    branchCode: m.branch?.code ?? null,
    branchName: m.branch?.name ?? null,
    ingredientId: m.ingredientId,
    ingredientName: m.ingredient?.name ?? null,
    baseUnit: m.ingredient?.baseUnit ?? null,
    type: m.type,
    quantity: Number(m.quantity),
    balanceAfter: Number(m.balanceAfter),
    refType: m.refType,
    refId: m.refId,
    reason: m.reason,
    userId: m.userId,
    userName: m.user?.name ?? null,
    createdAt: m.createdAt,
  }));
}
