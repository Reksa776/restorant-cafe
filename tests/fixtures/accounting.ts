/**
 * Test Data Factory for Accounting Integration Tests
 *
 * This module provides helper functions to create deterministic test data
 * for integration testing.
 */

import {
  Prisma,
  PrismaClient,
  CostingMode,
  ExpenseMethod,
  OrderItemCostStatus,
  OrderStatus,
  OrderType,
  PaymentStatus,
  RequestStatus,
  Role,
} from '@prisma/client';

export interface TestContext {
  restaurantId: string;
  branchId?: string | null;
  userId: string;
  prisma: PrismaClient;
}

/**
 * Generate unique identifiers for test data isolation
 */
export function generateTestId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 10000);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Create a test order with deterministic values
 */
export async function createTestOrder(
  prisma: PrismaClient,
  override?: Partial<{
    id: string;
    orderNumber: string;
    restaurantId: string;
    branchId: string | null;
    status: OrderStatus;
    paymentStatus: PaymentStatus;
    grandTotal: number;
    subtotal: number;
  }>
): Promise<{ id: string; orderNumber: string }> {
  const id = override?.id || generateTestId('ord');
  const orderNumber = override?.orderNumber || `ORD-${id.slice(-6)}`;

  return prisma.order.upsert({
    where: { id },
    update: {},
    create: {
      id,
      orderNumber,
      restaurantId: override?.restaurantId ?? '',
      branchId: override?.branchId ?? null,
      status: override?.status ?? 'COMPLETED',
      paymentStatus: override?.paymentStatus ?? 'PAID',
      subtotal: override?.subtotal ?? 100000,
      grandTotal: override?.grandTotal ?? 100000,
      tax: 0,
      serviceCharge: 0,
      discount: 0,
    } as Prisma.OrderUncheckedCreateInput,
  });
}

/**
 * Create test data for a complete order with items and COGS snapshot
 */
export async function createOrderWithItemAndSnapshot(
  prisma: PrismaClient,
  options: {
    restaurantId: string;
    branchId?: string | null;
    amount?: number;
    cogsRatio?: number;
  }
): Promise<{
  orderId: string;
  itemId: string;
  snapshotId: string;
  paymentId: string;
  amount: number;
  cogs: number;
}> {
  const { restaurantId, branchId = null, amount = 100000, cogsRatio = 0.6 } = options;

  const id = generateTestId('ord');
  const itemPrice = amount;
  const cogs = Math.round(itemPrice * cogsRatio);

  // Create order
  await prisma.order.create({
    data: {
      id,
      orderNumber: `ORD-${id.slice(-6)}`,
      restaurantId,
      branchId,
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      subtotal: itemPrice,
      grandTotal: itemPrice,
      tax: 0,
      serviceCharge: 0,
      discount: 0,
    } as Prisma.OrderUncheckedCreateInput,
  });

  // Create item
  const item = await prisma.orderItem.create({
    data: {
      id: generateTestId('item'),
      orderId: id,
      productId: generateTestId('prod'),
      quantity: 1,
      totalPrice: itemPrice,
    } as Prisma.OrderItemUncheckedCreateInput,
  });

  // Create COGS snapshot
  const snapshot = await prisma.orderItemCostSnapshot.create({
    data: {
      id: generateTestId('snap'),
      orderItemId: item.id,
      orderId: id,
      status: 'SNAPSHOTTED',
      hppTotal: cogs,
    } as Prisma.OrderItemCostSnapshotUncheckedCreateInput,
  });

  // Create payment
  const payment = await prisma.payment.create({
    data: {
      id: generateTestId('pay'),
      orderId: id,
      amount,
      method: 'KASIR',
      status: 'PAID',
    } as Prisma.PaymentUncheckedCreateInput,
  });

  return {
    orderId: id,
    itemId: item.id,
    snapshotId: snapshot.id,
    paymentId: payment.id,
    amount,
    cogs,
  };
}

/**
 * Create a full refund for an order
 */
export async function createFullRefund(
  prisma: PrismaClient,
  options: {
    orderId: string;
    restaurantId: string;
    cashierId: string;
    amount: number;
  }
): Promise<{ refundId: string; paymentTransactionId: string | null }> {
  const refundId = generateTestId('ref');

  // Create refund
  await prisma.refund.create({
    data: {
      id: refundId,
      orderId: options.orderId,
      restaurantId: options.restaurantId,
      requestedByCashierId: options.cashierId,
      amount: options.amount,
      status: 'APPROVED',
      approvedAt: new Date(),
      reason: 'Test refund',
    },
  });

  return { refundId, paymentTransactionId: null };
}

/**
 * Create a legacy refund (amount-only, no RefundItem)
 */
export async function createLegacyRefund(
  prisma: PrismaClient,
  options: {
    orderId: string;
    restaurantId: string;
    cashierId: string;
    amount: number;
    reason?: string;
  }
): Promise<{ refundId: string }> {
  const refundId = generateTestId('ref');

  await prisma.refund.create({
    data: {
      id: refundId,
      orderId: options.orderId,
      restaurantId: options.restaurantId,
      requestedByCashierId: options.cashierId,
      amount: options.amount,
      status: 'APPROVED',
      approvedAt: new Date(),
      reason: options.reason ?? 'Test refund',
    },
  });

  return { refundId };
}

// ============================================================
// STEP 2B.1 — CASHBOOK INTEGRATION FIXTURES
//
// Deterministic, FK-complete factories for the Cashbook read-model tests.
// Every identifier carries the run prefix so a run can be cleaned up
// precisely without touching unrelated rows (no TRUNCATE, no global
// transaction assumptions).
// ============================================================

/** Unique, deterministic-per-run prefix (time + random + pid). */
export function createRunId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 1e6).toString(36);
  return `${prefix}-${stamp}-${random}-${process.pid}`;
}

/** `Prisma.Decimal` keeps `tsc --noEmit` happy for Decimal(10,2)/(12,2) columns. */
function dec(value: number): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export async function createRestaurantFixture(
  prisma: PrismaClient,
  input: { id: string; name: string }
): Promise<void> {
  await prisma.restaurant.create({
    data: { id: input.id, name: input.name },
  });
}

export async function createBranchFixture(
  prisma: PrismaClient,
  input: { id: string; restaurantId: string; code: string; name: string }
): Promise<void> {
  await prisma.branch.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      code: input.code,
      name: input.name,
    },
  });
}

export async function createUserFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    restaurantId: string;
    email: string;
    name: string;
    role?: Role;
  }
): Promise<void> {
  await prisma.user.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      email: input.email,
      name: input.name,
      // Never a real credential — a test row only.
      password: "test-password-not-a-secret",
      role: input.role ?? "ADMIN",
    },
  });
}

export async function createCustomerFixture(
  prisma: PrismaClient,
  input: { id: string; restaurantId: string; phone: string; name?: string }
): Promise<void> {
  await prisma.customer.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      phone: input.phone,
      name: input.name ?? "Cashbook Test Customer",
    },
  });
}

export async function createOrderFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    restaurantId: string;
    branchId?: string | null;
    orderNumber: string;
    customerId: string;
    grandTotal: number;
    createdAt?: Date;
    status?: OrderStatus;
    paymentStatus?: PaymentStatus;
    /** Defaults to `grandTotal` (the cashbook fixtures rely on that default). */
    subtotal?: number;
    tax?: number;
    serviceCharge?: number;
    discount?: number;
    orderType?: OrderType;
  }
): Promise<void> {
  await prisma.order.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      branchId: input.branchId ?? null,
      orderNumber: input.orderNumber,
      customerId: input.customerId,
      status: input.status ?? "COMPLETED",
      paymentStatus: input.paymentStatus ?? "PAID",
      subtotal: dec(input.subtotal ?? input.grandTotal),
      grandTotal: dec(input.grandTotal),
      tax: dec(input.tax ?? 0),
      serviceCharge: dec(input.serviceCharge ?? 0),
      discount: dec(input.discount ?? 0),
      ...(input.orderType ? { orderType: input.orderType } : {}),
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

export async function createCategoryFixture(
  prisma: PrismaClient,
  input: { id: string; restaurantId: string; name: string }
): Promise<void> {
  await prisma.category.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      name: input.name,
    },
  });
}

export async function createProductFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    restaurantId: string;
    categoryId: string;
    name: string;
    price: number;
  }
): Promise<void> {
  await prisma.product.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      categoryId: input.categoryId,
      name: input.name,
      price: dec(input.price),
    },
  });
}

/**
 * One sold line. `totalPrice` is what the report aggregates for product/best-
 * seller revenue, `quantity` drives `summary.totalItemsSold`.
 */
export async function createOrderItemFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    orderId: string;
    productId: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
  }
): Promise<void> {
  await prisma.orderItem.create({
    data: {
      id: input.id,
      orderId: input.orderId,
      productId: input.productId,
      quantity: input.quantity,
      unitPrice: dec(input.unitPrice),
      totalPrice: dec(input.totalPrice),
    },
  });
}

export async function createPaymentFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    restaurantId: string;
    orderId: string;
    branchId?: string | null;
    amount: number;
    method?: string | null;
    status?: PaymentStatus;
    paidAt?: Date | null;
    createdAt?: Date;
    providerRef?: string | null;
  }
): Promise<void> {
  await prisma.payment.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      orderId: input.orderId,
      branchId: input.branchId ?? null,
      amount: dec(input.amount),
      method: input.method === undefined ? "KASIR" : input.method,
      status: input.status ?? "PAID",
      paidAt: input.paidAt ?? null,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
      ...(input.providerRef ? { providerRef: input.providerRef } : {}),
    },
  });
}

/**
 * A gateway/cashier mirror row. `PaymentTransaction` must NEVER add a cash
 * movement on top of its `Payment` (it stores the same money as an audit trail,
 * plus negative refund rows).
 */
export async function createPaymentTransactionFixture(
  prisma: PrismaClient,
  input: {
    paymentId: string;
    provider: string;
    type: string;
    status: string;
    amount: number;
  }
): Promise<void> {
  await prisma.paymentTransaction.create({
    data: {
      paymentId: input.paymentId,
      provider: input.provider,
      type: input.type,
      status: input.status,
      amount: dec(input.amount),
    },
  });
}

export async function createRefundFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    restaurantId: string;
    orderId: string;
    paymentId?: string | null;
    branchId?: string | null;
    amount: number;
    requestedByCashierId: string;
    status?: RequestStatus;
    approvedAt?: Date | null;
    createdAt?: Date;
    reason?: string;
  }
): Promise<void> {
  await prisma.refund.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      orderId: input.orderId,
      paymentId: input.paymentId ?? null,
      branchId: input.branchId ?? null,
      amount: dec(input.amount),
      requestedByCashierId: input.requestedByCashierId,
      status: input.status ?? "APPROVED",
      approvedAt: input.approvedAt ?? null,
      reason: input.reason ?? "Cashbook integration test refund",
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

/**
 * Frozen historical COGS snapshot (F.5). `hppUnit`/`hppTotal` are only
 * meaningful for status SNAPSHOTTED; other statuses keep them NULL (an
 * uncovered cost is never fabricated as 0).
 */
export async function createOrderItemCostSnapshotFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    restaurantId: string;
    orderId: string;
    orderItemId: string;
    productId: string;
    quantity: number;
    status: OrderItemCostStatus;
    branchId?: string | null;
    hppUnit?: number | null;
    hppTotal?: number | null;
    /**
     * The snapshot's write time — the M2 first-snapshot marker column
     * (`MIN(orderitemcostsnapshot.completedAt)`). Set it explicitly for any
     * marker-sensitive test: the column defaults to `now()`, which would make
     * the marker depend on the wall clock instead of the fixture.
     */
    completedAt?: Date;
  }
): Promise<void> {
  await prisma.orderItemCostSnapshot.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      orderId: input.orderId,
      orderItemId: input.orderItemId,
      productId: input.productId,
      quantity: input.quantity,
      status: input.status,
      branchId: input.branchId ?? null,
      hppUnit: input.hppUnit == null ? null : dec(input.hppUnit),
      hppTotal: input.hppTotal == null ? null : dec(input.hppTotal),
      ...(input.completedAt ? { completedAt: input.completedAt } : {}),
    },
  });
}

/**
 * One order status-history row. The M2 legacy classifier reads
 * `MIN(createdAt)` of the rows whose status = COMPLETED, so the completion time
 * a test asserts is ALWAYS the `createdAt` of this row — never
 * `Order.updatedAt`.
 */
export async function createOrderStatusHistoryFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    orderId: string;
    status: OrderStatus;
    createdAt: Date;
    notes?: string | null;
    changedBy?: string | null;
  }
): Promise<void> {
  await prisma.orderStatusHistory.create({
    data: {
      id: input.id,
      orderId: input.orderId,
      status: input.status,
      createdAt: input.createdAt,
      notes: input.notes ?? null,
      changedBy: input.changedBy ?? null,
    },
  });
}

/**
 * Per-branch product config — used to plant a DIFFERENT "current" HPP (MANUAL
 * mode) so a test can prove the profitability report uses the historical
 * snapshot instead.
 */
export async function createBranchProductFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    branchId: string;
    productId: string;
    costingMode?: CostingMode;
    manualHpp?: number | null;
  }
): Promise<void> {
  await prisma.branchProduct.create({
    data: {
      id: input.id,
      branchId: input.branchId,
      productId: input.productId,
      costingMode: input.costingMode ?? "MANUAL",
      manualHpp: input.manualHpp == null ? null : dec(input.manualHpp),
    },
  });
}

export async function createExpenseCategoryFixture(
  prisma: PrismaClient,
  input: { id: string; restaurantId: string; name: string }
): Promise<void> {
  await prisma.expenseCategory.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      name: input.name,
    },
  });
}

/**
 * One operational expense. `spentAt` is the ONLY attribution date every report
 * reads; `createdAt` is overridable so a test can prove that a back-dated
 * expense is bucketed by `spentAt` and never by its row-creation time (the
 * expense service always stamps `createdAt = now`, so the direct fixture is the
 * only way to model a legacy/back-filled row).
 */
export async function createExpenseFixture(
  prisma: PrismaClient,
  input: {
    id: string;
    restaurantId: string;
    branchId: string;
    categoryId: string;
    amount: number;
    spentAt: Date;
    createdByUserId: string;
    method?: ExpenseMethod;
    note?: string | null;
    createdAt?: Date;
  }
): Promise<void> {
  await prisma.expense.create({
    data: {
      id: input.id,
      restaurantId: input.restaurantId,
      branchId: input.branchId,
      categoryId: input.categoryId,
      amount: dec(input.amount),
      spentAt: input.spentAt,
      method: input.method ?? "CASH",
      note: input.note ?? null,
      createdByUserId: input.createdByUserId,
      ...(input.createdAt ? { createdAt: input.createdAt } : {}),
    },
  });
}

/** The tables a cashbook run may touch (whole-table row counts). */
export type ScopedCountTable =
  | "restaurant"
  | "branch"
  | "user"
  | "customer"
  | "order"
  | "orderItem"
  | "orderItemCostSnapshot"
  | "orderStatusHistory"
  | "product"
  | "category"
  | "branchProduct"
  | "stockMovement"
  | "ingredientStockMovement"
  | "payment"
  | "paymentTransaction"
  | "refund"
  | "refundItem"
  | "expense"
  | "expenseCategory"
  | "cashierShift"
  | "auditLog";

export type ScopedCounts = Record<ScopedCountTable, number>;

export async function snapshotCounts(prisma: PrismaClient): Promise<ScopedCounts> {
  const [
    restaurant,
    branch,
    user,
    customer,
    order,
    orderItem,
    orderItemCostSnapshot,
    orderStatusHistory,
    product,
    category,
    branchProduct,
    stockMovement,
    ingredientStockMovement,
    payment,
    paymentTransaction,
    refund,
    refundItem,
    expense,
    expenseCategory,
    cashierShift,
    auditLog,
  ] = await Promise.all([
    prisma.restaurant.count(),
    prisma.branch.count(),
    prisma.user.count(),
    prisma.customer.count(),
    prisma.order.count(),
    prisma.orderItem.count(),
    prisma.orderItemCostSnapshot.count(),
    prisma.orderStatusHistory.count(),
    prisma.product.count(),
    prisma.category.count(),
    prisma.branchProduct.count(),
    prisma.stockMovement.count(),
    prisma.ingredientStockMovement.count(),
    prisma.payment.count(),
    prisma.paymentTransaction.count(),
    prisma.refund.count(),
    prisma.refundItem.count(),
    prisma.expense.count(),
    prisma.expenseCategory.count(),
    prisma.cashierShift.count(),
    prisma.auditLog.count(),
  ]);

  return {
    restaurant,
    branch,
    user,
    customer,
    order,
    orderItem,
    orderItemCostSnapshot,
    orderStatusHistory,
    product,
    category,
    branchProduct,
    stockMovement,
    ingredientStockMovement,
    payment,
    paymentTransaction,
    refund,
    refundItem,
    expense,
    expenseCategory,
    cashierShift,
    auditLog,
  };
}

export interface RunScope {
  restaurantIds: string[];
  orderIds: string[];
  paymentIds: string[];
  refundIds: string[];
}

/**
 * Resolve the run's row ids by ID prefix (every fixture id is prefixed with the
 * run id), then delete them child-first. Explicit sequential `deleteMany`
 * statements are used on purpose: cleanup must not depend on a long interactive
 * Prisma transaction, and each step is scoped to this run only.
 */
export async function cleanupRun(
  prisma: PrismaClient,
  run: string
): Promise<{ scope: RunScope; deleted: Record<string, number> }> {
  const prefix = `${run}-`;

  const restaurants = await prisma.restaurant.findMany({
    where: { id: { startsWith: prefix } },
    select: { id: true },
  });
  const restaurantIds = restaurants.map((r) => r.id);

  const [orders, payments, refunds] = await Promise.all([
    prisma.order.findMany({
      where: { restaurantId: { in: restaurantIds } },
      select: { id: true },
    }),
    prisma.payment.findMany({
      where: { restaurantId: { in: restaurantIds } },
      select: { id: true },
    }),
    prisma.refund.findMany({
      where: { restaurantId: { in: restaurantIds } },
      select: { id: true },
    }),
  ]);

  const scope: RunScope = {
    restaurantIds,
    orderIds: orders.map((o) => o.id),
    paymentIds: payments.map((p) => p.id),
    refundIds: refunds.map((r) => r.id),
  };

  const deleted: Record<string, number> = {};
  const step = async (name: string, op: Promise<{ count: number }>) => {
    deleted[name] = (await op).count;
  };

  // Children first, then the tenants themselves. Rows created by the
  // production services (PaymentTransaction from a duplicate collection,
  // AuditLog from the audit trail) are reached through their parent ids, not
  // through the id prefix.
  await step(
    "paymentTransaction",
    prisma.paymentTransaction.deleteMany({ where: { paymentId: { in: scope.paymentIds } } })
  );
  // Stock ledgers reference branch + product (restrictive FKs) → delete first.
  // Refund approvals write REFUND_RESTORE rows keyed by orderId in `refId`.
  await step(
    "stockMovement",
    prisma.stockMovement.deleteMany({ where: { restaurantId: { in: restaurantIds } } })
  );
  await step(
    "ingredientStockMovement",
    prisma.ingredientStockMovement.deleteMany({ where: { restaurantId: { in: restaurantIds } } })
  );
  await step("refundItem", prisma.refundItem.deleteMany({ where: { refundId: { in: scope.refundIds } } }));
  await step("refund", prisma.refund.deleteMany({ where: { id: { in: scope.refundIds } } }));
  await step("payment", prisma.payment.deleteMany({ where: { id: { in: scope.paymentIds } } }));
  await step("expense", prisma.expense.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step(
    "orderItemCostSnapshot",
    prisma.orderItemCostSnapshot.deleteMany({ where: { orderId: { in: scope.orderIds } } })
  );
  await step("orderItem", prisma.orderItem.deleteMany({ where: { orderId: { in: scope.orderIds } } }));
  await step(
    "orderStatusHistory",
    prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: scope.orderIds } } })
  );
  await step("order", prisma.order.deleteMany({ where: { id: { in: scope.orderIds } } }));
  // Products/categories/branch config are deleted only after their order items
  // are gone (BranchProduct holds FKs to both branch and product).
  await step(
    "branchProduct",
    prisma.branchProduct.deleteMany({ where: { branch: { restaurantId: { in: restaurantIds } } } })
  );
  await step("product", prisma.product.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step("category", prisma.category.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step(
    "expenseCategory",
    prisma.expenseCategory.deleteMany({ where: { restaurantId: { in: restaurantIds } } })
  );
  await step("cashierShift", prisma.cashierShift.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step("auditLog", prisma.auditLog.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step("userBranch", prisma.userBranch.deleteMany({ where: { branch: { restaurantId: { in: restaurantIds } } } }));
  await step("customer", prisma.customer.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step("user", prisma.user.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step("branch", prisma.branch.deleteMany({ where: { restaurantId: { in: restaurantIds } } }));
  await step("restaurant", prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } }));

  return { scope, deleted };
}

/**
 * Residual check after cleanup: every scoped table must be back to its
 * pre-run count, and no run-prefixed row may survive.
 * `paymentTransaction`/`refundItem` are checked through their parent ids. The
 * parent rows are already deleted, so an id-based check is enough there.
 */
export async function findResiduals(
  prisma: PrismaClient,
  run: string,
  scope: RunScope
): Promise<Record<string, number>> {
  const prefix = `${run}-`;
  const [
    restaurant,
    branch,
    user,
    customer,
    order,
    orderItem,
    orderItemCostSnapshot,
    orderStatusHistory,
    product,
    category,
    branchProduct,
    stockMovement,
    ingredientStockMovement,
    payment,
    refund,
    expense,
    expenseCategory,
    cashierShift,
    auditLog,
    paymentTransaction,
    refundItem,
  ] = await Promise.all([
    prisma.restaurant.count({ where: { id: { startsWith: prefix } } }),
    prisma.branch.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.user.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.customer.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.order.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.orderItem.count({ where: { orderId: { in: scope.orderIds } } }),
    prisma.orderItemCostSnapshot.count({ where: { orderId: { in: scope.orderIds } } }),
    prisma.orderStatusHistory.count({ where: { orderId: { in: scope.orderIds } } }),
    prisma.product.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.category.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.branchProduct.count({
      where: { branch: { restaurantId: { in: scope.restaurantIds } } },
    }),
    // `refId` is a plain column (no FK) holding the order id for refund-driven
    // stock movements, so this check stays meaningful even after the tenant
    // rows are gone.
    prisma.stockMovement.count({ where: { refId: { in: scope.orderIds } } }),
    prisma.ingredientStockMovement.count({ where: { refId: { in: scope.orderIds } } }),
    prisma.payment.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.refund.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.expense.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.expenseCategory.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.cashierShift.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.auditLog.count({ where: { restaurantId: { in: scope.restaurantIds } } }),
    prisma.paymentTransaction.count({ where: { paymentId: { in: scope.paymentIds } } }),
    prisma.refundItem.count({ where: { refundId: { in: scope.refundIds } } }),
  ]);

  return {
    restaurant,
    branch,
    user,
    customer,
    order,
    orderItem,
    orderItemCostSnapshot,
    orderStatusHistory,
    product,
    category,
    branchProduct,
    stockMovement,
    ingredientStockMovement,
    payment,
    refund,
    expense,
    expenseCategory,
    cashierShift,
    auditLog,
    paymentTransaction,
    refundItem,
  };
}

/**
 * Verify cashbook balance for an order
 */
export async function verifyCashbookBalance(
  prisma: PrismaClient,
  orderId: string,
  expectedNet: number
): Promise<{
  paymentIn: number;
  refundOut: number;
  net: number;
  matches: boolean;
}> {
  const payments = await prisma.payment.findMany({
    where: { orderId, status: { in: ['PAID', 'REFUNDED'] } },
    select: { amount: true },
  });

  const refunds = await prisma.refund.findMany({
    where: { orderId, status: 'APPROVED' },
    select: { amount: true },
  });

  const paymentIn = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const refundOut = refunds.reduce((sum, r) => sum + Number(r.amount), 0);
  const net = paymentIn - refundOut;

  return {
    paymentIn,
    refundOut,
    net,
    matches: Math.abs(net - expectedNet) < 0.01,
  };
}