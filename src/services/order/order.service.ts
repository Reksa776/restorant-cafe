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

    // Calculate tax and service charge (10% tax, 5% service charge)
    const tax = Math.round(subtotal * 0.1);
    const serviceCharge = Math.round(subtotal * 0.05);
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

    return order;
  }

  /**
   * Create an order from customer website (public, no auth).
   * Finds or creates customer by phone, validates table belongs to restaurant.
   */
  async createCustomerOrder(input: CreateCustomerOrderInput, restaurantId: string) {
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

    // Calculate tax and service charge (10% tax, 5% service charge)
    const tax = Math.round(subtotal * 0.1);
    const serviceCharge = Math.round(subtotal * 0.05);
    const grandTotal = subtotal + tax + serviceCharge;

    // Generate order number
    const orderNumber = generateOrderNumber();

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
        } else if (input.customerName && !customer.name) {
          // Update name if customer exists but has no name
          customer = await tx.customer.update({
            where: { id: customer.id },
            data: { name: input.customerName },
          });
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
      }

      // Create order
      const newOrder = await tx.order.create({
        data: {
          restaurantId,
          orderNumber,
          customerId: customer.id,
          tableId: input.tableId || null,
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

      return newOrder;
    });

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
        payments: true,
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
