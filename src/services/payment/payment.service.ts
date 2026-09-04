import { prisma } from "@/lib/prisma";
import { NotFoundError, PaymentError, ConflictError } from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { IpaymuProvider } from "./providers/ipaymu/ipaymu.provider";
import type { PaymentProvider } from "./payment.types";

export class PaymentService {
  private provider: PaymentProvider;

  constructor() {
    this.provider = new IpaymuProvider();
  }

  /**
   * Create a payment for an order.
   *
   * `options.method`:
   * - "KASIR" — no payment gateway is contacted. An UNPAID Payment row with
   *   method KASIR is recorded and the order stays UNPAID until a cashier
   *   marks it paid. Idempotent: an existing UNPAID KASIR row is returned.
   * - "QRIS"  — DINE-IN QRIS: creates the transaction through the iPaymu
   *   gateway with the qris channel (amount = order.grandTotal).
   * - undefined — existing flow for TAKEAWAY/DELIVERY/admin: iPaymu BCA
   *   virtual account. Unchanged behaviour.
   *
   * The amount is ALWAYS recomputed from the order in the database — the
   * client can never influence the amount.
   */
  async createPayment(
    orderId: string,
    restaurantId: string,
    options?: { method?: "QRIS" | "KASIR" }
  ) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
      },
      include: {
        customer: true,
        restaurant: {
          select: { phone: true, email: true },
        },
        items: {
          include: {
            product: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    // Check if an online payment (gateway transaction) already exists.
    // PENDING/PAID online payments are terminal for creating a new one;
    // an UNPAID KASIR row also blocks a different method for the same order
    // so an order never ends up with two live payment intents.
    const existingPayment = await prisma.payment.findFirst({
      where: {
        orderId,
        status: { in: ["PENDING", "PAID"] },
      },
    });

    if (existingPayment) {
      throw new ConflictError(
        existingPayment.status === "PAID"
          ? "Order already paid"
          : "Payment already exists for this order"
      );
    }

    // ============================================================
    // KASIR — no gateway call. Record UNPAID and let a cashier collect.
    // ============================================================
    if (options?.method === "KASIR") {
      const existingCashier = await prisma.payment.findFirst({
        where: {
          orderId,
          restaurantId,
          method: "KASIR",
        },
        orderBy: { createdAt: "desc" },
      });

      if (existingCashier) {
        if (existingCashier.status === "PAID") {
          throw new ConflictError("Order already paid");
        }
        // Idempotent retry: the UNPAID KASIR row is already recorded.
        return existingCashier;
      }

      const cashierPayment = await prisma.payment.create({
        data: {
          restaurantId: order.restaurantId,
          orderId: order.id,
          status: "UNPAID",
          amount: order.grandTotal,
          method: "KASIR",
          provider: null,
        },
        include: {
          order: true,
        },
      });

      // Order payment status stays UNPAID — no gateway, nothing paid yet.
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_CREATED,
        cashierPayment.id,
        {
          paymentId: cashierPayment.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: Number(cashierPayment.amount),
          status: cashierPayment.status,
          method: cashierPayment.method,
          provider: null,
        }
      );
      emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);

      return cashierPayment;
    }

    // ============================================================
    // Gateway payment — QRIS (DINE-IN) or VA (legacy TAKEAWAY/DELIVERY)
    // ============================================================
    // A DINE-IN order that chose cashier first must not silently create a
    // different payment intent on top of the UNPAID KASIR row.
    if (options?.method !== "QRIS") {
      const cashierUnpaid = await prisma.payment.findFirst({
        where: {
          orderId,
          restaurantId,
          method: "KASIR",
          status: "UNPAID",
        },
      });
      if (cashierUnpaid) {
        throw new ConflictError(
          "Pembayaran di kasir sudah dicatat untuk pesanan ini"
        );
      }
    }

    const isQris = options?.method === "QRIS";

    // Create payment with provider (amount = grandTotal from the DB).
    // The iPaymu direct endpoint rejects empty buyer phone/email (reported as
    // "unauthorized signature"), so fall back to the restaurant's real contact
    // data when the customer did not provide any. The provider applies a final
    // non-empty placeholder only if the restaurant has none either.
    const paymentResult = await this.provider.createPayment({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: Number(order.grandTotal),
      customerName: order.customer.name || "Customer",
      customerPhone: order.customer.phone || order.restaurant.phone || "",
      customerEmail: order.restaurant.email || "",
      items: order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        price: Number(item.unitPrice),
      })),
      channel: isQris ? "qris" : "va",
    });

    // Save payment to database
    const payment = await prisma.payment.create({
      data: {
        restaurantId: order.restaurantId,
        orderId: order.id,
        status: "PENDING",
        amount: order.grandTotal,
        method: isQris ? "QRIS" : null,
        provider: "ipaymu",
        providerRef: paymentResult.reference,
        paymentUrl: paymentResult.paymentUrl,
        qrImage: paymentResult.qrImage || null,
        qrString: paymentResult.qrString || null,
        expiresAt: paymentResult.expiresAt,
      },
      include: {
        order: true,
      },
    });

    // Update order payment status
    await prisma.order.update({
      where: { id: orderId },
      data: { paymentStatus: "PENDING" },
    });

    // Realtime: a payment was initiated for an order.
    emitRealtime(
      restaurantId,
      REALTIME_EVENT_TYPES.PAYMENT_CREATED,
      payment.id,
      {
        paymentId: payment.id,
        orderId: order.id,
        orderNumber: order.orderNumber,
        amount: Number(payment.amount),
        status: payment.status,
        method: payment.method || null,
        provider: payment.provider,
      }
    );
    emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);

    return payment;
  }

  /**
   * Cashier action — mark a KASIR payment as paid.
   *
   * Security: the payment must belong to the admin's own restaurant
   * (restaurantId comes from the authenticated session) and must still be
   * UNPAID. A concurrent or repeated click is safe: the status update is a
   * guarded conditional update, so the payment can only ever be paid once.
   * Order STATUS is left untouched — only the payment state (and the order's
   * payment-status mirror) changes.
   */
  async markCashierPaymentPaid(
    paymentId: string,
    restaurantId: string,
    changedBy?: string
  ) {
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        restaurantId,
        method: "KASIR",
      },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            restaurantId: true,
            status: true,
            paymentStatus: true,
          },
        },
      },
    });

    if (!payment) {
      throw new NotFoundError("Pembayaran kasir tidak ditemukan");
    }

    // Already paid — idempotent no-op, never a double charge.
    if (payment.status === "PAID") {
      return { payment, alreadyPaid: true };
    }

    // Guarded update: only an UNPAID row can flip to PAID, so two cashiers
    // clicking at the same time can never double-pay.
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.updateMany({
        where: {
          id: payment.id,
          status: "UNPAID",
        },
        data: {
          status: "PAID",
          paidAt: new Date(),
        },
      });

      if (updated.count === 0) {
        // Lost the race — someone else already marked it paid.
        return { alreadyPaid: true };
      }

      // Mirror payment status on the order row ONLY (order.status untouched).
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: "PAID" },
      });

      return { alreadyPaid: false };
    });

    const paidPayment = await prisma.payment.findUnique({
      where: { id: payment.id },
      include: {
        order: {
          select: {
            id: true,
            orderNumber: true,
            restaurantId: true,
            status: true,
            paymentStatus: true,
          },
        },
      },
    });

    // Realtime: UNPAID → PAID for the KASIR method.
    if (!result.alreadyPaid) {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_STATUS_CHANGED,
        `${payment.id}-PAID`,
        {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.order?.orderNumber,
          amount: Number(payment.amount),
          status: "PAID",
          method: "KASIR",
          provider: null,
        }
      );
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_UPDATED,
        payment.id,
        {
          paymentId: payment.id,
          orderId: payment.orderId,
          status: "PAID",
        }
      );
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.DASHBOARD_UPDATED,
        payment.orderId
      );
    }

    return {
      payment: paidPayment || payment,
      alreadyPaid: result.alreadyPaid,
      changedBy: changedBy || null,
    };
  }

  async getPayments(
    restaurantId: string,
    params?: {
      page?: number;
      limit?: number;
      status?: string;
    }
  ) {
    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      restaurantId,
    };

    if (params?.status) {
      where.status = params.status;
    }

    const [payments, total] = await Promise.all([
      prisma.payment.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              grandTotal: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.payment.count({ where }),
    ]);

    return {
      items: payments,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getPayment(id: string, restaurantId: string) {
    const payment = await prisma.payment.findFirst({
      where: { id, restaurantId },
      include: {
        order: true,
        transactions: true,
      },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    return payment;
  }

  /**
   * Handle iPaymu webhook with:
   * 1. Signature verification
   * 2. Amount verification against DB
   * 3. Idempotent processing (skip if already PAID)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async handleWebhook(payload: any, signatureHeader?: string) {
    // Step 1: Validate webhook signature from X-Signature header
    const isValid = await this.provider.validateWebhook(payload, signatureHeader);
    if (!isValid) {
      throw new PaymentError("Invalid webhook signature");
    }

    // Step 2: Extract payment info from webhook
    const webhookData = await this.provider.parseWebhookPayload(payload);

    // Step 3: Find payment by reference
    const payment = await prisma.payment.findFirst({
      where: {
        providerRef: webhookData.reference,
      },
      include: {
        order: true,
      },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    // Step 4: Idempotent — if already PAID, skip processing
    if (payment.status === "PAID") {
      return payment;
    }

    // Step 5: Amount verification
    // Compare webhook amount against expected amount from database
    if (webhookData.status === "PAID") {
      const expectedAmount = Number(payment.amount);
      const webhookAmount = Number(webhookData.amount);

      // Allow small floating point difference (0.01 tolerance)
      if (Math.abs(expectedAmount - webhookAmount) > 0.01) {
        throw new PaymentError(
          `Amount mismatch: expected ${expectedAmount}, got ${webhookAmount}`
        );
      }
    }

    // Step 6: Update payment status in transaction
    const updatedPayment = await prisma.$transaction(async (tx) => {
      const updated = await tx.payment.update({
        where: { id: payment.id },
        data: {
          status: webhookData.status as "PAID" | "FAILED" | "EXPIRED",
          paidAt: webhookData.status === "PAID" ? new Date() : null,
        },
        include: {
          order: true,
        },
      });

      // Record transaction
      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          provider: "ipaymu",
          type: "webhook",
          status: webhookData.status,
          amount: webhookData.amount,
          rawData: payload,
        },
      });

      // Update order payment status for all terminal states
      if (webhookData.status === "PAID") {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: "PAID" },
        });
      } else if (webhookData.status === "FAILED" || webhookData.status === "EXPIRED") {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { paymentStatus: webhookData.status },
        });
      }

      return updated;
    });

    // Realtime: payment status changed (webhook → paid/failed/expired).
    emitRealtime(
      payment.restaurantId,
      REALTIME_EVENT_TYPES.PAYMENT_STATUS_CHANGED,
      `${payment.id}-${webhookData.status}`,
      {
        paymentId: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.order?.orderNumber,
        amount: Number(updatedPayment.amount),
        status: webhookData.status,
        provider: payment.provider,
      }
    );
    emitRealtime(
      payment.restaurantId,
      REALTIME_EVENT_TYPES.PAYMENT_UPDATED,
      payment.id,
      {
        paymentId: payment.id,
        orderId: payment.orderId,
        status: webhookData.status,
      }
    );
    emitRealtime(
      payment.restaurantId,
      REALTIME_EVENT_TYPES.DASHBOARD_UPDATED,
      payment.orderId
    );

    return updatedPayment;
  }

  async getPaymentUrl(id: string, restaurantId: string) {
    const payment = await prisma.payment.findFirst({
      where: { id, restaurantId },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    if (!payment.paymentUrl) {
      throw new PaymentError("Payment URL not available");
    }

    return { paymentUrl: payment.paymentUrl };
  }
}

export const paymentService = new PaymentService();
