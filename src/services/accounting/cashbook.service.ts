import { prisma } from "@/lib/prisma";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { round2 } from "@/lib/money";
import {
  CashbookQuerySchema,
  CASHBOOK_METHODS,
  CASHBOOK_TYPES,
  type CashbookMethod,
  type CashbookQuery,
  type CashbookSource,
  type CashbookType,
} from "./cashbook.types";

// ============================================================
// CASHBOOK — READ-MODEL (ACCOUNTING PHASE C)
//
// A READ-ONLY projection that unifies three EXISTING sources into one cash
// movement list + summary. It is NOT a new ledger and it writes nothing.
//
// Sources (never re-derived, never mutated):
//   * Payment  — status PAID or REFUNDED  (COLLECTED set), date = paidAt
//   * Refund   — status APPROVED,                       date = approvedAt
//   * Expense  — every row,                             date = spentAt
//
// Non-negotiable dedup rules (see ACCOUNTING-PHASE-C-AUDIT.md §5):
//   * ONE Payment row counted ONCE (per row, never per Order — split tender is
//     legitimate); `PaymentTransaction` is NEVER summed (it mirrors Payment and
//     carries the negative refund row → would double-count). It is not exposed.
//   * ONE Refund counted ONCE, from the `Refund` table only (not the
//     `PaymentTransaction` refund row).
//   * Order omzet is never added as cash; Purchase is never an Expense.
//   * `netMovement` is a PERIOD movement, NOT an absolute balance. Opening
//     balance is unavailable, so no running balance is produced.
//   * QRIS is NOT settled money until proven: it is a separate bucket with
//     `settlementVerified: false`.
//   * A null `shiftId` NEVER hides a row — it is kept and flagged
//     `shiftAttributed: false`.
//
// Tenant (`restaurantId`) always comes from the session; branch isolation is
// enforced through `branchFilters` (authorizedBranches).
// ============================================================

/** Per-source safety cap so a pathological tenant cannot blow up memory. */
const FETCH_CAP = 20000;

const METHOD_LABEL: Record<string, string> = {
  KASIR: "Tunai (KASIR)",
  QRIS: "QRIS",
  CASH: "Tunai",
  TRANSFER: "Transfer",
  CARD: "Kartu",
  OTHER: "Lainnya",
};

function label(method: string | null): string {
  if (!method) return "Tidak diketahui";
  return METHOD_LABEL[method] ?? method;
}

// ------------------------------------------------------------
// Date helpers — local-day semantics, matching the report/audit patterns.
// ------------------------------------------------------------

function toStartOfDay(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00.000`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function toEndOfDay(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// ------------------------------------------------------------
// Scope predicate — shared by every source (mirrors the expense service).
// ------------------------------------------------------------

function branchPredicate(
  requestedBranchId: string | null | undefined,
  branchFilters?: string[] | null
): Record<string, unknown> {
  if (
    requestedBranchId &&
    branchFilters?.length &&
    !branchFilters.includes(requestedBranchId)
  ) {
    throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
  }
  if (requestedBranchId) return { branchId: requestedBranchId };
  if (branchFilters?.length) return { branchId: { in: branchFilters } };
  return {};
}

// ------------------------------------------------------------
// Entry + summary shapes.
// ------------------------------------------------------------

export interface CashbookEntry {
  id: string;
  source: CashbookSource;
  type: CashbookType;
  method: string | null;
  methodLabel: string;
  status: string | null;
  date: string;
  /** True when a null date was substituted with a fallback (createdAt). */
  dateFallback: boolean;
  amount: number;
  signedAmount: number;
  branchId: string | null;
  branchCode: string | null;
  branchName: string | null;
  orderId: string | null;
  orderNumber: string | null;
  orderStatus: string | null;
  shiftId: string | null;
  shiftNumber: string | null;
  /** shiftId != null — false = not attributable to a cashier drawer. */
  shiftAttributed: boolean;
  categoryName: string | null;
  reference: string | null;
  note: string | null;
  /** A physical-cash instrument (KASIR payment / cash refund / CASH expense). */
  isCash: boolean;
  /** Non-cash whose external settlement is not recorded (QRIS). */
  settlementVerified: boolean;
  /** A Payment collected on a CANCELLED order (indicator only — not revenue). */
  onCancelledOrder: boolean;
}

export interface CashbookSummary {
  totalIn: number;
  totalOut: number;
  netMovement: number;
  inflow: {
    kasir: number;
    qris: number;
    other: number;
    total: number;
  };
  outflow: {
    refundKasir: number;
    refundQris: number;
    refundUnknown: number;
    expenseCash: number;
    expenseTransfer: number;
    expenseQris: number;
    expenseCard: number;
    expenseOther: number;
    total: number;
  };
  /** Physically attributable cash movement only. */
  attributableCash: { in: number; out: number; net: number };
  /** Non-cash movement (not proof of bank).
   *  `in` = qris + other; `out` = all non-cash outflow. */
  nonCash: { in: number; out: number; net: number };
  /** Rows kept but not tied to a shift. */
  unattributedShift: { count: number; inAmount: number; outAmount: number };
  /** Collected payments whose order is CANCELLED (indicator). */
  collectedOnCancelledOrders: { count: number; amount: number };
  /** QRIS funds are NOT proven settled. */
  qrisSettlementVerified: false;
  /** Absolute balance is unavailable — never fabricated. */
  openingBalance: null;
}

export interface CashbookResult {
  items: CashbookEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  range: { start: string | null; end: string | null };
  filters: {
    branchId: string | null;
    type: CashbookType | null;
    method: CashbookMethod | null;
    dateFrom: string | null;
    dateTo: string | null;
    search: string | null;
  };
  summary: CashbookSummary;
  meta: {
    methods: readonly string[];
    types: readonly string[];
    /** At least one source hit FETCH_CAP — totals may be incomplete. */
    truncated: boolean;
  };
}

// ------------------------------------------------------------
// Source loaders (all tenant + branch scoped by construction).
// ------------------------------------------------------------

async function loadPaymentEntries(
  restaurantId: string,
  branchWhere: Record<string, unknown>,
  gte: Date | undefined,
  lte: Date | undefined
): Promise<{ entries: CashbookEntry[]; truncated: boolean }> {
  const rows = await prisma.payment.findMany({
    where: {
      restaurantId,
      // COLLECTED set — a refunded payment WAS collected (excluded would make
      // the inflow vanish while the refund outflow remained).
      status: { in: ["PAID", "REFUNDED"] },
      ...branchWhere,
      ...(gte || lte
        ? {
            OR: [
              {
                paidAt: {
                  ...(gte ? { gte } : {}),
                  ...(lte ? { lte } : {}),
                },
              },
              // Fallback: a collected payment with a null paidAt is bucketed by
              // its createdAt and explicitly flagged as a fallback.
              {
                paidAt: null,
                createdAt: {
                  ...(gte ? { gte } : {}),
                  ...(lte ? { lte } : {}),
                },
              },
            ],
          }
        : {}),
    },
    select: {
      id: true,
      amount: true,
      method: true,
      status: true,
      paidAt: true,
      createdAt: true,
      branchId: true,
      orderId: true,
      shiftId: true,
      order: { select: { orderNumber: true, status: true } },
      branch: { select: { code: true, name: true } },
      shift: { select: { shiftNumber: true } },
    },
    orderBy: [{ paidAt: "desc" }, { createdAt: "desc" }],
    take: FETCH_CAP,
  });

  const entries: CashbookEntry[] = rows.map((p) => {
    const fallback = !p.paidAt;
    const d = p.paidAt ?? p.createdAt;
    const method = p.method;
    return {
      id: `payment:${p.id}`,
      source: "PAYMENT",
      type: "IN",
      method,
      methodLabel: label(method),
      status: p.status,
      date: d.toISOString(),
      dateFallback: fallback,
      amount: round2(Number(p.amount)),
      signedAmount: round2(Number(p.amount)),
      branchId: p.branchId,
      branchCode: p.branch?.code ?? null,
      branchName: p.branch?.name ?? null,
      orderId: p.orderId,
      orderNumber: p.order?.orderNumber ?? null,
      orderStatus: p.order?.status ?? null,
      shiftId: p.shiftId,
      shiftNumber: p.shift?.shiftNumber ?? null,
      shiftAttributed: Boolean(p.shiftId),
      categoryName: null,
      reference: p.order?.orderNumber ?? null,
      note: null,
      isCash: method === "KASIR",
      settlementVerified: method !== "QRIS",
      onCancelledOrder: p.order?.status === "CANCELLED",
    };
  });
  return { entries, truncated: rows.length === FETCH_CAP };
}

async function loadRefundEntries(
  restaurantId: string,
  branchWhere: Record<string, unknown>,
  gte: Date | undefined,
  lte: Date | undefined
): Promise<{ entries: CashbookEntry[]; truncated: boolean }> {
  const rows = await prisma.refund.findMany({
    where: {
      restaurantId,
      status: "APPROVED",
      ...branchWhere,
      ...(gte || lte
        ? {
            approvedAt: {
              ...(gte ? { gte } : {}),
              ...(lte ? { lte } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      amount: true,
      status: true,
      approvedAt: true,
      createdAt: true,
      branchId: true,
      orderId: true,
      shiftId: true,
      order: { select: { orderNumber: true, status: true } },
      // NOTE: `Refund` has NO `branch` relation (only the `branchId` scalar),
      // so branch display names are resolved with a batched lookup below.
      shift: { select: { shiftNumber: true } },
      // Parent payment method determines cash vs non-cash (may be null).
      payment: { select: { method: true } },
    },
    orderBy: [{ approvedAt: "desc" }, { createdAt: "desc" }],
    take: FETCH_CAP,
  });

  const branchIds = [
    ...new Set(rows.map((r) => r.branchId).filter((id): id is string => Boolean(id))),
  ];
  const branches = branchIds.length
    ? await prisma.branch.findMany({
        where: { id: { in: branchIds } },
        select: { id: true, code: true, name: true },
      })
    : [];
  const branchMap = new Map(branches.map((b) => [b.id, b]));

  const entries: CashbookEntry[] = rows.map((r) => {
    const fallback = !r.approvedAt;
    const d = r.approvedAt ?? r.createdAt;
    const method = r.payment?.method ?? null;
    return {
      id: `refund:${r.id}`,
      source: "REFUND",
      type: "OUT",
      method,
      methodLabel: label(method),
      status: r.status,
      date: d.toISOString(),
      dateFallback: fallback,
      amount: round2(Number(r.amount)),
      signedAmount: -round2(Number(r.amount)),
      branchId: r.branchId,
      branchCode: r.branchId ? (branchMap.get(r.branchId)?.code ?? null) : null,
      branchName: r.branchId ? (branchMap.get(r.branchId)?.name ?? null) : null,
      orderId: r.orderId,
      orderNumber: r.order?.orderNumber ?? null,
      orderStatus: r.order?.status ?? null,
      shiftId: r.shiftId,
      shiftNumber: r.shift?.shiftNumber ?? null,
      shiftAttributed: Boolean(r.shiftId),
      categoryName: null,
      reference: r.order?.orderNumber ?? null,
      note: null,
      // A refund is cash only when the underlying payment was KASIR.
      isCash: method === "KASIR",
      settlementVerified: method !== "QRIS",
      onCancelledOrder: false,
    };
  });
  return { entries, truncated: rows.length === FETCH_CAP };
}

async function loadExpenseEntries(
  restaurantId: string,
  branchWhere: Record<string, unknown>,
  gte: Date | undefined,
  lte: Date | undefined
): Promise<{ entries: CashbookEntry[]; truncated: boolean }> {
  const rows = await prisma.expense.findMany({
    where: {
      restaurantId,
      ...branchWhere,
      ...(gte || lte
        ? {
            spentAt: {
              ...(gte ? { gte } : {}),
              ...(lte ? { lte } : {}),
            },
          }
        : {}),
    },
    select: {
      id: true,
      amount: true,
      spentAt: true,
      method: true,
      note: true,
      branchId: true,
      category: { select: { name: true } },
      branch: { select: { code: true, name: true } },
    },
    orderBy: [{ spentAt: "desc" }],
    take: FETCH_CAP,
  });

  const entries: CashbookEntry[] = rows.map((e) => ({
    id: `expense:${e.id}`,
    source: "EXPENSE",
    type: "OUT",
    method: e.method,
    methodLabel: label(e.method),
    status: null,
    date: e.spentAt.toISOString(),
    dateFallback: false,
    amount: round2(Number(e.amount)),
    signedAmount: -round2(Number(e.amount)),
    branchId: e.branchId,
    branchCode: e.branch?.code ?? null,
    branchName: e.branch?.name ?? null,
    orderId: null,
    orderNumber: null,
    orderStatus: null,
    // Expenses have no drawer shift; they are never shift-attributed.
    shiftId: null,
    shiftNumber: null,
    shiftAttributed: false,
    categoryName: e.category?.name ?? null,
    reference: e.category?.name ?? null,
    note: e.note,
    isCash: e.method === "CASH",
    settlementVerified: e.method !== "QRIS",
    onCancelledOrder: false,
  }));
  return { entries, truncated: rows.length === FETCH_CAP };
}

// ------------------------------------------------------------
// Summary builder.
// ------------------------------------------------------------

function buildSummary(entries: CashbookEntry[]): CashbookSummary {
  const inflow = { kasir: 0, qris: 0, other: 0 };
  const outflow = {
    refundKasir: 0,
    refundQris: 0,
    refundUnknown: 0,
    expenseCash: 0,
    expenseTransfer: 0,
    expenseQris: 0,
    expenseCard: 0,
    expenseOther: 0,
  };
  let totalIn = 0;
  let totalOut = 0;
  let unattributedCount = 0;
  let unattributedIn = 0;
  let unattributedOut = 0;
  let cancelledCount = 0;
  let cancelledAmount = 0;

  for (const e of entries) {
    if (e.type === "IN") {
      totalIn += e.amount;
      if (e.method === "KASIR") inflow.kasir += e.amount;
      else if (e.method === "QRIS") inflow.qris += e.amount;
      else inflow.other += e.amount;
    } else {
      totalOut += e.amount;
      if (e.source === "REFUND") {
        if (e.method === "KASIR") outflow.refundKasir += e.amount;
        else if (e.method === "QRIS") outflow.refundQris += e.amount;
        else outflow.refundUnknown += e.amount;
      } else {
        if (e.method === "CASH") outflow.expenseCash += e.amount;
        else if (e.method === "TRANSFER") outflow.expenseTransfer += e.amount;
        else if (e.method === "QRIS") outflow.expenseQris += e.amount;
        else if (e.method === "CARD") outflow.expenseCard += e.amount;
        else outflow.expenseOther += e.amount;
      }
    }

    if (!e.shiftAttributed) {
      unattributedCount += 1;
      if (e.type === "IN") unattributedIn += e.amount;
      else unattributedOut += e.amount;
    }
    if (e.onCancelledOrder) {
      cancelledCount += 1;
      cancelledAmount += e.amount;
    }
  }

  const inflowKasir = round2(inflow.kasir);
  const inflowQris = round2(inflow.qris);
  const inflowOther = round2(inflow.other);
  const r = round2;

  const out = {
    refundKasir: r(outflow.refundKasir),
    refundQris: r(outflow.refundQris),
    refundUnknown: r(outflow.refundUnknown),
    expenseCash: r(outflow.expenseCash),
    expenseTransfer: r(outflow.expenseTransfer),
    expenseQris: r(outflow.expenseQris),
    expenseCard: r(outflow.expenseCard),
    expenseOther: r(outflow.expenseOther),
    total: r(totalOut),
  };
  const totalInR = r(totalIn);
  const nonCashOut = round2(
    out.refundQris + out.refundUnknown + out.expenseTransfer + out.expenseQris + out.expenseCard + out.expenseOther
  );
  const cashOut = round2(out.refundKasir + out.expenseCash);
  const nonCashIn = round2(inflowQris + inflowOther);

  return {
    totalIn: totalInR,
    totalOut: r(totalOut),
    netMovement: round2(totalInR - r(totalOut)),
    inflow: {
      kasir: inflowKasir,
      qris: inflowQris,
      other: inflowOther,
      total: totalInR,
    },
    outflow: out,
    attributableCash: {
      in: inflowKasir,
      out: cashOut,
      net: round2(inflowKasir - cashOut),
    },
    nonCash: {
      in: nonCashIn,
      out: nonCashOut,
      net: round2(nonCashIn - nonCashOut),
    },
    unattributedShift: {
      count: unattributedCount,
      inAmount: round2(unattributedIn),
      outAmount: round2(unattributedOut),
    },
    collectedOnCancelledOrders: {
      count: cancelledCount,
      amount: round2(cancelledAmount),
    },
    qrisSettlementVerified: false,
    openingBalance: null,
  };
}

// ------------------------------------------------------------
// Public API.
// ------------------------------------------------------------

export const CASHBOOK_FETCH_CAP = FETCH_CAP;

/**
 * Fetch + filter + sort once, so the list and the CSV can never diverge.
 * `type`/`method`/`search` are applied on the derived fields in the app layer.
 */
async function collectEntries(
  restaurantId: string,
  q: CashbookQuery,
  branchFilters?: string[] | null
): Promise<{ entries: CashbookEntry[]; truncated: boolean }> {
  const gte = toStartOfDay(q.dateFrom);
  const lte = toEndOfDay(q.dateTo);
  const branchWhere = branchPredicate(q.branchId, branchFilters);

  const [payments, refunds, expenses] = await Promise.all([
    loadPaymentEntries(restaurantId, branchWhere, gte, lte),
    loadRefundEntries(restaurantId, branchWhere, gte, lte),
    loadExpenseEntries(restaurantId, branchWhere, gte, lte),
  ]);

  let entries = [...payments.entries, ...refunds.entries, ...expenses.entries];
  if (q.type) entries = entries.filter((e) => e.type === q.type);
  if (q.method) entries = entries.filter((e) => e.method === q.method);
  if (q.search) {
    const needle = q.search.toLowerCase();
    entries = entries.filter((e) =>
      [e.orderNumber, e.reference, e.note, e.categoryName]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle))
    );
  }

  // Newest first; stable tiebreak on id so pagination never duplicates/skips.
  entries.sort((a, b) => {
    const da = new Date(a.date).getTime();
    const db = new Date(b.date).getTime();
    if (da !== db) return db - da;
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });

  return {
    entries,
    truncated: payments.truncated || refunds.truncated || expenses.truncated,
  };
}

export async function getCashbook(
  restaurantId: string,
  rawQuery: unknown,
  branchFilters?: string[] | null
): Promise<CashbookResult> {
  const parsed = CashbookQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const q = parsed.data;
  const { entries, truncated } = await collectEntries(restaurantId, q, branchFilters);

  const summary = buildSummary(entries);
  const total = entries.length;
  const skip = (q.page - 1) * q.limit;
  const items = entries.slice(skip, skip + q.limit);
  const gte = toStartOfDay(q.dateFrom);
  const lte = toEndOfDay(q.dateTo);

  return {
    items,
    total,
    page: q.page,
    limit: q.limit,
    totalPages: Math.ceil(total / q.limit),
    range: {
      start: gte ? gte.toISOString() : null,
      end: lte ? lte.toISOString() : null,
    },
    filters: {
      branchId: q.branchId ?? null,
      type: q.type ?? null,
      method: q.method ?? null,
      dateFrom: q.dateFrom ?? null,
      dateTo: q.dateTo ?? null,
      search: q.search ?? null,
    },
    summary,
    meta: {
      methods: CASHBOOK_METHODS,
      types: CASHBOOK_TYPES,
      truncated,
    },
  };
}

/**
 * CSV export — the SAME filters + scope as the list, bounded to FETCH_CAP.
 * Returns the FULL filtered entry set (not a page) so the CSV matches the
 * active filters. Never exposes `rawData`/gateway payloads.
 */
export async function exportCashbook(
  restaurantId: string,
  rawQuery: unknown,
  branchFilters?: string[] | null
): Promise<{ items: CashbookEntry[]; truncated: boolean }> {
  const parsed = CashbookQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const { entries, truncated } = await collectEntries(
    restaurantId,
    parsed.data,
    branchFilters
  );
  return { items: entries, truncated };
}
