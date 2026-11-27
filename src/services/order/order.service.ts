import crypto from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  IngredientCompletionError,
} from "@/lib/errors";
import type {
  CreateOrderInput,
  CreateCustomerOrderInput,
  UpdateOrderStatusInput,
  GetOrdersInput,
} from "./order.types";
import { normalizePhone } from "@/lib/phone";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { promoService } from "@/services/promo/promo.service";
import {
  applyStockMovement,
  StockRefType,
} from "@/services/stock/stock.service";
import {
  ensureOrderStockReserved,
  orderHasStockDeduction,
  releaseOrderStock,
} from "@/services/stock/order-stock.service";
import { consumeOrderIngredients } from "@/services/ingredient/ingredient-stock.service";
import {
  resolveReportRange,
  revenueWhere,
} from "@/services/report/report.service";
import { createOrderItemCostSnapshots } from "@/services/costing/historical-snapshot";
import {
  assertCanCreateOrder,
  isPlanFeatureActive,
} from "@/services/billing/plan-guard.service";
import { auditService } from "@/services/audit/audit.service";
import { MONEY_EPSILON } from "@/lib/money";
import {
  computeNetCollected,
  ORDER_STILL_HOLDS_MONEY_MESSAGE,
} from "@/services/approval/approval.service";

// ============================================================
// Constants
// ============================================================

const VALID_STATUS_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PROCESSING", "CANCELLED"],
  PROCESSING: ["READY", "CANCELLED"],
  READY: ["COMPLETED"],
  COMPLETED: [],
  CANCELLED: [],
};

// ============================================================
// Helper Functions
// ============================================================

function generateOrderNumber(): string {
  const date = new Date();
  const dateStr = date.toISOString().split("T")[0].replace(/-/g, "");
  // High-entropy suffix (base-36, 6 chars ≈ 2.1B values per day) so public
  // order numbers cannot be enumerated (previously ORD-YYYYMMDD-NNNN had
  // only 10k values per day and powered an unauthenticated lookup).
  const random = crypto
    .randomInt(0, 36 ** 6)
    .toString(36)
    .toUpperCase()
    .padStart(6, "0");
  return `ORD-${dateStr}-${random}`;
}

/** True when the error is a Prisma unique-constraint violation (P2002). */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

/**
 * The Prisma P2002 `meta.target` (field name or array of field names) as a
 * plain string — used to decide whether a collision is retryable (i.e. it
 * concerns the order number) or not (e.g. a customer phone duplicate).
 */
function orderNumberTarget(error: unknown): string {
  const meta = (error as Prisma.PrismaClientKnownRequestError)?.meta;
  const target = meta?.target;
  if (Array.isArray(target)) return target.join(",");
  return String(target ?? "");
}

// Retry cap for the (astronomically unlikely) order-number / shift-number
// unique-constraint race — bounded so a retry can never loop forever.
const UNIQUE_RETRY_ATTEMPTS = 5;

/**
 * Build WhatsApp notification message based on order type.
 */
function buildOrderReadyMessage(
  customerName: string,
  orderNumber: string,
  restaurantName: string,
  orderType: string
): string {
  const name = customerName || "Pelanggan";

  switch (orderType) {
    case "TAKEAWAY":
      return `Halo ${name},\n\nPesanan #${orderNumber} sudah selesai dan siap diambil.\n\nTerima kasih telah memesan di ${restaurantName}.`;
    case "DELIVERY":
      return `Halo ${name},\n\nPesanan #${orderNumber} sudah selesai diproses dan siap untuk pengantaran.\n\nTerima kasih telah memesan di ${restaurantName}.`;
    case "DINE_IN":
    default:
      return `Halo ${name},\n\nPesanan #${orderNumber} sudah selesai.\n\nSilakan menikmati pesanan Anda di ${restaurantName}.`;
  }
}

// ============================================================
// Order Service
// ============================================================

// ============================================================
// Customer-order engine contracts (reservation integration)
// ============================================================

/** The order row returned by `createCustomerOrder` (with its relations). */
// F1 (security) — the customer relation is projected to PUBLIC fields only.
// `password` (bcrypt) and `whatsappId` must never be selected here or anywhere
// else an order is serialized. This matches the API-facing `AdminOrder.customer`
// contract in order.types.ts ({ id, name, phone }).
export type CreatedCustomerOrder = Prisma.OrderGetPayload<{
  include: {
    customer: { select: { id: true; name: true; phone: true } };
    table: true;
    items: { include: { product: true } };
  };
}>;

/**
 * Post-commit realtime side effects of creating a customer order. When the
 * order is created INSIDE a caller-owned transaction (reservation flow) these
 * are returned instead of emitted, so the caller can announce them only after
 * its transaction actually commits.
 */
export interface CustomerOrderEffects {
  orderId: string;
  orderNumber: string;
  orderType: string;
  status: string;
  tableId: string | null;
  visitorCount: number | null;
  customerId: string;
  grandTotal: number;
  createdCustomerId: string | null;
  updatedCustomerId: string | null;
  createdCustomerPhone: string | null;
  createdCashierPaymentId: string | null;
  /** True when this order flipped its table to OCCUPIED. */
  tableOccupied: boolean;
}

export interface CustomerOrderResult {
  order: CreatedCustomerOrder;
  effects: CustomerOrderEffects;
}

/**
 * Optional engine behaviour for customer orders.
 *
 * `reservationMode` marks an order created as part of a RESERVATION. The
 * reservation — not the order — owns the table lifecycle:
 *   - `Table.status` is NEVER flipped to OCCUPIED (a booking ≠ seated), and
 *   - the table's operational status (MAINTENANCE) is not re-validated, because
 *     reservation availability (R5.1) is the authority for booking.
 * Normal checkout keeps the default (`false`) and is byte-for-byte unchanged.
 */
export interface CustomerOrderEngineOptions {
  reservationMode?: boolean;
}

/** Priced line item ready to be written as an OrderItem. */
interface PricedOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  notes: string | null;
  customizations: string;
}

/**
 * Server-authoritative order context (validated + priced from the database)
 * built once and reused across the create step / retries.
 */
interface CustomerOrderContext {
  resolvedBranchId: string | null;
  normalizedPhone: string | null;
  orderItems: PricedOrderItemInput[];
  subtotal: number;
  /** Server-quoted delivery (0 / null for non-delivery orders). */
  deliveryFee: number;
  deliveryAddress: string | null;
  deliveryLatitude: number | null;
  deliveryLongitude: number | null;
  deliveryNotes: string | null;
  deliveryProvider: string | null;
  deliveryCourier: string | null;
  deliveryServiceType: string | null;
}

export class OrderService {
  /**
   * Create a new order from items (admin-initiated).
   * restaurantId is derived from the authenticated admin's record.
   * branchId is derived from the validated branch context — never trusted
   * from the client directly. When a table is provided, the table's branch
   * must match the current branch.
   */
  async createOrder(
    input: CreateOrderInput,
    restaurantId: string,
    branchId?: string | null
  ) {
    // Phase 4 — subscription validity + monthly transaction quota (STARTER:
    // 150/month). Throws 403 PLAN_LIMIT_REACHED / UPGRADE_REQUIRED.
    await assertCanCreateOrder(restaurantId);

    // Validate customer exists and belongs to this restaurant
    const customer = await prisma.customer.findFirst({
      where: {
        id: input.customerId,
        restaurantId,
      },
    });

    if (!customer) {
      throw new NotFoundError("Customer not found");
    }

    // Validate table if provided and belongs to this restaurant
    if (input.tableId) {
      const table = await prisma.table.findFirst({
        where: {
          id: input.tableId,
          restaurantId,
        },
      });

      if (!table) {
        throw new NotFoundError("Table not found");
      }

      if (table.status === "MAINTENANCE") {
        throw new ValidationError("Table is under maintenance");
      }

      // A table assigned to a branch must only be used from that branch.
      if (table.branchId && branchId && table.branchId !== branchId) {
        throw new ForbiddenError(
          "Meja tidak berada di cabang yang aktif"
        );
      }
    }

    // Validate all products exist, are available, and belong to this restaurant.
    // Deduplicate product ids BEFORE comparing counts: the same product may
    // legitimately appear several times with different customizations, and
    // Prisma returns one row per unique id — a raw count comparison would
    // reject those orders (see H7). Each line item is still preserved below.
    const productIds = input.items.map((item) => item.productId);
    const uniqueProductIds = [...new Set(productIds)];
    const products = await prisma.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        restaurantId,
        isActive: true,
        isAvailable: true,
      },
      include: {
        optionGroups: {
          where: { isActive: true },
          include: {
            options: { where: { isActive: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
        addons: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (products.length !== uniqueProductIds.length) {
      const foundIds = new Set(products.map((p) => p.id));
      const missingIds = uniqueProductIds.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        `Products not found or unavailable: ${missingIds.join(", ")}`
      );
    }

    // Validate branch products: a product hidden for this branch cannot be
    // ordered from it (only when a branch is active). The same rows carry the
    // branch price override (H0) — effective price = override ?? Product.price
    // (override = 0 is a VALID free price, so `??` is required, never `||`).
    const priceOverrideByProduct = new Map<string, Prisma.Decimal | null>();
    if (branchId) {
      const branchProducts = await prisma.branchProduct.findMany({
        where: {
          branchId,
          productId: { in: uniqueProductIds },
        },
        select: { productId: true, isAvailable: true, priceOverride: true },
      });
      if (branchProducts.some((bp) => !bp.isAvailable)) {
        throw new ValidationError(
          "Beberapa produk tidak tersedia di cabang ini"
        );
      }
      for (const bp of branchProducts) {
        priceOverrideByProduct.set(bp.productId, bp.priceOverride);
      }
    }

    // Create product map for quick lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Stock validation: aggregate quantities per product across all line
    // items (same product may appear multiple times with different
    // customizations) and verify against BranchProduct.stock.
    // Only enforced when a branch is active. Under a resolved branch a
    // product WITHOUT a BranchProduct row is treated as SOLD OUT (default
    // stock 0 after the stock migration), so a branch can only sell
    // products the staff explicitly stocked (> 0).
    if (branchId) {
      const qtyByProduct = new Map<string, number>();
      for (const item of input.items) {
        qtyByProduct.set(
          item.productId,
          (qtyByProduct.get(item.productId) || 0) + item.quantity
        );
      }
      const branchStockRows = await prisma.branchProduct.findMany({
        where: {
          branchId,
          productId: { in: uniqueProductIds },
        },
        select: { productId: true, stock: true },
      });
      const stockMap = new Map(branchStockRows.map((r) => [r.productId, r.stock]));
      for (const [pid, qty] of qtyByProduct) {
        const stock = stockMap.get(pid);
        if (stock === undefined) {
          const p = productMap.get(pid);
          throw new ValidationError(
            `Produk ${p?.name || pid} sudah habis`
          );
        }
        if (stock <= 0) {
          const p = productMap.get(pid);
          throw new ValidationError(
            `Produk ${p?.name || pid} sudah habis`
          );
        }
        if (stock < qty) {
          const p = productMap.get(pid);
          throw new ValidationError(
            `Stok ${p?.name || pid} tidak mencukupi (tersisa ${stock}, diminta ${qty})`
          );
        }
      }
    }

    // Calculate prices (always from database, never from input). Per-item
    // variant selections (option groups), addons and notes are validated
    // server-side and the unit price is recomputed from DB prices — the
    // client can never influence the amount (mirrors createCustomerOrder so
    // kasir manual orders support the same customizations as the website).
    let subtotal = 0;
    const orderItems = input.items.map((item) => {
      const product = productMap.get(item.productId)!;

      // Validate + price variant selections (option groups).
      let selectionPriceAdj = 0;
      const validatedSelections: Array<{
        groupId: string;
        groupName: string;
        optionId: string;
        optionName: string;
        priceAdjustment: number;
      }> = [];
      if (item.selections && item.selections.length > 0) {
        for (const selection of item.selections) {
          const group = product.optionGroups.find(
            (g) => g.id === selection.groupId
          );
          if (!group) {
            throw new ValidationError(
              `Option group tidak valid untuk produk ${product.name}`
            );
          }
          const option = group.options.find((o) => o.id === selection.optionId);
          if (!option) {
            throw new ValidationError(
              `Option tidak valid: ${selection.optionName}`
            );
          }
          const priceAdj = Number(option.priceAdjustment);
          selectionPriceAdj += priceAdj;
          validatedSelections.push({
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            priceAdjustment: priceAdj,
          });
        }

        // Required groups, minSelect, maxSelect must be satisfied.
        for (const group of product.optionGroups) {
          const groupSelections = validatedSelections.filter(
            (s) => s.groupId === group.id
          );
          const count = groupSelections.length;
          if (group.isRequired && count < group.minSelect) {
            throw new ValidationError(
              `Wajib memilih minimal ${group.minSelect} dari ${group.name} untuk ${product.name}`
            );
          }
          if (count > group.maxSelect) {
            throw new ValidationError(
              `Maksimal memilih ${group.maxSelect} dari ${group.name} untuk ${product.name}`
            );
          }
        }
      } else {
        // Required groups that weren't provided are rejected.
        for (const group of product.optionGroups) {
          if (group.isRequired && group.minSelect > 0 && group.options.length > 0) {
            throw new ValidationError(
              `Wajib memilih ${group.name} untuk ${product.name}`
            );
          }
        }
      }

      // Validate + price addons.
      let addonPrice = 0;
      const validatedAddons: Array<{
        addonId: string;
        name: string;
        price: number;
        quantity: number;
      }> = [];
      if (item.addons && item.addons.length > 0) {
        for (const addon of item.addons) {
          const dbAddon = product.addons.find((a) => a.id === addon.addonId);
          if (!dbAddon) {
            throw new ValidationError(`Addon tidak valid: ${addon.name}`);
          }
          const addonPriceTotal = Number(dbAddon.price) * addon.quantity;
          addonPrice += addonPriceTotal;
          validatedAddons.push({
            addonId: dbAddon.id,
            name: dbAddon.name,
            price: Number(dbAddon.price),
            quantity: addon.quantity,
          });
        }
      }

      // H0 — effective base price is the branch override when set
      // (override ?? Product.price; an override of 0 is a valid free price).
      const effectiveBasePrice =
        priceOverrideByProduct.get(item.productId) ?? product.price;
      const unitPrice =
        Number(effectiveBasePrice) + selectionPriceAdj + addonPrice;
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;

      const customizations = {
        productName: product.name,
        basePrice: Number(effectiveBasePrice),
        selections: validatedSelections,
        addons: validatedAddons,
        notes: item.notes || null,
      };

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        notes: item.notes || null,
        customizations: JSON.stringify(customizations),
      };
    });

    // H5 — no hardcoded tax / service charge. Both default to 0 so the bill is
    // exactly subtotal (no discount on the admin/POS path), matching what the
    // gateway and the cashier are asked to collect. A configurable per-outlet
    // tax setting is a separate feature; until then the server never invents
    // a percentage.
    const tax = 0;
    const serviceCharge = 0;
    const grandTotal = subtotal;

    // Create order in transaction, retrying on a unique-constraint race
    // (restaurantId + orderNumber) with a fresh order number each attempt.
    const createInTx = (orderNumber: string) =>
      prisma.$transaction(async (tx) => {
        // Create order
        const newOrder = await tx.order.create({
          data: {
            restaurantId,
            branchId: branchId || null,
            orderNumber,
            customerId: input.customerId,
            tableId: input.tableId,
            orderType: input.orderType || "DINE_IN",
            status: "PENDING",
            paymentStatus: "UNPAID",
            subtotal,
            tax,
            serviceCharge,
            grandTotal,
            notes: input.notes,
            items: {
              create: orderItems,
            },
          },
          include: {
            customer: { select: { id: true, name: true, phone: true } },
            table: true,
            items: {
              include: {
                product: true,
              },
            },
          },
        });

        // Create initial status history
        await tx.orderStatusHistory.create({
          data: {
            orderId: newOrder.id,
            status: "PENDING",
            notes: "Order created",
          },
        });

        // Update table status if table is assigned
        if (input.tableId) {
          await tx.table.update({
            where: { id: input.tableId },
            data: { status: "OCCUPIED" },
          });
        }

        // K5 — hold the product stock atomically with the order. The row lock
        // lives inside applyStockMovement, so a concurrent order for the same
        // last unit fails HERE (and rolls the order back) instead of later at
        // READY, after the customer has already paid.
        await ensureOrderStockReserved(tx, {
          restaurantId,
          orderId: newOrder.id,
          branchId: branchId || null,
          items: orderItems.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
          reason: "Stok dipegang saat pesanan dibuat",
        });

        return newOrder;
      });

    let order: Awaited<ReturnType<typeof createInTx>> | null = null;
    for (let attempt = 0; attempt < UNIQUE_RETRY_ATTEMPTS; attempt++) {
      try {
        order = await createInTx(generateOrderNumber());
        break;
      } catch (error) {
        const isCollision =
          isUniqueViolation(error) &&
          // Only retry when the collision is on the order number, not e.g.
          // a customer phone duplicate that a fresh number cannot fix.
          orderNumberTarget(error).includes("orderNumber");
        if (!isCollision || attempt === UNIQUE_RETRY_ATTEMPTS - 1) {
          throw error;
        }
      }
    }
    if (!order) {
      throw new Error("Failed to create order after retries");
    }
    const createdOrder = order;

    // Realtime: order created by the restaurant admin.
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.ORDER_CREATED, createdOrder.id, {
      orderId: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      orderType: createdOrder.orderType,
      status: createdOrder.status,
      tableId: createdOrder.tableId || null,
      visitorCount: createdOrder.visitorCount,
      customerId: createdOrder.customerId,
      grandTotal: Number(createdOrder.grandTotal),
    });
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, createdOrder.id);
    if (createdOrder.tableId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
        `${createdOrder.tableId}-OCCUPIED`,
        { tableId: createdOrder.tableId, status: "OCCUPIED" }
      );
    }

    return createdOrder;
  }

  /**
   * Create an order from customer website (public).
   * Finds or creates customer by phone, validates table belongs to restaurant.
   *
   * `sessionCustomerId` (from the verified customer session cookie) is
   * required ONLY when a promoCode is used — guest checkout is unchanged.
   * The promo discount is always computed server-side from the DB.
   *
   * `branchId` (optional) is derived server-side from the QR/table context.
   * When a table is provided, the table's branch is authoritative and is
   * compared against a provided branchId to keep the QR/table consistent.
   */
  async createCustomerOrder(
    input: CreateCustomerOrderInput,
    restaurantId: string,
    sessionCustomerId?: string,
    branchId?: string | null
  ): Promise<CreatedCustomerOrder> {
    // Phase 4 — same subscription/quota gate as the admin POS path.
    await assertCanCreateOrder(restaurantId);

    const context = await this.buildCustomerOrderContext(
      prisma,
      input,
      restaurantId,
      branchId
    );

    // Retry on an order-number collision with a fresh number (bounded).
    let result: CustomerOrderResult | null = null;
    for (let attempt = 0; attempt < UNIQUE_RETRY_ATTEMPTS; attempt++) {
      try {
        result = await prisma.$transaction((tx) =>
          this.persistCustomerOrder(
            tx,
            input,
            restaurantId,
            sessionCustomerId,
            context
          )
        );
        break;
      } catch (error) {
        const isCollision =
          isUniqueViolation(error) &&
          orderNumberTarget(error).includes("orderNumber");
        if (!isCollision || attempt === UNIQUE_RETRY_ATTEMPTS - 1) {
          throw error;
        }
      }
    }
    if (!result) {
      throw new Error("Failed to create order after retries");
    }

    // Realtime AFTER the transaction above committed.
    this.emitCustomerOrderEffects(restaurantId, result.effects);
    return result.order;
  }

  /**
   * Create a customer order INSIDE a caller-owned transaction (reservation
   * integration). Validation + pricing are IDENTICAL to the public checkout
   * (same server-authoritative rules, same engine); the caller commits or
   * rolls back the whole unit, so a failed reservation rolls back its Order,
   * OrderItems and Payment together — no orphan order is possible.
   *
   * Post-commit realtime effects are RETURNED (not emitted); the caller must
   * call `emitCustomerOrderEffects` after its transaction commits.
   */
  async createCustomerOrderInTransaction(
    tx: Prisma.TransactionClient,
    input: CreateCustomerOrderInput,
    restaurantId: string,
    sessionCustomerId?: string,
    branchId?: string | null,
    options?: CustomerOrderEngineOptions
  ): Promise<CustomerOrderResult> {
    const context = await this.buildCustomerOrderContext(
      tx,
      input,
      restaurantId,
      branchId,
      options
    );
    return this.persistCustomerOrder(
      tx,
      input,
      restaurantId,
      sessionCustomerId,
      context,
      options
    );
  }

  /**
   * Announce a customer order's post-commit realtime side effects. Public so
   * the reservation flow (which owns its transaction) can emit them AFTER its
   * own commit — never before.
   */
  emitCustomerOrderEffects(
    restaurantId: string,
    effects: CustomerOrderEffects
  ): void {
    if (effects.createdCustomerId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.CUSTOMER_CREATED,
        effects.createdCustomerId,
        {
          customerId: effects.createdCustomerId,
          phone: effects.createdCustomerPhone,
        }
      );
    }
    if (effects.updatedCustomerId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.CUSTOMER_UPDATED,
        effects.updatedCustomerId,
        { customerId: effects.updatedCustomerId }
      );
    }
    if (effects.createdCashierPaymentId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_CREATED,
        effects.createdCashierPaymentId,
        {
          paymentId: effects.createdCashierPaymentId,
          orderId: effects.orderId,
          orderNumber: effects.orderNumber,
          amount: effects.grandTotal,
          status: "UNPAID",
          method: "KASIR",
          provider: null,
        }
      );
    }
    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.ORDER_CREATED,
      effects.orderId,
      {
        orderId: effects.orderId,
        orderNumber: effects.orderNumber,
        orderType: effects.orderType,
        status: effects.status,
        tableId: effects.tableId,
        visitorCount: effects.visitorCount,
        customerId: effects.customerId,
        grandTotal: effects.grandTotal,
      }
    );
    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.DASHBOARD_UPDATED,
      effects.orderId
    );
    if (effects.tableOccupied && effects.tableId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
        `${effects.tableId}-OCCUPIED`,
        { tableId: effects.tableId, status: "OCCUPIED" }
      );
    }
  }

  /**
   * Cancel the UNPAID order linked to a reservation that is being cancelled,
   * INSIDE the caller-owned transaction — so cancelling a reservation can never
   * leave an orphan order behind. Deliberately minimal and reusing the existing
   * Order model (NO new cancellation/refund engine):
   *   - a PAID order is NEVER touched here — the existing refund/cancellation
   *     workflow (Refund / CancellationRequest) stays the source of truth;
   *   - `Table.status` is never touched (reservation orders never set OCCUPIED,
   *     so another flow may own the table).
   * Returns true when the order was cancelled, false when nothing was done.
   */
  async cancelUnpaidLinkedOrderInTransaction(
    tx: Prisma.TransactionClient,
    orderId: string,
    restaurantId: string,
    notes?: string | null
  ): Promise<boolean> {
    const order = await tx.order.findFirst({
      where: { id: orderId, restaurantId },
      select: { id: true, status: true, paymentStatus: true },
    });
    if (!order) return false;
    if (order.paymentStatus === "PAID") return false;

    const allowed = VALID_STATUS_TRANSITIONS[order.status] || [];
    if (!allowed.includes("CANCELLED")) return false;

    // Conditional update: only from the status we just validated, so a racing
    // order transition can never be silently overwritten.
    const result = await tx.order.updateMany({
      where: { id: orderId, restaurantId, status: order.status },
      data: { status: "CANCELLED" },
    });
    if (result.count === 0) return false;

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        status: "CANCELLED",
        notes: notes ?? "Reservasi dibatalkan",
      },
    });

    // K5 — the linked order is gone: release the product stock hold it still
    // carries, inside this same transaction. Idempotent and a no-op for an
    // order that never deducted stock (e.g. legacy branch-less data).
    await releaseOrderStock(tx, {
      restaurantId,
      orderId,
      reason: notes ?? "Reservasi dibatalkan",
    });

    return true;
  }

  /**
   * Validate + price an order entirely from the database (server-authoritative).
   * Accepts the base client OR a transaction client so the exact same rules run
   * for public checkout and reservation-originated orders.
   */
  private async buildCustomerOrderContext(
    client: Prisma.TransactionClient,
    input: CreateCustomerOrderInput,
    restaurantId: string,
    branchId?: string | null,
    options?: CustomerOrderEngineOptions
  ): Promise<CustomerOrderContext> {
    // The QRIS/KASIR payment intent is DINE_IN-only. TAKEAWAY/DELIVERY must
    // keep the legacy gateway flow, so a paymentMethod on those types is a
    // server-side validation error (never silently ignored).
    if (input.paymentMethod && input.orderType !== "DINE_IN") {
      throw new ValidationError(
        "Payment method selection hanya tersedia untuk dine-in"
      );
    }

    // Validate restaurant exists and is active
    const restaurant = await client.restaurant.findFirst({
      where: { id: restaurantId, isActive: true },
    });
    if (!restaurant) {
      throw new NotFoundError("Restaurant not found");
    }

    // Normalize phone if provided
    const normalizedPhone = normalizePhone(input.customerPhone);

    // Validate table if provided
    let resolvedBranchId = branchId ?? null;
    if (input.tableId) {
      const table = await client.table.findFirst({
        where: {
          id: input.tableId,
          restaurantId,
        },
      });

      if (!table) {
        throw new NotFoundError("Table not found");
      }

      // Reservation availability (R5.1) is the sole authority for booking, so
      // a reservation-originated order does not re-validate the table's
      // operational status; normal checkout keeps the guard.
      if (table.status === "MAINTENANCE" && !options?.reservationMode) {
        throw new ValidationError("Table is under maintenance");
      }

      // The table's branch is authoritative; a mismatched request context is
      // rejected so Jakarta Table 01 can never be ordered from Bandung.
      if (table.branchId) {
        if (resolvedBranchId && table.branchId !== resolvedBranchId) {
          throw new ValidationError(
            "Meja tidak sesuai dengan cabang yang dipilih"
          );
        }
        resolvedBranchId = table.branchId;
      }
    }

    // ============================================================
    // DELIVERY — server-authoritative quote.
    //
    // A delivery order needs a branch (pickup origin), a full address and
    // coordinates. The courier fee is quoted HERE from the tenant's own
    // provider and persisted on the order; the client's deliveryFee (if it
    // sends one) is never read. Network I/O happens before the order
    // transaction, so a slow courier API cannot hold DB locks.
    // ============================================================
    let deliveryFee = 0;
    let deliveryAddress: string | null = null;
    let deliveryLatitude: number | null = null;
    let deliveryLongitude: number | null = null;
    let deliveryNotes: string | null = null;
    let deliveryProvider: string | null = null;
    let deliveryCourier: string | null = null;
    let deliveryServiceType: string | null = null;

    if (input.orderType === "DELIVERY") {
      if (input.tableId) {
        throw new ValidationError(
          "Pesanan delivery tidak menggunakan meja — hapus pilihan meja."
        );
      }
      if (!resolvedBranchId) {
        throw new ValidationError(
          "Pilih cabang pengiriman terlebih dahulu."
        );
      }
      const address = input.deliveryAddress?.trim();
      if (!address || address.length < 5) {
        throw new ValidationError("Alamat pengiriman wajib diisi.");
      }
      if (
        input.deliveryLatitude === undefined ||
        input.deliveryLongitude === undefined
      ) {
        throw new ValidationError(
          "Koordinat alamat pengiriman wajib diisi (gunakan \"Gunakan Lokasi Saya\")."
        );
      }

      const { deliveryService } = await import(
        "@/services/delivery/delivery.service"
      );
      const quote = await deliveryService.quoteForOrder({
        restaurantId,
        branchId: resolvedBranchId,
        destination: {
          address,
          latitude: input.deliveryLatitude,
          longitude: input.deliveryLongitude,
          contactName: input.customerName || null,
          contactPhone: normalizedPhone,
        },
        courierCode: input.deliveryCourier ?? null,
        serviceType: input.deliveryService ?? null,
      });

      deliveryFee = quote.rate.fee;
      deliveryAddress = address;
      deliveryLatitude = input.deliveryLatitude;
      deliveryLongitude = input.deliveryLongitude;
      deliveryNotes = input.deliveryNotes?.trim() || null;
      deliveryProvider = quote.provider;
      deliveryCourier = quote.rate.courierCode;
      deliveryServiceType = quote.rate.serviceType;
    }

    // Validate all products exist, are available, and belong to this restaurant.
    // Deduplicate product ids BEFORE comparing counts — the same product may
    // appear several times with different customizations (see H7).
    const productIds = input.items.map((item) => item.productId);
    const uniqueProductIds = [...new Set(productIds)];
    const products = await client.product.findMany({
      where: {
        id: { in: uniqueProductIds },
        restaurantId,
        isActive: true,
        isAvailable: true,
      },
      include: {
        optionGroups: {
          where: { isActive: true },
          include: {
            options: { where: { isActive: true } },
          },
          orderBy: { sortOrder: "asc" },
        },
        addons: {
          where: { isActive: true },
          orderBy: { sortOrder: "asc" },
        },
      },
    });

    if (products.length !== uniqueProductIds.length) {
      const foundIds = new Set(products.map((p) => p.id));
      const missingIds = uniqueProductIds.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        `Produk tidak ditemukan atau tidak tersedia: ${missingIds.join(", ")}`
      );
    }

    // Branch product availability: a product hidden for this branch cannot be
    // ordered from it (only enforced when a branch is resolved). The same rows
    // carry the branch price override (H0) — effective base price =
    // override ?? Product.price (an override of 0 is a valid free price).
    const priceOverrideByProduct = new Map<string, Prisma.Decimal | null>();
    if (resolvedBranchId) {
      const branchProducts = await client.branchProduct.findMany({
        where: {
          branchId: resolvedBranchId,
          productId: { in: uniqueProductIds },
        },
        select: { productId: true, isAvailable: true, priceOverride: true },
      });
      if (branchProducts.some((bp) => !bp.isAvailable)) {
        throw new ValidationError(
          "Beberapa produk tidak tersedia di cabang ini"
        );
      }
      for (const bp of branchProducts) {
        priceOverrideByProduct.set(bp.productId, bp.priceOverride);
      }
    }

    // Create product map for quick lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Stock validation: aggregate quantities per product across all line
    // items and verify against BranchProduct.stock. Only enforced when
    // the branch is known (QR table context provides it). Under a resolved
    // branch a product WITHOUT a BranchProduct row is treated as SOLD OUT
    // (default stock 0 after the stock migration) — a branch can only sell
    // products the staff explicitly stocked (> 0).
    if (resolvedBranchId) {
      const qtyByProduct = new Map<string, number>();
      for (const item of input.items) {
        qtyByProduct.set(
          item.productId,
          (qtyByProduct.get(item.productId) || 0) + item.quantity
        );
      }
      const branchStockRows = await client.branchProduct.findMany({
        where: {
          branchId: resolvedBranchId,
          productId: { in: uniqueProductIds },
        },
        select: { productId: true, stock: true },
      });
      const stockMap = new Map(branchStockRows.map((r) => [r.productId, r.stock]));
      for (const [pid, qty] of qtyByProduct) {
        const stock = stockMap.get(pid);
        if (stock === undefined) {
          const p = productMap.get(pid);
          throw new ValidationError(
            `Produk ${p?.name || pid} sudah habis`
          );
        }
        if (stock <= 0) {
          const p = productMap.get(pid);
          throw new ValidationError(
            `Produk ${p?.name || pid} sudah habis`
          );
        }
        if (stock < qty) {
          const p = productMap.get(pid);
          throw new ValidationError(
            `Stok ${p?.name || pid} tidak mencukupi (tersisa ${stock}, diminta ${qty})`
          );
        }
      }
    }

    // Calculate prices (always from database, never from input)
    let subtotal = 0;
    const orderItems = input.items.map((item) => {
      const product = productMap.get(item.productId)!;
      // H0 — effective base price is the branch override when set
      // (override ?? Product.price; an override of 0 is a valid free price).
      const basePrice = Number(
        priceOverrideByProduct.get(item.productId) ?? product.price
      );

      // Validate and calculate selections (variants)
      let selectionPriceAdj = 0;
      const validatedSelections: Array<{
        groupId: string;
        groupName: string;
        optionId: string;
        optionName: string;
        priceAdjustment: number;
      }> = [];

      if (item.selections && item.selections.length > 0) {
        for (const selection of item.selections) {
          // Find the option group on this product
          const group = product.optionGroups.find((g) => g.id === selection.groupId);
          if (!group) {
            throw new ValidationError(
              `Option group tidak valid untuk produk ${product.name}`
            );
          }

          // Find the option within the group
          const option = group.options.find((o) => o.id === selection.optionId);
          if (!option) {
            throw new ValidationError(
              `Option tidak valid: ${selection.optionName}`
            );
          }

          const priceAdj = Number(option.priceAdjustment);
          selectionPriceAdj += priceAdj;

          validatedSelections.push({
            groupId: group.id,
            groupName: group.name,
            optionId: option.id,
            optionName: option.name,
            priceAdjustment: priceAdj,
          });
        }

        // Validate required groups, minSelect, and maxSelect are satisfied
        for (const group of product.optionGroups) {
          const groupSelections = validatedSelections.filter(
            (s) => s.groupId === group.id
          );
          const count = groupSelections.length;

          if (group.isRequired && count < group.minSelect) {
            throw new ValidationError(
              `Wajib memilih minimal ${group.minSelect} dari ${group.name} untuk ${product.name}`
            );
          }
          if (count > group.maxSelect) {
            throw new ValidationError(
              `Maksimal memilih ${group.maxSelect} dari ${group.name} untuk ${product.name}`
            );
          }
        }
      } else {
        // Check if there are required groups that weren't provided
        for (const group of product.optionGroups) {
          if (group.isRequired && group.minSelect > 0 && group.options.length > 0) {
            throw new ValidationError(
              `Wajib memilih ${group.name} untuk ${product.name}`
            );
          }
        }
      }

      // Validate and calculate addons
      let addonPrice = 0;
      const validatedAddons: Array<{
        addonId: string;
        name: string;
        price: number;
        quantity: number;
      }> = [];

      if (item.addons && item.addons.length > 0) {
        for (const addon of item.addons) {
          // Find the addon on this product
          const dbAddon = product.addons.find((a) => a.id === addon.addonId);
          if (!dbAddon) {
            throw new ValidationError(
              `Addon tidak valid: ${addon.name}`
            );
          }

          const addonPriceTotal = Number(dbAddon.price) * addon.quantity;
          addonPrice += addonPriceTotal;

          validatedAddons.push({
            addonId: dbAddon.id,
            name: dbAddon.name,
            price: Number(dbAddon.price),
            quantity: addon.quantity,
          });
        }
      }

      // Unit price = base price + selection adjustments + addon prices
      const unitPrice = basePrice + selectionPriceAdj + addonPrice;
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;

      // Build customization snapshot
      const customizations = {
        productName: product.name,
        basePrice,
        selections: validatedSelections,
        addons: validatedAddons,
        notes: item.notes || null,
      };

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
        notes: item.notes || null,
        customizations: JSON.stringify(customizations),
      };
    });

    // Server-authoritative pricing is complete — hand the validated context to
    // the create step (see persistCustomerOrder).
    return {
      resolvedBranchId,
      orderItems,
      subtotal,
      normalizedPhone,
      deliveryFee,
      deliveryAddress,
      deliveryLatitude,
      deliveryLongitude,
      deliveryNotes,
      deliveryProvider,
      deliveryCourier,
      deliveryServiceType,
    };
  }

  /**
   * Persist a validated customer order on the CALLER-PROVIDED transaction
   * client. The public checkout opens its own transaction; the reservation
   * flow supplies its own so Order + OrderItems + Payment + Reservation are
   * ONE atomic unit. Returns the created order and its post-commit effects.
   */
  private async persistCustomerOrder(
    tx: Prisma.TransactionClient,
    input: CreateCustomerOrderInput,
    restaurantId: string,
    sessionCustomerId: string | undefined,
    context: CustomerOrderContext,
    options?: CustomerOrderEngineOptions
  ): Promise<CustomerOrderResult> {
    const {
      resolvedBranchId,
      orderItems,
      subtotal,
      normalizedPhone,
      deliveryFee,
      deliveryAddress,
      deliveryLatitude,
      deliveryLongitude,
      deliveryNotes,
      deliveryProvider,
      deliveryCourier,
      deliveryServiceType,
    } = context;


    // Customer side effects are collected here and RETURNED so the caller can
    // announce them AFTER its transaction commits (a guest checkout creates a
    // new Customer row).
    let createdCustomerId: string | null = null;
    let updatedCustomerId: string | null = null;
    let createdCustomerPhone: string | null = null;
    let createdCashierPaymentId: string | null = null;
    let tableOccupied = false;

    const orderNumber = generateOrderNumber();

    return await (async () => {
      // Find or create customer. A promo REQUIRES the logged-in customer
      // (promos are only usable by logged-in customers) — the order is then
      // tied to that account so usage limits can be enforced per customer.
      let customer;
      if (input.promoCode) {
        if (!sessionCustomerId) {
          throw new UnauthorizedError(
            "Login customer diperlukan untuk memakai promo"
          );
        }
        customer = await tx.customer.findFirst({
          where: { id: sessionCustomerId, restaurantId, isActive: true },
        });
        if (!customer) {
          throw new NotFoundError("Customer tidak ditemukan");
        }
        if (input.customerName && !customer.name) {
          customer = await tx.customer.update({
            where: { id: customer.id },
            data: { name: input.customerName },
          });
          updatedCustomerId = customer.id;
        }
      } else if (normalizedPhone) {
        // Try to find existing customer by phone
        customer = await tx.customer.findFirst({
          where: {
            restaurantId,
            phone: normalizedPhone,
          },
        });

        if (!customer) {
          customer = await tx.customer.create({
            data: {
              restaurantId,
              phone: normalizedPhone,
              name: input.customerName,
            },
          });
          createdCustomerId = customer.id;
          createdCustomerPhone = normalizedPhone;
        } else if (input.customerName && !customer.name) {
          // Update name if customer exists but has no name
          customer = await tx.customer.update({
            where: { id: customer.id },
            data: { name: input.customerName },
          });
          updatedCustomerId = customer.id;
        }
      } else {
        // No phone — create customer with a generated placeholder phone
        // Use a unique placeholder to avoid unique constraint conflicts
        const placeholderPhone = `guest-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        customer = await tx.customer.create({
          data: {
            restaurantId,
            phone: placeholderPhone,
            name: input.customerName,
          },
        });
        createdCustomerId = customer.id;
        createdCustomerPhone = placeholderPhone;
      }

      // Promo application — server-authoritative discount, validated inside
      // this transaction (per-promo row lock, quota + per-customer limits).
      let discount = 0;
      let promoId: string | null = null;
      let promoCode: string | null = null;
      if (input.promoCode) {
        const applied = await promoService.applyPromoToOrder(
          tx,
          restaurantId,
          resolvedBranchId,
          customer.id,
          input.promoCode,
          subtotal
        );
        discount = applied.discount;
        promoId = applied.promoId;
        promoCode = applied.promoCode;
      }

      // H5 — no hardcoded tax / service charge: both are always 0, so the
      // payable total is exactly the discounted subtotal. This is the same
      // number persisted on the order, sent to iPaymu and shown to the
      // cashier — one source of truth.
      const taxBase = Math.max(subtotal - discount, 0);
      const tax = 0;
      const serviceCharge = 0;
      // Delivery fee is the SERVER quote captured in the context — it is part
      // of the payable total sent to iPaymu and mirrored on the order.
      const grandTotal = taxBase + deliveryFee;

      // Create order
      const newOrder = await tx.order.create({
        data: {
          restaurantId,
          branchId: resolvedBranchId,
          orderNumber,
          customerId: customer.id,
          tableId: input.tableId || null,
          visitorCount: input.visitorCount || null,
          orderType: input.orderType || "DINE_IN",
          status: "PENDING",
          paymentStatus: "UNPAID",
          subtotal,
          discount,
          tax,
          serviceCharge,
          grandTotal,
          deliveryFee,
          deliveryAddress,
          deliveryLatitude,
          deliveryLongitude,
          deliveryNotes,
          notes: input.notes,
          promoId,
          promoCode,
          items: {
            create: orderItems,
          },
        },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          table: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      // Delivery booking INTENT (PENDING). Created atomically with the order
      // so dispatch later reuses this row — one order can never hold two
      // courier bookings. No courier API is contacted here.
      if (
        input.orderType === "DELIVERY" &&
        deliveryProvider &&
        deliveryCourier &&
        deliveryServiceType
      ) {
        await tx.orderShipment.create({
          data: {
            restaurantId,
            orderId: newOrder.id,
            provider: deliveryProvider,
            courierCode: deliveryCourier,
            serviceType: deliveryServiceType,
            status: "PENDING",
            fee: deliveryFee,
          },
        });
      }

      // Record the promo use (upgrades a prior claim row when present).
      if (promoId) {
        await promoService.recordPromoUse(tx, promoId, customer.id, newOrder.id, resolvedBranchId);
      }

      // Create initial status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: newOrder.id,
          status: "PENDING",
          notes: "Order created via website",
        },
      });

      // Update table status if table is assigned. A reservation-originated
      // order must NEVER flip the table to OCCUPIED: a booking is not
      // "seated" — the reservation (R5.1) owns availability and the order
      // only references the table.
      if (input.tableId && !options?.reservationMode) {
        await tx.table.update({
          where: { id: input.tableId },
          data: { status: "OCCUPIED" },
        });
        tableOccupied = true;
      }

      // K5 — hold the product stock inside this same transaction (BranchProduct
      // FOR UPDATE). A race for the last unit now loses here, before payment,
      // instead of producing a paid order that cannot reach READY.
      await ensureOrderStockReserved(tx, {
        restaurantId,
        orderId: newOrder.id,
        branchId: resolvedBranchId,
        items: orderItems.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        })),
        reason: "Stok dipegang saat pesanan dibuat",
      });

      // KASIR intent: record the UNPAID cashier payment atomically with the
      // order (no gateway call), so a DINE-IN order never exists without its
      // cashier payment row and a refresh/retry can never duplicate it.
      if (input.paymentMethod === "KASIR") {
        const cashierPayment = await tx.payment.create({
          data: {
            restaurantId,
            branchId: resolvedBranchId,
            orderId: newOrder.id,
            status: "UNPAID",
            amount: grandTotal,
            method: "KASIR",
          },
        });
        createdCashierPaymentId = cashierPayment.id;
      }

      return {
        order: newOrder,
        effects: {
          orderId: newOrder.id,
          orderNumber: newOrder.orderNumber,
          orderType: newOrder.orderType,
          status: newOrder.status,
          tableId: newOrder.tableId ?? null,
          visitorCount: newOrder.visitorCount ?? null,
          customerId: newOrder.customerId,
          grandTotal: Number(newOrder.grandTotal),
          createdCustomerId,
          updatedCustomerId,
          createdCustomerPhone,
          createdCashierPaymentId,
          tableOccupied,
        },
      };
    })();
  }

  /**
   * Get orders with pagination, filtering, and search.
   * Scoped to restaurantId (and branchId when the caller is branch-scoped).
   */
  async getOrders(
    input: GetOrdersInput,
    restaurantId: string,
    branchFilters?: string[] | null
  ) {
    const { page, limit, status, search, startDate, endDate } = input;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {
      restaurantId,
    };

    if (branchFilters?.length) {
      where.branchId = { in: branchFilters };
    }

    if (status) {
      where.status = status;
    }

    if (search) {
      where.OR = [
        { orderNumber: { contains: search } },
        { customer: { name: { contains: search } } },
        { customer: { phone: { contains: search } } },
      ];
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate);
      if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate);
    }

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          table: true,
          // Branch name/code so the UI can label orders when the admin views
          // "Semua Cabang" — never the raw database id.
          branch: {
            select: { id: true, name: true, code: true },
          },
          items: {
            include: {
              product: true,
            },
          },
          payments: {
            select: {
              id: true,
              method: true,
              provider: true,
              status: true,
              amount: true,
              paymentUrl: true,
              paidAt: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
          },
          refunds: {
            where: { status: "APPROVED" },
            select: { amount: true },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      items: orders.map((order) => {
        const collected = order.payments
          .filter((payment) => payment.status === "PAID" || payment.status === "REFUNDED")
          .reduce((sum, payment) => sum + Number(payment.amount), 0);
        const refunded = order.refunds.reduce((sum, refund) => sum + Number(refund.amount), 0);
        return {
          ...order,
          fullyRefunded:
            collected > MONEY_EPSILON && refunded >= collected - MONEY_EPSILON,
        };
      }),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get single order by ID with restaurant ownership verification.
   * Payment rows carry their transactions so cashier audit entries
   * (amountDue/amountReceived/changeAmount/processedBy) can be shown.
   * Restaurant + branding (logo/site name) are included so the admin can
   * render a print bill without a second round-trip.
   *
   * When `branchFilters` is provided the order must belong to one of those
   * branches, and a branch-scoped caller can never read another branch's order.
   */
  async getOrder(id: string, restaurantId: string, branchFilters?: string[] | null) {
    const order = await prisma.order.findFirst({
      where: {
        id,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        table: true,
        branch: {
          select: { id: true, name: true, code: true },
        },
        restaurant: {
          select: {
            name: true,
            address: true,
            phone: true,
            settings: {
              select: {
                siteName: true,
                logoUrl: true,
              },
            },
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: "desc" },
        },
        payments: {
          include: {
            transactions: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        shipment: true,
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    return order;
  }

  /**
   * Get a single order by its PUBLIC order number (admin, restaurant-scoped).
   * Used by the /admin/orders/[orderNumber] page after a QR scan — the order
   * number alone is not enough to cross the restaurant boundary. When
   * `branchFilters` is provided the order must also belong to one of those
   * branches (QR scan from a cashier is branch-scoped).
   */
  async getOrderByNumberScoped(
    orderNumber: string,
    restaurantId: string,
    branchFilters?: string[] | null
  ) {
    const order = await prisma.order.findFirst({
      where: {
        orderNumber,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        table: true,
        branch: {
          select: { id: true, name: true, code: true },
        },
        restaurant: {
          select: {
            name: true,
            address: true,
            phone: true,
            settings: {
              select: {
                siteName: true,
                logoUrl: true,
              },
            },
          },
        },
        items: {
          include: {
            product: true,
          },
        },
        statusHistory: {
          orderBy: { createdAt: "asc" },
        },
        payments: {
          include: {
            transactions: {
              orderBy: { createdAt: "asc" },
            },
          },
        },
        shipment: true,
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    return order;
  }

  /**
   * Get order by order number (public — for customer tracking).
   * No auth required, but order must exist.
   *
   * Returns only the fields needed for customer tracking — the caller maps
   * this to an explicit DTO (never the raw Prisma object). Customer phone
   * and internal payment fields (provider / paymentUrl / providerRef) are
   * intentionally NOT selected here (see H3).
   */
  async getOrderByNumber(orderNumber: string, restaurantId?: string) {
    // Phase 2 (multi-tenant): public tracking passes the resolved tenant so
    // an order number from merchant B can never be read through merchant A's
    // storefront. Admin callers keep the old signature (no tenant filter).
    const order = await prisma.order.findFirst({
      where: { orderNumber, ...(restaurantId ? { restaurantId } : {}) },
      include: {
        customer: {
          select: { name: true },
        },
        table: {
          select: { number: true, name: true },
        },
        items: {
          include: {
            product: {
              select: { name: true },
            },
          },
        },
        statusHistory: {
          orderBy: { createdAt: "asc" },
          select: {
            status: true,
            notes: true,
            createdAt: true,
          },
        },
        payments: {
          select: {
            method: true,
            status: true,
            amount: true,
            paidAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        // Public-safe shipment fields only (no raw provider payload).
        shipment: {
          select: {
            provider: true,
            courierCode: true,
            serviceType: true,
            status: true,
            fee: true,
            waybillId: true,
            driverName: true,
            driverPhone: true,
            driverPlate: true,
            trackingUrl: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    return order;
  }

  /**
   * Update order status with validation and restaurant ownership check.
   * Returns additional info about whether WhatsApp notification was triggered.
   *
   * When `branchFilters` is provided the order must belong to one of those
   * branches.
   */
  async updateOrderStatus(
    id: string,
    input: UpdateOrderStatusInput,
    restaurantId: string,
    changedBy?: string,
    branchFilters?: string[] | null
  ): Promise<{ order: Record<string, unknown>; whatsappTriggered: boolean }> {
    const order = await prisma.order.findFirst({
      where: {
        id,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
      include: {
        table: true,
        customer: { select: { id: true, name: true, phone: true } },
        restaurant: {
          select: { name: true },
        },
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    // Validate status transition
    const allowedTransitions = VALID_STATUS_TRANSITIONS[order.status] || [];
    if (!allowedTransitions.includes(input.status)) {
      throw new ConflictError(
        `Cannot transition from ${order.status} to ${input.status}`
      );
    }

    let whatsappTriggered = false;

    // Historical COGS snapshot (F.5) — the item set is captured INSIDE the
    // completion transaction but the snapshot itself is written BEST-EFFORT
    // after that transaction commits (see below). Order completion is not
    // conditioned on costing data: recipe / WAC / ingredient / addon-option
    // BOM availability never blocks the status flip.
    let cogsSnapshotInput: {
      restaurantId: string;
      orderId: string;
      branchId: string | null;
      items: Array<{
        orderItemId: string;
        productId: string;
        quantity: number;
        customizations?: unknown;
      }>;
    } | null = null;

    // Update order status. The transition itself is a CONDITIONAL update
    // (only from the status we validated above), so two concurrent or
    // double-clicked requests cannot both write the same transition — the
    // loser gets a ConflictError instead of a duplicate history row (LOW-7).
    const updatedOrder = await prisma.$transaction(
      async (tx) => {
        const updated = await tx.order.updateMany({
          where: { id, status: order.status },
        data: {
          status: input.status as "PENDING" | "CONFIRMED" | "PROCESSING" | "READY" | "COMPLETED" | "CANCELLED",
        },
      });

      if (updated.count === 0) {
        throw new ConflictError(
          "Status pesanan telah berubah — silakan muat ulang"
        );
      }

      // P0 (PHASE 7B) — a cancelled order must not silently drop collected
      // money. Direct status updates (this path) previously had NO payment
      // guard, so a PAID order could become CANCELLED with no refund, no
      // payment void and no financial record (live evidence:
      // ORD-20260908-HCOK1L). Reuse the EXACT semantic the approval engine
      // already enforces in `decideCancellation` (`computeNetCollected`, the
      // shared net-collected basis) — no second formula. Read inside this
      // transaction so a concurrently-approved refund is observed; the throw
      // rolls back the status flip above.
      if (input.status === "CANCELLED") {
        const netCollected = await computeNetCollected(tx, id);
        if (netCollected > MONEY_EPSILON) {
          throw new ConflictError(ORDER_STILL_HOLDS_MONEY_MESSAGE);
        }
      }

      // A fully refunded order must not be completed (which would consume
      // stock and freeze COGS for a sale that no longer exists). Partial
      // refunds can still complete the remaining order. Read INSIDE this same
      // transaction so a concurrent refund approval cannot slip through.
      if (order.status !== "COMPLETED" && input.status === "COMPLETED") {
        const netCollected = await computeNetCollected(tx, id);
        if (netCollected <= MONEY_EPSILON) {
          throw new ConflictError(
            "Order sudah direfund penuh dan tidak dapat diselesaikan."
          );
        }
      }

      const fresh = await tx.order.findUnique({
        where: { id },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          table: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      });
      if (!fresh) {
        throw new NotFoundError("Order not found");
      }

      // F.5 — capture the snapshot input for THIS order's items. Written once,
      // only on a real COMPLETED transition (from a non-COMPLETED status).
      // The write itself happens after commit and is never a prerequisite of
      // completion; a repeated COMPLETED request never re-snapshots (the
      // unique orderItemId also rejects a second write).
      if (order.status !== "COMPLETED" && input.status === "COMPLETED") {
        cogsSnapshotInput = {
          restaurantId,
          orderId: id,
          branchId: order.branchId,
          items: fresh.items.map((item) => ({
            orderItemId: item.id,
            productId: item.productId,
            quantity: item.quantity,
            // H4.3 — freeze the actual HPP of the selected addon/option BOM.
            customizations: item.customizations,
          })),
        };
      }

      // Create status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: input.status as "PENDING" | "CONFIRMED" | "PROCESSING" | "READY" | "COMPLETED" | "CANCELLED",
          notes: input.notes,
          changedBy,
        },
      });

      // K5 — product stock is now HELD when the order is created
      // (ORDER_RESERVE), so READY must never deduct a second time. Legacy
      // orders created before the hold existed keep the former
      // READY/COMPLETED deduction as a one-time fallback: it only runs when no
      // deduction ledger row exists for the order yet. The deduction itself
      // stays atomic (branchproduct FOR UPDATE, balance may not go negative).
      const stockAlreadyDeducted = await orderHasStockDeduction(
        tx,
        restaurantId,
        order.id
      );

      let legacyReadyNeedsStockDeduction = false;
      if (
        !stockAlreadyDeducted &&
        order.status === "READY" &&
        input.status === "COMPLETED" &&
        order.branchId
      ) {
        legacyReadyNeedsStockDeduction = true;
      }

      const deductProductStockNow =
        !stockAlreadyDeducted &&
        ((order.status === "PROCESSING" && input.status === "READY") ||
          legacyReadyNeedsStockDeduction);
      if (deductProductStockNow && order.branchId) {
        // Aggregate quantity per product across order items
        const freshItems = await tx.orderItem.findMany({
          where: { orderId: id },
          // H4.4 — the stored customizations drive addon/option BOM
          // consumption (IDs + quantities only; never client prices).
          select: { productId: true, quantity: true, customizations: true },
        });
        const qtyByProduct = new Map<string, number>();
        for (const item of freshItems) {
          qtyByProduct.set(
            item.productId,
            (qtyByProduct.get(item.productId) || 0) + item.quantity
          );
        }

        for (const [pid, qty] of qtyByProduct) {
          // Atomic conditional deduction through the shared stock-movement
          // foundation: the branchproduct row is locked FOR UPDATE, the
          // balance may not drop below 0, and a StockMovement OUT row is
          // appended in the SAME transaction. If two COMPLETED requests
          // race, the loser's conditional order-status update rolls back —
          // no double deduction, no ledger row without its balance change.
          try {
            await applyStockMovement(tx, {
              restaurantId,
              branchId: order.branchId,
              productId: pid,
              type: "OUT",
              quantity: -qty,
              refType: legacyReadyNeedsStockDeduction
                ? "ORDER_COMPLETED"
                : StockRefType.ORDER_READY,
              refId: order.id,
              reason: input.notes ?? null,
              userId: changedBy ?? undefined,
            });
          } catch (error) {
            if (error instanceof ConflictError) {
              throw new ConflictError(
                `Stok produk tidak mencukupi — status ${input.status} tidak dapat diterapkan`
              );
            }
            throw error;
          }
        }
      }

      // K4 — consume the recipe/BOM of the completed order in THIS
      // transaction. Idempotent: the ORDER_COMPLETED ledger row is written
      // exactly once per order, so a repeated completion never consumes twice.
      // Master-data gaps (missing/empty recipe, addon/option BOM not filled,
      // inactive ingredient) still never block a paid order from completing —
      // the engine validates every requirement BEFORE its first ledger write,
      // so a skipped run leaves no partial stock and no partial ledger. A
      // genuine failure (infrastructure, unexpected) propagates and rolls the
      // status flip back.
      if (
        order.status !== "COMPLETED" &&
        input.status === "COMPLETED" &&
        order.branchId
      ) {
        const alreadyConsumed = await tx.ingredientStockMovement.findFirst({
          where: {
            restaurantId,
            refType: "ORDER_COMPLETED",
            refId: order.id,
          },
          select: { id: true },
        });
        if (!alreadyConsumed) {
          try {
            await consumeOrderIngredients(tx, {
              restaurantId,
              branchId: order.branchId,
              items: fresh.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
                customizations: item.customizations,
              })),
              refId: order.id,
              reason: `Pesanan ${order.orderNumber} selesai`,
              userId: changedBy ?? null,
            });
          } catch (error) {
            if (error instanceof IngredientCompletionError) {
              console.warn(
                `[Order] Ingredient consumption skipped for ${order.orderNumber}: ${error.message}`
              );
            } else {
              throw error;
            }
          }
        }
      }

      // Free table when order is completed or cancelled
      if (
        (input.status === "COMPLETED" || input.status === "CANCELLED") &&
        order.tableId
      ) {
        await tx.table.update({
          where: { id: order.tableId },
          data: { status: "AVAILABLE" },
        });
      }

      // K5 — return whatever product stock this order still holds (the hold
      // written at creation, or the legacy READY deduction). Ledger-derived
      // and idempotent: an approved refund that already restored part of the
      // order is subtracted, never restored twice.
      if (input.status === "CANCELLED") {
        await releaseOrderStock(tx, {
          restaurantId,
          orderId: order.id,
          reason: input.notes ?? "Pesanan dibatalkan",
          userId: changedBy ?? null,
        });
      }

      return fresh;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }
    );

    // ============================================================
    // Historical COGS snapshot (F.5) — BEST-EFFORT, AFTER commit
    // ============================================================
    // The order is already COMPLETED at this point. Recipe / WAC / ingredient
    // / addon-option BOM availability — and even a snapshot write failure —
    // can no longer affect the order outcome. `createOrderItemCostSnapshots`
    // already records an explicit NULL status (NO_RECIPE / MISSING_WAC /
    // INACTIVE_INGREDIENT / NO_BRANCH) when cost data is unavailable, so a
    // missing recipe never throws here and never becomes 0. Only a genuine
    // infrastructure/DB failure is isolated below: the order stays COMPLETED
    // and the absent snapshot is surfaced by Integrity Monitoring (existing
    // disclosure) instead of blocking the restaurant's workflow. Written
    // exactly once — `orderItemId` is unique and this runs only on a real
    // pre-COMPLETED → COMPLETED transition.
    if (cogsSnapshotInput) {
      try {
        await createOrderItemCostSnapshots(prisma, cogsSnapshotInput);
      } catch (error) {
        console.error(
          `[Order] COGS snapshot failed for order ${order.orderNumber} (status stays COMPLETED; items flagged by Integrity Monitoring):`,
          error
        );
      }
    }

    // ============================================================
    // WhatsApp notification trigger on READY status
    // ============================================================
    if (input.status === "READY") {
      // Phase 5 — WhatsApp notifications are a PRO+ feature (`whatsappNotif`).
      // A tenant on a lower plan (or with a lapsed subscription) skips the send
      // silently: the status change is already committed and MUST NOT be
      // affected by a notification decision.
      const whatsappAllowed = await isPlanFeatureActive(
        restaurantId,
        "whatsappNotif"
      );
      if (!whatsappAllowed) {
        console.log(
          `[Order] WhatsApp notification skipped for order ${order.orderNumber} (paket aktif tanpa fitur whatsappNotif)`
        );
      }

      // Idempotency: check if already notified
      if (whatsappAllowed && !order.notifiedAt) {
        const customerPhone = order.customer?.phone;

        // Only trigger if customer has a valid phone (not a guest placeholder)
        if (
          customerPhone &&
          !customerPhone.startsWith("guest-") &&
          customerPhone.length > 5
        ) {
          try {
            // Build message based on order type
            const message = buildOrderReadyMessage(
              order.customer?.name || "Pelanggan",
              order.orderNumber,
              order.restaurant?.name || "Restaurant",
              order.orderType
            );

            // Lazy import to avoid circular deps
            const { sendWhatsAppNotification } = await import(
              "@/services/whatsapp/whatsapp-notifier"
            );

            // Demo: the WEB process owns the Baileys socket, so the
            // notification is delivered in-process (no queue, no worker).
            const sent = await sendWhatsAppNotification(
              restaurantId,
              customerPhone,
              message
            );

            if (sent) {
              // Mark as notified only after the send actually succeeded
              // (idempotency guard for the NEXT READY transition).
              await prisma.order.update({
                where: { id },
                data: { notifiedAt: new Date() },
              });

              whatsappTriggered = true;

              console.log(
                `[Order] WhatsApp notification sent for order ${order.orderNumber}`
              );
            } else {
              console.warn(
                `[Order] WhatsApp notification not delivered for order ${order.orderNumber} (WhatsApp not connected)`
              );
            }
          } catch (error) {
            // WhatsApp failure should NOT affect order status
            console.error(
              `[Order] Failed to send WhatsApp notification for order ${order.orderNumber}:`,
              error
            );
          }
        }
      }
    }

    // Realtime: order status changed + downstream effects.
    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.ORDER_STATUS_CHANGED,
      `${id}-${input.status}`,
      {
        orderId: id,
        orderNumber: order.orderNumber,
        fromStatus: order.status,
        toStatus: input.status,
        tableId: order.tableId || null,
      }
    );
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.ORDER_UPDATED, id, {
      orderId: id,
      orderNumber: order.orderNumber,
      status: input.status,
    });
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, id);

    // Table freed when an order finishes/cancels.
    if (
      (input.status === "COMPLETED" || input.status === "CANCELLED") &&
      order.tableId
    ) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
        `${order.tableId}-AVAILABLE`,
        { tableId: order.tableId, status: "AVAILABLE" }
      );
    }

    // P1 (PHASE 7B) — a DIRECT cancellation (no CancellationRequest row) was
    // the only financial workflow in the app with no audit trail. Record it
    // with the SAME action the approval engine uses (`ORDER_CANCELLED`) so the
    // audit viewer stays consistent — one row per successful cancellation,
    // written only AFTER the mutation committed (a rejected/failed attempt
    // throws above and never reaches this point). The approval engine never
    // calls this method, so the event is never duplicated.
    if (input.status === "CANCELLED") {
      await auditService.log({
        restaurantId,
        branchId: order.branchId,
        userId: changedBy ?? null,
        action: "ORDER_CANCELLED",
        entityType: "Order",
        entityId: id,
        details: {
          orderNumber: order.orderNumber,
          reason: input.notes ?? null,
          previousStatus: order.status,
          newStatus: "CANCELLED",
          source: "DIRECT_STATUS_UPDATE",
        },
      });
    }

    // ============================================================
    // DELIVERY — auto-dispatch when the tenant chose "READY".
    //
    // Runs AFTER the status transaction committed and is best-effort: a
    // courier/API failure marks the shipment FAILED (retryable from the
    // dashboard) and can never roll back the READY transition. The PAID
    // trigger lives in the iPaymu webhook.
    // ============================================================
    if (input.status === "READY" && order.orderType === "DELIVERY") {
      try {
        const settings = await prisma.restaurantSettings.findUnique({
          where: { restaurantId },
          select: { deliveryEnabled: true, deliveryAutoDispatchOn: true },
        });
        if (
          settings?.deliveryEnabled &&
          settings.deliveryAutoDispatchOn === "READY"
        ) {
          const { deliveryService } = await import(
            "@/services/delivery/delivery.service"
          );
          await deliveryService.dispatchOrderShipment(id, restaurantId);
        }
      } catch (error) {
        console.error(
          `[Order] Delivery auto-dispatch failed for ${order.orderNumber} (status stays READY; retry from the dashboard):`,
          error
        );
      }
    }

    return { order: updatedOrder, whatsappTriggered };
  }

  /**
   * Get dashboard statistics scoped to restaurantId (and branchId when the
   * caller is branch-scoped).
   */
  async getDashboardStats(restaurantId: string, branchFilters?: string[] | null) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // PHASE 5B — revenue basis. `Order.status` is a fulfillment/workflow state,
    // NOT revenue recognition; money is recognised by the payment. Reuse the
    // report engine's authoritative predicate (`revenueWhere`) and its range
    // resolver so `todayRevenue` ===
    // `reportService.getSalesReport().summary.totalSales` for period "today"
    // and the same restaurant/branch scope. No second revenue predicate here.
    const revenueRange = resolveReportRange("today");

    const whereBase: Record<string, unknown> = { restaurantId };
    if (branchFilters?.length) {
      whereBase.branchId = { in: branchFilters };
    }

    const orderWhere = (extra: Record<string, unknown>) => ({
      ...whereBase,
      ...extra,
    });
    const paymentWhere: Record<string, unknown> = {
      restaurantId,
      ...(branchFilters?.length ? { branchId: { in: branchFilters } } : {}),
    };

    const [
      todayOrders,
      pendingOrders,
      processingOrders,
      readyOrders,
      completedOrders,
      todayRevenue,
      pendingPayments,
      paidOrders,
    ] = await Promise.all([
      prisma.order.count({
        where: orderWhere({
          createdAt: { gte: today },
        }),
      }),
      prisma.order.count({
        where: orderWhere({
          status: "PENDING",
        }),
      }),
      prisma.order.count({
        where: orderWhere({
          status: "PROCESSING",
        }),
      }),
      prisma.order.count({
        where: orderWhere({
          status: "READY",
        }),
      }),
      prisma.order.count({
        where: orderWhere({
          status: "COMPLETED",
        }),
      }),
      // Revenue = the report engine's revenue set: status != CANCELLED AND
      // (paymentStatus = PAID OR a collected-then-refunded payment exists).
      // A COMPLETED-but-unpaid/pending/expired order is NOT revenue, and a
      // PAID order that is not yet COMPLETED still IS.
      prisma.order.aggregate({
        where: revenueWhere(restaurantId, revenueRange, branchFilters),
        _sum: { grandTotal: true },
      }),
      prisma.payment.count({
        where: {
          ...paymentWhere,
          status: { in: ["UNPAID", "PENDING"] },
        },
      }),
      prisma.payment.count({
        where: {
          ...paymentWhere,
          status: "PAID",
        },
      }),
    ]);

    return {
      todayOrders,
      pendingOrders,
      processingOrders,
      readyOrders,
      completedOrders,
      todayRevenue: todayRevenue._sum.grandTotal?.toString() || "0",
      pendingPayments,
      paidOrders,
    };
  }
}

export const orderService = new OrderService();
