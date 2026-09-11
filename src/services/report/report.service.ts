import { Prisma, PaymentStatus, OrderType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { ValidationError } from "@/lib/errors";

// ============================================================
// Sales report aggregation (server-side only — never trusts client
// totals). All queries are restaurant-scoped and only count REAL sales:
// an order counts as sold when status != CANCELLED AND paymentStatus = PAID
// (FAILED / EXPIRED / REFUNDED / UNPAID / PENDING are never revenue).
//
// REPORT FILTERS (Wave 1):
//  - orderType / paymentMethod / status / branchId are applied to the
//    reporting SET of orders. Revenue metrics are ALWAYS computed on the
//    PAID subset (paymentStatus = 'PAID'); a non-PAID status filter shows
//    the activity (order counts, payment buckets) but never books it as
//    revenue. This respects the revenue rules without mislabelling failed/
//    expired/unpaid activity as sales.
// ============================================================

export type ReportPeriod = "today" | "yesterday" | "week" | "month" | "custom";

export const REPORT_PERIODS: ReportPeriod[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "custom",
];

export const REPORT_PAYMENT_METHODS = ["KASIR", "QRIS"] as const;
export const REPORT_ORDER_TYPES = [
  "DINE_IN",
  "TAKEAWAY",
  "DELIVERY",
] as const;
export const REPORT_PAYMENT_STATUSES = [
  "UNPAID",
  "PENDING",
  "PAID",
  "FAILED",
  "EXPIRED",
  "REFUNDED",
  "CANCELLED",
] as const;

export const REPORT_PURCHASE_STATUSES = ["DRAFT", "RECEIVED", "CANCELLED"] as const;
export const REPORT_STOCK_MOVEMENT_TYPES = ["IN", "OUT", "ADJUSTMENT"] as const;

export interface ReportRange {
  start: Date;
  end: Date;
}

export interface ReportFilters {
  orderType?: OrderType | null;
  paymentMethod?: "KASIR" | "QRIS" | null;
  status?: PaymentStatus | null;
  branchId?: string | null;
}

export interface ReportPagination {
  page?: number;
  limit?: number;
}

/** Resolve a period (+ optional custom dates) into a [start, end] range. */
export function resolveReportRange(
  period: ReportPeriod,
  startDate?: string,
  endDate?: string
): ReportRange {
  const now = new Date();

  if (period === "custom") {
    if (!startDate || !endDate) {
      throw new ValidationError(
        "startDate dan endDate wajib diisi untuk periode custom"
      );
    }
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59.999`);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      throw new ValidationError("Format tanggal tidak valid");
    }
    if (start > end) {
      throw new ValidationError("startDate tidak boleh melebihi endDate");
    }
    return { start, end };
  }

  const start = new Date(now);
  start.setHours(0, 0, 0, 0);

  switch (period) {
    case "today":
      break;
    case "yesterday": {
      start.setDate(start.getDate() - 1);
      break;
    }
    case "week": {
      // Monday-based week (ISO).
      const day = start.getDay(); // 0 = Sunday
      const diff = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diff);
      break;
    }
    case "month": {
      start.setDate(1);
      break;
    }
  }

  if (period === "yesterday") {
    const end = new Date(start);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  return { start, end: now };
}

/**
 * Base (payment-status-free) order scope shared by every report: restaurant,
 * authorized branches, date range, cancelled-excluded + the order-level
 * filters (order type, payment method). Used to build the "activity" set.
 */
function reportBaseWhere(
  restaurantId: string,
  range: ReportRange,
  branchFilters?: string[] | null,
  filters?: ReportFilters
) {
  return {
    restaurantId,
    ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    createdAt: { gte: range.start, lte: range.end },
    status: { not: "CANCELLED" as const },
    ...(filters?.orderType ? { orderType: filters.orderType } : {}),
    ...(filters?.paymentMethod
      ? {
          payments: {
            some: {
              method: filters.paymentMethod,
              status: "PAID" as const,
            },
          },
        }
      : {}),
  };
}

/**
 * The "reporting set" (activity): base scope + the selected payment status
 * (default PAID). Drives order counts and the payment breakdown buckets.
 */
function reportActivityWhere(
  restaurantId: string,
  range: ReportRange,
  branchFilters?: string[] | null,
  filters?: ReportFilters
) {
  return {
    ...reportBaseWhere(restaurantId, range, branchFilters, filters),
    paymentStatus: (filters?.status ?? "PAID") as PaymentStatus,
  };
}

/**
 * The "revenue set": ALWAYS paymentStatus = PAID. Revenue metrics (totals,
 * items, order types, best sellers, product sales) are computed from this set
 * so a non-PAID status filter never books failed/expired/unpaid activity as
 * sales.
 */
function revenueWhere(
  restaurantId: string,
  range: ReportRange,
  branchFilters?: string[] | null,
  filters?: ReportFilters
) {
  return {
    ...reportBaseWhere(restaurantId, range, branchFilters, filters),
    paymentStatus: "PAID" as const,
  };
}

/** Round a numeric/Decimal/bigint to a safe JS number (2dp). */
function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Math.round(n * 100) / 100;
}

// ============================================================
// Raw-SQL helpers (conditional WHERE fragments)
// ============================================================

function branchFragment(branchFilters?: string[] | null) {
  return branchFilters?.length
    ? Prisma.sql`AND \`branchId\` IN (${Prisma.join([...branchFilters])})`
    : Prisma.empty;
}

function orderFragment(
  restaurantId: string,
  range: ReportRange,
  branchFilters?: string[] | null,
  filters?: ReportFilters
) {
  return Prisma.sql`
    AND \`restaurantId\` = ${restaurantId}
    AND \`createdAt\` >= ${range.start}
    AND \`createdAt\` <= ${range.end}
    AND \`status\` <> 'CANCELLED'
    AND \`paymentStatus\` = 'PAID'
    ${branchFragment(branchFilters)}
    ${filters?.orderType ? Prisma.sql`AND \`orderType\` = ${filters.orderType}` : Prisma.empty}
    ${filters?.paymentMethod ? Prisma.sql`AND \`id\` IN (SELECT \`orderId\` FROM \`payment\` WHERE \`method\` = ${filters.paymentMethod} AND \`status\` = 'PAID')` : Prisma.empty}
  `;
}

export class ReportService {
  // ============================================================
  // WAVE 6 — LAPORAN PEMBELIAN
  // ============================================================

  /**
   * Purchase report (purchase VALUE/quantity/status — never COGS, never
   * profit). Aggregations are server-side (Prisma aggregate + SQL GROUP BY).
   *
   * Semantics:
   *  - DRAFT   = planned purchase, NOT stock in.
   *  - RECEIVED = goods actually received (StockMovement IN applied).
   *  - CANCELLED = aborted draft, never received stock.
   *  - "Total Purchase Value" is the purchase value of the scoped set — it
   *    is NOT labelled profit/expense/COGS (accounting does not exist yet).
   *  - "Created By" is only available for RECEIVED purchases (via the
   *    PURCHASE_RECEIVE stock movement's userId); the Purchase model does not
   *    store a creator, so DRAFT/CANCELLED rows report null.
   */
  async getPurchaseReport(
    restaurantId: string,
    period: ReportPeriod,
    opts?: {
      startDate?: string;
      endDate?: string;
      branchFilters?: string[] | null;
      filters?: {
        branchId?: string | null;
        supplierId?: string | null;
        status?: "DRAFT" | "RECEIVED" | "CANCELLED" | null;
      };
      pagination?: ReportPagination;
    }
  ) {
    const range = resolveReportRange(period, opts?.startDate, opts?.endDate);
    const branchFilters = opts?.branchFilters;
    const { branchId, supplierId, status } = opts?.filters || {};

    const page = Math.max(1, opts?.pagination?.page ?? 1);
    // The UI route clamps its page size to 100 before calling; the CSV export
    // legitimately requests a larger bounded page so the download is complete.
    // Keep a hard service-level ceiling so no caller can request unbounded data.
    const limit = Math.min(5000, Math.max(1, opts?.pagination?.limit ?? 50));
    const skip = (page - 1) * limit;

    // baseWhere excludes the status filter so received/cancelled counts can
    // be narrowed consistently below (with a status filter, the summary only
    // counts that status — matching the sales-report filter semantics).
    const baseWhere: Prisma.PurchaseWhereInput = {
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      ...(branchId ? { branchId } : {}),
      ...(supplierId ? { supplierId } : {}),
      createdAt: { gte: range.start, lte: range.end },
    };
    const where: Prisma.PurchaseWhereInput = {
      ...baseWhere,
      ...(status ? { status } : {}),
    };

    // Qualified branch fragment for raw SQL on the `p` alias.
    const pBranchSql =
      branchFilters?.length
        ? Prisma.sql`AND p.\`branchId\` IN (${Prisma.join([...branchFilters])})`
        : Prisma.empty;

    const [agg, receivedCountAll, cancelledCountAll, itemAgg, detailRows, productRows, supplierRows] =
      await Promise.all([
        prisma.purchase.aggregate({
          where,
          _count: { _all: true },
          _sum: { total: true },
        }),
        prisma.purchase.count({ where: { ...baseWhere, status: "RECEIVED" } }),
        prisma.purchase.count({ where: { ...baseWhere, status: "CANCELLED" } }),
        prisma.purchaseItem.aggregate({
          where: { purchase: { is: where } },
          _count: { _all: true },
          _sum: { quantity: true },
        }),
        // Purchase detail rows (bounded + paginated). One grouped query —
        // item count + total quantity per purchase, never per-row lookups.
        prisma.$queryRaw<
          Array<{
            id: string;
            status: string;
            total: number | bigint | string;
            receivedAt: Date | null;
            createdAt: Date;
            supplierName: string | null;
            branchCode: string | null;
            branchName: string | null;
            itemCount: number | bigint;
            totalQty: number | bigint | string;
          }>
        >`
          SELECT p.\`id\` AS id,
                 p.\`status\` AS status,
                 p.\`total\` AS total,
                 p.\`receivedAt\` AS receivedAt,
                 p.\`createdAt\` AS createdAt,
                 s.\`name\` AS supplierName,
                 b.\`code\` AS branchCode,
                 b.\`name\` AS branchName,
                 COUNT(pi.\`id\`) AS itemCount,
                 COALESCE(SUM(pi.\`quantity\`), 0) AS totalQty
          FROM \`purchase\` p
          JOIN \`supplier\` s ON s.\`id\` = p.\`supplierId\`
          JOIN \`branch\` b ON b.\`id\` = p.\`branchId\`
          LEFT JOIN \`purchaseitem\` pi ON pi.\`purchaseId\` = p.\`id\`
          WHERE p.\`restaurantId\` = ${restaurantId}
            AND p.\`createdAt\` >= ${range.start}
            AND p.\`createdAt\` <= ${range.end}
            ${pBranchSql}
            ${branchId ? Prisma.sql`AND p.\`branchId\` = ${branchId}` : Prisma.empty}
            ${supplierId ? Prisma.sql`AND p.\`supplierId\` = ${supplierId}` : Prisma.empty}
            ${status ? Prisma.sql`AND p.\`status\` = ${status}` : Prisma.empty}
          GROUP BY p.\`id\`, p.\`status\`, p.\`total\`, p.\`receivedAt\`, p.\`createdAt\`,
                   s.\`name\`, b.\`code\`, b.\`name\`
          ORDER BY p.\`createdAt\` DESC
          LIMIT ${limit} OFFSET ${skip}
        `,
        // Product breakdown — quantity/cost per product over the SAME scoped
        // set (a status filter narrows it; with none, DRAFT/CANCELLED
        // purchases are still reported as "purchased quantity", never as
        // received stock — the inventory report owns stock semantics).
        prisma.$queryRaw<
          Array<{
            productId: string;
            purchases: number | bigint;
            qty: number | bigint | string;
            totalCost: number | bigint | string;
            avgUnitCost: number | bigint | string;
          }>
        >`
          SELECT pi.\`productId\` AS productId,
                 COUNT(DISTINCT pi.\`purchaseId\`) AS purchases,
                 COALESCE(SUM(pi.\`quantity\`), 0) AS qty,
                 COALESCE(SUM(pi.\`lineTotal\`), 0) AS totalCost,
                 COALESCE(AVG(pi.\`unitCost\`), 0) AS avgUnitCost
          FROM \`purchaseitem\` pi
          JOIN \`purchase\` p ON p.\`id\` = pi.\`purchaseId\`
          WHERE p.\`restaurantId\` = ${restaurantId}
            AND p.\`createdAt\` >= ${range.start}
            AND p.\`createdAt\` <= ${range.end}
            ${pBranchSql}
            ${branchId ? Prisma.sql`AND p.\`branchId\` = ${branchId}` : Prisma.empty}
            ${supplierId ? Prisma.sql`AND p.\`supplierId\` = ${supplierId}` : Prisma.empty}
            ${status ? Prisma.sql`AND p.\`status\` = ${status}` : Prisma.empty}
          GROUP BY pi.\`productId\`
          ORDER BY totalCost DESC
        `,
        // Supplier breakdown — per-supplier totals over the scoped set.
        prisma.$queryRaw<
          Array<{
            supplierId: string;
            supplierName: string | null;
            purchases: number | bigint;
            qty: number | bigint | string;
            totalValue: number | bigint | string;
          }>
        >`
          SELECT s.\`id\` AS supplierId,
                 s.\`name\` AS supplierName,
                 COUNT(DISTINCT p.\`id\`) AS purchases,
                 COALESCE(SUM(pi.qty), 0) AS qty,
                 COALESCE(SUM(p.\`total\`), 0) AS totalValue
          FROM \`purchase\` p
          JOIN \`supplier\` s ON s.\`id\` = p.\`supplierId\`
          LEFT JOIN (
            SELECT \`purchaseId\` AS purchaseId, SUM(\`quantity\`) AS qty
            FROM \`purchaseitem\` GROUP BY \`purchaseId\`
          ) pi ON pi.purchaseId = p.\`id\`
          WHERE p.\`restaurantId\` = ${restaurantId}
            AND p.\`createdAt\` >= ${range.start}
            AND p.\`createdAt\` <= ${range.end}
            ${pBranchSql}
            ${branchId ? Prisma.sql`AND p.\`branchId\` = ${branchId}` : Prisma.empty}
            ${supplierId ? Prisma.sql`AND p.\`supplierId\` = ${supplierId}` : Prisma.empty}
            ${status ? Prisma.sql`AND p.\`status\` = ${status}` : Prisma.empty}
          GROUP BY s.\`id\`, s.\`name\`
          ORDER BY totalValue DESC
        `,
      ]);

    // Created-by resolution: RECEIVED purchases expose the receiving user via
    // their PURCHASE_RECEIVE movements (one lookup, no N+1).
    const detailIds = detailRows.map((r) => r.id as string);
    const receiveMoves =
      detailIds.length > 0
        ? await prisma.stockMovement.findMany({
            where: { refType: "PURCHASE_RECEIVE", refId: { in: detailIds } },
            select: { refId: true, user: { select: { name: true } } },
          })
        : [];
    const createdByMap = new Map<string, string | null>();
    for (const m of receiveMoves) {
      if (m.refId) createdByMap.set(m.refId, m.user?.name ?? null);
    }

    const productIds = productRows.map((r) => r.productId as string).filter(Boolean);
    const productMeta =
      productIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: productIds }, restaurantId },
            select: { id: true, name: true },
          })
        : [];
    const productNameMap = new Map(productMeta.map((p) => [p.id, p.name]));

    const total = Number(agg._count._all);
    // A status filter narrows the summary to that status only (never mixes
    // other statuses into the filtered view).
    const receivedCount =
      status === "RECEIVED" ? total : status ? 0 : receivedCountAll;
    const cancelledCount =
      status === "CANCELLED" ? total : status ? 0 : cancelledCountAll;
    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      filters: {
        branchId: branchId ?? null,
        supplierId: supplierId ?? null,
        status: status ?? null,
      },
      summary: {
        totalPurchases: total,
        totalValue: num(agg._sum.total),
        totalReceived: receivedCount,
        totalCancelled: cancelledCount,
        totalItemsPurchased: Number(itemAgg._count._all),
        totalQuantity: num(itemAgg._sum.quantity),
      },
      items: detailRows.map((r) => ({
        id: r.id as string,
        date: (r.createdAt as Date).toISOString(),
        supplierName: r.supplierName ?? null,
        branchCode: r.branchCode ?? null,
        branchName: r.branchName ?? null,
        status: r.status as string,
        itemCount: Number(r.itemCount),
        totalQuantity: num(r.totalQty),
        total: num(r.total),
        createdBy: createdByMap.get(r.id as string) ?? null,
        receivedAt: r.receivedAt ? (r.receivedAt as Date).toISOString() : null,
      })),
      productBreakdown: productRows.map((r) => ({
        productId: r.productId as string,
        name: productNameMap.get(r.productId as string) ?? null,
        quantityPurchased: num(r.qty),
        totalCost: num(r.totalCost),
        averageUnitCost: num(r.avgUnitCost),
        numberOfPurchases: Number(r.purchases),
      })),
      supplierBreakdown: supplierRows.map((r) => ({
        supplierId: r.supplierId as string,
        name: r.supplierName ?? null,
        numberOfPurchases: Number(r.purchases),
        quantity: num(r.qty),
        totalValue: num(r.totalValue),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ============================================================
  // WAVE 6 — LAPORAN INVENTORY / STOK
  // ============================================================

  /**
   * Inventory report — movement history + product stock summary.
   *
   * Current stock ALWAYS comes from BranchProduct.stock (never recomputed
   * from the ledger); the ledger (StockMovement) supplies the in/out/
   * adjustment activity within the selected range + balanceAfter history.
   * Opening this report NEVER creates movements or mutates stock.
   *
   * Movement table is paginated/bounded. All aggregation is server-side.
   */
  async getInventoryReport(
    restaurantId: string,
    period: ReportPeriod,
    opts?: {
      startDate?: string;
      endDate?: string;
      branchFilters?: string[] | null;
      filters?: {
        branchId?: string | null;
        productId?: string | null;
        categoryId?: string | null;
        type?: "IN" | "OUT" | "ADJUSTMENT" | null;
      };
      pagination?: ReportPagination;
    }
  ) {
    const range = resolveReportRange(period, opts?.startDate, opts?.endDate);
    const branchFilters = opts?.branchFilters;
    const { branchId, productId, categoryId, type } = opts?.filters || {};

    const page = Math.max(1, opts?.pagination?.page ?? 1);
    // The UI route clamps its page size to 100 before calling; the CSV export
    // legitimately requests a larger bounded page so the download is complete.
    // Keep a hard service-level ceiling so no caller can request unbounded data.
    const limit = Math.min(5000, Math.max(1, opts?.pagination?.limit ?? 50));
    const skip = (page - 1) * limit;

    const movementWhere: Prisma.StockMovementWhereInput = {
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      ...(branchId ? { branchId } : {}),
      ...(productId ? { productId } : {}),
      ...(categoryId ? { product: { categoryId } } : {}),
      ...(type ? { type } : {}),
      createdAt: { gte: range.start, lte: range.end },
    };

    // BranchProduct scope (current stock source of truth).
    // BranchProduct has no restaurantId column — scope via the product join
    // so a report can never leak stock across tenants.
    const bpSql = Prisma.sql`
      AND p.\`restaurantId\` = ${restaurantId}
      ${branchFilters?.length ? Prisma.sql`AND bp.\`branchId\` IN (${Prisma.join([...branchFilters])})` : Prisma.empty}
      ${branchId ? Prisma.sql`AND bp.\`branchId\` = ${branchId}` : Prisma.empty}
      ${productId ? Prisma.sql`AND bp.\`productId\` = ${productId}` : Prisma.empty}
      ${categoryId ? Prisma.sql`AND p.\`categoryId\` = ${categoryId}` : Prisma.empty}
    `;

    const [movementCount, totalStockRows, inAgg, outAgg, adjAgg, movementRows, productStockRows, productStockCountRows] =
      await Promise.all([
        prisma.stockMovement.count({ where: movementWhere }),
        prisma.$queryRaw<Array<{ total: number | bigint | string }>>`
          SELECT COALESCE(SUM(bp.\`stock\`), 0) AS total
          FROM \`branchproduct\` bp
          JOIN \`product\` p ON p.\`id\` = bp.\`productId\`
          WHERE 1 = 1
          ${bpSql}
        `,
        prisma.stockMovement.aggregate({
          where: { ...movementWhere, type: "IN" },
          _sum: { quantity: true },
        }),
        prisma.stockMovement.aggregate({
          where: { ...movementWhere, type: "OUT" },
          _sum: { quantity: true },
        }),
        prisma.stockMovement.aggregate({
          where: { ...movementWhere, type: "ADJUSTMENT" },
          _sum: { quantity: true },
        }),
        // Movement table (paginated).
        prisma.stockMovement.findMany({
          where: movementWhere,
          include: {
            branch: { select: { code: true, name: true } },
            product: { select: { name: true } },
            user: { select: { name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
        // Product stock summary (paginated) — current stock from
        // BranchProduct, in/out/adjustment from the ledger within range.
        prisma.$queryRaw<
          Array<{
            branchId: string;
            productId: string;
            stock: number | bigint;
            stockIn: number | bigint | string;
            stockOut: number | bigint | string;
            adjustment: number | bigint | string;
            lastMovement: Date | null;
            branchName: string | null;
            branchCode: string | null;
          }>
        >`
          SELECT bp.\`branchId\` AS branchId,
                 bp.\`productId\` AS productId,
                 bp.\`stock\` AS stock,
                 COALESCE(SUM(CASE WHEN sm.\`type\` = 'IN' THEN sm.\`quantity\` ELSE 0 END), 0) AS stockIn,
                 COALESCE(SUM(CASE WHEN sm.\`type\` = 'OUT' THEN sm.\`quantity\` ELSE 0 END), 0) AS stockOut,
                 COALESCE(SUM(CASE WHEN sm.\`type\` = 'ADJUSTMENT' THEN sm.\`quantity\` ELSE 0 END), 0) AS adjustment,
                 MAX(sm.\`createdAt\`) AS lastMovement,
                 b.\`name\` AS branchName,
                 b.\`code\` AS branchCode
          FROM \`branchproduct\` bp
          JOIN \`product\` p ON p.\`id\` = bp.\`productId\`
          LEFT JOIN \`branch\` b ON b.\`id\` = bp.\`branchId\`
          LEFT JOIN \`stockmovement\` sm
            ON sm.\`branchId\` = bp.\`branchId\`
           AND sm.\`productId\` = bp.\`productId\`
           AND sm.\`restaurantId\` = ${restaurantId}
           AND sm.\`createdAt\` >= ${range.start}
           AND sm.\`createdAt\` <= ${range.end}
           ${type ? Prisma.sql`AND sm.\`type\` = ${type}` : Prisma.empty}
          WHERE 1 = 1
          ${bpSql}
          GROUP BY bp.\`branchId\`, bp.\`productId\`, bp.\`stock\`, b.\`name\`, b.\`code\`
          ORDER BY bp.\`stock\` DESC
          LIMIT ${limit} OFFSET ${skip}
        `,
        prisma.$queryRaw<Array<{ total: number | bigint }>>`
          SELECT COUNT(*) AS total
          FROM \`branchproduct\` bp
          JOIN \`product\` p ON p.\`id\` = bp.\`productId\`
          WHERE 1 = 1
          ${bpSql}
        `,
      ]);

    const stockTotal = Number(totalStockRows[0]?.total ?? 0);
    const stockSummaryTotal = Number(productStockCountRows[0]?.total ?? 0);

    // Hydrate product names for the stock summary rows.
    const stockProductIds = [
      ...new Set(productStockRows.map((r) => r.productId as string)),
    ];
    const stockProducts =
      stockProductIds.length > 0
        ? await prisma.product.findMany({
            where: { id: { in: stockProductIds }, restaurantId },
            select: { id: true, name: true },
          })
        : [];
    const stockProductMap = new Map(stockProducts.map((p) => [p.id, p.name]));

    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      filters: {
        branchId: branchId ?? null,
        productId: productId ?? null,
        categoryId: categoryId ?? null,
        type: type ?? null,
      },
      summary: {
        // Current total stock (BranchProduct), NOT a ledger replay.
        totalStock: stockTotal,
        stockIn: num(inAgg._sum.quantity),
        stockOut: num(outAgg._sum.quantity),
        adjustment: num(adjAgg._sum.quantity),
        movements: movementCount,
      },
      items: movementRows.map((m) => ({
        id: m.id,
        date: m.createdAt.toISOString(),
        branchId: m.branchId,
        branchCode: m.branch?.code ?? null,
        branchName: m.branch?.name ?? null,
        productId: m.productId,
        productName: m.product?.name ?? null,
        type: m.type,
        quantity: m.quantity,
        balanceAfter: m.balanceAfter,
        refType: m.refType,
        refId: m.refId,
        reason: m.reason,
        userId: m.userId,
        userName: m.user?.name ?? null,
      })),
      productStockSummary: productStockRows.map((r) => ({
        branchId: r.branchId as string,
        branchName: r.branchName ?? null,
        branchCode: r.branchCode ?? null,
        productId: r.productId as string,
        productName: stockProductMap.get(r.productId as string) ?? null,
        currentStock: Number(r.stock),
        stockIn: num(r.stockIn),
        stockOut: num(r.stockOut),
        adjustment: num(r.adjustment),
        lastMovement: r.lastMovement ? (r.lastMovement as Date).toISOString() : null,
      })),
      pagination: {
        page,
        limit,
        total: movementCount,
        totalPages: Math.ceil(movementCount / limit),
      },
      stockPagination: {
        page,
        limit,
        total: stockSummaryTotal,
        totalPages: Math.ceil(stockSummaryTotal / limit),
      },
    };
  }

  /**
   * Full sales report for the period. When `branchFilters` is set, only those
   * branches. `filters` (optional) narrows the reporting set by order type,
   * payment method, and/or payment status, all validated server-side at the
   * route layer.
   */
  async getSalesReport(
    restaurantId: string,
    period: ReportPeriod,
    startDate?: string,
    endDate?: string,
    branchFilters?: string[] | null,
    filters?: ReportFilters
  ) {
    const range = resolveReportRange(period, startDate, endDate);
    const soldWhere = revenueWhere(restaurantId, range, branchFilters, filters);
    // "Activity" count (all non-cancelled orders in scope, all payment
    // statuses) unless a status filter is given — preserves the original
    // "Total Order" semantics (counts unpaid/failed too).
    const activityCountWhere = {
      ...reportBaseWhere(restaurantId, range, branchFilters, filters),
      ...(filters?.status ? { paymentStatus: filters.status } : {}),
    };

    // ------------------------------------------------------------
    // Summary (Prisma aggregate over sold orders)
    // ------------------------------------------------------------
    const [
      orderAgg,
      orderCountAll,
      paidOrderCount,
      itemAgg,
      refundAgg,
      paymentRows,
      orderTypeRows,
      bestSellerRows,
      categoryProductRows,
      hourlyRows,
    ] = await Promise.all([
      prisma.order.aggregate({
        where: soldWhere,
        _sum: {
          subtotal: true,
          grandTotal: true,
          discount: true,
          tax: true,
          serviceCharge: true,
        },
      }),
      prisma.order.count({ where: activityCountWhere }),
      prisma.order.count({ where: soldWhere }),
      prisma.orderItem.aggregate({
        where: { order: { is: soldWhere } },
        _sum: { quantity: true },
      }),
      // APPROVED refunds booked in the period (net revenue adjustment).
      prisma.refund.aggregate({
        where: {
          restaurantId,
          ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
          status: "APPROVED",
          approvedAt: { gte: range.start, lte: range.end },
          order: { is: soldWhere },
        },
        _sum: { amount: true },
      }),
      // Payment breakdown (all statuses — cash/QRIS/VA + non-paid buckets).
      prisma.payment.groupBy({
        by: ["method", "status", "provider"],
        where: {
          restaurantId,
          ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
          createdAt: { gte: range.start, lte: range.end },
          ...(filters?.status ? { status: filters.status } : {}),
          ...(filters?.paymentMethod ? { method: filters.paymentMethod } : {}),
        },
        _count: { _all: true },
        _sum: { amount: true },
      }),
      // Order type breakdown (sold only).
      prisma.order.groupBy({
        by: ["orderType"],
        where: soldWhere,
        _count: { _all: true },
        _sum: { grandTotal: true },
      }),
      // Best selling products (sold only).
      prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: { is: soldWhere } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 10,
      }),
      // Category revenue — group by product first, join category below.
      prisma.orderItem.groupBy({
        by: ["productId"],
        where: { order: { is: soldWhere } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: 50,
      }),
      // Busiest hours (MySQL HOUR()) — sold orders only.
      prisma.$queryRaw<
        Array<{ hour: number; orders: bigint | number; revenue: number | string }>
      >`
        SELECT HOUR(\`createdAt\`) AS hour,
               COUNT(*) AS orders,
               COALESCE(SUM(\`grandTotal\`), 0) AS revenue
        FROM \`order\`
        WHERE \`restaurantId\` = ${restaurantId}
          ${branchFragment(branchFilters)}
          AND \`createdAt\` >= ${range.start}
          AND \`createdAt\` <= ${range.end}
          AND \`status\` <> 'CANCELLED'
          AND \`paymentStatus\` = 'PAID'
          ${filters?.orderType ? Prisma.sql`AND \`orderType\` = ${filters.orderType}` : Prisma.empty}
          ${filters?.paymentMethod ? Prisma.sql`AND \`id\` IN (SELECT \`orderId\` FROM \`payment\` WHERE \`method\` = ${filters.paymentMethod} AND \`status\` = 'PAID')` : Prisma.empty}
        GROUP BY HOUR(\`createdAt\`)
        ORDER BY hour ASC
      `,
    ]);

    const totalSales = num(orderAgg._sum.grandTotal);
    const grossSales = num(orderAgg._sum.subtotal);
    const totalDiscount = num(orderAgg._sum.discount);
    const totalTax = num(orderAgg._sum.tax);
    const totalServiceCharge = num(orderAgg._sum.serviceCharge);
    const totalRefund = num(refundAgg._sum.amount);
    const totalItemsSold = num(itemAgg._sum.quantity);

    // ------------------------------------------------------------
    // Payment breakdown buckets
    // ------------------------------------------------------------
    const buckets = {
      cash: { count: 0, amount: 0 },
      qris: { count: 0, amount: 0 },
      va: { count: 0, amount: 0 },
      other: { count: 0, amount: 0 },
      unpaid: { count: 0, amount: 0 },
      failed: { count: 0, amount: 0 },
      refunded: { count: 0, amount: 0 },
      cancelled: { count: 0, amount: 0 },
    };

    for (const row of paymentRows) {
      const amount = num(row._sum.amount);
      const count = row._count._all;
      const method = row.method;
      const status = row.status;

      // Method bucket (paid only for the revenue buckets).
      if (status === "PAID") {
        if (method === "KASIR") {
          buckets.cash.count += count;
          buckets.cash.amount += amount;
        } else if (method === "QRIS") {
          buckets.qris.count += count;
          buckets.qris.amount += amount;
        } else if (row.provider === "ipaymu" && !method) {
          buckets.va.count += count;
          buckets.va.amount += amount;
        } else {
          buckets.other.count += count;
          buckets.other.amount += amount;
        }
      } else if (status === "UNPAID" || status === "PENDING") {
        buckets.unpaid.count += count;
        buckets.unpaid.amount += amount;
      } else if (status === "FAILED" || status === "EXPIRED") {
        buckets.failed.count += count;
        buckets.failed.amount += amount;
      } else if (status === "REFUNDED") {
        buckets.refunded.count += count;
        buckets.refunded.amount += amount;
      } else if (status === "CANCELLED") {
        buckets.cancelled.count += count;
        buckets.cancelled.amount += amount;
      }
    }

    // ------------------------------------------------------------
    // Order type breakdown
    // ------------------------------------------------------------
    const orderType = {
      DINE_IN: { count: 0, amount: 0 },
      TAKEAWAY: { count: 0, amount: 0 },
      DELIVERY: { count: 0, amount: 0 },
    };
    for (const row of orderTypeRows) {
      const bucket = orderType[row.orderType];
      if (bucket) {
        bucket.count = row._count._all;
        bucket.amount = num(row._sum.grandTotal);
      }
    }

    // ------------------------------------------------------------
    // Best selling products (+ categories)
    // ------------------------------------------------------------
    const bestSellerIds = bestSellerRows.map((r) => r.productId);
    const bestSellers = await prisma.product.findMany({
      where: { id: { in: bestSellerIds }, restaurantId },
      select: {
        id: true,
        name: true,
        imageUrl: true,
        category: { select: { id: true, name: true } },
      },
    });
    const bestSellerMap = new Map(bestSellers.map((p) => [p.id, p]));

    const bestSellingProducts = bestSellerRows
      .map((row) => {
        const product = bestSellerMap.get(row.productId);
        if (!product) return null;
        return {
          productId: product.id,
          name: product.name,
          imageUrl: product.imageUrl,
          categoryName: product.category?.name || null,
          quantitySold: num(row._sum.quantity),
          revenue: num(row._sum.totalPrice),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    // Category revenue aggregated from the top-50 product rows.
    const productRowsForCategory = await prisma.product.findMany({
      where: {
        id: { in: categoryProductRows.map((r) => r.productId) },
        restaurantId,
      },
      select: {
        id: true,
        category: { select: { id: true, name: true } },
      },
    });
    const productCategoryMap = new Map(
      productRowsForCategory.map((p) => [p.id, p.category])
    );
    const categoryTotals = new Map<
      string,
      { name: string; quantitySold: number; revenue: number }
    >();
    for (const row of categoryProductRows) {
      const cat = productCategoryMap.get(row.productId);
      if (!cat) continue;
      const entry = categoryTotals.get(cat.id) || {
        name: cat.name,
        quantitySold: 0,
        revenue: 0,
      };
      entry.quantitySold += num(row._sum.quantity);
      entry.revenue += num(row._sum.totalPrice);
      categoryTotals.set(cat.id, entry);
    }
    const bestCategories = [...categoryTotals.values()]
      .sort((a, b) => b.quantitySold - a.quantitySold)
      .slice(0, 5);

    // ------------------------------------------------------------
    // Busiest hours
    // ------------------------------------------------------------
    const busiestHours = hourlyRows.map((row) => ({
      hour: Number(row.hour),
      orders: Number(row.orders),
      revenue: Number(row.revenue),
    }));

    const paidCount = paidOrderCount;
    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      filters: {
        orderType: filters?.orderType ?? null,
        paymentMethod: filters?.paymentMethod ?? null,
        status: filters?.status ?? null,
        branchId: filters?.branchId ?? null,
      },
      summary: {
        totalSales,
        grossSales,
        totalOrders: orderCountAll,
        paidOrders: paidCount,
        totalItemsSold,
        averageOrderValue: paidCount > 0 ? totalSales / paidCount : 0,
        totalDiscount,
        totalTax,
        totalServiceCharge,
        totalRefund,
        // Net = product revenue after discount + APPROVED refunds, before tax
        // and service charge (matches the previous formula when refund = 0).
        netSales: totalSales - totalTax - totalServiceCharge - totalRefund,
      },
      paymentBreakdown: buckets,
      orderType,
      bestSellingProducts,
      bestCategories,
      busiestHours,
    };
  }

  /**
   * Order-level rows for the CSV export (non-cancelled orders in range).
   * Bounded to the 5000 most recent orders so the export stays cheap.
   * Accepts the same optional filters as getSalesReport (validated at the
   * ADMIN-only route layer).
   */
  async getSalesOrdersForExport(
    restaurantId: string,
    period: ReportPeriod,
    startDate?: string,
    endDate?: string,
    branchFilters?: string[] | null,
    filters?: ReportFilters
  ) {
    const range = resolveReportRange(period, startDate, endDate);

    const orders = await prisma.order.findMany({
      where: {
        restaurantId,
        ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
        createdAt: { gte: range.start, lte: range.end },
        status: { not: "CANCELLED" },
        ...(filters?.status ? { paymentStatus: filters.status } : {}),
        ...(filters?.orderType ? { orderType: filters.orderType } : {}),
        ...(filters?.paymentMethod
          ? {
              payments: {
                some: { method: filters.paymentMethod, status: "PAID" },
              },
            }
          : {}),
      },
      include: {
        customer: { select: { name: true } },
        payments: {
          select: {
            method: true,
            provider: true,
            status: true,
            paidAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { createdAt: "desc" },
      take: 5000,
    });

    // Newest-first for the DB read, but export chronologically.
    return orders.reverse();
  }

  // ============================================================
  // WAVE 2 — LAPORAN PRODUK
  // ============================================================

  /**
   * Product report aggregated from OrderItem (historical transaction source —
   * never Product.price). Discount is a pro-rata allocation of the order-level
   * discount (weighted by each item's share of the order subtotal) because the
   * schema stores discounts on the Order only, not on OrderItem.
   *
   * Revenue always uses the PAID subset, filtered by the reporting set. Sold
   * rows may reference products that are currently inactive/deleted — they are
   * still reported because OrderItem is the historical source. The current
   * catalog only affects the "unsold products" list.
   */
  async getProductReport(
    restaurantId: string,
    period: ReportPeriod,
    opts?: {
      startDate?: string;
      endDate?: string;
      branchFilters?: string[] | null;
      filters?: ReportFilters;
      categoryId?: string | null;
      productId?: string | null;
      sortBy?: "qty" | "revenue" | "gross";
    }
  ) {
    const range = resolveReportRange(period, opts?.startDate, opts?.endDate);
    const { branchFilters } = opts || {};
    const { filters } = opts || {};
    const soldWhere = revenueWhere(
      restaurantId,
      range,
      branchFilters,
      filters
    );

    const categoryId = opts?.categoryId || null;
    const productParam = opts?.productId || null;
    const sortBy = opts?.sortBy || "qty";

    const orderSql = Prisma.sql`
      ${productParam ? Prisma.sql`AND oi.\`productId\` = ${productParam}` : Prisma.empty}
      ${categoryId ? Prisma.sql`AND oi.\`productId\` IN (SELECT \`id\` FROM \`product\` WHERE \`restaurantId\` = ${restaurantId} AND \`categoryId\` = ${categoryId})` : Prisma.empty}
    `;

    const rows = await prisma.$queryRaw<
      Array<{
        productId: string;
        qty: number | bigint | string;
        gross: number | bigint | string;
        discount: number | bigint | string;
        orderCount: number | bigint | string;
      }>
    >`
      SELECT oi.\`productId\` AS productId,
             COALESCE(SUM(oi.\`quantity\`), 0) AS qty,
             COALESCE(SUM(oi.\`totalPrice\`), 0) AS gross,
             COALESCE(SUM(
               CASE WHEN o.\`subtotal\` > 0
                 THEN oi.\`totalPrice\` * o.\`discount\` / o.\`subtotal\`
                 ELSE 0 END
             ), 0) AS discount,
             COUNT(DISTINCT oi.\`orderId\`) AS orderCount
      FROM \`orderitem\` oi
      JOIN \`order\` o ON o.\`id\` = oi.\`orderId\`
      WHERE o.\`restaurantId\` = ${restaurantId}
        AND o.\`createdAt\` >= ${range.start}
        AND o.\`createdAt\` <= ${range.end}
        AND o.\`status\` <> 'CANCELLED'
        AND o.\`paymentStatus\` = 'PAID'
        ${branchFragment(branchFilters)}
        ${filters?.orderType ? Prisma.sql`AND o.\`orderType\` = ${filters.orderType}` : Prisma.empty}
        ${filters?.paymentMethod ? Prisma.sql`AND o.\`id\` IN (SELECT \`orderId\` FROM \`payment\` WHERE \`method\` = ${filters.paymentMethod} AND \`status\` = 'PAID')` : Prisma.empty}
        ${orderSql}
      GROUP BY oi.\`productId\`
      ORDER BY
        ${sortBy === "qty"
          ? Prisma.sql`COALESCE(SUM(oi.\`quantity\`), 0)`
          : Prisma.sql`COALESCE(SUM(oi.\`totalPrice\`), 0)`} DESC
    `;

    const soldIds = rows.map((r) => r.productId as string).filter(Boolean);

    const [productsMeta, unsoldProducts, soldOrderCount, categories] =
      await Promise.all([
        prisma.product.findMany({
          where: { id: { in: soldIds }, restaurantId },
          select: {
            id: true,
            name: true,
            price: true,
            isActive: true,
            isAvailable: true,
            category: { select: { id: true, name: true } },
          },
        }),
        // Unsold products = current catalog products (active) with no sold
        // items in the period. Never includes deleted/inactive catalog rows.
        prisma.product.findMany({
          where: {
            restaurantId,
            isActive: true,
            ...(categoryId ? { categoryId } : {}),
            ...(productParam ? { id: productParam } : {}),
            ...(branchFilters?.length
              ? {
                  branchProducts: {
                    some: { branchId: { in: branchFilters } },
                  },
                }
              : {}),
            orderItems: { none: { order: { is: soldWhere } } },
          },
          select: {
            id: true,
            name: true,
            price: true,
            isActive: true,
            isAvailable: true,
            category: { select: { id: true, name: true } },
          },
          orderBy: { name: "asc" },
        }),
        prisma.order.count({ where: soldWhere }),
        prisma.category.findMany({
          where: { restaurantId, isActive: true },
          select: { id: true, name: true },
          orderBy: { sortOrder: "asc" },
        }),
      ]);

    const metaMap = new Map(productsMeta.map((p) => [p.id, p]));

    const products = rows
      .map((r) => {
        const meta = metaMap.get(r.productId as string);
        if (!meta) return null;
        const gross = num(r.gross);
        const discount = num(r.discount);
        const netSales = Math.round((gross - discount) * 100) / 100;
        return {
          productId: meta.id,
          name: meta.name,
          categoryId: meta.category?.id ?? null,
          categoryName: meta.category?.name ?? null,
          price: num(meta.price),
          isActive: meta.isActive,
          isAvailable: meta.isAvailable,
          qtySold: num(r.qty),
          grossSales: gross,
          discount,
          netSales,
          revenue: netSales,
          orderCount: Number(r.orderCount),
        };
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);

    products.sort((a, b) => b.grossSales - a.grossSales);
    if (sortBy === "qty") products.sort((a, b) => b.qtySold - a.qtySold);
    else if (sortBy === "revenue" || sortBy === "gross")
      products.sort((a, b) => b.netSales - a.netSales);

    const ranked = products.map((p, i) => ({ ...p, rank: i + 1 }));

    const summary = {
      soldProductCount: ranked.length,
      qtySold: ranked.reduce((s, p) => s + p.qtySold, 0),
      grossSales: ranked.reduce((s, p) => s + p.grossSales, 0),
      discount: ranked.reduce((s, p) => s + p.discount, 0),
      netSales: Math.round(
        (ranked.reduce((s, p) => s + p.netSales, 0)) * 100
      ) / 100,
      orderCount: Number(soldOrderCount),
    };

    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      filters: {
        branchId: filters?.branchId ?? null,
        categoryId: categoryId ?? null,
        productId: productParam ?? null,
        sortBy,
      },
      summary,
      products: ranked,
      unsoldProducts: unsoldProducts.map((p) => ({
        productId: p.id,
        name: p.name,
        categoryId: p.category?.id ?? null,
        categoryName: p.category?.name ?? null,
        price: num(p.price),
        isActive: p.isActive,
        isAvailable: p.isAvailable,
      })),
      categories,
    };
  }

  // ============================================================
  // WAVE 3 — LAPORAN PENJUALAN PER SHIFT
  // ============================================================

  /**
   * Per-shift sales report. Reuses the existing shift semantics:
   *  - CASH (KASIR) and cashier QRIS payments link to the shift via shiftId;
   *    customer-direct QRIS (shiftId NULL) never appears here.
   *  - FAILED / CANCELLED payments are not sales.
   *  - Transaction count = DISTINCT order ids with a PAID payment in the
   *    shift (split payments never double-count an order).
   *  - Expected cash = opening cash + CASH sales − approved refunds (matches
   *    computeShiftTotals in shift.service.ts). Difference = actual − expected.
   */
  async getShiftSalesReport(
    restaurantId: string,
    period: ReportPeriod,
    opts?: {
      startDate?: string;
      endDate?: string;
      branchFilters?: string[] | null;
      filters?: {
        branchId?: string | null;
        cashierId?: string | null;
        status?: "OPEN" | "CLOSED" | null;
      };
    }
  ) {
    const range = resolveReportRange(period, opts?.startDate, opts?.endDate);
    const branchFilters = opts?.branchFilters;
    const { branchId, cashierId, status } = opts?.filters || {};

    const shifts = await prisma.cashierShift.findMany({
      where: {
        restaurantId,
        ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
        ...(branchId ? { branchId } : {}),
        ...(cashierId ? { userId: cashierId } : {}),
        ...(status ? { status } : {}),
        openedAt: { gte: range.start, lte: range.end },
      },
      include: {
        user: { select: { id: true, name: true } },
        branch: { select: { id: true, name: true, code: true } },
      },
      orderBy: { openedAt: "desc" },
      take: 500,
    });

    const shiftIds = shifts.map((s) => s.id);
    const [paymentRows, refundRows] = await Promise.all([
      prisma.payment.findMany({
        where: { shiftId: { in: shiftIds }, status: "PAID" },
        select: { shiftId: true, method: true, provider: true, amount: true, orderId: true },
      }),
      prisma.refund.findMany({
        where: { shiftId: { in: shiftIds }, status: "APPROVED" },
        select: { shiftId: true, amount: true },
      }),
    ]);

    // Per-shift accumulator (mirrors computePaymentBreakdown semantics, adds
    // an "other" bucket for any PAID payment method that is not KASIR/QRIS).
    const acc = new Map<
      string,
      { cash: number; qris: number; other: number; refund: number; orders: Set<string> }
    >();
    for (const r of paymentRows) {
      if (!r.shiftId) continue;
      const e = acc.get(r.shiftId) || { cash: 0, qris: 0, other: 0, refund: 0, orders: new Set<string>() };
      const amt = num(r.amount);
      if (r.method === "KASIR") e.cash += amt;
      else if (r.method === "QRIS") e.qris += amt;
      else e.other += amt;
      e.orders.add(r.orderId);
      acc.set(r.shiftId, e);
    }
    for (const r of refundRows) {
      if (!r.shiftId) continue;
      const e = acc.get(r.shiftId);
      if (e) e.refund += num(r.amount);
    }

    const items = shifts.map((s) => {
      const e = acc.get(s.id);
      const cash = e?.cash ?? 0;
      const qris = e?.qris ?? 0;
      const other = e?.other ?? 0;
      const refund = e?.refund ?? 0;
      const transactionCount = e?.orders.size ?? 0;
      const opening = num(s.openingCash);
      const expectedCash = Math.round((opening + cash - refund) * 100) / 100;
      const actualCash = s.closingCash != null ? num(s.closingCash) : null;
      const difference =
        actualCash != null ? Math.round((actualCash - expectedCash) * 100) / 100 : null;
      return {
        shiftId: s.id,
        shiftNumber: s.shiftNumber,
        cashierId: s.userId,
        cashierName: s.user?.name ?? null,
        branchId: s.branchId ?? null,
        branchName: s.branch?.name ?? null,
        branchCode: s.branch?.code ?? null,
        status: s.status,
        openedAt: s.openedAt.toISOString(),
        closedAt: s.closedAt ? s.closedAt.toISOString() : null,
        openingCash: opening,
        cashSales: cash,
        qrisSales: qris,
        otherPayment: other,
        totalSales: cash + qris + other,
        refund,
        expectedCash,
        actualCash,
        difference,
        transactionCount,
      };
    });

    const summary = {
      totalSales: items.reduce((s, i) => s + i.totalSales, 0),
      cash: items.reduce((s, i) => s + i.cashSales, 0),
      qris: items.reduce((s, i) => s + i.qrisSales, 0),
      other: items.reduce((s, i) => s + i.otherPayment, 0),
      refund: items.reduce((s, i) => s + i.refund, 0),
      transactions: items.reduce((s, i) => s + i.transactionCount, 0),
      difference: items.reduce(
        (s, i) => s + (i.difference ?? 0),
        0
      ),
    };

    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      filters: {
        branchId: branchId ?? null,
        cashierId: cashierId ?? null,
        status: status ?? null,
      },
      summary,
      items,
    };
  }

  // ============================================================
  // WAVE 4 — LAPORAN PEMBAYARAN
  // ============================================================

  /**
   * Payment report (payment activity, NOT revenue unless PAID). Paginated
   * with bounded defaults. NEVER exposes paymentUrl / provider secrets /
   * qrImage / qrString / providerRef.
   */
  async getPaymentReport(
    restaurantId: string,
    period: ReportPeriod,
    opts?: {
      startDate?: string;
      endDate?: string;
      branchFilters?: string[] | null;
      filters?: {
        branchId?: string | null;
        cashierId?: string | null;
        shiftId?: string | null;
        method?: string | null;
        status?: string | null;
      };
      pagination?: ReportPagination;
    }
  ) {
    const range = resolveReportRange(period, opts?.startDate, opts?.endDate);
    const branchFilters = opts?.branchFilters;
    const { branchId, cashierId, shiftId, method, status } = opts?.filters || {};

    const page = Math.max(1, opts?.pagination?.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts?.pagination?.limit ?? 50));
    const skip = (page - 1) * limit;

    const where: Prisma.PaymentWhereInput = {
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      ...(branchId ? { branchId } : {}),
      ...(cashierId ? { shift: { userId: cashierId } } : {}),
      ...(shiftId ? { shiftId } : {}),
      ...(method ? { method: method as "KASIR" | "QRIS" } : {}),
      ...(status ? { status: status as PaymentStatus } : {}),
      createdAt: { gte: range.start, lte: range.end },
    };

    const [total, amountAgg, paidAgg, distinctOrders, statusBuckets, items] =
      await Promise.all([
        prisma.payment.count({ where }),
        prisma.payment.aggregate({ where, _sum: { amount: true } }),
        prisma.payment.aggregate({
          where: { ...where, status: "PAID" },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        prisma.payment.groupBy({
          by: ["orderId"],
          where,
          _count: { _all: true },
        }),
        prisma.payment.groupBy({
          by: ["status"],
          where,
          _count: { _all: true },
          _sum: { amount: true },
        }),
        prisma.payment.findMany({
          where,
          select: {
            id: true,
            orderId: true,
            branchId: true,
            method: true,
            status: true,
            amount: true,
            createdAt: true,
            paidAt: true,
            order: { select: { orderNumber: true } },
            shift: {
              select: {
                shiftNumber: true,
                user: { select: { id: true, name: true } },
              },
            },
            branch: { select: { code: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          skip,
          take: limit,
        }),
      ]);

    const paidAmount = num(paidAgg._sum.amount);
    const statusList = statusBuckets.map((b) => ({
      status: b.status,
      count: b._count._all,
      amount: num(b._sum.amount),
    }));

    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      filters: {
        branchId: branchId ?? null,
        cashierId: cashierId ?? null,
        shiftId: shiftId ?? null,
        method: method ?? null,
        status: status ?? null,
      },
      summary: {
        totalPayments: total,
        totalAmount: num(amountAgg._sum.amount),
        // PAID is the only revenue bucket; everything else is activity only.
        paidAmount,
        paidCount: paidAgg._count._all,
        totalOrders: distinctOrders.length,
      },
      statusBreakdown: statusList,
      items: items.map((p) => ({
        paymentId: p.id,
        orderId: p.orderId,
        orderNumber: p.order?.orderNumber ?? null,
        date: p.createdAt.toISOString(),
        paidAt: p.paidAt ? p.paidAt.toISOString() : null,
        branchId: p.branchId ?? null,
        branchCode: p.branch?.code ?? null,
        branchName: p.branch?.name ?? null,
        shiftNumber: p.shift?.shiftNumber ?? null,
        cashierId: p.shift?.user?.id ?? null,
        cashierName: p.shift?.user?.name ?? null,
        method: p.method,
        status: p.status,
        amount: num(p.amount),
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Payment rows for CSV export — the SAME filters/semantics as
   * getPaymentReport but UNPAGINATED and bounded (take: 5000). Chronological
   * (createdAt asc). Never exposes paymentUrl / provider / providerRef /
   * qrImage / qrString / internal IDs. Refund per row = sum of APPROVED
   * refunds linked to that payment within the report range (matches the
   * sales report's APPROVED-only refund semantics; 0 when none).
   */
  async getPaymentsForExport(
    restaurantId: string,
    period: ReportPeriod,
    opts?: {
      startDate?: string;
      endDate?: string;
      branchFilters?: string[] | null;
      filters?: {
        branchId?: string | null;
        cashierId?: string | null;
        shiftId?: string | null;
        method?: string | null;
        status?: string | null;
      };
    }
  ) {
    const range = resolveReportRange(period, opts?.startDate, opts?.endDate);
    const branchFilters = opts?.branchFilters;
    const { branchId, cashierId, shiftId, method, status } = opts?.filters || {};

    const where: Prisma.PaymentWhereInput = {
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
      ...(branchId ? { branchId } : {}),
      ...(cashierId ? { shift: { userId: cashierId } } : {}),
      ...(shiftId ? { shiftId } : {}),
      ...(method ? { method: method as "KASIR" | "QRIS" } : {}),
      ...(status ? { status: status as PaymentStatus } : {}),
      createdAt: { gte: range.start, lte: range.end },
    };

    const payments = await prisma.payment.findMany({
      where,
      select: {
        id: true,
        createdAt: true,
        paidAt: true,
        method: true,
        status: true,
        amount: true,
        order: { select: { orderNumber: true } },
        shift: {
          select: {
            shiftNumber: true,
            user: { select: { name: true } },
          },
        },
        branch: { select: { code: true, name: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 5000,
    });

    // Approved refunds linked to the exported payments (same date range).
    const ids = payments.map((p) => p.id);
    const refundRows =
      ids.length > 0
        ? await prisma.refund.findMany({
            where: {
              paymentId: { in: ids },
              status: "APPROVED",
              approvedAt: { gte: range.start, lte: range.end },
            },
            select: { paymentId: true, amount: true },
          })
        : [];
    const refundByPayment = new Map<string, number>();
    for (const r of refundRows) {
      if (!r.paymentId) continue;
      refundByPayment.set(
        r.paymentId,
        (refundByPayment.get(r.paymentId) ?? 0) + num(r.amount)
      );
    }

    return {
      count: payments.length,
      items: payments.map((p) => ({
        createdAt: p.createdAt.toISOString(),
        paidAt: p.paidAt ? p.paidAt.toISOString() : "",
        orderNumber: p.order?.orderNumber ?? "",
        branchCode: p.branch?.code ?? "",
        branchName: p.branch?.name ?? "",
        shiftNumber: p.shift?.shiftNumber ?? "",
        cashierName: p.shift?.user?.name ?? "",
        method: p.method ?? "",
        status: p.status,
        amount: num(p.amount),
        refund: refundByPayment.get(p.id) ?? 0,
      })),
    };
  }

  // ============================================================
  // WAVE 5 — LAPORAN MULTI OUTLET
  // ============================================================

  /**
   * Multi-outlet comparison (ADMIN only at the route). Aggregates per branch
   * via database GROUP BY queries scoped to `authorizedBranches(ctx)` — it
   * never loops per branch and never trusts a client-supplied id. Metrics use
   * the same revenue semantics as the sales report (PAID, non-cancelled).
   */
  async getMultiOutletReport(
    restaurantId: string,
    period: ReportPeriod,
    startDate?: string,
    endDate?: string,
    branchFilters?: string[] | null
  ) {
    const range = resolveReportRange(period, startDate, endDate);

    const [
      branches,
      orderRows,
      itemRows,
      paymentRows,
      refundRows,
      orderTypeRows,
      productRows,
    ] = await Promise.all([
      prisma.branch.findMany({
        where: {
          restaurantId,
          ...(branchFilters?.length ? { id: { in: branchFilters } } : {}),
        },
        select: { id: true, code: true, name: true, isActive: true },
        orderBy: { name: "asc" },
      }),
      prisma.$queryRaw<
        Array<{
          branchId: string | null;
          orders: number | bigint;
          gross: number | bigint | string;
          discount: number | bigint | string;
          tax: number | bigint | string;
          serviceCharge: number | bigint | string;
          total: number | bigint | string;
        }>
      >`
        SELECT o.\`branchId\` AS branchId,
               COUNT(*) AS orders,
               COALESCE(SUM(o.\`subtotal\`), 0) AS gross,
               COALESCE(SUM(o.\`discount\`), 0) AS discount,
               COALESCE(SUM(o.\`tax\`), 0) AS tax,
               COALESCE(SUM(o.\`serviceCharge\`), 0) AS serviceCharge,
               COALESCE(SUM(o.\`grandTotal\`), 0) AS total
        FROM \`order\` o
        WHERE o.\`restaurantId\` = ${restaurantId}
          AND o.\`createdAt\` >= ${range.start}
          AND o.\`createdAt\` <= ${range.end}
          AND o.\`status\` <> 'CANCELLED'
          AND o.\`paymentStatus\` = 'PAID'
          AND o.\`branchId\` IS NOT NULL
          ${branchFragment(branchFilters)}
        GROUP BY o.\`branchId\`
      `,
      prisma.$queryRaw<
        Array<{ branchId: string | null; items: number | bigint }>
      >`
        SELECT o.\`branchId\` AS branchId,
               COALESCE(SUM(oi.\`quantity\`), 0) AS items
        FROM \`orderitem\` oi
        JOIN \`order\` o ON o.\`id\` = oi.\`orderId\`
        WHERE o.\`restaurantId\` = ${restaurantId}
          AND o.\`createdAt\` >= ${range.start}
          AND o.\`createdAt\` <= ${range.end}
          AND o.\`status\` <> 'CANCELLED'
          AND o.\`paymentStatus\` = 'PAID'
          AND o.\`branchId\` IS NOT NULL
          ${branchFragment(branchFilters)}
        GROUP BY o.\`branchId\`
      `,
      prisma.$queryRaw<
        Array<{
          branchId: string | null;
          method: string | null;
          cnt: number | bigint;
          amount: number | bigint | string;
        }>
      >`
        SELECT p.\`branchId\` AS branchId,
               p.\`method\` AS method,
               COUNT(*) AS cnt,
               COALESCE(SUM(p.\`amount\`), 0) AS amount
        FROM \`payment\` p
        WHERE p.\`restaurantId\` = ${restaurantId}
          AND p.\`createdAt\` >= ${range.start}
          AND p.\`createdAt\` <= ${range.end}
          AND p.\`status\` = 'PAID'
          AND p.\`branchId\` IS NOT NULL
          ${branchFragment(branchFilters)}
        GROUP BY p.\`branchId\`, p.\`method\`
      `,
      prisma.$queryRaw<
        Array<{ branchId: string | null; amount: number | bigint | string }>
      >`
        SELECT r.\`branchId\` AS branchId,
               COALESCE(SUM(r.\`amount\`), 0) AS amount
        FROM \`refund\` r
        WHERE r.\`restaurantId\` = ${restaurantId}
          AND r.\`status\` = 'APPROVED'
          AND r.\`approvedAt\` >= ${range.start}
          AND r.\`approvedAt\` <= ${range.end}
          AND r.\`branchId\` IS NOT NULL
          ${branchFragment(branchFilters)}
        GROUP BY r.\`branchId\`
      `,
      prisma.$queryRaw<
        Array<{
          branchId: string | null;
          orderType: string;
          cnt: number | bigint;
          amount: number | bigint | string;
        }>
      >`
        SELECT o.\`branchId\` AS branchId,
               o.\`orderType\` AS orderType,
               COUNT(*) AS cnt,
               COALESCE(SUM(o.\`grandTotal\`), 0) AS amount
        FROM \`order\` o
        WHERE o.\`restaurantId\` = ${restaurantId}
          AND o.\`createdAt\` >= ${range.start}
          AND o.\`createdAt\` <= ${range.end}
          AND o.\`status\` <> 'CANCELLED'
          AND o.\`paymentStatus\` = 'PAID'
          AND o.\`branchId\` IS NOT NULL
          ${branchFragment(branchFilters)}
        GROUP BY o.\`branchId\`, o.\`orderType\`
      `,
      prisma.$queryRaw<
        Array<{
          branchId: string | null;
          productId: string | null;
          qty: number | bigint;
          revenue: number | bigint | string;
        }>
      >`
        SELECT o.\`branchId\` AS branchId,
               oi.\`productId\` AS productId,
               COALESCE(SUM(oi.\`quantity\`), 0) AS qty,
               COALESCE(SUM(oi.\`totalPrice\`), 0) AS revenue
        FROM \`orderitem\` oi
        JOIN \`order\` o ON o.\`id\` = oi.\`orderId\`
        WHERE o.\`restaurantId\` = ${restaurantId}
          AND o.\`createdAt\` >= ${range.start}
          AND o.\`createdAt\` <= ${range.end}
          AND o.\`status\` <> 'CANCELLED'
          AND o.\`paymentStatus\` = 'PAID'
          AND o.\`branchId\` IS NOT NULL
          ${branchFragment(branchFilters)}
        GROUP BY o.\`branchId\`, oi.\`productId\`
      `,
    ]);

    const orderMap = new Map(
      orderRows
        .filter((r) => r.branchId)
        .map((r) => [r.branchId as string, r as NonNullable<typeof r>])
    );
    const itemMap = new Map(
      itemRows
        .filter((r) => r.branchId)
        .map((r) => [r.branchId as string, r as NonNullable<typeof r>])
    );
    const refundMap = new Map(
      refundRows
        .filter((r) => r.branchId)
        .map((r) => [r.branchId as string, r as NonNullable<typeof r>])
    );

    // Payment per branch (method buckets).
    const paymentByBranch = new Map<
      string,
      { cash: number; qris: number; other: number; count: number }
    >();
    for (const r of paymentRows) {
      if (!r.branchId) continue;
      const e = paymentByBranch.get(r.branchId) || {
        cash: 0,
        qris: 0,
        other: 0,
        count: 0,
      };
      const amt = num(r.amount);
      if (r.method === "KASIR") e.cash += amt;
      else if (r.method === "QRIS") e.qris += amt;
      else e.other += amt;
      e.count += Number(r.cnt);
      paymentByBranch.set(r.branchId, e);
    }

    // Order type per branch.
    const orderTypeByBranch = new Map<
      string,
      Record<string, { count: number; amount: number }>
    >();
    for (const r of orderTypeRows) {
      if (!r.branchId) continue;
      const e = orderTypeByBranch.get(r.branchId) || {};
      e[r.orderType] = {
        count: Number(r.cnt),
        amount: num(r.amount),
      };
      orderTypeByBranch.set(r.branchId, e);
    }

    // Best selling product per branch (top by qty).
    const bestByBranch = new Map<
      string,
      { productId: string; qty: number; revenue: number }
    >();
    for (const r of productRows) {
      if (!r.branchId || !r.productId) continue;
      const cur = bestByBranch.get(r.branchId);
      const qty = Number(r.qty);
      if (!cur || qty > cur.qty) {
        bestByBranch.set(r.branchId, {
          productId: r.productId,
          qty,
          revenue: num(r.revenue),
        });
      }
    }

    // Hydrate product names for each outlet's top seller.
    const bestProductIds = [
      ...new Set([...bestByBranch.values()].map((b) => b.productId)),
    ];
    const bestProducts = await prisma.product.findMany({
      where: { id: { in: bestProductIds }, restaurantId },
      select: { id: true, name: true },
    });
    const bestProductMap = new Map(bestProducts.map((p) => [p.id, p]));

    const outlets = branches.map((b) => {
      const ord = orderMap.get(b.id);
      const itm = itemMap.get(b.id);
      const rf = refundMap.get(b.id);
      const pmt = paymentByBranch.get(b.id);
      const ot = orderTypeByBranch.get(b.id);
      const best = bestByBranch.get(b.id);

      const orders = Number(ord?.orders ?? 0);
      const gross = num(ord?.gross);
      const discount = num(ord?.discount);
      const tax = num(ord?.tax);
      const serviceCharge = num(ord?.serviceCharge);
      const total = num(ord?.total);
      const refund = num(rf?.amount);
      const items = Number(itm?.items ?? 0);

      return {
        branchId: b.id,
        branchCode: b.code,
        branchName: b.name,
        isActive: b.isActive,
        orders,
        items,
        grossSales: gross,
        discount,
        tax,
        serviceCharge,
        refund,
        totalSales: total,
        netSales: Math.round((total - tax - serviceCharge - refund) * 100) / 100,
        aov: orders > 0 ? Math.round((total / orders) * 100) / 100 : 0,
        cash: pmt?.cash ?? 0,
        qris: pmt?.qris ?? 0,
        other: pmt?.other ?? 0,
        paymentCount: pmt?.count ?? 0,
        orderType: {
          DINE_IN: ot?.DINE_IN ?? { count: 0, amount: 0 },
          TAKEAWAY: ot?.TAKEAWAY ?? { count: 0, amount: 0 },
          DELIVERY: ot?.DELIVERY ?? { count: 0, amount: 0 },
        },
        bestSellingProduct: best
          ? {
              productId: best.productId,
              name: bestProductMap.get(best.productId)?.name ?? null,
              qtySold: best.qty,
              revenue: best.revenue,
            }
          : null,
      };
    });

    // Ranking (by total sales, then by order count).
    const bySales = [...outlets].sort((a, b) => b.totalSales - a.totalSales);
    const salesRank = new Map(bySales.map((o, i) => [o.branchId, i + 1]));
    const byOrders = [...outlets].sort((a, b) => b.orders - a.orders);
    const orderRank = new Map(byOrders.map((o, i) => [o.branchId, i + 1]));

    const rankedOutlets = outlets.map((o) => ({
      ...o,
      rank: salesRank.get(o.branchId) ?? 0,
      rankBySales: salesRank.get(o.branchId) ?? 0,
      rankByOrders: orderRank.get(o.branchId) ?? 0,
    }));

    const summary = {
      totalOrders: outlets.reduce((s, o) => s + o.orders, 0),
      totalItems: outlets.reduce((s, o) => s + o.items, 0),
      grossSales: outlets.reduce((s, o) => s + o.grossSales, 0),
      discount: outlets.reduce((s, o) => s + o.discount, 0),
      tax: outlets.reduce((s, o) => s + o.tax, 0),
      serviceCharge: outlets.reduce((s, o) => s + o.serviceCharge, 0),
      refund: outlets.reduce((s, o) => s + o.refund, 0),
      netSales: outlets.reduce((s, o) => s + o.netSales, 0),
      cash: outlets.reduce((s, o) => s + o.cash, 0),
      qris: outlets.reduce((s, o) => s + o.qris, 0),
      other: outlets.reduce((s, o) => s + o.other, 0),
    };

    return {
      period,
      range: {
        start: range.start.toISOString(),
        end: range.end.toISOString(),
      },
      summary,
      outlets: rankedOutlets,
    };
  }
}

export const reportService = new ReportService();