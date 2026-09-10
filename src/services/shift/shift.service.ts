import { Prisma } from "@prisma/client";
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

// ============================================================
// Payment breakdown helper (CASH + QRIS revenue + unique orders)
// ============================================================

interface PaymentBreakdown {
  cash: number;
  qris: number;
  totalRevenue: number;
  transactionCount: number; // unique orders with at least one paid payment
}

/**
 * Compute CASH/QRIS revenue and unique-order transaction count for a set of
 * shifts. Uses a single SELECT query and de-duplicates orders in JS so that
 * one order paying partially with CASH + QRIS is counted as one transaction.
 */
async function computePaymentBreakdown(
  shiftIds: string[]
): Promise<Map<string, PaymentBreakdown>> {
  if (!shiftIds.length) return new Map();

  // Fetch every PAID payment linked to these shifts — groupBy _count would
  // over-count orders that have multiple payment rows (split tender), so we
  // select distinct (shiftId, orderId) and de-dup in the application layer.
  const rows = await prisma.payment.findMany({
    where: { shiftId: { in: shiftIds }, status: "PAID" },
    select: { shiftId: true, method: true, amount: true, orderId: true },
  });

  // Per-shift accumulator: revenue by method + set of unique orderIds.
  const acc = new Map<
    string,
    { cash: number; qris: number; orders: Set<string> }
  >();
  for (const r of rows) {
    if (!r.shiftId) continue;
    const e = acc.get(r.shiftId) || { cash: 0, qris: 0, orders: new Set() };
    const amt = Number(r.amount);
    if (r.method === "KASIR") e.cash += amt;
    else if (r.method === "QRIS") e.qris += amt;
    e.orders.add(r.orderId);
    acc.set(r.shiftId, e);
  }

  const result = new Map<string, PaymentBreakdown>();
  for (const [sid, e] of acc) {
    result.set(sid, {
      cash: e.cash,
      qris: e.qris,
      totalRevenue: e.cash + e.qris,
      transactionCount: e.orders.size,
    });
  }
  return result;
}

export class ShiftService {
  /**
   * Open a cash drawer shift for the authenticated cashier.
   * Rules:
   * - One OPEN shift per cashier per branch at a time.
   * - openingCash >= 0 and required.
   */
  async openShift(input: {
    restaurantId: string;
    userId: string;
    openingCash: number;
    notes?: string;
    branchId?: string | null;
  }) {
    if (
      !Number.isFinite(input.openingCash) ||
      input.openingCash < 0
    ) {
      throw new ValidationError("Jumlah kas awal tidak valid");
    }

    const resolvedBranchId = input.branchId ?? null;

    const existing = await prisma.cashierShift.findFirst({
      where: {
        restaurantId: input.restaurantId,
        userId: input.userId,
        status: "OPEN",
        branchId: resolvedBranchId,
      },
    });
    if (existing) {
      throw new ConflictError(
        "Shift sudah dibuka — tutup shift aktif sebelum membuka shift baru"
      );
    }

    // Retry on a shift-number unique violation (M5): two cashiers opening
    // concurrently can read the same sequence value. Bounded retry with a
    // fresh number; any other error propagates immediately.
    let shift: Awaited<ReturnType<typeof prisma.cashierShift.create>> | null =
      null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const shiftNumber = await nextShiftNumber(input.restaurantId);
      try {
        shift = await prisma.cashierShift.create({
          data: {
            restaurantId: input.restaurantId,
            branchId: resolvedBranchId,
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
        break;
      } catch (error) {
        const isCollision =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002";
        if (!isCollision || attempt === 4) {
          throw error;
        }
      }
    }
    if (!shift) {
      throw new Error("Failed to open shift after retries");
    }

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
      branchId: resolvedBranchId,
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
    branchId?: string | null;
  }) {
    if (!Number.isFinite(input.actualCash) || input.actualCash < 0) {
      throw new ValidationError("Jumlah kas aktual tidak valid");
    }

    const shift = await prisma.cashierShift.findFirst({
      where: {
        restaurantId: input.restaurantId,
        userId: input.userId,
        status: "OPEN",
        branchId: input.branchId ?? undefined,
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
      branchId: shift.branchId ?? input.branchId ?? null,
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
   * Get the caller's open shift (or null), optionally scoped to branches.
   * Includes the CASH + QRIS revenue breakdown for the open drawer.
   */
  async getMyOpenShift(
    restaurantId: string,
    userId: string,
    branchFilters?: string[] | null
  ) {
    const shift = await prisma.cashierShift.findFirst({
      where: {
        restaurantId,
        userId,
        status: "OPEN",
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        payments: {
          where: { status: "PAID", method: "KASIR" },
          select: { id: true, amount: true, paidAt: true },
        },
      },
    });
    if (!shift) return null;

    const breakdown = await computePaymentBreakdown([shift.id]);
    const bk = breakdown.get(shift.id);

    return {
      ...shift,
      cashRevenue: bk?.cash ?? 0,
      qrisRevenue: bk?.qris ?? 0,
      totalRevenue: bk?.totalRevenue ?? 0,
      transactionCount: bk?.transactionCount ?? 0,
    };
  }

  /**
   * My shifts — a cashier may only ever read their OWN shifts
   * (server-side scoping; never trust the client).
   */
  async listMyShifts(
    restaurantId: string,
    userId: string,
    branchFilters?: string[] | null,
    filters?: {
      status?: "OPEN" | "CLOSED";
      startDate?: string;
      endDate?: string;
    }
  ) {
    const where: Prisma.CashierShiftWhereInput = {
      restaurantId,
      userId,
      branchId: branchFilters?.length ? { in: branchFilters } : undefined,
    };
    if (filters?.status) where.status = filters.status;
    if (filters?.startDate || filters?.endDate) {
      where.openedAt = {};
      if (filters.startDate) {
        where.openedAt.gte = new Date(`${filters.startDate}T00:00:00`);
      }
      if (filters.endDate) {
        where.openedAt.lte = new Date(`${filters.endDate}T23:59:59.999`);
      }
    }

    const shifts = await prisma.cashierShift.findMany({
      where,
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, code: true } },
        _count: {
          select: { payments: { where: { status: "PAID", method: "KASIR" } } },
        },
      },
      orderBy: { openedAt: "desc" },
      take: 100,
    });

    const shiftIds = shifts.map((s) => s.id);
    const breakdown = await computePaymentBreakdown(shiftIds);

    const items = shifts.map((s) => {
      const bk = breakdown.get(s.id);
      return {
        ...s,
        cashRevenue: bk?.cash ?? 0,
        qrisRevenue: bk?.qris ?? 0,
        totalRevenue: bk?.totalRevenue ?? 0,
        transactionCount: bk?.transactionCount ?? 0,
      };
    });
    return { items };
  }

  /**
   * All shifts across cashiers (admin only), optionally scoped to branches.
   * Supports filtering by userId, status, and date range.
   */
  async listAllShifts(
    restaurantId: string,
    branchFilters?: string[] | null,
    filters?: {
      userId?: string;
      status?: "OPEN" | "CLOSED";
      startDate?: string;
      endDate?: string;
    }
  ) {
    const where: Prisma.CashierShiftWhereInput = {
      restaurantId,
      branchId: branchFilters?.length ? { in: branchFilters } : undefined,
    };
    if (filters?.userId) where.userId = filters.userId;
    if (filters?.status) where.status = filters.status;
    if (filters?.startDate || filters?.endDate) {
      where.openedAt = {};
      if (filters.startDate) {
        where.openedAt.gte = new Date(`${filters.startDate}T00:00:00`);
      }
      if (filters.endDate) {
        where.openedAt.lte = new Date(`${filters.endDate}T23:59:59.999`);
      }
    }

    // Sorting: OPEN shifts first (newest openedAt), then CLOSED (newest closedAt)
    const shifts = await prisma.cashierShift.findMany({
      where,
      include: {
        user: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true, code: true } },
        overrides: { orderBy: { createdAt: "desc" } },
        _count: {
          select: { payments: { where: { status: "PAID", method: "KASIR" } } },
        },
      },
      orderBy: [{ status: "asc" }, { openedAt: "desc" }],
      take: 200,
    });

    const shiftIds = shifts.map((s) => s.id);
    const breakdown = await computePaymentBreakdown(shiftIds);

    const items = shifts.map((s) => {
      const bk = breakdown.get(s.id);
      return {
        ...s,
        cashRevenue: bk?.cash ?? 0,
        qrisRevenue: bk?.qris ?? 0,
        totalRevenue: bk?.totalRevenue ?? 0,
        transactionCount: bk?.transactionCount ?? 0,
      };
    });
    return { items };
  }

  /** Shift detail with payments and refunds (admin all; cashier own only). */
  async getShift(
    shiftId: string,
    restaurantId: string,
    userId?: string,
    isAdmin?: boolean,
    branchFilters?: string[] | null
  ) {
    const shift = await prisma.cashierShift.findFirst({
      where: isAdmin
        ? {
            id: shiftId,
            restaurantId,
            branchId: branchFilters?.length ? { in: branchFilters } : undefined,
          }
        : {
            id: shiftId,
            restaurantId,
            userId,
            branchId: branchFilters?.length ? { in: branchFilters } : undefined,
          },
      include: {
        user: { select: { id: true, name: true, email: true } },
        branch: { select: { id: true, name: true, code: true } },
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
    const breakdown = await computePaymentBreakdown([shift.id]);
    const bk = breakdown.get(shift.id);
    return {
      shift,
      totals,
      cashRevenue: bk?.cash ?? 0,
      qrisRevenue: bk?.qris ?? 0,
      totalRevenue: bk?.totalRevenue ?? 0,
      transactionCount: bk?.transactionCount ?? 0,
    };
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
        branchId: shift.branchId ?? null,
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
      branchId: shift.branchId ?? null,
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
    branchFilters?: string[] | null;
  }) {
    const override = await prisma.shiftOverride.findFirst({
      where: {
        id: input.overrideId,
        restaurantId: input.restaurantId,
        status: "PENDING",
        ...(input.branchFilters?.length
          ? { branchId: { in: input.branchFilters } }
          : {}),
      },
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
      branchId: override.shift?.branchId ?? null,
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
    branchFilters?: string[] | null;
  }) {
    const shift = await prisma.cashierShift.findFirst({
      where: {
        id: input.shiftId,
        restaurantId: input.restaurantId,
        status: "CLOSED",
        ...(input.branchFilters?.length
          ? { branchId: { in: input.branchFilters } }
          : {}),
      },
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
      branchId: shift.branchId ?? null,
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
