import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { auditService } from "@/services/audit/audit.service";
import type { RequestStatus } from "@prisma/client";

// ============================================================
// Shared helpers
// ============================================================

/** The caller's open shift (used to tie cash operations to a drawer). */
async function openShiftOf(restaurantId: string, userId: string) {
  return prisma.cashierShift.findFirst({
    where: { restaurantId, userId, status: "OPEN" },
  });
}

/** H3 — 2dp money rounding (ROUND_HALF_UP-equivalent on non-negative totals). */
function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/** Half-cent tolerance for Decimal comparisons. */
const MONEY_EPSILON = 0.005;

/**
 * H4.5-B2 — COLLECTED payment statuses. Refund eligibility (both at request
 * and at approval) must only ever count money actually collected, using the
 * SAME basis as revenue reporting. PENDING / FAILED / EXPIRED / CANCELLED /
 * UNPAID payments are never refundable.
 */
const COLLECTED_PAYMENT_STATUSES = ["PAID", "REFUNDED"] as const;

/** H3.2 — a client may request quantities only; prices come from the DB. */
export interface RefundItemAllocationInput {
  orderItemId: string;
  quantity: number;
}

interface ResolvedAllocation {
  orderItemId: string;
  quantity: number;
  amount: number;
}

// ============================================================
// Approval service — refunds & cancellations
// ============================================================

export class ApprovalService {
  // ----------------------------------------------------------
  // REFUNDS
  // ----------------------------------------------------------

  /**
   * Cashier initiates a refund request for a paid order. Approval (with the
   * admin's password) happens in decideRefund. Rules:
   * - Order must exist, belong to the restaurant, and NOT be cancelled.
   * - The order must have at least one PAID payment.
   * - amount > 0 and <= the paid total (no over-refund).
   * - Only one PENDING refund per order at a time.
   * - When the cashier has an open shift the refund is drawer-linked
   *   (counted against expected cash at shift close).
   */
  async requestRefund(input: {
    restaurantId: string;
    userId: string;
    orderId: string;
    amount: number;
    reason: string;
    // H3.2 — optional quantity-based allocation. When present, the refund
    // amount is derived SERVER-SIDE from the order items (the client may only
    // ask for quantities); every allocation is validated against the item.
    items?: RefundItemAllocationInput[];
    // Server-validated branch scope; when set the order must belong to it.
    branchFilters?: string[] | null;
  }) {
    if (!input.reason || input.reason.trim().length < 5) {
      throw new ValidationError("Alasan refund minimal 5 karakter");
    }

    const order = await prisma.order.findFirst({
      where: { id: input.orderId, restaurantId: input.restaurantId },
      include: {
        // H3.0 — REFUNDED payments are included too: a refunded payment still
        // represents money that was collected (and may be partially refunded).
        // H4.5-B2 — collected-only basis (never PENDING/FAILED/EXPIRED/etc.).
        payments: { where: { status: { in: [...COLLECTED_PAYMENT_STATUSES] } } },
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPrice: true,
            totalPrice: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundError("Order tidak ditemukan");
    }
    // Branch guard: a branch-scoped cashier can only refund orders of their
    // own branches (a headerless scoped request is never widened).
    if (
      input.branchFilters?.length &&
      !input.branchFilters.includes(order.branchId ?? "")
    ) {
      throw new NotFoundError("Order tidak ditemukan");
    }
    if (order.status === "CANCELLED") {
      throw new ConflictError("Order sudah dibatalkan — tidak bisa refund");
    }
    if (order.payments.length === 0) {
      throw new ConflictError("Belum ada pembayaran lunas untuk order ini");
    }

    // H3.0 — refundable = total collected (PAID + REFUNDED payments) minus
    // every already-APPROVED refund. Never derived from one payment alone, and
    // never from the original payment amount only (that allowed over-refund).
    const totalPaid = round2(
      order.payments.reduce((sum, p) => sum + Number(p.amount), 0)
    );
    const approvedAgg = await prisma.refund.aggregate({
      where: { orderId: order.id, status: "APPROVED" },
      _sum: { amount: true },
    });
    const alreadyRefunded = round2(Number(approvedAgg._sum.amount ?? 0));
    const refundableAmount = round2(totalPaid - alreadyRefunded);
    if (refundableAmount <= MONEY_EPSILON) {
      throw new ConflictError("Order ini sudah direfund penuh");
    }

    // Only a KASIR (cash) payment can be refunded in cash from a drawer; an
    // online payment (QRIS/VA) refund stays admin-approved without a drawer.
    const cashPayment = order.payments.find((p) => p.method === "KASIR");

    // H3.2 — quantity-based allocation (validated + priced server-side).
    const allocations = await this.resolveRefundAllocations(
      order,
      input.items
    );

    let refundAmount: number;
    if (allocations) {
      refundAmount = allocations.totalAmount;
      if (refundAmount <= MONEY_EPSILON) {
        throw new ValidationError("Total refund tidak valid");
      }
      if (refundAmount > refundableAmount + MONEY_EPSILON) {
        throw new ConflictError(
          `Jumlah refund melebihi sisa yang dapat direfund (Rp${refundableAmount.toLocaleString("id-ID")})`
        );
      }
    } else {
      if (!Number.isFinite(input.amount) || input.amount <= 0) {
        throw new ValidationError("Jumlah refund harus lebih dari 0");
      }
      if (input.amount > refundableAmount + MONEY_EPSILON) {
        throw new ConflictError(
          `Jumlah refund melebihi sisa yang dapat direfund (Rp${refundableAmount.toLocaleString("id-ID")})`
        );
      }
      refundAmount = round2(input.amount);
    }

    // The refund is drawer-linked to the shift that COLLECTED the cash
    // payment (payment.shiftId) so the drawer math reconciles correctly at
    // shift close. Falls back to the requester's open shift when the
    // collected payment has no shift recorded yet (legacy admin entries).
    let refundShiftId: string | null = null;
    if (cashPayment) {
      refundShiftId = cashPayment.shiftId ?? null;
      if (!refundShiftId) {
        const openShift = await openShiftOf(input.restaurantId, input.userId);
        refundShiftId = openShift?.id ?? null;
      }
    }

    // H2 (G8) / H3.0 — the "one PENDING refund per order" check and the insert
    // are atomic under a per-order row lock, so two concurrent requests can
    // never both create a PENDING refund (which would also bypass the
    // cumulative over-refund guard).
    const refund = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`order\` WHERE id = ${order.id} FOR UPDATE`;
      const pending = await tx.refund.findFirst({
        where: { orderId: order.id, status: "PENDING" },
      });
      if (pending) {
        throw new ConflictError(
          "Refund untuk order ini masih menunggu persetujuan"
        );
      }
      return tx.refund.create({
        data: {
          restaurantId: input.restaurantId,
          // The refund belongs to the ORDER's branch (same principle as
          // payments following their order).
          branchId: order.branchId,
          orderId: order.id,
          paymentId: cashPayment?.id || null,
          shiftId: refundShiftId,
          amount: refundAmount,
          reason: input.reason,
          status: "PENDING",
          requestedByCashierId: input.userId,
          ...(allocations
            ? {
                items: {
                  create: allocations.items.map((i) => ({
                    orderItemId: i.orderItemId,
                    quantity: i.quantity,
                    amount: i.amount,
                  })),
                },
              }
            : {}),
        },
        include: {
          order: { select: { orderNumber: true } },
          requester: { select: { id: true, name: true } },
        },
      });
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.REFUND_REQUESTED,
      refund.id,
      {
        refundId: refund.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: input.amount,
        requestedBy: input.userId,
        reason: input.reason,
      }
    );
    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);

    await auditService.log({
      restaurantId: input.restaurantId,
      branchId: order.branchId,
      userId: input.userId,
      action: "REFUND_REQUESTED",
      entityType: "Refund",
      entityId: refund.id,
      details: {
        orderNumber: order.orderNumber,
        amount: refundAmount,
        reason: input.reason,
        shiftId: refund.shiftId,
        itemAllocations: allocations?.items.length ?? 0,
      },
    });

    return refund;
  }

  /**
   * H3.2 — validate + price a quantity-based refund allocation. The client
   * may only request quantities; every price comes from the database
   * (effective unit price = OrderItem.totalPrice / OrderItem.quantity, so any
   * line discount is respected). Returns null for a legacy amount-only refund.
   */
  private async resolveRefundAllocations(
    order: {
      id: string;
      items: Array<{
        id: string;
        quantity: number;
        totalPrice: unknown;
      }>;
    },
    input: RefundItemAllocationInput[] | undefined
  ): Promise<{ items: ResolvedAllocation[]; totalAmount: number } | null> {
    if (!input || input.length === 0) return null;

    const itemMap = new Map(order.items.map((i) => [i.id, i]));
    const seen = new Set<string>();
    for (const raw of input) {
      if (!raw || typeof raw.orderItemId !== "string") {
        throw new ValidationError("orderItemId tidak valid");
      }
      if (seen.has(raw.orderItemId)) {
        throw new ValidationError("Item refund duplikat");
      }
      seen.add(raw.orderItemId);
      const item = itemMap.get(raw.orderItemId);
      // Ownership: the item must belong to THIS order (never trust the client).
      if (!item) {
        throw new ValidationError("Item tidak ditemukan pada order ini");
      }
      if (!Number.isInteger(raw.quantity) || raw.quantity <= 0) {
        throw new ValidationError("Jumlah item refund harus bilangan bulat > 0");
      }
      if (raw.quantity > item.quantity) {
        throw new ValidationError("Jumlah item refund melebihi jumlah dibeli");
      }
    }

    // Remaining per-item quantity = purchased − already-APPROVED allocations.
    const approvedAlloc = await prisma.refundItem.groupBy({
      by: ["orderItemId"],
      where: {
        orderItemId: { in: input.map((i) => i.orderItemId) },
        refund: { status: "APPROVED" },
      },
      _sum: { quantity: true },
    });
    const allocatedMap = new Map(
      approvedAlloc.map((r) => [r.orderItemId, Number(r._sum.quantity ?? 0)])
    );

    const resolved: ResolvedAllocation[] = [];
    let totalAmount = 0;
    for (const raw of input) {
      const item = itemMap.get(raw.orderItemId)!;
      const already = allocatedMap.get(raw.orderItemId) ?? 0;
      if (raw.quantity > item.quantity - already) {
        throw new ConflictError(
          "Jumlah item refund melebihi sisa yang dapat direfund"
        );
      }
      const unit =
        item.quantity > 0 ? Number(item.totalPrice) / item.quantity : 0;
      const lineAmount = round2(unit * raw.quantity);
      totalAmount = round2(totalAmount + lineAmount);
      resolved.push({
        orderItemId: raw.orderItemId,
        quantity: raw.quantity,
        amount: lineAmount,
      });
    }
    return { items: resolved, totalAmount };
  }

  /**
   * Admin approves/rejects a refund request. The route verifies the admin
   * password first. On approval:
   * - Refund row → APPROVED (approvedAt set).
   * - Payment (KASIR cash collected) is voided/refunded.
   * - The order payment status reflects the remaining balance.
   */
  async decideRefund(input: {
    restaurantId: string;
    adminId: string;
    refundId: string;
    approve: boolean;
    decisionNote?: string;
    branchFilters?: string[] | null;
  }) {
    const refund = await prisma.refund.findFirst({
      where: {
        id: input.refundId,
        restaurantId: input.restaurantId,
        status: "PENDING",
        ...(input.branchFilters?.length
          ? { branchId: { in: input.branchFilters } }
          : {}),
      },
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
        payment: true,
        items: { select: { id: true, orderItemId: true, quantity: true } },
      },
    });
    if (!refund) {
      throw new NotFoundError("Permintaan refund tidak ditemukan");
    }

    const decided = await prisma.$transaction(async (tx) => {
      const status: RequestStatus = input.approve ? "APPROVED" : "REJECTED";
      // H2 (G8) — GUARDED transition: only ONE request may move this refund
      // PENDING → APPROVED/REJECTED. The refund row was read as PENDING above
      // (outside the tx), so a concurrent approval / double-click would
      // otherwise both pass and double-apply the side effects below; the
      // conditional updateMany loses the race and throws instead.
      const transitioned = await tx.refund.updateMany({
        where: { id: refund.id, status: "PENDING" },
        data: {
          status,
          decisionNote: input.decisionNote || null,
          approvedByAdminId: input.approve ? input.adminId : null,
          rejectedByAdminId: input.approve ? null : input.adminId,
          decidedAt: new Date(),
          approvedAt: input.approve ? new Date() : null,
        },
      });
      if (transitioned.count === 0) {
        throw new ConflictError("Permintaan refund sudah diproses");
      }

      if (input.approve) {
        const amount = round2(Number(refund.amount));

        // H3.3 — freeze each allocation's reversed COGS from the immutable
        // OrderItemCostSnapshot (hppUnit × quantity). The snapshot is NEVER
        // mutated; NULL marks an item whose cost is not covered (never 0).
        if (refund.items.length > 0) {
          const orderItems = await tx.orderItem.findMany({
            where: { id: { in: refund.items.map((i) => i.orderItemId) } },
            select: {
              id: true,
              costSnapshot: { select: { status: true, hppUnit: true } },
            },
          });
          const snapMap = new Map(
            orderItems.map((oi) => [oi.id, oi.costSnapshot])
          );
          for (const item of refund.items) {
            const snap = snapMap.get(item.orderItemId);
            const reversedCogs =
              snap && snap.status === "SNAPSHOTTED" && snap.hppUnit != null
                ? round2(Number(snap.hppUnit) * item.quantity)
                : null;
            await tx.refundItem.update({
              where: { id: item.id },
              data: { reversedCogs },
            });
          }
        }

        // H3.0 — aggregate financial state across ALL payments (never one
        // KASIR payment). A REFUNDED payment still counts as collected, so a
        // QRIS/VA refund no longer flips the whole order to UNPAID.
        const orderPayments = await tx.payment.findMany({
          where: {
            orderId: refund.orderId,
            status: { in: [...COLLECTED_PAYMENT_STATUSES] },
          },
          select: { id: true, amount: true, status: true, method: true },
        });
        const totalPaid = round2(
          orderPayments.reduce((sum, p) => sum + Number(p.amount), 0)
        );
        const approvedAgg = await tx.refund.aggregate({
          where: { orderId: refund.orderId, status: "APPROVED" },
          _sum: { amount: true },
        });
        const cumulativeRefunded = round2(Number(approvedAgg._sum.amount ?? 0));
        const netPaid = round2(totalPaid - cumulativeRefunded);

        // Immutable refund ledger — exactly one row per successful approval
        // (the guarded transition above guarantees a single winner).
        const targetPayment =
          refund.payment ??
          orderPayments.find((p) => p.status === "PAID") ??
          orderPayments[0] ??
          null;
        if (targetPayment && amount > 0) {
          await tx.paymentTransaction.create({
            data: {
              paymentId: targetPayment.id,
              provider: targetPayment.method === "KASIR" ? "cashier" : "refund",
              type: "refund",
              status: "REFUNDED",
              amount: -amount,
              rawData: {
                refundId: refund.id,
                reason: refund.reason,
                approvedBy: input.adminId,
                approvedAt: new Date().toISOString(),
              },
            },
          });
        }

        // Fully refunded → collected payments are marked REFUNDED (history
        // preserved, never deleted). Partially refunded → they stay PAID.
        if (netPaid <= MONEY_EPSILON) {
          await tx.payment.updateMany({
            where: { orderId: refund.orderId, status: "PAID" },
            data: { status: "REFUNDED" },
          });
        }

        // The order reflects the NET collected balance. A fully refunded
        // COMPLETED order becomes UNPAID but REMAINS representable in
        // profitability (its frozen COGS is retained, never zeroed).
        await tx.order.update({
          where: { id: refund.orderId },
          data: { paymentStatus: netPaid > MONEY_EPSILON ? "PAID" : "UNPAID" },
        });
      }

      const updated = await tx.refund.findUnique({ where: { id: refund.id } });
      if (!updated) {
        throw new NotFoundError("Permintaan refund tidak ditemukan");
      }
      return updated;
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.REFUND_DECIDED,
      refund.id,
      {
        refundId: refund.id,
        orderId: refund.orderId,
        orderNumber: refund.order?.orderNumber,
        status: decided.status,
        decidedBy: input.adminId,
      }
    );
    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.DASHBOARD_UPDATED,
      refund.orderId
    );

    await auditService.log({
      restaurantId: input.restaurantId,
      branchId: refund.branchId,
      userId: input.adminId,
      action: input.approve ? "REFUND_APPROVED" : "REFUND_DENIED",
      entityType: "Refund",
      entityId: refund.id,
      details: {
        orderNumber: refund.order?.orderNumber,
        amount: Number(refund.amount),
        reason: refund.reason,
        decisionNote: input.decisionNote || null,
      },
    });

    return decided;
  }

  // ----------------------------------------------------------
  // CANCELLATIONS
  // ----------------------------------------------------------

  /**
   * Cashier requests to cancel an order (admin password approval follows).
   */
  async requestCancellation(input: {
    restaurantId: string;
    userId: string;
    orderId: string;
    reason: string;
    branchFilters?: string[] | null;
  }) {
    if (!input.reason || input.reason.trim().length < 5) {
      throw new ValidationError("Alasan pembatalan minimal 5 karakter");
    }
    const order = await prisma.order.findFirst({
      where: { id: input.orderId, restaurantId: input.restaurantId },
    });
    if (!order) {
      throw new NotFoundError("Order tidak ditemukan");
    }
    // Branch guard: a branch-scoped cashier can only cancel orders of their
    // own branches (a headerless scoped request is never widened).
    if (
      input.branchFilters?.length &&
      !input.branchFilters.includes(order.branchId ?? "")
    ) {
      throw new NotFoundError("Order tidak ditemukan");
    }
    if (["COMPLETED", "CANCELLED"].includes(order.status)) {
      throw new ConflictError(
        order.status === "COMPLETED"
          ? "Order sudah selesai — tidak bisa dibatalkan"
          : "Order sudah dibatalkan"
      );
    }
    // H2 (G8) — atomic "one PENDING cancellation per order" check + insert
    // under a per-order row lock (same pattern as requestRefund).
    const request = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM \`order\` WHERE id = ${order.id} FOR UPDATE`;
      const pending = await tx.cancellationRequest.findFirst({
        where: { orderId: order.id, status: "PENDING" },
      });
      if (pending) {
        throw new ConflictError(
          "Permintaan pembatalan masih menunggu persetujuan"
        );
      }
      return tx.cancellationRequest.create({
        data: {
          restaurantId: input.restaurantId,
          branchId: order.branchId,
          orderId: order.id,
          reason: input.reason,
          status: "PENDING",
          requestedByCashierId: input.userId,
        },
        include: {
          order: { select: { orderNumber: true } },
          requester: { select: { id: true, name: true } },
        },
      });
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.CANCELLATION_REQUESTED,
      request.id,
      {
        requestId: request.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        requestedBy: input.userId,
        reason: input.reason,
      }
    );
    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);

    await auditService.log({
      restaurantId: input.restaurantId,
      branchId: order.branchId,
      userId: input.userId,
      action: "CANCELLATION_REQUESTED",
      entityType: "CancellationRequest",
      entityId: request.id,
      details: { orderNumber: order.orderNumber, reason: input.reason },
    });

    return request;
  }

  /**
   * Admin approves/rejects a cancellation request (password verified by the
   * route). Approval sets the order status to CANCELLED + status history,
   * frees the table, and voids any live (UNPAID/PENDING) payments.
   */
  async decideCancellation(input: {
    restaurantId: string;
    adminId: string;
    requestId: string;
    approve: boolean;
    decisionNote?: string;
    branchFilters?: string[] | null;
  }) {
    const request = await prisma.cancellationRequest.findFirst({
      where: {
        id: input.requestId,
        restaurantId: input.restaurantId,
        status: "PENDING",
        ...(input.branchFilters?.length
          ? { branchId: { in: input.branchFilters } }
          : {}),
      },
      include: {
        order: {
          include: {
            payments: true,
            restaurant: { select: { name: true } },
            customer: { select: { name: true, phone: true } },
          },
        },
      },
    });
    if (!request) {
      throw new NotFoundError("Permintaan pembatalan tidak ditemukan");
    }
    const order = request.order;
    if (["COMPLETED", "CANCELLED"].includes(order.status)) {
      throw new ConflictError("Order sudah berada di status akhir");
    }

    const decided = await prisma.$transaction(async (tx) => {
      const status: RequestStatus = input.approve ? "APPROVED" : "REJECTED";
      // H2 (G8) — GUARDED transition: only ONE request may decide a PENDING
      // cancellation request (concurrent approvals / double-click).
      const transitioned = await tx.cancellationRequest.updateMany({
        where: { id: request.id, status: "PENDING" },
        data: {
          status,
          decisionNote: input.decisionNote || null,
          approvedByAdminId: input.approve ? input.adminId : null,
          rejectedByAdminId: input.approve ? null : input.adminId,
          decidedAt: new Date(),
          approvedAt: input.approve ? new Date() : null,
        },
      });
      if (transitioned.count === 0) {
        throw new ConflictError("Permintaan pembatalan sudah diproses");
      }

      if (input.approve) {
        // H3.7 — a PAID order can NOT be cancelled while it still holds
        // collected money. The payment must be resolved/refunded first; we
        // never silently turn PAID → CANCELLED (which would drop the revenue
        // with no financial event) and never auto-create a refund here.
        const orderPayments = await tx.payment.findMany({
          where: {
            orderId: order.id,
            status: { in: [...COLLECTED_PAYMENT_STATUSES] },
          },
          select: { amount: true },
        });
        const totalPaid = round2(
          orderPayments.reduce((sum, p) => sum + Number(p.amount), 0)
        );
        const approvedAgg = await tx.refund.aggregate({
          where: { orderId: order.id, status: "APPROVED" },
          _sum: { amount: true },
        });
        const netPaid = round2(
          totalPaid - Number(approvedAgg._sum.amount ?? 0)
        );
        if (netPaid > MONEY_EPSILON) {
          throw new ConflictError(
            "Order sudah dibayar — selesaikan refund terlebih dahulu sebelum membatalkan"
          );
        }

        // GUARDED order transition: never overwrite a concurrent COMPLETED /
        // CANCELLED terminal state with this cancellation.
        const orderUpdated = await tx.order.updateMany({
          where: { id: order.id, status: { notIn: ["COMPLETED", "CANCELLED"] } },
          data: { status: "CANCELLED" },
        });
        if (orderUpdated.count === 0) {
          throw new ConflictError(
            "Status order sudah berubah — pembatalan tidak dapat diterapkan"
          );
        }
        await tx.orderStatusHistory.create({
          data: {
            orderId: order.id,
            status: "CANCELLED",
            notes: `Dibatalkan — ${input.decisionNote || request.reason}`,
            changedBy: input.adminId,
          },
        });

        // Free the table.
        if (order.tableId) {
          await tx.table.update({
            where: { id: order.tableId },
            data: { status: "AVAILABLE" },
          });
        }

        // Void live intents (never delete — history preserved).
        await tx.payment.updateMany({
          where: { orderId: order.id, status: { in: ["UNPAID", "PENDING"] } },
          data: { status: "FAILED" },
        });
      }

      const updated = await tx.cancellationRequest.findUnique({
        where: { id: request.id },
      });
      if (!updated) {
        throw new NotFoundError("Permintaan pembatalan tidak ditemukan");
      }
      return updated;
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.CANCELLATION_DECIDED,
      request.id,
      {
        requestId: request.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        status: decided.status,
        decidedBy: input.adminId,
      }
    );
    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.ORDER_STATUS_CHANGED,
      `${order.id}-CANCELLED`,
      {
        orderId: order.id,
        orderNumber: order.orderNumber,
        fromStatus: order.status,
        toStatus: "CANCELLED",
      }
    );
    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);
    if (order.tableId) {
      emitRealtime(
        input.restaurantId,
        REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
        `${order.tableId}-AVAILABLE`,
        { tableId: order.tableId, status: "AVAILABLE" }
      );
    }

    await auditService.log({
      restaurantId: input.restaurantId,
      branchId: request.branchId,
      userId: input.adminId,
      action: input.approve ? "ORDER_CANCELLED" : "CANCELLATION_REJECTED",
      entityType: "CancellationRequest",
      entityId: request.id,
      details: {
        orderNumber: order.orderNumber,
        reason: request.reason,
        decisionNote: input.decisionNote || null,
      },
    });

    return decided;
  }

  // ----------------------------------------------------------
  // Lists (used by UI)
  // ----------------------------------------------------------

  async listPendingForRestaurant(restaurantId: string, branchFilters?: string[] | null) {
    const branchWhere =
      branchFilters?.length ? { branchId: { in: branchFilters } } : {};
    const [refunds, cancellations, overrides] = await Promise.all([
      prisma.refund.findMany({
        where: { ...branchWhere, restaurantId, status: "PENDING" },
        include: {
          order: { select: { id: true, orderNumber: true } },
          requester: { select: { id: true, name: true } },
        },
        orderBy: { requestedAt: "desc" },
      }),
      prisma.cancellationRequest.findMany({
        where: { ...branchWhere, restaurantId, status: "PENDING" },
        include: {
          order: { select: { id: true, orderNumber: true } },
          requester: { select: { id: true, name: true } },
        },
        orderBy: { requestedAt: "desc" },
      }),
      prisma.shiftOverride.findMany({
        where: {
          restaurantId,
          status: "PENDING",
          ...branchWhere,
        },
        include: {
          shift: { select: { id: true, shiftNumber: true } },
          requester: { select: { id: true, name: true } },
        },
        orderBy: { requestedAt: "desc" },
      }),
    ]);
    return { refunds, cancellations, overrides };
  }
}

export const approvalService = new ApprovalService();
