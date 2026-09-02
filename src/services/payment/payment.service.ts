import { prisma } from "@/lib/prisma";
import { NotFoundError, PaymentError, ConflictError } from "@/lib/errors";
import { IpaymuProvider } from "./providers/ipaymu/ipaymu.provider";
import type { PaymentProvider } from "./payment.types";

export class PaymentService {
  private provider: PaymentProvider;

  constructor() {
    this.provider = new IpaymuProvider();
  }

  async createPayment(orderId: string, restaurantId: string) {
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
      },
      include: {
        customer: true,
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

    // Check if payment already exists
    const existingPayment = await prisma.payment.findFirst({
      where: {
        orderId,
        status: { in: ["PENDING", "PAID"] },
      },
    });

    if (existingPayment) {
      throw new ConflictError("Payment already exists for this order");
    }

    // Create payment with provider
    const paymentResult = await this.provider.createPayment({
      orderId: order.id,
      orderNumber: order.orderNumber,
      amount: Number(order.grandTotal),
      customerName: order.customer.name || "Customer",
      customerPhone: order.customer.phone,
      items: order.items.map((item) => ({
        name: item.product.name,
        quantity: item.quantity,
        price: Number(item.unitPrice),
      })),
    });

    // Save payment to database
    const payment = await prisma.payment.create({
      data: {
        restaurantId: order.restaurantId,
        orderId: order.id,
        status: "PENDING",
        amount: order.grandTotal,
        provider: "ipaymu",
        providerRef: paymentResult.reference,
        paymentUrl: paymentResult.paymentUrl,
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

    return payment;
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
