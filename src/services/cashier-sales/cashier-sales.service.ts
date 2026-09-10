import { Prisma, PaymentStatus, OrderType } from "@prisma/client";
import { prisma } from "@/lib/prisma";

// ============================================================
// Cashier Sales History Service
//
// Queries Payment + Order + CashierShift to build a cashier's
// transaction ledger. Cashier identity is derived from
// Payment.shiftId → CashierShift.userId (server-side only).
// ============================================================

export interface SalesFilter {
  page?: number;
  limit?: number;
  startDate?: string;
  endDate?: string;
  shiftId?: string;
  paymentMethod?: string; // KASIR | QRIS
  paymentStatus?: string; // PAID | FAILED | EXPIRED | CANCELLED
  orderType?: string; // DINE_IN | TAKEAWAY | DELIVERY
  cashierId?: string; // ADMIN only — filter by specific cashier
  branchId?: string; // validated filter
}

export interface SalesTransaction {
  id: string;
  paymentId: string;
  orderId: string;
  orderNumber: string;
  customerName: string;
  orderType: string;
  paymentMethod: string | null;
  paymentStatus: string;
  amount: number;
  grandTotal: number;
  paidAt: Date | null;
  createdAt: Date;
  shiftId: string | null;
  shiftNumber: string | null;
  branchId: string | null;
  branchName: string | null;
  branchCode: string | null;
  cashierId: string | null;
  cashierName: string | null;
}

export interface SalesSummary {
  totalTransactions: number;
  totalSales: number;
  totalCash: number;
  totalQris: number;
  totalRefund: number;
  netSales: number;
}

export interface SalesPageResult {
  items: SalesTransaction[];
  summary: SalesSummary;
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

/**
 * Get cashier sales history — transaction ledger for a specific cashier
 * or all cashiers (admin).
 *
 * Cashier identity is resolved server-side via:
 *   Payment.shiftId → CashierShift.userId
 *
 * For KASIR role, userId is forced from the authenticated session.
 * For ADMIN role, cashierId filter is optional.
 */
export async function getCashierSales(
  restaurantId: string,
  filters: SalesFilter,
  options: {
    /** Forced userId for KASIR role. null = admin (no user filter). */
    userId: string | null;
    /** Authorized branch IDs (undefined = all branches). */
    branchFilters?: string[] | null;
  }
): Promise<SalesPageResult> {
  const page = Math.max(1, filters.page ?? 1);
  const limit = Math.min(50, Math.max(1, filters.limit ?? 30));
  const skip = (page - 1) * limit;

  // ---- Build the cashier scope ----
  // For KASIR: find their shifts first, then payments linked to those shifts.
  // For ADMIN: optionally filter by specific cashier's shifts.
  let shiftWhere: Prisma.CashierShiftWhereInput = {
    restaurantId,
  };

  // Branch scope
  if (options.branchFilters?.length) {
    shiftWhere.branchId = { in: options.branchFilters };
  } else if (filters.branchId) {
    shiftWhere.branchId = filters.branchId;
  }

  // User scope (KASIR forced, ADMIN optional)
  if (options.userId) {
    // KASIR: always forced to own userId
    shiftWhere.userId = options.userId;
  } else if (filters.cashierId) {
    // ADMIN: optionally filter by specific cashier
    shiftWhere.userId = filters.cashierId;
  }

  // Date filter on shift openedAt
  if (filters.startDate || filters.endDate) {
    shiftWhere.openedAt = {};
    if (filters.startDate) {
      shiftWhere.openedAt.gte = new Date(`${filters.startDate}T00:00:00`);
    }
    if (filters.endDate) {
      shiftWhere.openedAt.lte = new Date(`${filters.endDate}T23:59:59.999`);
    }
  }

  // Shift filter
  if (filters.shiftId) {
    shiftWhere.id = filters.shiftId;
  }

  // Find all qualifying shift IDs
  const shifts = await prisma.cashierShift.findMany({
    where: shiftWhere,
    select: { id: true },
  });
  const shiftIds = shifts.map((s) => s.id);

  if (shiftIds.length === 0) {
    return {
      items: [],
      summary: {
        totalTransactions: 0,
        totalSales: 0,
        totalCash: 0,
        totalQris: 0,
        totalRefund: 0,
        netSales: 0,
      },
      page,
      limit,
      total: 0,
      totalPages: 0,
    };
  }

  // ---- Build Payment where clause ----
  // The sales book contains PAID transactions by default — FAILED / EXPIRED /
  // CANCELLED are investigation rows only, visible via an explicit status
  // filter, and they never count toward sales. (Shift Monitoring semantics.)
  //
  // contextWhere = every filter EXCEPT the payment status. It defines the
  // "sales context" (shifts, branch, cashier, date, method, orderType) that
  // the summary is always scoped to.
  const contextWhere: Prisma.PaymentWhereInput = {
    restaurantId,
    shiftId: { in: shiftIds },
  };

  // Payment method filter
  if (filters.paymentMethod) {
    contextWhere.method = filters.paymentMethod;
  }

  // Order type filter
  if (filters.orderType) {
    contextWhere.order = { orderType: filters.orderType as OrderType };
  }

  // Payment status filter — defaults to the sales book (PAID).
  const paymentWhere: Prisma.PaymentWhereInput = {
    ...contextWhere,
    status: (filters.paymentStatus as PaymentStatus) ?? "PAID",
  };

  // ---- Count total transactions (unique orders, NOT payment rows) ----
  // Shift Monitoring de-duplicates by orderId so an order with multiple
  // payment rows (split/retried tender) still counts as ONE transaction.
  const orderGroups = await prisma.payment.groupBy({
    by: ["orderId"],
    where: paymentWhere,
    _count: { _all: true },
  });
  const total = orderGroups.length;

  // ---- Fetch paginated transactions (ONE row per ORDER — split/retried
// tender must not inflate the ledger; 1 order = 1 transaction, Shift
// Monitoring semantics). ----
// Pagination is done at the ORDER level (GROUP BY orderId, ordered by
// MAX(createdAt)/MAX(id)), so `total`/`totalPages`/items stay consistent and
// stable even when an order has multiple payment rows. The display row for
// each order is then the NEWEST matching payment row.
const paymentInclude = {
  order: {
    select: {
      id: true,
      orderNumber: true,
      orderType: true,
      grandTotal: true,
      status: true,
      customer: { select: { name: true } },
    },
  },
  shift: {
    select: {
      id: true,
      shiftNumber: true,
      user: { select: { id: true, name: true } },
      branch: { select: { id: true, name: true, code: true } },
    },
  },
} as const;

// Order-level stable keyset: distinct orderIds in the same total ordering
// used by the transaction count (newest activity first, id tie-break).
const conds: Prisma.Sql[] = [
  Prisma.sql`p.restaurantId = ${restaurantId}`,
  Prisma.sql`p.shiftId IN (${Prisma.join(shiftIds)})`,
  Prisma.sql`p.status = ${paymentWhere.status ?? "PAID"}`,
];
if (paymentWhere.method) conds.push(Prisma.sql`p.method = ${paymentWhere.method}`);
if (filters.orderType) conds.push(Prisma.sql`o.orderType = ${filters.orderType}`);

const pageOrderRows = await prisma.$queryRaw<Array<{ orderId: string }>>(Prisma.sql`
  SELECT p.orderId
  FROM \`payment\` p
  JOIN \`order\` o ON o.id = p.orderId
  WHERE ${Prisma.join(conds, " AND ")}
  GROUP BY p.orderId
  ORDER BY MAX(p.createdAt) DESC, MAX(p.id) DESC
  LIMIT ${limit} OFFSET ${skip}`);
const pageOrderIds = pageOrderRows.map((r) => r.orderId);

// Hydrate full payment rows for the page's orders.
const kept: Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>[] = [];
if (pageOrderIds.length > 0) {
  const pagePayments = await prisma.payment.findMany({
    where: { ...paymentWhere, orderId: { in: pageOrderIds } },
    include: paymentInclude,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  // Newest row per order → drives method/status/shift display.
  const newestPerOrder = new Map<string, Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>>();
  for (const p of pagePayments) {
    newestPerOrder.set(p.orderId, p);
  }
  // Preserve the groupBy (stable) order.
  for (const id of pageOrderIds) {
    const p = newestPerOrder.get(id);
    if (p) kept.push(p);
  }
}

// ---- Build items (amount = order grand total — the transaction value) ----
const items: SalesTransaction[] = kept.map((p) => ({
  id: p.id,
  paymentId: p.id,
  orderId: p.orderId,
  orderNumber: p.order.orderNumber,
  customerName: p.order.customer?.name ?? "—",
  orderType: p.order.orderType,
  paymentMethod: p.method,
  paymentStatus: p.status,
  amount: Number(p.order.grandTotal),
  grandTotal: Number(p.order.grandTotal),
  paidAt: p.paidAt,
  createdAt: p.createdAt,
  shiftId: p.shiftId,
  shiftNumber: p.shift?.shiftNumber ?? null,
  branchId: p.shift?.branch?.id ?? null,
  branchName: p.shift?.branch?.name ?? null,
  branchCode: p.shift?.branch?.code ?? null,
  cashierId: p.shift?.user?.id ?? null,
  cashierName: p.shift?.user?.name ?? null,
}));

  // ---- Summary (all matching transactions, not just current page) ----
  // Sales metrics always count PAID only, but MUST follow every scoping
  // filter. When a non-PAID status filter narrows the ledger (FAILED /
  // EXPIRED / CANCELLED), the summary is restricted to those SAME orders so
  // the cards never leak sales from outside the filtered view.
  let salesWhere: Prisma.PaymentWhereInput = {
    ...contextWhere,
    status: "PAID",
  };
  if (filters.paymentStatus && filters.paymentStatus !== "PAID") {
    const filteredOrderIds = orderGroups.map((g) => g.orderId);
    salesWhere = {
      ...contextWhere,
      status: "PAID",
      orderId: { in: filteredOrderIds },
    };
  }

  const refundWhere: Prisma.RefundWhereInput = {
    restaurantId,
    shiftId: { in: shiftIds },
    status: "APPROVED",
    ...(filters.paymentMethod
      ? { payment: { method: filters.paymentMethod } }
      : {}),
    ...(filters.orderType
      ? { order: { orderType: filters.orderType as OrderType } }
      : {}),
    ...(filters.startDate || filters.endDate
      ? {
          requestedAt: {
            ...(filters.startDate
              ? { gte: new Date(`${filters.startDate}T00:00:00`) }
              : {}),
            ...(filters.endDate
              ? { lte: new Date(`${filters.endDate}T23:59:59.999`) }
              : {}),
          },
        }
      : {}),
  };
  const [salesAgg, refundAgg] = await Promise.all([
    prisma.payment.aggregate({
      where: salesWhere,
      _sum: { amount: true },
      _count: { _all: true },
    }),
    prisma.refund.aggregate({
      where: refundWhere,
      _sum: { amount: true },
    }),
  ]);

  // CASH vs QRIS breakdown (PAID only, same filtered scope as sales)
  const methodBreakdown = await prisma.payment.groupBy({
    by: ["method"],
    where: salesWhere,
    _sum: { amount: true },
    _count: { _all: true },
  });

  let totalCash = 0;
  let totalQris = 0;
  for (const row of methodBreakdown) {
    const amt = Number(row._sum.amount ?? 0);
    if (row.method === "KASIR") totalCash = amt;
    else if (row.method === "QRIS") totalQris = amt;
  }

  const totalSales = Number(salesAgg._sum.amount ?? 0);
  const totalRefund = Number(refundAgg._sum.amount ?? 0);
  const netSales = Math.round((totalSales - totalRefund) * 100) / 100;

  return {
    items,
    summary: {
      totalTransactions: total,
      totalSales,
      totalCash,
      totalQris,
      totalRefund,
      netSales,
    },
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}
