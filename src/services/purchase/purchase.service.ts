import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import {
  applyStockMovement,
  StockRefType,
  type StockMovementType,
} from "@/services/stock/stock.service";

// ============================================================
// PURCHASE SERVICE FOUNDATION (Phase B)
//
// D1 — quantities are integer PCS. D2 — unit cost is stored ONLY here on
// PurchaseItem.unitCost (historical); Product.price is never touched.
// total/lineTotal are server-derived — client input is never trusted.
//
// Idempotency: RECEIVE (DRAFT → RECEIVED) is a conditional status update
// inside the SAME transaction that applies the movements. A double-click /
// network retry of an already-received purchase hits count 0, throws a
// ConflictError and applies NO stock a second time.
//
// Status flow: DRAFT → RECEIVED (goods in) | DRAFT → CANCELLED.
// Only DRAFT can be changed; RECEIVED/CANCELLED are terminal.
// ============================================================

const PURCHASE_STATUSES = ["DRAFT", "RECEIVED", "CANCELLED"] as const;

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export interface PurchaseItemInput {
  productId: string;
  quantity: number;
  unitCost: number;
}

export interface CreatePurchaseInput {
  supplierId: string;
  branchId: string;
  notes?: string | null;
  items: PurchaseItemInput[];
}

export interface UpdateDraftPurchaseInput {
  supplierId?: string;
  notes?: string | null;
  items?: PurchaseItemInput[];
}

export interface ListPurchaseFilter {
  status?: string | null;
  supplierId?: string | null;
  /** Explicit branch filter — the caller must authorize it. */
  branchId?: string | null;
  /** ISO date string. When present the created range is bounded inclusively. */
  startDate?: string | null;
  endDate?: string | null;
  limit?: number;
  skip?: number;
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

function parsePurchaseStatus(status: string | null | undefined): "DRAFT" | "RECEIVED" | "CANCELLED" | undefined {
  if (!status) return undefined;
  if (!PURCHASE_STATUSES.includes(status as never)) {
    throw new ValidationError("Status pembelian tidak valid");
  }
  return status as "DRAFT" | "RECEIVED" | "CANCELLED";
}

async function validateBranch(restaurantId: string, branchId: string) {
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, restaurantId },
    select: { id: true },
  });
  if (!branch) {
    throw new NotFoundError("Cabang tidak ditemukan");
  }
}

async function validateSupplier(restaurantId: string, supplierId: string) {
  const supplier = await prisma.supplier.findFirst({
    where: { id: supplierId, restaurantId },
    select: { id: true, isActive: true },
  });
  if (!supplier) {
    throw new NotFoundError("Supplier tidak ditemukan");
  }
  if (!supplier.isActive) {
    throw new ValidationError("Supplier tidak aktif");
  }
}

/**
 * Validate raw purchase items against the tenant's Product master and return
 * normalized rows with server-derived lineTotal. quantity must be a positive
 * integer (PCS); unitCost must be a finite number >= 0.
 */
async function normalizeItems(
  restaurantId: string,
  rawItems: PurchaseItemInput[]
): Promise<{ productId: string; quantity: number; unitCost: number; lineTotal: number }[]> {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new ValidationError("Pembelian harus memiliki minimal satu item");
  }

  const productIds = new Set<string>();
  for (const item of rawItems) {
    if (!item || typeof item.productId !== "string" || !item.productId) {
      throw new ValidationError("Produk wajib diisi pada setiap item");
    }
    productIds.add(item.productId);
  }

  const products = await prisma.product.findMany({
    where: { id: { in: [...productIds] }, restaurantId },
    select: { id: true },
  });
  if (products.length !== productIds.size) {
    throw new ValidationError("Ada produk yang tidak ditemukan");
  }
  const owned = new Set(products.map((p) => p.id));

  return rawItems.map((item) => {
    if (!owned.has(item.productId)) {
      throw new ValidationError("Ada produk yang tidak ditemukan");
    }
    const quantity = item.quantity;
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
      throw new ValidationError("Jumlah item harus bilangan bulat positif (PCS)");
    }
    const unitCost = Number(item.unitCost);
    if (
      typeof item.unitCost !== "number" ||
      !Number.isFinite(unitCost) ||
      unitCost < 0
    ) {
      throw new ValidationError("Harga satuan tidak boleh negatif");
    }
    const cost = round2(unitCost);
    return {
      productId: item.productId,
      quantity,
      unitCost: cost,
      lineTotal: round2(quantity * cost),
    };
  });
}

function toNumber(value: Prisma.Decimal | number): number {
  return Number(value);
}

export async function createPurchase(
  restaurantId: string,
  input: CreatePurchaseInput
) {
  await validateBranch(restaurantId, input.branchId);
  await validateSupplier(restaurantId, input.supplierId);
  const items = await normalizeItems(restaurantId, input.items);
  const total = round2(items.reduce((sum, i) => sum + i.lineTotal, 0));

  const purchase = await prisma.$transaction(async (tx) => {
    const created = await tx.purchase.create({
      data: {
        restaurantId,
        branchId: input.branchId,
        supplierId: input.supplierId,
        status: "DRAFT",
        total,
        notes: input.notes?.trim() || null,
      },
    });
    await tx.purchaseItem.createMany({
      data: items.map((i) => ({
        purchaseId: created.id,
        productId: i.productId,
        quantity: i.quantity,
        unitCost: i.unitCost,
        lineTotal: i.lineTotal,
      })),
    });
    return created;
  });

  return {
    id: purchase.id,
    status: purchase.status,
    branchId: purchase.branchId,
    supplierId: purchase.supplierId,
    total: toNumber(purchase.total),
    notes: purchase.notes,
    receivedAt: purchase.receivedAt,
    createdAt: purchase.createdAt,
    items,
  };
}

export async function listPurchases(
  restaurantId: string,
  branchFilters: string[] | undefined,
  filter: ListPurchaseFilter = {}
) {
  const status = parsePurchaseStatus(filter.status);
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  const skip = Math.max(filter.skip ?? 0, 0);

  const where: Prisma.PurchaseWhereInput = {
    restaurantId,
    ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    ...(status ? { status } : {}),
    ...(filter.supplierId ? { supplierId: filter.supplierId } : {}),
    ...(filter.branchId ? { branchId: filter.branchId } : {}),
    ...(filter.startDate || filter.endDate
      ? {
          createdAt: {
            ...(toStartOfDay(filter.startDate) ? { gte: toStartOfDay(filter.startDate) } : {}),
            ...(toEndOfDay(filter.endDate) ? { lte: toEndOfDay(filter.endDate) } : {}),
          },
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.purchase.findMany({
      where,
      include: {
        supplier: { select: { id: true, name: true } },
        branch: { select: { id: true, code: true, name: true } },
        items: {
          select: { id: true, productId: true, quantity: true, unitCost: true, lineTotal: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: limit,
      skip,
    }),
    prisma.purchase.count({ where }),
  ]);

  return {
    items: items.map((p) => ({
      id: p.id,
      status: p.status,
      statusLabel:
        p.status === "DRAFT"
          ? "Draft"
          : p.status === "RECEIVED"
            ? "Diterima"
            : "Dibatalkan",
      branchId: p.branchId,
      branchCode: p.branch?.code ?? null,
      branchName: p.branch?.name ?? null,
      supplierId: p.supplierId,
      supplierName: p.supplier?.name ?? null,
      total: toNumber(p.total),
      notes: p.notes,
      receivedAt: p.receivedAt,
      createdAt: p.createdAt,
      itemCount: p.items.length,
    })),
    total,
  };
}

export async function getPurchase(
  restaurantId: string,
  id: string,
  branchFilters: string[] | undefined
) {
  const purchase = await prisma.purchase.findFirst({
    where: {
      id,
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    },
    include: {
      supplier: { select: { id: true, name: true, phone: true } },
      branch: { select: { id: true, code: true, name: true } },
      items: {
        include: {
          product: { select: { id: true, name: true, price: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!purchase) {
    throw new NotFoundError("Pembelian tidak ditemukan");
  }

  // StockMovement is linked by string refType/refId (foundation design — one
  // purchase legitimately has one IN movement per item). Look them up directly
  // so the received purchase detail shows its inventory history (STEP 12).
  const movements = await prisma.stockMovement.findMany({
    where: {
      restaurantId,
      branchId: purchase.branchId,
      refType: StockRefType.PURCHASE_RECEIVE,
      refId: purchase.id,
    },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  return {
    id: purchase.id,
    status: purchase.status,
    branchId: purchase.branchId,
    branchCode: purchase.branch?.code ?? null,
    branchName: purchase.branch?.name ?? null,
    supplierId: purchase.supplierId,
    supplierName: purchase.supplier?.name ?? null,
    supplierPhone: purchase.supplier?.phone ?? null,
    total: toNumber(purchase.total),
    notes: purchase.notes,
    receivedAt: purchase.receivedAt,
    createdAt: purchase.createdAt,
    items: purchase.items.map((i) => ({
      id: i.id,
      productId: i.productId,
      productName: i.product?.name ?? null,
      productPrice: i.product ? toNumber(i.product.price) : null,
      quantity: i.quantity,
      unitCost: toNumber(i.unitCost),
      lineTotal: toNumber(i.lineTotal),
    })),
    movements: movements.map((m) => ({
      id: m.id,
      productId: m.productId,
      type: m.type,
      quantity: m.quantity,
      balanceAfter: m.balanceAfter,
      reason: m.reason,
      userName: m.user?.name ?? null,
      createdBy: m.userId,
      createdAt: m.createdAt,
    })),
  };
}

export async function updateDraftPurchase(
  restaurantId: string,
  id: string,
  branchFilters: string[] | undefined,
  input: UpdateDraftPurchaseInput
) {
  const existing = await prisma.purchase.findFirst({
    where: {
      id,
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    },
    include: { items: true },
  });
  if (!existing) {
    throw new NotFoundError("Pembelian tidak ditemukan");
  }
  if (existing.status !== "DRAFT") {
    throw new ConflictError("Hanya pembelian draft yang dapat diubah");
  }

  if (input.supplierId && input.supplierId !== existing.supplierId) {
    await validateSupplier(restaurantId, input.supplierId);
  }

  const items = input.items ? await normalizeItems(restaurantId, input.items) : null;
  const total = items
    ? round2(items.reduce((sum, i) => sum + i.lineTotal, 0))
    : existing.total;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.purchase.updateMany({
      where: {
        id,
        restaurantId,
        status: "DRAFT",
        ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      },
      data: {
        ...(input.supplierId ? { supplierId: input.supplierId } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        total,
      },
    });
    if (updated.count === 0) {
      throw new ConflictError("Hanya pembelian draft yang dapat diubah");
    }

    if (items) {
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchaseItem.createMany({
        data: items.map((i) => ({
          purchaseId: id,
          productId: i.productId,
          quantity: i.quantity,
          unitCost: i.unitCost,
          lineTotal: i.lineTotal,
        })),
      });
    }
  });
}

/**
 * Receive goods: atomically flips DRAFT → RECEIVED and applies an IN stock
 * movement (balance + quantity) per purchase item — all in ONE transaction.
 * The conditional status update is the idempotency gate: any duplicate /
 * retried receive hits count 0 and adds no stock.
 */
export async function receivePurchase(
  restaurantId: string,
  id: string,
  userId: string | null,
  branchFilters: string[] | undefined
) {
  const purchase = await prisma.purchase.findFirst({
    where: {
      id,
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    },
    include: {
      items: true,
      branch: { select: { code: true, name: true } },
      supplier: { select: { name: true } },
    },
  });
  if (!purchase) {
    throw new NotFoundError("Pembelian tidak ditemukan");
  }
  if (purchase.status !== "DRAFT") {
    throw new ConflictError("Pembelian sudah diterima atau dibatalkan");
  }

  const total = round2(purchase.items.reduce((sum, i) => sum + Number(i.lineTotal), 0));

  await prisma.$transaction(async (tx) => {
    const moved = await tx.purchase.updateMany({
      where: {
        id,
        restaurantId,
        status: "DRAFT",
        ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      },
      data: { status: "RECEIVED", receivedAt: new Date(), total },
    });
    if (moved.count === 0) {
      throw new ConflictError("Pembelian sudah diterima atau dibatalkan");
    }

    for (const item of purchase.items) {
      await applyStockMovement(tx, {
        restaurantId,
        branchId: purchase.branchId,
        productId: item.productId,
        type: "IN" as StockMovementType,
        quantity: item.quantity,
        refType: StockRefType.PURCHASE_RECEIVE,
        refId: purchase.id,
        userId,
      });
    }
  });

  return getPurchase(restaurantId, id, branchFilters);
}

export async function cancelPurchase(
  restaurantId: string,
  id: string,
  branchFilters: string[] | undefined
) {
  const existing = await prisma.purchase.findFirst({
    where: {
      id,
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    },
    select: { id: true, status: true },
  });
  if (!existing) {
    throw new NotFoundError("Pembelian tidak ditemukan");
  }
  if (existing.status !== "DRAFT") {
    throw new ConflictError("Hanya pembelian draft yang dapat dibatalkan");
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.purchase.updateMany({
      where: {
        id,
        restaurantId,
        status: "DRAFT",
        ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      },
      data: { status: "CANCELLED" },
    });
    if (updated.count === 0) {
      throw new ConflictError("Hanya pembelian draft yang dapat dibatalkan");
    }
  });

  return { id, status: "CANCELLED" };
}