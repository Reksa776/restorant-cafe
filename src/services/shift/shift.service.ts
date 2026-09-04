import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { auditService } from "@/services/audit/audit.service";

// ============================================================
// Shift number: SH-YYYYMMDD-NNN (restaurant-wide sequence)
// ============================================================
async function nextShiftNumber(restaurantId: string): Promise<string> {
  const now = new Date();
  const dateStr = now.toISOString().split("T")[0].replace(/-/g, "");
  const prefix = `SH-${dateStr}`;

  const last = await prisma.cashierShift.findFirst({
    where: {
      restaurantId,
      shiftNumber: { startsWith: prefix },
    },
    orderBy: { shiftNumber: "desc" },
    select: { shiftNumber: true },
  });

  const lastSeq = last ? parseInt(last.shiftNumber.split("-").pop() || "0", 10) : 0;
  const seq = (Number.isFinite(lastSeq) ? lastSeq : 0) + 1;
  return `${prefix}-${String(seq).padStart(3, "0")}`;
}

// ============================================================
// Shift money math
// ============================================================

/**
 * Expected cash at close = openingCash + cash collected (PAID KASIR payments
 * in this shift) − cash refunded in this shift.
 */
async function computeShiftTotals(shiftId: string, restaurantId: string) {
  const shift = await prisma.cashierShift.findUnique({
    where: { id: shiftId },
  });
  if (!shift || shift.restaurantId !== restaurantId) {
    throw new NotFoundError("Shift tidak ditemukan");
  }

  const [cashSalesAgg, refundsAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: {
        shiftId: shift.id,
        restaurantId,
        method: "KASIR",
        status: "PAID",
      },
      _sum: { amount: true },
    }),
    prisma.refund.aggregate({
      where: {
        shiftId: shift.id,
        restaurantId,
        status: "APPROVED",
      },
      _sum: { amount: true },
    }),
  ]);

  const openingCash = Number(shift.openingCash) || 0;
  const cashSales = Number(cashSalesAgg._sum.amount) || 0;
  const refunds = Number(refundsAgg._sum.amount) || 0;
  const expectedCash = Math.round((openingCash + cashSales - refunds) * 100) / 100;

  return { openingCash, cashSales, refunds, expectedCash };
}

export class ShiftService {
  /**
   * Open a cash drawer shift for the authenticated cashier.
   * Rules:
   * - One OPEN shift per cashier (and per user) at a time.
   * - openingCash >= 0 and required.
   */
  async openShift(input: {
    restaurantId: string;
    userId: string;
    openingCash: number;
    notes?: string;
  }) {
    if (
      !Number.isFinite(input.openingCash) ||
      input.openingCash < 0
    ) {
      throw new ValidationError("Jumlah kas awal tidak valid");
    }

    const existing = await prisma.cashierShift.findFirst({
      where: {
        restaurantId: input.restaurantId,
        userId: input.userId,
        status: "OPEN",
      },
    });
    if (existing) {
      throw new ConflictError(
        "Shift sudah dibuka — tutup shift aktif sebelum membuka shift baru"
      );
    }

    const shiftNumber = await nextShiftNumber(input.restaurantId);
    const shift = await prisma.cashierShift.create({
      data: {
        restaurantId: input.restaurantId,
        userId: input.userId,
        shiftNumber,
        openingCash: input.openingCash,
        notes: input.notes || null,
        status: "OPEN",
        openedAt: new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.SHIFT_OPENED,
      shift.id,
      {
        shiftId: shift.id,
        shiftNumber: shift.shiftNumber,
        userId: input.userId,
        openingCash: Number(shift.openingCash),
      }
    );
    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, shift.id);

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.userId,
      action: "SHIFT_OPENED",
      entityType: "CashierShift",
      entityId: shift.id,
      details: { shiftNumber: shift.shiftNumber, openingCash: Number(shift.openingCash) },
    });

    return shift;
  }

  /**
   * Close the caller's OPEN shift.
   * Cashier supplies actualCash (physical drawer count); the server computes
   * expectedCash and difference = actualCash − expectedCash.
   */
  async closeShift(input: {
    restaurantId: string;
    userId: string;
    actualCash: number;
    notes?: string;
  }) {
    if (!Number.isFinite(input.actualCash) || input.actualCash < 0) {
      throw new ValidationError("Jumlah kas aktual tidak valid");
    }

    const shift = await prisma.cashierShift.findFirst({
      where: {
        restaurantId: input.restaurantId,
        userId: input.userId,
        status: "OPEN",
      },
    });
    if (!shift) {
      throw new NotFoundError("Tidak ada shift aktif untuk ditutup");
    }

    const { openingCash, cashSales, refunds, expectedCash } =
      await computeShiftTotals(shift.id, input.restaurantId);

    const difference = Math.round((input.actualCash - expectedCash) * 100) / 100;

    const closed = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: "CLOSED",
        closingCash: input.actualCash,
        expectedCash,
        difference,
        notes: input.notes || shift.notes,
        closedAt: new Date(),
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        payments: {
          where: { status: "PAID", method: "KASIR" },
          select: { id: true, amount: true },
        },
      },
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.SHIFT_CLOSED,
      shift.id,
      {
        shiftId: shift.id,
        shiftNumber: shift.shiftNumber,
        userId: input.userId,
        expectedCash,
        closingCash: input.actualCash,
        difference,
      }
    );
    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, shift.id);

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.userId,
      action: "SHIFT_CLOSED",
      entityType: "CashierShift",
      entityId: shift.id,
      details: {
        shiftNumber: shift.shiftNumber,
        openingCash,
        cashSales,
        refunds,
        expectedCash,
        closingCash: input.actualCash,
        difference,
      },
    });

    return { shift: closed, expectedCash, cashSales, refunds, difference };
  }

  /**
   * Get the caller's open shift (or null).
   */
  async getMyOpenShift(restaurantId: string, userId: string) {
    return prisma.cashierShift.findFirst({
      where: { restaurantId, userId, status: "OPEN" },
      include: {
        user: { select: { id: true, name: true, email: true } },
        payments: {
          where: { status: "PAID", method: "KASIR" },
          select: { id: true, amount: true, paidAt: true },
        },
      },
    });
  }

  /**
   * My shifts — a cashier may only ever read their OWN shifts
   * (server-side scoping; never trust the client).
   */
  async listMyShifts(restaurantId: string, userId: string) {
    const shifts = await prisma.cashierShift.findMany({
      where: { restaurantId, userId },
      include: {
        user: { select: { id: true, name: true } },
        _count: {
          select: { payments: { where: { status: "PAID", method: "KASIR" } } },
        },
      },
      orderBy: { openedAt: "desc" },
      take: 100,
    });
    return { items: shifts };
  }

  /**
   * All shifts across cashiers (admin only).
   */
  async listAllShifts(restaurantId: string) {
    const shifts = await prisma.cashierShift.findMany({
      where: { restaurantId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        overrides: { orderBy: { createdAt: "desc" } },
        _count: {
          select: { payments: { where: { status: "PAID", method: "KASIR" } } },
        },
      },
      orderBy: { openedAt: "desc" },
      take: 200,
    });
    return { items: shifts };
  }

  /** Shift detail with payments and refunds (admin all; cashier own only). */
  async getShift(shiftId: string, restaurantId: string, userId?: string, isAdmin?: boolean) {
    const shift = await prisma.cashierShift.findFirst({
      where: isAdmin
        ? { id: shiftId, restaurantId }
        : { id: shiftId, restaurantId, userId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        payments: {
          where: { status: "PAID", method: "KASIR" },
          orderBy: { paidAt: "asc" },
          include: { order: { select: { orderNumber: true } } },
        },
        overrides: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!shift) {
      throw new NotFoundError("Shift tidak ditemukan");
    }
    const totals = await computeShiftTotals(shift.id, restaurantId);
    return { shift, totals };
  }

  /**
   * Cashier requests an admin override on a CLOSED shift (e.g. wrong cash
   * count). The shift stays immutable until an admin approves with password.
   */
  async requestOverride(input: {
    restaurantId: string;
    userId: string;
    shiftId: string;
    reason: string;
    proposedClosingCash?: number;
  }) {
    if (!input.reason || input.reason.trim().length < 5) {
      throw new ValidationError("Alasan override minimal 5 karakter");
    }
    const shift = await prisma.cashierShift.findFirst({
      where: {
        id: input.shiftId,
        restaurantId: input.restaurantId,
        userId: input.userId, // cashier: own shift only
        status: "CLOSED",
      },
    });
    if (!shift) {
      throw new NotFoundError(
        "Shift tidak ditemukan atau belum ditutup (hanya shift milik sendiri)"
      );
    }

    const existing = await prisma.shiftOverride.findFirst({
      where: {
        shiftId: shift.id,
        status: "PENDING",
      },
    });
    if (existing) {
      throw new ConflictError("Override untuk shift ini masih menunggu persetujuan");
    }

    const override = await prisma.shiftOverride.create({
      data: {
        restaurantId: input.restaurantId,
        shiftId: shift.id,
        requestedByCashierId: input.userId,
        reason: input.reason,
        proposedClosingCash: input.proposedClosingCash ?? null,
        status: "PENDING",
      },
      include: {
        shift: { select: { shiftNumber: true } },
        requester: { select: { id: true, name: true } },
      },
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.SHIFT_OVERRIDE_REQUESTED,
      override.id,
      {
        overrideId: override.id,
        shiftId: shift.id,
        shiftNumber: shift.shiftNumber,
        requestedBy: input.userId,
        reason: input.reason,
      }
    );
    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, shift.id);

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.userId,
      action: "SHIFT_OVERRIDE_REQUESTED",
      entityType: "ShiftOverride",
      entityId: override.id,
      details: { shiftNumber: shift.shiftNumber, reason: input.reason },
    });

    return override;
  }

  /**
   * Admin approves/rejects a pending override request (password confirmed by
   * the route). Approving with a proposedClosingCash reconciles the closed
   * shift's closingCash/expectedCash/difference to the corrected value.
   */
  async decideOverride(input: {
    restaurantId: string;
    adminId: string;
    overrideId: string;
    approve: boolean;
    decisionNote?: string;
  }) {
    const override = await prisma.shiftOverride.findFirst({
      where: { id: input.overrideId, restaurantId: input.restaurantId, status: "PENDING" },
      include: { shift: true },
    });
    if (!override) {
      throw new NotFoundError("Permintaan override tidak ditemukan");
    }

    const decided = await prisma.$transaction(async (tx) => {
      const status = input.approve ? "APPROVED" : "REJECTED";
      const updated = await tx.shiftOverride.update({
        where: { id: override.id },
        data: {
          status,
          decisionNote: input.decisionNote || null,
          approvedByAdminId: input.approve ? input.adminId : null,
          rejectedByAdminId: input.approve ? null : input.adminId,
          decidedAt: new Date(),
        },
      });

      // Approval reconciles the immutable closed shift with the corrected
      // drawer count (the "edit closed shift" that requires admin override).
      if (input.approve && override.proposedClosingCash != null) {
        const { expectedCash } = await computeShiftTotals(
          override.shiftId,
          input.restaurantId
        );
        const closing = Number(override.proposedClosingCash);
        await tx.cashierShift.update({
          where: { id: override.shiftId },
          data: {
            closingCash: closing,
            difference: Math.round((closing - expectedCash) * 100) / 100,
            notes: [
              override.shift.notes,
              `Override disetujui ${new Date().toISOString()} oleh admin: ${input.decisionNote || override.reason}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        });
      }

      return updated;
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.SHIFT_OVERRIDE_DECIDED,
      override.id,
      {
        overrideId: override.id,
        shiftId: override.shiftId,
        status: decided.status,
        decidedBy: input.adminId,
      }
    );
    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.DASHBOARD_UPDATED,
      override.shiftId
    );

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.adminId,
      action: input.approve ? "SHIFT_OVERRIDE_APPROVED" : "SHIFT_OVERRIDE_REJECTED",
      entityType: "ShiftOverride",
      entityId: override.id,
      details: {
        shiftNumber: override.shift.shiftNumber,
        reason: override.reason,
        decisionNote: input.decisionNote || null,
        proposedClosingCash: override.proposedClosingCash != null ? Number(override.proposedClosingCash) : null,
      },
    });

    return decided;
  }

  /** Admin: reopen a closed shift (password confirmed). Cash reconciles at close. */
  async reopenShift(input: {
    restaurantId: string;
    adminId: string;
    shiftId: string;
    reason: string;
  }) {
    const shift = await prisma.cashierShift.findFirst({
      where: { id: input.shiftId, restaurantId: input.restaurantId, status: "CLOSED" },
    });
    if (!shift) {
      throw new NotFoundError("Shift tertutup tidak ditemukan");
    }

    const reopened = await prisma.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: "OPEN",
        closedAt: null,
        closingCash: null,
        expectedCash: null,
        difference: null,
        notes: [
          shift.notes,
          `Shift dibuka kembali ${new Date().toISOString()} oleh admin: ${input.reason}`,
        ]
          .filter(Boolean)
          .join("\n"),
      },
    });

    emitRealtime(
      input.restaurantId,
      REALTIME_EVENT_TYPES.SHIFT_UPDATED,
      shift.id,
      { shiftId: shift.id, status: "OPEN", reopenedBy: input.adminId }
    );
    emitRealtime(input.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, shift.id);

    await auditService.log({
      restaurantId: input.restaurantId,
      userId: input.adminId,
      action: "SHIFT_REOPENED",
      entityType: "CashierShift",
      entityId: shift.id,
      details: { shiftNumber: shift.shiftNumber, reason: input.reason },
    });

    return reopened;
  }
}

export const shiftService = new ShiftService();
