import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";

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
      ingredient: { select: { id: true, name: true, baseUnit: true } },
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
