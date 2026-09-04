import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  PaymentError,
  ConflictError,
  ValidationError,
} from "@/lib/errors";
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
   * Switch a failed/expired online payment (QRIS) to a KASIR payment on the
   * SAME order. Business rules:
   * - No new order, no modification of the historical QRIS row — the old
   *   payment stays as history and a NEW KASIR UNPAID row is created.
   * - Allowed only for DINE_IN orders that are not cancelled/paid and whose
   *   latest payment is EXPIRED or FAILED — or a stale PENDING payment whose
   *   expiresAt has passed (that row is atomically marked EXPIRED first).
   * - Idempotent: an existing UNPAID KASIR row is returned as-is, never a
   *   duplicate.
   * - Amount is always order.grandTotal read from the database.
   */
  async switchToCashier(orderNumber: string) {
    const order = await prisma.order.findFirst({
      where: { orderNumber },
      include: {
        payments: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    // KASIR is a DINE_IN-only intent (same rule as createPayment/order create).
    if (order.orderType !== "DINE_IN") {
      throw new ValidationError(
        "Metode pembayaran hanya tersedia untuk dine-in"
      );
    }
    if (order.status === "CANCELLED") {
      throw new ConflictError(
        "Pesanan dibatalkan — tidak dapat dialihkan ke pembayaran kasir"
      );
    }
    // QRIS PAID (or any paid payment) can never switch to cashier.
    if (
      order.paymentStatus === "PAID" ||
      order.payments.some((p) => p.status === "PAID")
    ) {
      throw new ConflictError("Order already paid");
    }

    // Idempotent reuse: an active UNPAID KASIR row is already the intent.
    const activeCashier = order.payments.find(
      (p) => p.method === "KASIR" && p.status === "UNPAID"
    );
    if (activeCashier) {
      return { payment: activeCashier, alreadyExisted: true, staleExpired: false };
    }

    const latest = order.payments[0] || null;
    if (!latest) {
      throw new ValidationError(
        "Pembayaran belum dibuat untuk pesanan ini"
      );
    }

    const now = new Date();
    const stalePending =
      latest.status === "PENDING" &&
      latest.expiresAt !== null &&
      new Date(latest.expiresAt).getTime() <= now.getTime();

    // A PENDING payment that has not expired yet is still live — no switch.
    if (latest.status === "PENDING" && !stalePending) {
      throw new ConflictError(
        "Pembayaran QRIS masih aktif — tunggu hingga kedaluwarsa"
      );
    }
    // Only EXPIRED/FAILED (or stale PENDING) online payments may switch.
    if (
      latest.status !== "EXPIRED" &&
      latest.status !== "FAILED" &&
      !stalePending
    ) {
      throw new ConflictError(
        "Pembayaran saat ini tidak dapat dialihkan ke kasir"
      );
    }
    if (latest.method === "KASIR") {
      throw new ConflictError(
        "Pembayaran kasir sudah tercatat untuk pesanan ini"
      );
    }

    const reference = `CASH-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    const result = await prisma.$transaction(async (tx) => {
      // A stale PENDING payment becomes EXPIRED atomically (guarded update so
      // a racing webhook cannot overwrite a newer state).
      let staleExpired = false;
      if (stalePending) {
        const updated = await tx.payment.updateMany({
          where: { id: latest.id, status: "PENDING" },
          data: { status: "EXPIRED" },
        });
        staleExpired = updated.count > 0;
      }

      // Re-check inside the transaction: a concurrent request may have just
      // recorded the cashier row between our initial read and this write.
      const existing = await tx.payment.findFirst({
        where: {
          orderId: order.id,
          restaurantId: order.restaurantId,
          method: "KASIR",
          status: "UNPAID",
        },
        orderBy: { createdAt: "desc" },
      });
      if (existing) {
        return { payment: existing, alreadyExisted: true, staleExpired };
      }

      const payment = await tx.payment.create({
        data: {
          restaurantId: order.restaurantId,
          orderId: order.id,
          status: "UNPAID",
          amount: order.grandTotal,
          method: "KASIR",
          provider: null,
          providerRef: reference,
        },
      });

      // A new live payment intent exists again → mirror it on the order row
      // (same convention as createPayment with an explicit method).
      await tx.order.update({
        where: { id: order.id },
        data: { paymentStatus: "UNPAID" },
      });

      return { payment, alreadyExisted: false, staleExpired };
    });

    // Realtime: only when a NEW cashier intent was actually recorded.
    if (!result.alreadyExisted) {
      emitRealtime(
        order.restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_CREATED,
        result.payment.id,
        {
          paymentId: result.payment.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: Number(result.payment.amount),
          status: result.payment.status,
          method: result.payment.method,
          provider: null,
        }
      );
      emitRealtime(order.restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);
    }

    return {
      payment: result.payment,
      alreadyExisted: result.alreadyExisted,
      staleExpired: result.staleExpired,
    };
  }

  /**
   * Cashier action — collect a KASIR payment.
   *
   * `options.amountReceived` is the cash handed by the customer (cashier
   * payment form). When omitted (legacy quick "Tandai" button) it defaults to
   * the exact amount due (change = 0). Validation: amountReceived must be
   * >= amountDue, otherwise the completion is rejected BEFORE any write.
   *
   * Security (all server-authoritative): the payment must belong to the
   * admin's own restaurant (restaurantId from the session) and must still be
   * UNPAID. The flip uses a guarded conditional update inside a transaction,
   * so a double / concurrent click can never pay twice — the caller decides
   * how to surface an already-paid attempt (route returns 409).
   *
   * Audit trail: every completed collection writes a PaymentTransaction row
   * (provider "cashier") with amountDue / amountReceived / changeAmount /
   * processedBy / processedAt.
   *
   * Order STATUS advance to PROCESSING happens when cash is actually
   * received at the counter: (a) the cashier completed the full payment form
   * (amountReceived provided), or (b) the KASIR row is the fallback after a
   * QRIS attempt on the same order. In both cases only while the order is
   * still PENDING/CONFIRMED. The legacy quick-mark on a direct cashier order
   * (no amountReceived, no QRIS history) keeps the manual status flow.
   */
  async markCashierPaymentPaid(
    paymentId: string,
    restaurantId: string,
    changedBy?: string,
    options?: { amountReceived?: number }
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

    const amountDue = Math.round(Number(payment.amount) * 100) / 100;
    const isFormPayment = options?.amountReceived !== undefined;
    const amountReceived =
      isFormPayment
        ? Math.round(Number(options.amountReceived) * 100) / 100
        : amountDue;
    if (Number.isNaN(amountDue) || Number.isNaN(amountReceived)) {
      throw new ValidationError("Jumlah uang tidak valid");
    }
    if (amountReceived < amountDue) {
      throw new ValidationError("Uang yang diterima kurang dari total tagihan");
    }
    const changeAmount = Math.round((amountReceived - amountDue) * 100) / 100;

    // Already paid — never a double charge. (The route returns 409 so a
    // second completion attempt is visibly blocked.)
    if (payment.status === "PAID") {
      return {
        payment,
        alreadyPaid: true,
        orderAdvanced: false,
        audit: { amountDue, amountReceived, changeAmount },
      };
    }

    // Was this KASIR row the fallback after a QRIS attempt on the same order?
    // (history check — the QRIS row itself is never modified)
    const priorQrisCount = await prisma.payment.count({
      where: { orderId: payment.orderId, method: "QRIS" },
    });
    const fromStatus = payment.order?.status || null;

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
        // Lost the race — someone else already collected it.
        return { alreadyPaid: true, orderAdvanced: false };
      }

      // Mirror payment status on the order row.
      await tx.order.update({
        where: { id: payment.orderId },
        data: { paymentStatus: "PAID" },
      });

      // Cash in hand → kitchen may start (form completion or QRIS fallback).
      let orderAdvanced = false;
      if (
        (priorQrisCount > 0 || isFormPayment) &&
        (fromStatus === "PENDING" || fromStatus === "CONFIRMED")
      ) {
        await tx.order.update({
          where: { id: payment.orderId },
          data: { status: "PROCESSING" },
        });
        await tx.orderStatusHistory.create({
          data: {
            orderId: payment.orderId,
            status: "PROCESSING",
            notes:
              isFormPayment
                ? `Pembayaran kasir diterima — total Rp${amountDue.toLocaleString("id-ID")}, diterima Rp${amountReceived.toLocaleString("id-ID")}, kembalian Rp${changeAmount.toLocaleString("id-ID")}`
                : "Pembayaran kasir diterima (pengalihan dari QRIS)",
            changedBy: changedBy || null,
          },
        });
        orderAdvanced = true;
      }

      // Audit log: exact money math + who/when, on the payment row.
      await tx.paymentTransaction.create({
        data: {
          paymentId: payment.id,
          provider: "cashier",
          type: "cashier_payment",
          status: "PAID",
          amount: payment.amount,
          rawData: {
            amountDue,
            amountReceived,
            changeAmount,
            processedBy: changedBy || null,
            processedAt: new Date().toISOString(),
          },
        },
      });

      return { alreadyPaid: false, orderAdvanced };
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

      // The order advanced to PROCESSING (switched-QRIS fallback collected).
      if (result.orderAdvanced) {
        emitRealtime(
          restaurantId,
          REALTIME_EVENT_TYPES.ORDER_STATUS_CHANGED,
          `${payment.orderId}-PROCESSING`,
          {
            orderId: payment.orderId,
            orderNumber: payment.order?.orderNumber,
            fromStatus: fromStatus || payment.order?.status,
            toStatus: "PROCESSING",
          }
        );
        emitRealtime(
          restaurantId,
          REALTIME_EVENT_TYPES.ORDER_UPDATED,
          payment.orderId,
          {
            orderId: payment.orderId,
            status: "PROCESSING",
          }
        );
      }
    }

    return {
      payment: paidPayment || payment,
      alreadyPaid: result.alreadyPaid,
      orderAdvanced: result.orderAdvanced,
      changedBy: changedBy || null,
      audit: { amountDue, amountReceived, changeAmount },
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
