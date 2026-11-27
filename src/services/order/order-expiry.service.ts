import { prisma } from "@/lib/prisma";
import { releaseOrderStock } from "@/services/stock/order-stock.service";

// ============================================================
// PHASE 5 — AUTO-EXPIRE STALE UNPAID ORDERS (stock hold safety)
//
// An order created by QR self-order / online checkout holds product stock
// from the moment it is created (`ORDER_RESERVE` ledger row, K5). If the
// customer never pays, that hold would stay forever and the product would
// look sold out — the stock is "nyangkut".
//
// This service finds orders that are still PENDING + UNPAID after the grace
// period and cancels them ATOMICALLY, releasing the hold back to
// `BranchProduct.stock` through the existing ledger-reconciled
// `releaseOrderStock()` (idempotent — a partially restored hold is never
// restored twice).
//
// Safety rules:
//   - Only `status = PENDING` AND `paymentStatus = UNPAID` are touched. A PAID
//     order, an order already in the kitchen, or one awaiting gateway
//     confirmation (`PENDING` payment) is never expired.
//   - Every order is cancelled in its own transaction with a conditional
//     `updateMany` guard, so a concurrent payment/status change wins and the
//     expiry silently skips that order.
//   - `paymentStatus` is left UNPAID: this is a cancellation, not a payment
//     state transition, and revenue reporting keys off PAID + non-cancelled.
//   - The order's table (when it occupied one) is freed, mirroring the normal
//     cancellation flow.
//
// Callers: the protected cron endpoint
// `POST /api/internal/cron/expire-orders` (crontab / worker every 5 minutes).
// ============================================================

/** Default grace period before an unpaid PENDING order is auto-cancelled. */
export const STALE_UNPAID_ORDER_MINUTES = 30;

/** Upper bound on orders handled per run (keeps a single cron tick bounded). */
const MAX_ORDERS_PER_RUN = 200;

export interface ExpireStaleUnpaidOrdersResult {
  /** Orders that matched the stale filter in this run. */
  scanned: number;
  /** Orders actually flipped to CANCELLED (stock released). */
  cancelled: number;
  /** Orders skipped because their state changed underneath us / a DB error. */
  skipped: number;
  /** Cutoff timestamp used for the stale filter (ISO string). */
  cutoff: string;
  orderNumbers: string[];
}

/**
 * Cancel PENDING + UNPAID orders older than `olderThanMinutes` and return
 * their held stock to the branch. Never throws for a single order failure —
 * the remaining orders are still processed and the error is logged.
 */
export async function expireStaleUnpaidOrders(
  olderThanMinutes: number = STALE_UNPAID_ORDER_MINUTES
): Promise<ExpireStaleUnpaidOrdersResult> {
  const minutes =
    Number.isFinite(olderThanMinutes) && olderThanMinutes > 0
      ? Math.trunc(olderThanMinutes)
      : STALE_UNPAID_ORDER_MINUTES;

  const cutoff = new Date(Date.now() - minutes * 60 * 1000);

  const candidates = await prisma.order.findMany({
    where: {
      status: "PENDING",
      paymentStatus: "UNPAID",
      createdAt: { lt: cutoff },
    },
    select: {
      id: true,
      restaurantId: true,
      orderNumber: true,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_ORDERS_PER_RUN,
  });

  const result: ExpireStaleUnpaidOrdersResult = {
    scanned: candidates.length,
    cancelled: 0,
    skipped: 0,
    cutoff: cutoff.toISOString(),
    orderNumbers: [],
  };

  for (const candidate of candidates) {
    try {
      const cancelled = await prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the order may have been paid or
        // moved forward between the candidate query and this moment.
        const order = await tx.order.findFirst({
          where: { id: candidate.id, restaurantId: candidate.restaurantId },
          select: {
            id: true,
            restaurantId: true,
            orderNumber: true,
            status: true,
            paymentStatus: true,
            tableId: true,
          },
        });

        if (
          !order ||
          order.status !== "PENDING" ||
          order.paymentStatus !== "UNPAID"
        ) {
          return null;
        }

        // Conditional update: only the exact state we just validated, so a
        // racing payment / status transition is never overwritten.
        const flipped = await tx.order.updateMany({
          where: {
            id: order.id,
            restaurantId: order.restaurantId,
            status: "PENDING",
            paymentStatus: "UNPAID",
          },
          data: { status: "CANCELLED" },
        });
        if (flipped.count === 0) return null;

        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            status: "CANCELLED",
            notes: `Dibatalkan otomatis: belum dibayar lebih dari ${minutes} menit`,
          },
        });

        // Release whatever product stock this order still holds.
        await releaseOrderStock(tx, {
          restaurantId: order.restaurantId,
          orderId: order.id,
          reason: `Pesanan ${order.orderNumber} kedaluwarsa (belum dibayar)`,
        });

        // Free the table the expired order was occupying.
        if (order.tableId) {
          await tx.table.updateMany({
            where: { id: order.tableId, restaurantId: order.restaurantId },
            data: { status: "AVAILABLE" },
          });
        }

        return order;
      });

      if (cancelled) {
        result.cancelled += 1;
        result.orderNumbers.push(cancelled.orderNumber);
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.skipped += 1;
      console.error(
        `[OrderExpiry] Failed to expire order ${candidate.orderNumber}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  return result;
}
