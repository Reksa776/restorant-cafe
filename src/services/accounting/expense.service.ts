import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { round2 } from "@/lib/money";
import { auditService } from "@/services/audit/audit.service";
import {
  CreateExpenseSchema,
  CreateExpenseCategorySchema,
  ExpenseListQuerySchema,
  UpdateExpenseSchema,
  UpdateExpenseCategorySchema,
  type ExpenseMethodValue,
} from "./expense.types";

// ============================================================
// EXPENSE MANAGEMENT (ACCOUNTING PHASE B)
//
// Operational (NON-COGS) expenses. Deliberately NOT a cashbook/journal/ledger
// and Purchase is never auto-recorded here (a purchase is inventory whose
// cost becomes COGS when sold — recording it as an expense too double-counts).
//
// Trust boundary:
//   * `restaurantId` and the acting `userId` are ALWAYS passed in from the
//     authenticated session — never read from the request body/query.
//   * `branchFilters` (authorizedBranches) is applied to every read/mutation,
//     so a branch-scoped admin can never read or write another branch.
//   * `branchId`/`categoryId` from the client are validated against the
//     caller's tenant (and branch scope) before any write.
// ============================================================

const METHOD_LABEL: Record<ExpenseMethodValue, string> = {
  CASH: "Tunai",
  TRANSFER: "Transfer",
  QRIS: "QRIS",
  CARD: "Kartu",
  OTHER: "Lainnya",
};

// ------------------------------------------------------------
// Date helpers — local-day semantics, matching the audit-log list and the
// purchase list. A `spentAt` is a plain calendar day at local midnight.
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

function parseDateOnly(value: string): Date {
  const d = new Date(`${value}T00:00:00.000`);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError("Tanggal tidak valid");
  }
  return d;
}

/** Render a stored date as `YYYY-MM-DD` from its local components. */
function formatDateOnly(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toAmount(value: Prisma.Decimal | number): number {
  return round2(Number(value));
}

// ------------------------------------------------------------
// Scope predicate — shared by list/summary/read/update/delete so the two can
// never drift apart. A branch-scoped caller (branchFilters set) can never
// widen to another branch; an explicit branchId outside the list is rejected.
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
// Shared WHERE builder for list / summary / export so they can never drift.
// ------------------------------------------------------------

function buildExpenseWhere(
  restaurantId: string,
  q: {
    branchId?: string | null;
    categoryId?: string | null;
    method?: ExpenseMethodValue | null;
    dateFrom?: string | null;
    dateTo?: string | null;
    search?: string | null;
  },
  branchFilters?: string[] | null
): Prisma.ExpenseWhereInput {
  const gte = toStartOfDay(q.dateFrom);
  const lte = toEndOfDay(q.dateTo);
  return {
    restaurantId,
    ...branchPredicate(q.branchId, branchFilters),
    ...(q.categoryId ? { categoryId: q.categoryId } : {}),
    ...(q.method ? { method: q.method } : {}),
    ...(q.dateFrom || q.dateTo
      ? { spentAt: { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) } }
      : {}),
    ...(q.search ? { note: { contains: q.search } } : {}),
  };
}

// ------------------------------------------------------------
// Tenant/scope validation helpers.
// ------------------------------------------------------------

async function assertBranchInTenant(
  restaurantId: string,
  branchId: string,
  branchFilters?: string[] | null
): Promise<void> {
  if (branchFilters?.length && !branchFilters.includes(branchId)) {
    throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
  }
  const branch = await prisma.branch.findFirst({
    where: { id: branchId, restaurantId },
    select: { id: true },
  });
  if (!branch) {
    throw new NotFoundError("Cabang tidak ditemukan");
  }
}

async function assertCategoryInTenant(
  restaurantId: string,
  categoryId: string,
  requireActive: boolean
): Promise<{ id: string; name: string }> {
  const category = await prisma.expenseCategory.findFirst({
    where: { id: categoryId, restaurantId },
    select: { id: true, name: true, isActive: true },
  });
  if (!category) {
    throw new ValidationError("Kategori pengeluaran tidak ditemukan untuk restoran ini");
  }
  if (requireActive && !category.isActive) {
    throw new ValidationError("Kategori pengeluaran tidak aktif");
  }
  return { id: category.id, name: category.name };
}

// ------------------------------------------------------------
// View mapping.
// ------------------------------------------------------------

interface ExpenseRowWithRelations {
  id: string;
  amount: Prisma.Decimal;
  spentAt: Date;
  method: string;
  note: string | null;
  categoryId: string;
  branchId: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  category: { id: string; name: string; isActive: boolean } | null;
  branch: { id: string; code: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
}

function toExpenseView(row: ExpenseRowWithRelations) {
  const method = row.method as ExpenseMethodValue;
  return {
    id: row.id,
    amount: toAmount(row.amount),
    spentAt: formatDateOnly(row.spentAt),
    method,
    methodLabel: METHOD_LABEL[method] ?? row.method,
    note: row.note,
    categoryId: row.categoryId,
    categoryName: row.category?.name ?? null,
    categoryActive: row.category?.isActive ?? false,
    branchId: row.branchId,
    branchCode: row.branch?.code ?? null,
    branchName: row.branch?.name ?? null,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdBy?.name ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ============================================================
// LIST + SUMMARY
// ============================================================

export interface ListExpenseResult {
  items: ReturnType<typeof toExpenseView>[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: {
    totalAmount: number;
    count: number;
    byCategory: Array<{
      categoryId: string;
      categoryName: string;
      total: number;
      count: number;
    }>;
  };
}

export async function listExpenses(
  restaurantId: string,
  rawQuery: unknown,
  branchFilters?: string[] | null
): Promise<ListExpenseResult> {
  const parsed = ExpenseListQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const q = parsed.data;
  const skip = (q.page - 1) * q.limit;

  const where = buildExpenseWhere(restaurantId, q, branchFilters);

  const [rows, total, aggregate, grouped] = await Promise.all([
    prisma.expense.findMany({
      where,
      include: {
        category: { select: { id: true, name: true, isActive: true } },
        branch: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, name: true } },
      },
      orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
      take: q.limit,
      skip,
    }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.groupBy({
      by: ["categoryId"],
      where,
      _sum: { amount: true },
      _count: { _all: true },
    }),
  ]);

  // Resolve category names for the breakdown in one batched lookup.
  const categoryIds = grouped.map((g) => g.categoryId);
  const categories = categoryIds.length
    ? await prisma.expenseCategory.findMany({
        where: { id: { in: categoryIds }, restaurantId },
        select: { id: true, name: true },
      })
    : [];
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));

  const byCategory = grouped
    .map((g) => ({
      categoryId: g.categoryId,
      categoryName: categoryName.get(g.categoryId) ?? "—",
      total: toAmount(g._sum.amount ?? 0),
      count: g._count._all,
    }))
    .sort((a, b) => b.total - a.total);

  return {
    items: rows.map(toExpenseView),
    total,
    page: q.page,
    limit: q.limit,
    totalPages: Math.ceil(total / q.limit),
    summary: {
      totalAmount: toAmount(aggregate._sum.amount ?? 0),
      count: total,
      byCategory,
    },
  };
}

// ============================================================
// EXPORT — same filters/scope as the list, bounded to the most recent 5000.
// ============================================================

export const EXPENSE_EXPORT_LIMIT = 5000;

export async function exportExpenses(
  restaurantId: string,
  rawQuery: unknown,
  branchFilters?: string[] | null
) {
  const parsed = ExpenseListQuerySchema.safeParse(rawQuery ?? {});
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const q = parsed.data;
  const where = buildExpenseWhere(restaurantId, q, branchFilters);
  const rows = await prisma.expense.findMany({
    where,
    include: {
      category: { select: { id: true, name: true, isActive: true } },
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
    orderBy: [{ spentAt: "desc" }, { createdAt: "desc" }],
    take: EXPENSE_EXPORT_LIMIT,
  });
  return { items: rows.map(toExpenseView) };
}

// ============================================================
// READ ONE
// ============================================================

export async function getExpense(
  restaurantId: string,
  id: string,
  branchFilters?: string[] | null
) {
  const row = await prisma.expense.findFirst({
    where: {
      id,
      restaurantId,
      ...branchPredicate(null, branchFilters),
    },
    include: {
      category: { select: { id: true, name: true, isActive: true } },
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });
  if (!row) {
    throw new NotFoundError("Pengeluaran tidak ditemukan");
  }
  return toExpenseView(row);
}

// ============================================================
// CREATE
// ============================================================

export async function createExpense(
  restaurantId: string,
  userId: string,
  rawInput: unknown
) {
  const parsed = CreateExpenseSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const input = parsed.data;

  if (!input.branchId) {
    throw new ValidationError("Pilih cabang terlebih dahulu");
  }
  await assertBranchInTenant(restaurantId, input.branchId);
  const category = await assertCategoryInTenant(restaurantId, input.categoryId, true);

  const amount = round2(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("Nominal harus lebih dari 0");
  }
  const spentAt = parseDateOnly(input.spentAt);

  const created = await prisma.expense.create({
    data: {
      restaurantId,
      branchId: input.branchId,
      categoryId: input.categoryId,
      amount,
      spentAt,
      method: input.method,
      note: input.note?.trim() || null,
      createdByUserId: userId,
    },
    include: {
      category: { select: { id: true, name: true, isActive: true } },
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  await auditService.log({
    restaurantId,
    branchId: created.branchId,
    userId,
    action: "EXPENSE_CREATED",
    entityType: "Expense",
    entityId: created.id,
    details: {
      categoryId: category.id,
      categoryName: category.name,
      amount,
      spentAt: input.spentAt,
      method: input.method,
      branchId: created.branchId,
    },
  });

  return toExpenseView(created);
}

// ============================================================
// UPDATE
// ============================================================

export async function updateExpense(
  restaurantId: string,
  id: string,
  branchFilters: string[] | undefined,
  userId: string,
  rawInput: unknown
) {
  const parsed = UpdateExpenseSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const input = parsed.data;

  const existing = await prisma.expense.findFirst({
    where: { id, restaurantId, ...branchPredicate(null, branchFilters) },
  });
  if (!existing) {
    throw new NotFoundError("Pengeluaran tidak ditemukan");
  }

  let branchId = existing.branchId;
  if (input.branchId && input.branchId !== existing.branchId) {
    await assertBranchInTenant(restaurantId, input.branchId, branchFilters);
    branchId = input.branchId;
  }

  let categoryName: string | undefined;
  if (input.categoryId && input.categoryId !== existing.categoryId) {
    categoryName = (
      await assertCategoryInTenant(restaurantId, input.categoryId, true)
    ).name;
  }

  let amount: number | undefined;
  if (input.amount !== undefined) {
    amount = round2(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new ValidationError("Nominal harus lebih dari 0");
    }
  }

  const updated = await prisma.expense.update({
    where: { id: existing.id },
    data: {
      ...(input.branchId ? { branchId } : {}),
      ...(input.categoryId ? { categoryId: input.categoryId } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(input.spentAt ? { spentAt: parseDateOnly(input.spentAt) } : {}),
      ...(input.method ? { method: input.method } : {}),
      ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
    },
    include: {
      category: { select: { id: true, name: true, isActive: true } },
      branch: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, name: true } },
    },
  });

  await auditService.log({
    restaurantId,
    branchId: updated.branchId,
    userId,
    action: "EXPENSE_UPDATED",
    entityType: "Expense",
    entityId: updated.id,
    details: {
      changed: Object.keys(input),
      categoryId: updated.categoryId,
      categoryName: categoryName ?? updated.category?.name ?? null,
      amount: toAmount(updated.amount),
      spentAt: formatDateOnly(updated.spentAt),
      method: updated.method,
      branchId: updated.branchId,
    },
  });

  return toExpenseView(updated);
}

// ============================================================
// DELETE (hard delete, fully snapshotted into AuditLog)
//
// An expense row is an operational record, not a posted journal entry, so a
// hard delete is acceptable — but it is NEVER silent: the complete row is
// captured in an EXPENSE_DELETED audit entry (actor, branch, category,
// amount, date) so the trail survives the delete. No credential/secret is
// ever written.
// ============================================================

export async function deleteExpense(
  restaurantId: string,
  id: string,
  branchFilters: string[] | undefined,
  userId: string
) {
  const existing = await prisma.expense.findFirst({
    where: { id, restaurantId, ...branchPredicate(null, branchFilters) },
    include: {
      category: { select: { name: true } },
      branch: { select: { code: true, name: true } },
    },
  });
  if (!existing) {
    throw new NotFoundError("Pengeluaran tidak ditemukan");
  }

  await prisma.expense.delete({ where: { id: existing.id } });

  await auditService.log({
    restaurantId,
    branchId: existing.branchId,
    userId,
    action: "EXPENSE_DELETED",
    entityType: "Expense",
    entityId: existing.id,
    details: {
      categoryId: existing.categoryId,
      categoryName: existing.category?.name ?? null,
      amount: toAmount(existing.amount),
      spentAt: formatDateOnly(existing.spentAt),
      method: existing.method,
      branchId: existing.branchId,
      branchCode: existing.branch?.code ?? null,
      note: existing.note,
    },
  });

  return { id: existing.id };
}

// ============================================================
// EXPENSE CATEGORIES (restaurant-scoped — never branch-scoped)
// ============================================================

export async function listExpenseCategories(restaurantId: string) {
  const rows = await prisma.expenseCategory.findMany({
    where: { restaurantId },
    include: { _count: { select: { expenses: true } } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }],
  });
  return {
    items: rows.map((c) => ({
      id: c.id,
      name: c.name,
      isActive: c.isActive,
      expenseCount: c._count.expenses,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    })),
  };
}

export async function createExpenseCategory(
  restaurantId: string,
  userId: string,
  rawInput: unknown
) {
  const parsed = CreateExpenseCategorySchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const name = parsed.data.name;

  const duplicate = await prisma.expenseCategory.findFirst({
    where: { restaurantId, name },
    select: { id: true },
  });
  if (duplicate) {
    throw new ConflictError("Kategori dengan nama ini sudah ada");
  }

  const created = await prisma.expenseCategory.create({
    data: { restaurantId, name },
  });

  await auditService.log({
    restaurantId,
    userId,
    action: "EXPENSE_CATEGORY_CREATED",
    entityType: "ExpenseCategory",
    entityId: created.id,
    details: { name: created.name },
  });

  return { id: created.id, name: created.name, isActive: created.isActive };
}

export async function updateExpenseCategory(
  restaurantId: string,
  id: string,
  userId: string,
  rawInput: unknown
) {
  const parsed = UpdateExpenseCategorySchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.message);
  }
  const input = parsed.data;

  const existing = await prisma.expenseCategory.findFirst({
    where: { id, restaurantId },
    select: { id: true },
  });
  if (!existing) {
    throw new NotFoundError("Kategori pengeluaran tidak ditemukan");
  }

  if (input.name !== undefined) {
    const duplicate = await prisma.expenseCategory.findFirst({
      where: { restaurantId, name: input.name, id: { not: id } },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictError("Kategori dengan nama ini sudah ada");
    }
  }

  const updated = await prisma.expenseCategory.update({
    where: { id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    },
  });

  await auditService.log({
    restaurantId,
    userId,
    action: "EXPENSE_CATEGORY_UPDATED",
    entityType: "ExpenseCategory",
    entityId: updated.id,
    details: {
      changed: Object.keys(input),
      name: updated.name,
      isActive: updated.isActive,
    },
  });

  return { id: updated.id, name: updated.name, isActive: updated.isActive };
}
