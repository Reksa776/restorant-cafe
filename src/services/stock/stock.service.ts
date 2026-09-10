import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ConflictError, ValidationError } from "@/lib/errors";

// ============================================================
// STOCK MOVEMENT FOUNDATION (Phase B)
//
// Every stock change goes through ONE atomic path:
//   applyStockMovement(tx, ...)  — lock branchproduct row (FOR UPDATE),
//   validate the signed quantity, compute balanceAfter, upsert the balance
//   and append a StockMovement ledger row IN THE SAME TRANSACTION. A failed
//   movement rolls the whole transaction back, so a StockMovement can never
//   exist without its BranchProduct.stock change (and vice versa).
//
// qty semantics (documented in schema.prisma):
//   IN         quantity > 0  — receiving goods adds stock
//   OUT        quantity < 0  — an Order reaching COMPLETED removes stock
//   ADJUSTMENT quantity is a signed delta (+ / -)
// balanceAfter is captured BEFORE-AFTER so the ledger is fully replayable.
//
// refType/refId identify the source document (PURCHASE_RECEIVE + purchaseId,
// ORDER_COMPLETED + orderId). They are NOT unique: one purchase legitimately
// produces one movement per item. Duplicate requests are prevented at the
// source-document status transition (see purchase.receive and
// order.updateOrderStatus), never by a movement-level unique constraint.
// ============================================================

export const StockRefType = {
  PURCHASE_RECEIVE: "PURCHASE_RECEIVE",
  ORDER_COMPLETED: "ORDER_COMPLETED",
  STOCK_ADJUSTMENT: "STOCK_ADJUSTMENT",
} as const;

export type StockMovementType = "IN" | "OUT" | "ADJUSTMENT";

export interface ApplyStockMovementInput {
  restaurantId: string;
  branchId: string;
  productId: string;
  type: StockMovementType;
  /** Signed integer — see qty semantics above. Never trusted from client. */
  quantity: number;
  reason?: string | null;
  refType?: string | null;
  refId?: string | null;
  userId?: string | null;
}

function validateQuantity(type: StockMovementType, quantity: number): void {
  if (typeof quantity !== "number" || !Number.isInteger(quantity)) {
    throw new ValidationError("Jumlah pergerakan stok harus bilangan bulat");
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
 * Apply one stock movement + the BranchProduct balance atomically.
 *
 * MUST be called inside an interactive transaction (`prisma.$transaction`).
 * The branchproduct row is locked FOR UPDATE so concurrent movements on the
 * same product serialize; a movement that would drive stock below 0 throws a
 * ConflictError and rolls the wrapping transaction back.
 *
 * Precondition (enforced by callers): `branchId` and `productId` belong to
 * `restaurantId`. Branch/resource ownership is validated in the service
 * layer, which derives restaurantId/branchId from the authenticated context
 * — never from the client.
 */
export async function applyStockMovement(
  tx: Prisma.TransactionClient,
  input: ApplyStockMovementInput
): Promise<{ balanceAfter: number }> {
  const { restaurantId, branchId, productId, type, quantity } = input;

  validateQuantity(type, quantity);

  // Serialize concurrent movement writers on the same branch+product row.
  // FOR UPDATE only locks EXISTING rows, so when the BranchProduct row does not
  // exist yet two transactions could both pass this SELECT with 0 rows and
  // overwrite each other's balance. Reserve the row inside the lock window
  // first (P2002 is benign — the other writer already reserved it), then
  // re-lock so we actually hold the row lock before computing balanceAfter.
  let rows = await tx.$queryRaw<Array<{ stock: number | bigint }>>(Prisma.sql`
    SELECT \`stock\` FROM \`branchproduct\`
    WHERE \`branchId\` = ${branchId} AND \`productId\` = ${productId}
    FOR UPDATE
  `);
  if (!rows.length) {
    try {
      await tx.branchProduct.create({
        data: {
          branchId,
          productId,
          stock: 0,
          isAvailable: true,
          priceOverride: null,
        },
      });
    } catch (e) {
      // Unique violation: a concurrent movement created the row. It now exists
      // (and is committed by the time our lock attempt below runs), so proceed.
      if ((e as { code?: string }).code !== "P2002") throw e;
    }
    rows = await tx.$queryRaw<Array<{ stock: number | bigint }>>(Prisma.sql`
      SELECT \`stock\` FROM \`branchproduct\`
      WHERE \`branchId\` = ${branchId} AND \`productId\` = ${productId}
      FOR UPDATE
    `);
  }
  const current = rows.length ? Number(rows[0].stock) : 0;
  const balanceAfter = current + quantity;

  if (balanceAfter < 0) {
    throw new ConflictError("Stok tidak mencukupi untuk pergerakan ini");
  }

  // Upsert the balance (an IN on a product never stocked in this branch
  // creates the BranchProduct row, defaults availability on).
  await tx.branchProduct.upsert({
    where: { branchId_productId: { branchId, productId } },
    update: { stock: balanceAfter },
    create: {
      branchId,
      productId,
      stock: balanceAfter,
      isAvailable: true,
      priceOverride: null,
    },
  });

  // Append the ledger row in the same transaction.
  await tx.stockMovement.create({
    data: {
      restaurantId,
      branchId,
      productId,
      type,
      quantity,
      balanceAfter,
      reason: input.reason ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      userId: input.userId ?? null,
    },
  });

  return { balanceAfter };
}

export interface ListStockMovementFilter {
  branchId?: string | null;
  productId?: string | null;
  type?: StockMovementType | null;
  /** ISO date string — inclusive day bounds (server-normalized). */
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
}

function toStartOfDay(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(0, 0, 0, 0);
  return d;
}

function toEndOfDay(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Read the stock ledger for a restaurant (optionally branch-scoped).
 * Returns rows with branch + product names, newest first.
 */
export async function listStockMovements(
  restaurantId: string,
  branchFilters: string[] | undefined,
  filter: ListStockMovementFilter = {}
) {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);

  const rows = await prisma.stockMovement.findMany({
    where: {
      restaurantId,
      branchId: {
        ...(branchFilters?.length ? { in: branchFilters } : {}),
        ...(filter.branchId ? { equals: filter.branchId } : {}),
      },
      productId: filter.productId ?? undefined,
      type:
        filter.type &&
        (filter.type === "IN" || filter.type === "OUT" || filter.type === "ADJUSTMENT")
          ? filter.type
          : undefined,
      createdAt:
        filter.startDate || filter.endDate
          ? {
              ...(toStartOfDay(filter.startDate) ? { gte: toStartOfDay(filter.startDate) } : {}),
              ...(toEndOfDay(filter.endDate) ? { lte: toEndOfDay(filter.endDate) } : {}),
            }
          : undefined,
    },
    include: {
      branch: { select: { code: true, name: true } },
      product: { select: { name: true } },
      user: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((m) => ({
    id: m.id,
    branchId: m.branchId,
    productId: m.productId,
    type: m.type,
    quantity: m.quantity,
    balanceAfter: m.balanceAfter,
    refType: m.refType,
    refId: m.refId,
    reason: m.reason,
    createdAt: m.createdAt,
    branchCode: m.branch?.code ?? null,
    branchName: m.branch?.name ?? null,
    productName: m.product?.name ?? null,
    userId: m.userId,
    userName: m.user?.name ?? null,
  }));
}