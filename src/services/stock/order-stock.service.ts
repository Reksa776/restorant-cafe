import { Prisma } from "@prisma/client";
import { applyStockMovement } from "./stock.service";

// ============================================================
// ORDER STOCK HOLD (K5 — no oversell between order creation and READY)
//
// Product stock used to be validated at order creation but deducted only at
// PROCESSING → READY. Two concurrent orders could therefore both pass the
// check for the last unit, both get paid, and the second one then failed at
// READY with "Stok tidak mencukupi".
//
// This module makes the deduction happen INSIDE the order-creation
// transaction, under the existing `branchproduct … FOR UPDATE` lock:
//
//   ORDER_RESERVE  OUT  written when stock is held for an order
//   ORDER_RELEASE  IN   written when the hold is given back
//
// The "currently held" quantity is DERIVED from the ledger, per product:
//
//   held = Σ deductions (ORDER_RESERVE / ORDER_READY / ORDER_COMPLETED)
//        − Σ ORDER_RELEASE
//
// A full cancellation/expiry releases everything; a payment retry can then
// re-hold exactly the missing quantity (never the whole order twice). Legacy
// orders deducted at READY are held by the same formula, so nothing is
// deducted twice when they flow through the new code.
//
// Refund restorations (REFUND_RESTORE) are intentionally NOT subtracted here:
// a refunded unit left the order permanently, so a later payment attempt must
// not silently re-hold it. `releaseOrderStock` DOES subtract them (plus the
// legacy CANCELLATION_RESTORE rows) so a cancellation never restores the same
// unit twice.
//
// MUST be called inside the caller's interactive transaction.
// ============================================================

/** Ledger rows that represent stock actually taken out for this order. */
const DEDUCTION_REF_TYPES = [
  "ORDER_RESERVE", // new: held at order creation
  "ORDER_READY", // legacy: deducted at PROCESSING → READY
  "ORDER_COMPLETED", // legacy: deducted at READY → COMPLETED
] as const;

/** Ledger rows that released a hold (only these reduce "currently held"). */
const RELEASE_REF_TYPES = ["ORDER_RELEASE"] as const;

/** Ledger rows that already put stock back for this order (any reason). */
const RESTORE_REF_TYPES = [
  "ORDER_RELEASE", // this module
  "CANCELLATION_RESTORE", // legacy cancellation restore
  "REFUND_RESTORE", // approved refund restore
] as const;

export const ORDER_STOCK_RESERVE_REF = "ORDER_RESERVE";
export const ORDER_STOCK_RELEASE_REF = "ORDER_RELEASE";

type Tx = Prisma.TransactionClient;

export interface OrderStockLine {
  productId: string;
  quantity: number;
}

/**
 * Per-product quantity this order currently holds: deductions minus released
 * holds. Only positive entries are returned.
 */
async function heldQuantitiesByProduct(
  tx: Tx,
  restaurantId: string,
  orderId: string
): Promise<Map<string, number>> {
  const [deductions, releases] = await Promise.all([
    tx.stockMovement.findMany({
      where: {
        restaurantId,
        refId: orderId,
        type: "OUT",
        refType: { in: [...DEDUCTION_REF_TYPES] },
      },
      select: { productId: true, quantity: true },
    }),
    tx.stockMovement.findMany({
      where: {
        restaurantId,
        refId: orderId,
        refType: { in: [...RELEASE_REF_TYPES] },
      },
      select: { productId: true, quantity: true },
    }),
  ]);

  const held = new Map<string, number>();
  for (const row of deductions) {
    held.set(row.productId, (held.get(row.productId) ?? 0) + Math.abs(row.quantity));
  }
  for (const row of releases) {
    held.set(row.productId, (held.get(row.productId) ?? 0) - Math.abs(row.quantity));
  }
  for (const [productId, quantity] of held) {
    if (quantity <= 0) held.delete(productId);
  }
  return held;
}

/** True when this order CURRENTLY holds stock (hold intact, not released). */
export async function orderHasStockDeduction(
  tx: Tx,
  restaurantId: string,
  orderId: string
): Promise<boolean> {
  const held = await heldQuantitiesByProduct(tx, restaurantId, orderId);
  return held.size > 0;
}

/**
 * Hold (`OUT`) the stock of every ordered product exactly once.
 *
 * Idempotent and incremental: only the per-product quantity that is not
 * already held is deducted, so it is a no-op while the hold is intact and
 * re-acquires exactly the released quantity after an expired intent. Lock
 * order is deterministic (sorted productId) so concurrent order creations
 * cannot deadlock. A shortage throws ConflictError from `applyStockMovement`
 * and rolls the caller's transaction back — the order/payment is never
 * created against stock that does not exist.
 */
export async function ensureOrderStockReserved(
  tx: Tx,
  input: {
    restaurantId: string;
    orderId: string;
    branchId: string | null | undefined;
    items: OrderStockLine[];
    reason?: string | null;
    userId?: string | null;
  }
): Promise<{ reserved: boolean }> {
  const { restaurantId, orderId, branchId, items } = input;
  // Branch-less legacy flow: there is no BranchProduct to hold.
  if (!branchId || items.length === 0) return { reserved: false };

  // Aggregate per product (the same product may appear in several lines with
  // different customizations).
  const requiredByProduct = new Map<string, number>();
  for (const item of items) {
    if (!Number.isInteger(item.quantity) || item.quantity <= 0) continue;
    requiredByProduct.set(
      item.productId,
      (requiredByProduct.get(item.productId) ?? 0) + item.quantity
    );
  }
  if (requiredByProduct.size === 0) return { reserved: false };

  const held = await heldQuantitiesByProduct(tx, restaurantId, orderId);

  // Deterministic lock order.
  const productIds = [...requiredByProduct.keys()].sort();
  let reserved = false;

  for (const productId of productIds) {
    const required = requiredByProduct.get(productId) ?? 0;
    const alreadyHeld = held.get(productId) ?? 0;
    const missing = required - alreadyHeld;
    if (missing <= 0) continue;

    await applyStockMovement(tx, {
      restaurantId,
      branchId,
      productId,
      type: "OUT",
      quantity: -missing,
      refType: ORDER_STOCK_RESERVE_REF,
      refId: orderId,
      reason: input.reason ?? "Stok dipegang saat pesanan dibuat",
      userId: input.userId ?? null,
    });
    reserved = true;
  }

  return { reserved };
}

/**
 * Release whatever is still held for this order (cancelled / expired).
 *
 * Ledger reconciliation: `restore = Σ deductions − Σ already restored`
 * (releases + legacy cancellation/refund restores). Idempotent (a second call
 * computes 0), and correct for legacy orders deducted at READY rather than
 * held at creation. Only net-positive per-product quantities are written, in
 * sorted order (deadlock-safe).
 */
export async function releaseOrderStock(
  tx: Tx,
  input: {
    restaurantId: string;
    orderId: string;
    reason?: string | null;
    userId?: string | null;
  }
): Promise<{ restoredProducts: number }> {
  const { restaurantId, orderId } = input;

  const [deductions, restorations] = await Promise.all([
    tx.stockMovement.findMany({
      where: {
        restaurantId,
        refId: orderId,
        type: "OUT",
        refType: { in: [...DEDUCTION_REF_TYPES] },
      },
      select: { productId: true, quantity: true, branchId: true },
    }),
    tx.stockMovement.findMany({
      where: {
        restaurantId,
        refId: orderId,
        refType: { in: [...RESTORE_REF_TYPES] },
      },
      select: { productId: true, quantity: true },
    }),
  ]);

  if (deductions.length === 0) return { restoredProducts: 0 };

  const net = new Map<string, number>();
  const branchByProduct = new Map<string, string>();
  for (const row of deductions) {
    net.set(row.productId, (net.get(row.productId) ?? 0) + Math.abs(row.quantity));
    // The deduction ledger row carries the branch that actually lost the
    // stock; the release must land on that same branch.
    if (!branchByProduct.has(row.productId)) {
      branchByProduct.set(row.productId, row.branchId);
    }
  }
  for (const row of restorations) {
    net.set(row.productId, (net.get(row.productId) ?? 0) - Math.abs(row.quantity));
  }

  const productIds = [...net.entries()]
    .filter(([, qty]) => qty > 0)
    .map(([productId]) => productId)
    .sort();

  for (const productId of productIds) {
    const quantity = net.get(productId) ?? 0;
    if (quantity <= 0) continue;
    const branchId = branchByProduct.get(productId);
    if (!branchId) continue;
    await applyStockMovement(tx, {
      restaurantId,
      branchId,
      productId,
      type: "IN",
      quantity,
      refType: ORDER_STOCK_RELEASE_REF,
      refId: orderId,
      reason: input.reason ?? "Stok dikembalikan karena pesanan dibatalkan",
      userId: input.userId ?? null,
    });
  }

  return { restoredProducts: productIds.length };
}
