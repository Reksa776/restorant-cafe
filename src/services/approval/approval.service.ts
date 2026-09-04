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
  }) {
    if (!Number.isFinite(input.amount) || input.amount <= 0) {
      throw new ValidationError("Jumlah refund harus lebih dari 0");
    }
    if (!input.reason || input.reason.trim().length < 5) {
      throw new ValidationError("Alasan refund minimal 5 karakter");
    }

    const order = await prisma.order.findFirst({
      where: { id: input.orderId, restaurantId: input.restaurantId },
      include: {
        payments: { where: { status: "PAID" } },
      },
    });
    if (!order) {
      throw new NotFoundError("Order tidak ditemukan");
    }
    if (order.status === "CANCELLED") {
      throw new ConflictError("Order sudah dibatalkan — tidak bisa refund");
    }
    if (order.payments.length === 0) {
      throw new ConflictError("Belum ada pembayaran lunas untuk order ini");
    }

    // Only a KASIR (cash) payment can be refunded in cash from a drawer; an
    // online payment (QRIS/VA) refund stays admin-approved without a drawer.
    const cashPayment = order.payments.find((p) => p.method === "KASIR");
    const paidTotal = order.payments.reduce(
      (sum, p) => sum + Number(p.amount),
      0
    );
    if (input.amount > paidTotal) {
      throw new ValidationError(
        `Jumlah refund melebihi total pembayaran (Rp${paidTotal.toLocaleString("id-ID")})`
      );
    }

    const pending = await prisma.refund.findFirst({
      where: { orderId: order.id, status: "PENDING" },
    });
    if (pending) {
      throw new ConflictError("Refund untuk order ini masih menunggu persetujuan");
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

    const refund = await prisma.refund.create({
      data: {
        restaurantId: input.restaurantId,
        orderId: order.id,
        paymentId: cashPayment?.id || null,
        shiftId: refundShiftId,
        amount: input.amount,
        reason: input.reason,
        status: "PENDING",
        requestedByCashierId: input.userId,
      },
      include: {
        order: { select: { orderNumber: true } },
        requester: { select: { id: true, name: true } },
      },
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
      userId: input.userId,
      action: "REFUND_REQUESTED",
      entityType: "Refund",
      entityId: refund.id,
      details: {
        orderNumber: order.orderNumber,
        amount: input.amount,
        reason: input.reason,
        shiftId: refund.shiftId,
      },
    });

    return refund;
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
  }) {
    const refund = await prisma.refund.findFirst({
      where: {
        id: input.refundId,
        restaurantId: input.restaurantId,
        status: "PENDING",
      },
      include: {
        order: { select: { id: true, orderNumber: true, status: true } },
        payment: true,
      },
    });
    if (!refund) {
      throw new NotFoundError("Permintaan refund tidak ditemukan");
    }

    const decided = await prisma.$transaction(async (tx) => {
      const status: RequestStatus = input.approve ? "APPROVED" : "REJECTED";
      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: {
          status,
          decisionNote: input.decisionNote || null,
          approvedByAdminId: input.approve ? input.adminId : null,
          rejectedByAdminId: input.approve ? null : input.adminId,
          decidedAt: new Date(),
          approvedAt: input.approve ? new Date() : null,
        },
      });

      if (input.approve) {
        const payment = refund.payment;
        const amount = Number(refund.amount);
        const paid = payment ? Number(payment.amount) : 0;

        // Mark the collected cash payment refunded (never delete the row —
        // history is preserved).
        if (payment) {
          await tx.payment.update({
            where: { id: payment.id },
            data: { status: amount >= paid ? "REFUNDED" : "PAID" },
          });
          await tx.paymentTransaction.create({
            data: {
              paymentId: payment.id,
              provider: "cashier",
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

        // The order is no longer fully paid once its cash payment was fully
        // refunded (or its payment status mirrors the refund).
        const remainingPaid = amount >= paid ? 0 : paid - amount;
        await tx.order.update({
          where: { id: refund.orderId },
          data: {
            paymentStatus: remainingPaid > 0 ? "PAID" : "UNPAID",
          },
        });
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
    if (["COMPLETED", "CANCELLED"].includes(order.status)) {
      throw new ConflictError(
        order.status === "COMPLETED"
          ? "Order sudah selesai — tidak bisa dibatalkan"
          : "Order sudah dibatalkan"
      );
    }
    const pending = await prisma.cancellationRequest.findFirst({
      where: { orderId: order.id, status: "PENDING" },
    });
    if (pending) {
      throw new ConflictError("Permintaan pembatalan masih menunggu persetujuan");
    }

    const request = await prisma.cancellationRequest.create({
      data: {
        restaurantId: input.restaurantId,
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
  }) {
    const request = await prisma.cancellationRequest.findFirst({
      where: {
        id: input.requestId,
        restaurantId: input.restaurantId,
        status: "PENDING",
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
      const updated = await tx.cancellationRequest.update({
        where: { id: request.id },
        data: {
          status,
          decisionNote: input.decisionNote || null,
          approvedByAdminId: input.approve ? input.adminId : null,
          rejectedByAdminId: input.approve ? null : input.adminId,
          decidedAt: new Date(),
          approvedAt: input.approve ? new Date() : null,
        },
      });

      if (input.approve) {
        await tx.order.update({
          where: { id: order.id },
          data: { status: "CANCELLED" },
        });
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

  async listPendingForRestaurant(restaurantId: string) {
    const [refunds, cancellations, overrides] = await Promise.all([
      prisma.refund.findMany({
        where: { restaurantId, status: "PENDING" },
        include: {
          order: { select: { id: true, orderNumber: true } },
          requester: { select: { id: true, name: true } },
        },
        orderBy: { requestedAt: "desc" },
      }),
      prisma.cancellationRequest.findMany({
        where: { restaurantId, status: "PENDING" },
        include: {
          order: { select: { id: true, orderNumber: true } },
          requester: { select: { id: true, name: true } },
        },
        orderBy: { requestedAt: "desc" },
      }),
      prisma.shiftOverride.findMany({
        where: { restaurantId, status: "PENDING" },
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
