import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
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
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `ORD-${dateStr}-${random}`;
}

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

export class OrderService {
  /**
   * Create a new order from items (admin-initiated).
   * restaurantId is derived from the authenticated admin's record.
   */
  async createOrder(input: CreateOrderInput, restaurantId: string) {
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
    }

    // Validate all products exist, are available, and belong to this restaurant
    const productIds = input.items.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        restaurantId,
        isActive: true,
        isAvailable: true,
      },
    });

    if (products.length !== productIds.length) {
      const foundIds = new Set(products.map((p) => p.id));
      const missingIds = productIds.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        `Products not found or unavailable: ${missingIds.join(", ")}`
      );
    }

    // Create product map for quick lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Calculate prices (always from database, never from input)
    let subtotal = 0;
    const orderItems = input.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const unitPrice = Number(product.price);
      const totalPrice = unitPrice * item.quantity;
      subtotal += totalPrice;

      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        totalPrice,
      };
    });

    // DINE_IN orders are tax-free and service-free: total = subtotal.
    // TAKEAWAY / DELIVERY keep the 10% tax + 5% service charge.
    const isDineIn = input.orderType === "DINE_IN";
    const tax = isDineIn ? 0 : Math.round(subtotal * 0.1);
    const serviceCharge = isDineIn ? 0 : Math.round(subtotal * 0.05);
    const grandTotal = subtotal + tax + serviceCharge;

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Create order in transaction
    const order = await prisma.$transaction(async (tx) => {
      // Create order
      const newOrder = await tx.order.create({
        data: {
          restaurantId,
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
          customer: true,
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

      return newOrder;
    });

    // Realtime: order created by the restaurant admin.
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.ORDER_CREATED, order.id, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      status: order.status,
      tableId: order.tableId || null,
      visitorCount: order.visitorCount,
      customerId: order.customerId,
      grandTotal: Number(order.grandTotal),
    });
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);
    if (order.tableId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
        `${order.tableId}-OCCUPIED`,
        { tableId: order.tableId, status: "OCCUPIED" }
      );
    }

    return order;
  }

  /**
   * Create an order from customer website (public, no auth).
   * Finds or creates customer by phone, validates table belongs to restaurant.
   */
  async createCustomerOrder(input: CreateCustomerOrderInput, restaurantId: string) {
    // The QRIS/KASIR payment intent is DINE_IN-only. TAKEAWAY/DELIVERY must
    // keep the legacy gateway flow, so a paymentMethod on those types is a
    // server-side validation error (never silently ignored).
    if (input.paymentMethod && input.orderType !== "DINE_IN") {
      throw new ValidationError(
        "Payment method selection hanya tersedia untuk dine-in"
      );
    }

    // Validate restaurant exists and is active
    const restaurant = await prisma.restaurant.findFirst({
      where: { id: restaurantId, isActive: true },
    });
    if (!restaurant) {
      throw new NotFoundError("Restaurant not found");
    }

    // Normalize phone if provided
    const normalizedPhone = normalizePhone(input.customerPhone);

    // Validate table if provided
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
    }

    // Validate all products exist, are available, and belong to this restaurant
    const productIds = input.items.map((item) => item.productId);
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
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

    if (products.length !== productIds.length) {
      const foundIds = new Set(products.map((p) => p.id));
      const missingIds = productIds.filter((id) => !foundIds.has(id));
      throw new ValidationError(
        `Produk tidak ditemukan atau tidak tersedia: ${missingIds.join(", ")}`
      );
    }

    // Create product map for quick lookup
    const productMap = new Map(products.map((p) => [p.id, p]));

    // Calculate prices (always from database, never from input)
    let subtotal = 0;
    const orderItems = input.items.map((item) => {
      const product = productMap.get(item.productId)!;
      const basePrice = Number(product.price);

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

    // DINE_IN orders are tax-free and service-free: total = subtotal.
    // TAKEAWAY / DELIVERY keep the 10% tax + 5% service charge.
    const isDineIn = input.orderType === "DINE_IN";
    const tax = isDineIn ? 0 : Math.round(subtotal * 0.1);
    const serviceCharge = isDineIn ? 0 : Math.round(subtotal * 0.05);
    const grandTotal = subtotal + tax + serviceCharge;

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Track customer side effects to notify the admin in realtime after the
    // transaction commits (a guest checkout creates a new Customer row).
    let createdCustomerId: string | null = null;
    let updatedCustomerId: string | null = null;
    let createdCustomerPhone: string | null = null;
    let createdCashierPaymentId: string | null = null;

    // Create order in transaction
    const order = await prisma.$transaction(async (tx) => {
      // Find or create customer
      let customer;
      if (normalizedPhone) {
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

      // Create order
      const newOrder = await tx.order.create({
        data: {
          restaurantId,
          orderNumber,
          customerId: customer.id,
          tableId: input.tableId || null,
          visitorCount: input.visitorCount || null,
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
          customer: true,
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
          notes: "Order created via website",
        },
      });

      // Update table status if table is assigned
      if (input.tableId) {
        await tx.table.update({
          where: { id: input.tableId },
          data: { status: "OCCUPIED" },
        });
      }

      // KASIR intent: record the UNPAID cashier payment atomically with the
      // order (no gateway call), so a DINE-IN order never exists without its
      // cashier payment row and a refresh/retry can never duplicate it.
      if (input.paymentMethod === "KASIR") {
        const cashierPayment = await tx.payment.create({
          data: {
            restaurantId,
            orderId: newOrder.id,
            status: "UNPAID",
            amount: grandTotal,
            method: "KASIR",
          },
        });
        createdCashierPaymentId = cashierPayment.id;
      }

      return newOrder;
    });

    // Realtime (after commit): notify the admin's restaurant channel.
    if (createdCustomerId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.CUSTOMER_CREATED,
        createdCustomerId,
        {
          customerId: createdCustomerId,
          phone: createdCustomerPhone,
        }
      );
    }
    if (updatedCustomerId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.CUSTOMER_UPDATED,
        updatedCustomerId,
        { customerId: updatedCustomerId }
      );
    }
    if (createdCashierPaymentId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_CREATED,
        createdCashierPaymentId,
        {
          paymentId: createdCashierPaymentId,
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: Number(order.grandTotal),
          status: "UNPAID",
          method: "KASIR",
          provider: null,
        }
      );
    }
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.ORDER_CREATED, order.id, {
      orderId: order.id,
      orderNumber: order.orderNumber,
      orderType: order.orderType,
      status: order.status,
      tableId: order.tableId || null,
      visitorCount: order.visitorCount,
      customerId: order.customerId,
      grandTotal: Number(order.grandTotal),
    });
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);
    if (order.tableId) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.TABLE_STATUS_CHANGED,
        `${order.tableId}-OCCUPIED`,
        { tableId: order.tableId, status: "OCCUPIED" }
      );
    }

    return order;
  }

  /**
   * Get orders with pagination, filtering, and search.
   * Scoped to restaurantId.
   */
  async getOrders(input: GetOrdersInput, restaurantId: string) {
    const { page, limit, status, search, startDate, endDate } = input;
    const skip = (page - 1) * limit;

    // Build where clause
    const where: Record<string, unknown> = {
      restaurantId,
    };

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
          customer: true,
          table: true,
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
            take: 3,
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      items: orders,
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
   */
  async getOrder(id: string, restaurantId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id,
        restaurantId,
      },
      include: {
        customer: true,
        table: true,
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
   * number alone is not enough to cross the restaurant boundary.
   */
  async getOrderByNumberScoped(orderNumber: string, restaurantId: string) {
    const order = await prisma.order.findFirst({
      where: {
        orderNumber,
        restaurantId,
      },
      include: {
        customer: true,
        table: true,
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
   */
  async getOrderByNumber(orderNumber: string) {
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      include: {
        customer: {
          select: { name: true, phone: true },
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
            provider: true,
            status: true,
            amount: true,
            paymentUrl: true,
            paidAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 1,
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
   */
  async updateOrderStatus(
    id: string,
    input: UpdateOrderStatusInput,
    restaurantId: string,
    changedBy?: string
  ): Promise<{ order: Record<string, unknown>; whatsappTriggered: boolean }> {
    const order = await prisma.order.findFirst({
      where: {
        id,
        restaurantId,
      },
      include: {
        table: true,
        customer: true,
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

    // Update order status
    const updatedOrder = await prisma.$transaction(async (tx) => {
      const updated = await tx.order.update({
        where: { id },
        data: {
          status: input.status as "PENDING" | "CONFIRMED" | "PROCESSING" | "READY" | "COMPLETED" | "CANCELLED",
        },
        include: {
          customer: true,
          table: true,
          items: {
            include: {
              product: true,
            },
          },
        },
      });

      // Create status history
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: input.status as "PENDING" | "CONFIRMED" | "PROCESSING" | "READY" | "COMPLETED" | "CANCELLED",
          notes: input.notes,
          changedBy,
        },
      });

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

      return updated;
    });

    // ============================================================
    // WhatsApp notification trigger on READY status
    // ============================================================
    if (input.status === "READY") {
      // Idempotency: check if already notified
      if (!order.notifiedAt) {
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
            const { queueWhatsAppNotification } = await import(
              "@/services/whatsapp/whatsapp.queue"
            );

            await queueWhatsAppNotification(
              restaurantId,
              order.customerId,
              order.orderNumber,
              customerPhone,
              message
            );

            // Mark as notified (idempotency)
            await prisma.order.update({
              where: { id },
              data: { notifiedAt: new Date() },
            });

            whatsappTriggered = true;

            console.log(
              `[Order] WhatsApp notification queued for order ${order.orderNumber}`
            );
          } catch (error) {
            // WhatsApp failure should NOT affect order status
            console.error(
              `[Order] Failed to queue WhatsApp notification for order ${order.orderNumber}:`,
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

    return { order: updatedOrder, whatsappTriggered };
  }

  /**
   * Get dashboard statistics scoped to restaurantId.
   */
  async getDashboardStats(restaurantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

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
        where: {
          restaurantId,
          createdAt: { gte: today },
        },
      }),
      prisma.order.count({
        where: {
          restaurantId,
          status: "PENDING",
        },
      }),
      prisma.order.count({
        where: {
          restaurantId,
          status: "PROCESSING",
        },
      }),
      prisma.order.count({
        where: {
          restaurantId,
          status: "READY",
        },
      }),
      prisma.order.count({
        where: {
          restaurantId,
          status: "COMPLETED",
        },
      }),
      prisma.order.aggregate({
        where: {
          restaurantId,
          status: "COMPLETED",
          createdAt: { gte: today },
        },
        _sum: { grandTotal: true },
      }),
      prisma.payment.count({
        where: {
          restaurantId,
          status: { in: ["UNPAID", "PENDING"] },
        },
      }),
      prisma.payment.count({
        where: {
          restaurantId,
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
