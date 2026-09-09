import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  PaymentError,
  ConflictError,
  ValidationError,
} from "@/lib/errors";
import { emitRealtime } from "@/lib/realtime/bus";
import { REALTIME_EVENT_TYPES } from "@/lib/realtime/types";
import { auditService } from "@/services/audit/audit.service";
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
    options?: { method?: "QRIS" | "KASIR" },
    branchFilters?: string[] | null
  ) {
    const isQris = options?.method === "QRIS";

    // ============================================================
    // 1. Pre-read the order (for validation + the gateway payload).
    // ============================================================
    const order = await prisma.order.findFirst({
      where: {
        id: orderId,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
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

    // ============================================================
    // 2. Atomically create the payment INTENT under a per-order row lock.
    //
    // Serializes concurrent creations for the same order (M11): two
    // simultaneous requests both lock the order row, so only the first can
    // pass the PENDING/PAID existence checks and create the intent; the
    // second gets a ConflictError. The intent row is created FIRST (before
    // the gateway call) so the lock window stays tiny — no network I/O is
    // ever performed inside the transaction.
    //
    // This transaction is ALSO the serialization point for method switches:
    // KASIR supersedes live online intents (QRIS → CASH) and an explicit
    // QRIS intent supersedes the live UNPAID KASIR row (CASH → QRIS). Every
    // supersede is a guarded updateMany, so a racing webhook or a concurrent
    // markCashierPaymentPaid can never be overwritten.
    // ============================================================
    const intent = await prisma.$transaction(async (tx) => {
      // Lock the order row (MySQL FOR UPDATE) to serialize per-order intents.
      await tx.$queryRaw`SELECT id FROM \`order\` WHERE id = ${orderId} FOR UPDATE`;

      const lockedOrder = await tx.order.findFirst({
        where: {
          id: orderId,
          restaurantId,
          branchId: branchFilters?.length ? { in: branchFilters } : undefined,
        },
        select: {
          id: true,
          orderNumber: true,
          restaurantId: true,
          branchId: true,
          grandTotal: true,
          status: true,
          paymentStatus: true,
        },
      });
      if (!lockedOrder) {
        throw new NotFoundError("Order not found");
      }
      if (lockedOrder.status === "CANCELLED") {
        throw new ConflictError(
          "Order dibatalkan — tidak dapat membuat pembayaran"
        );
      }

      // PAID is always terminal — an order can never be paid twice. This
      // covers ANY method (online QRIS/VA webhook PAID and KASIR cash PAID
      // alike) — the second pay attempt on a settled order is always
      // rejected under the same per-order row lock.
      const paidPayment = await tx.payment.findFirst({
        where: {
          orderId,
          status: "PAID",
        },
      });
      if (paidPayment) {
        throw new ConflictError("Order already paid");
      }

      // ------------------------------------------------------------
      // KASIR — no gateway call. Record UNPAID and let a cashier collect.
      // ------------------------------------------------------------
      if (options?.method === "KASIR") {
        // A live online intent (PENDING/FAILED/EXPIRED QRIS/VA) is superseded
        // by the cashier's explicit CASH choice. The stale rows are CANCELLED
        // here — guarded update (only rows still in those states flip, so a
        // racing webhook can never be overwritten) — and stay as history; the
        // order mirrors the live KASIR intent as UNPAID. This is what makes
        // QRIS → Kembali → CASH work without a 409 (the reverse switch,
        // CASH → QRIS, lives in createKasirQrisPayment).
        await tx.payment.updateMany({
          where: {
            orderId,
            method: { not: "KASIR" },
            status: { in: ["PENDING", "FAILED", "EXPIRED"] },
          },
          data: { status: "CANCELLED" },
        });
        await tx.order.updateMany({
          where: { id: lockedOrder.id, paymentStatus: { not: "PAID" } },
          data: { paymentStatus: "UNPAID" },
        });
        const existingCashier = await tx.payment.findFirst({
          where: {
            orderId,
            restaurantId,
            method: "KASIR",
          },
          orderBy: { createdAt: "desc" },
        });

        if (existingCashier) {
          if (existingCashier.status === "PAID") {
            // Defense in depth: the any-method PAID check at the top of the
            // transaction already rejects a settled order — this duplicate
            // guard is intentionally kept so the KASIR branch alone can never
            // double-settle even if the top check is ever reordered.
            throw new ConflictError("Order already paid");
          }
          if (existingCashier.status === "UNPAID") {
            // Idempotent retry: the live UNPAID KASIR row is already
            // recorded — never a duplicate.
            return { payment: existingCashier, kind: "kasir_existing" } as const;
          }
          // A CANCELLED/FAILED/EXPIRED KASIR row is not a live intent (e.g.
          // it was superseded when the cashier chose QRIS) — fall through and
          // record a fresh UNPAID row below.
        }

        const cashierPayment = await tx.payment.create({
          data: {
            restaurantId: lockedOrder.restaurantId,
            // The written branch is the ORDER's branch — always within the
            // authorized filter the order was resolved against.
            branchId: lockedOrder.branchId || branchFilters?.[0] || null,
            orderId: lockedOrder.id,
            status: "UNPAID",
            amount: lockedOrder.grandTotal,
            method: "KASIR",
            provider: null,
          },
          include: {
            order: true,
          },
        });

        // Order payment status stays UNPAID — no gateway, nothing paid yet.
        return { payment: cashierPayment, kind: "kasir_new" } as const;
      }

      // ------------------------------------------------------------
      // Gateway payment — QRIS (DINE-IN) or VA (legacy TAKEAWAY/DELIVERY)
      // ------------------------------------------------------------
      // A DINE-IN order that chose cashier first must not silently create a
      // different payment intent on top of the UNPAID KASIR row — EXCEPT when
      // an explicit QRIS intent is requested (isQris): the cashier may switch
      // from CASH back to QRIS (CASH → Kembali → QRIS), so the live UNPAID
      // KASIR row is superseded here (guarded cancel inside the same locked
      // transaction — history is kept, never deleted).
      if (!isQris) {
        const cashierUnpaid = await tx.payment.findFirst({
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
      } else {
        // Explicit QRIS intent supersedes a live UNPAID KASIR row (the reverse
        // switch). Guarded updateMany: only a row still UNPAID flips, so a
        // concurrent markCashierPaymentPaid (UNPAID → PAID) can never be
        // overwritten by this cancel. History is preserved.
        await tx.payment.updateMany({
          where: {
            orderId,
            method: "KASIR",
            status: "UNPAID",
          },
          data: { status: "CANCELLED" },
        });
      }

      // Idempotent intent: an explicit QRIS request (or the orderId VA path)
      // that finds a LIVE PENDING QRIS row returns it instead of stacking a
      // second collectable intent. Two sequential QRIS clicks (e.g. the
      // customer page retried while the first was still valid) can never
      // create two live QRIS intents on the same order. (Double-click races
      // are serialized by the order row lock above.)
      if (isQris) {
        const liveQris = await tx.payment.findFirst({
          where: {
            orderId,
            method: "QRIS",
            status: "PENDING",
          },
        });
        if (liveQris) {
          return { payment: liveQris, kind: "kasir_existing" } as const;
        }
      }

      const pending = await tx.payment.create({
        data: {
          restaurantId: lockedOrder.restaurantId,
          branchId: lockedOrder.branchId || branchFilters?.[0] || null,
          orderId: lockedOrder.id,
          status: "PENDING",
          amount: lockedOrder.grandTotal,
          method: isQris ? "QRIS" : null,
          provider: "ipaymu",
        },
        include: {
          order: true,
        },
      });

      // Mirror PENDING onto the order ONLY while the order still reflects a
      // superseded/live-intent state this intent replaced. Ownership check:
      // - UNPAID  → this QRIS intent legitimately replaced a CASH intent (the
      //   reverse switch) — safe to mirror.
      // - PENDING → mirror the QRIS state (the superseded QRIS rows were just
      //   cancelled inside this transaction).
      // - FAILED/EXPIRED/CANCELLED → this intent is the RETRY after a failed
      //   gateway attempt (the service marks intent FAILED and mirrors
      //   FAILED/EXPIRED on gateway error) — the fresh intent legitimately
      //   replaces that mirror.
      // - PAID    → a concurrent QRIS webhook PAID this order while the QRIS
      //   intent was being created — the payment row above was created anyway
      //   (loss: a cancelled PENDING orphan, no money movement), but the order
      //   is NEVER dragged back from PAID. Terminal PAID wins.
      await tx.order.updateMany({
        where: {
          id: lockedOrder.id,
          paymentStatus: { not: "PAID" },
        },
        data: { paymentStatus: "PENDING" },
      });

      return { payment: pending, kind: "gateway" } as const;
    });

    // ------------------------------------------------------------
    // KASIR outcomes (already fully recorded inside the transaction).
    // ------------------------------------------------------------
    if (intent.kind === "kasir_existing") {
      return intent.payment;
    }
    if (intent.kind === "kasir_new") {
      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_CREATED,
        intent.payment.id,
        {
          paymentId: intent.payment.id,
          orderId: order.id,
          orderNumber: order.orderNumber,
          amount: Number(intent.payment.amount),
          status: intent.payment.status,
          method: intent.payment.method,
          provider: null,
        }
      );
      emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, order.id);
      return intent.payment;
    }

    // ------------------------------------------------------------
    // 3. Gateway call (OUTSIDE the lock — never hold a row lock over
    //    network I/O).
    // ------------------------------------------------------------
    try {
      // The iPaymu direct endpoint rejects empty buyer phone/email (reported
      // as "unauthorized signature"), so fall back to the restaurant's real
      // contact data when the customer did not provide any. The provider
      // applies a final non-empty placeholder only if the restaurant has
      // none either. Amount is ALWAYS order.grandTotal from the DB.
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

      // 4. Finalize the intent with the gateway's reference + payment data.
      const payment = await prisma.payment.update({
        where: { id: intent.payment.id },
        data: {
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
    } catch (error) {
      // 5. Gateway failure → the intent becomes FAILED (guarded updates, so a
      //    racing webhook cannot be overwritten). A FAILED payment may be
      //    retried by the business flow.
      await prisma.payment.updateMany({
        where: { id: intent.payment.id, status: "PENDING" },
        data: { status: "FAILED" },
      });
      await prisma.order.updateMany({
        where: { id: orderId, paymentStatus: "PENDING" },
        data: { paymentStatus: "FAILED" },
      });

      emitRealtime(
        restaurantId,
        REALTIME_EVENT_TYPES.PAYMENT_STATUS_CHANGED,
        `${intent.payment.id}-FAILED`,
        {
          paymentId: intent.payment.id,
          orderId: orderId,
          orderNumber: order.orderNumber,
          amount: Number(intent.payment.amount),
          status: "FAILED",
          provider: "ipaymu",
        }
      );
      emitRealtime(restaurantId, REALTIME_EVENT_TYPES.DASHBOARD_UPDATED, orderId);

      throw error;
    }
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
          branchId: order.branchId || null,
          orderId: order.id,
          status: "UNPAID",
          amount: order.grandTotal,
          method: "KASIR",
          provider: null,
          providerRef: reference,
        },
      });

      // A new live payment intent exists again → mirror it on the order row
      // (same convention as createPayment with an explicit method). Guarded:
      // a PAID order (a webhook that won the race) is terminal and is never
      // dragged back to UNPAID.
      await tx.order.updateMany({
        where: { id: order.id, paymentStatus: { not: "PAID" } },
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
    options?: { amountReceived?: number },
    branchFilters?: string[] | null
  ) {
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        restaurantId,
        method: "KASIR",
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
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

    // Order-level duplicate protection: a stale UNPAID KASIR row on an order
    // already settled through another channel (e.g. a QRIS webhook marked the
    // order PAID) must never be collectable a second time.
    if (payment.order?.paymentStatus === "PAID") {
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

    // ============================================================
    // Cash drawer linking (RBAC): when the acting user is a CASHIER the
    // payment must be collected under THEIR open shift — it is never allowed
    // to collect into someone else's drawer. Admins (no shift workflow)
    // keep the legacy unlinked quick-mark behaviour.
    // ============================================================
    let shiftId: string | null = null;
    if (changedBy) {
      const actor = await prisma.user.findUnique({
        where: { id: changedBy },
        select: { role: true, restaurantId: true },
      });
      if (actor?.restaurantId === restaurantId && actor.role === "CASHIER") {
        const openShift = await prisma.cashierShift.findFirst({
          where: {
            restaurantId,
            userId: changedBy,
            status: "OPEN",
            // Cash is collected into the drawer of the branch the payment
            // belongs to — a cashier can never pay one branch's order into
            // another branch's shift.
            ...(payment.branchId ? { branchId: payment.branchId } : {}),
          },
        });
        if (!openShift) {
          throw new ConflictError(
            "Kasir harus membuka shift terlebih dahulu sebelum menerima pembayaran"
          );
        }
        // Cross-drawer safety: a payment already linked to another shift
        // cannot be collected by a different cashier.
        if (payment.shiftId && payment.shiftId !== openShift.id) {
          throw new ConflictError(
            "Pembayaran ini tercatat pada shift kasir lain"
          );
        }
        shiftId = openShift.id;
      }
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
          ...(shiftId ? { shiftId } : {}),
        },
      });

      if (updated.count === 0) {
        // Lost the race — someone else already collected it.
        return { alreadyPaid: true, orderAdvanced: false };
      }

      // Mirror payment status on the order row — guarded: the order mirror
      // must never overwrite a concurrent authoritative writer. Ownership
      // check mirrors the webhook handler: this collection only claims the
      // order when the order still reflects THIS intent (UNPAID — the state
      // this KASIR row set) or a superseded live-online state (PENDING/FAILED
      // /EXPIRED from a QRIS attempt the cashier is now settling in cash). A
      // CANCELLED mirror never exists, and PAID (a QRIS webhook that won the
      // race) is terminal — this write cannot resurrect or double-mirror it.
      // The guarded updateMany makes the whole claim atomic with the row flip
      // above under the same transaction.
      await tx.order.updateMany({
        where: {
          id: payment.orderId,
          paymentStatus: {
            in: ["UNPAID", "PENDING", "FAILED", "EXPIRED"],
          },
        },
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
            ...(shiftId ? { shiftId } : {}),
          },
        },
      });

      return { alreadyPaid: false, orderAdvanced, shiftId };
    });

    // Centralized audit trail (best-effort, after the write commits).
    if (!result.alreadyPaid) {
      await auditService.log({
        restaurantId,
        branchId: payment.branchId || branchFilters?.[0] || null,
        userId: changedBy || null,
        action: "PAYMENT_RECEIVED",
        entityType: "Payment",
        entityId: payment.id,
        details: {
          orderNumber: payment.order?.orderNumber || null,
          amount: amountDue,
          amountReceived,
          changeAmount,
          method: "KASIR",
          shiftId: result.shiftId || null,
          processedBy: changedBy || null,
        },
      });
    }

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
    },
    branchFilters?: string[] | null
  ) {
    const page = params?.page || 1;
    const limit = params?.limit || 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      restaurantId,
    };

    if (branchFilters?.length) {
      where.branchId = { in: branchFilters };
    }

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
          // Branch name/code so the UI can label payments when the admin views
          // "Semua Cabang" — never the raw database id.
          branch: {
            select: { id: true, name: true, code: true },
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

  async getPayment(id: string, restaurantId: string, branchFilters?: string[] | null) {
    const payment = await prisma.payment.findFirst({
      where: { id, restaurantId, branchId: branchFilters?.length ? { in: branchFilters } : undefined },
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

    // Step 4b: A PENDING callback must never change an existing state (M1).
    // The intent was already created as PENDING server-side; a late pending
    // notification (e.g. after EXPIRED) must not resurrect or fail it.
    if (webhookData.status === "PENDING") {
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
      // Webhook race protection (M1): the old QRIS payment may already have
      // been CANCELLED server-side (e.g. the cashier switched to CASH) while
      // this callback was in flight. A cancelled row is history — this
      // webhook must never resurrect it, pay it, or touch the order/other
      // payments. All further state flips below are guarded updateMany writes
      // on the row's current status, so a racing writer can never be
      // overwritten either.
      const current = await tx.payment.findUnique({
        where: { id: payment.id },
        select: { status: true, orderId: true },
      });
      if (!current || current.status === "CANCELLED") {
        await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            provider: "ipaymu",
            type: "webhook",
            status: "IGNORED_CANCELLED",
            amount: webhookData.amount,
            rawData: {
              ...(payload as Record<string, unknown>),
              ignoredReason: "PAYMENT_CANCELLED",
            },
          },
        });
        return null;
      }

      const paidGuard = { id: payment.id, status: current.status } as const;

      const updated = await tx.payment.updateMany({
        where: paidGuard,
        data: {
          status: webhookData.status as
            | "PAID"
            | "FAILED"
            | "EXPIRED"
            | "CANCELLED",
          ...(webhookData.status === "PAID" ? { paidAt: new Date() } : {}),
        },
      });

      if (updated.count === 0) {
        // Lost the race against a concurrent writer (e.g. the cashier flow
        // cancelled this row) — the newer state wins, this webhook is only
        // recorded as an ignored callback.
        await tx.paymentTransaction.create({
          data: {
            paymentId: payment.id,
            provider: "ipaymu",
            type: "webhook",
            status: "IGNORED_STALE",
            amount: webhookData.amount,
            rawData: {
              ...(payload as Record<string, unknown>),
              ignoredReason: "STATUS_CHANGED",
            },
          },
        });
        return null;
      }

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

      // Mirror onto the order ONLY while the order still reflects THIS
      // payment's state — a newer live intent (CASH) on a paid order is never
      // overwritten, and a non-paid order is never dragged backwards.
      if (webhookData.status === "PAID") {
        await tx.order.updateMany({
          where: { id: payment.orderId, paymentStatus: current.status },
          data: { paymentStatus: "PAID" },
        });
      } else if (
        webhookData.status === "FAILED" ||
        webhookData.status === "EXPIRED" ||
        webhookData.status === "CANCELLED"
      ) {
        await tx.order.updateMany({
          where: {
            id: payment.orderId,
            paymentStatus: current.status,
          },
          data: { paymentStatus: webhookData.status },
        });
      }

      // Re-read inside the transaction so the caller gets the final row.
      return tx.payment.findUnique({
        where: { id: payment.id },
        include: { order: true },
      });
    });

    // The webhook was ignored (cancelled/stale row) — nothing changed, and a
    // PAID status must never be emitted downstream.
    if (!updatedPayment) {
      return payment;
    }

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

  async getPaymentUrl(
    id: string,
    restaurantId: string,
    branchFilters?: string[] | null
  ) {
    const payment = await prisma.payment.findFirst({
      where: {
        id,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
    });

    if (!payment) {
      throw new NotFoundError("Payment not found");
    }

    if (!payment.paymentUrl) {
      throw new PaymentError("Payment URL not available");
    }

    return { paymentUrl: payment.paymentUrl };
  }

  /**
   * Kasir-initiated QRIS payment creation.
   *
   * Mirrors createPayment with method QRIS, but scoped to kasir context:
   * - Available for all order types (DINE_IN, TAKEAWAY, DELIVERY).
   *   This widens the existing DINE_IN-only kasir QRIS rule without
   *   changing the customer-facing TAKEAWAY/DELIVERY legacy flow.
   * - Must not already be PAID.
   * - Allows retry on FAILED/EXPIRED by expiring stale rows first.
   * - Returns the created/retry payment with QR data.
   */
  async createKasirQrisPayment(
    orderNumber: string,
    restaurantId: string,
    branchFilters?: string[] | null
  ) {
    // Find the order with payments
    const order = await prisma.order.findFirst({
      where: {
        orderNumber,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
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
        payments: {
          orderBy: { createdAt: "desc" },
        },
      },
    });

    if (!order) {
      throw new NotFoundError("Order not found");
    }

    // Already paid orders cannot create new payments
    if (
      order.paymentStatus === "PAID" ||
      order.payments.some((p) => p.status === "PAID")
    ) {
      throw new ConflictError("Order already paid");
    }

    const now = new Date();

    // A live UNPAID KASIR row (CASH chosen earlier) is superseded by the
    // explicit QRIS selection — the guarded cancel now happens ATOMICALLY
    // inside createPayment under the same FOR UPDATE order lock, so a
    // concurrent markCashierPaymentPaid (UNPAID → PAID) can never be
    // overwritten by this switch, and a concurrent webhook mirror cannot
    // straddle the supersede. (Pre-cancelled here before, outside the lock —
    // that window is gone.) Nothing to do in this pre-read beyond keeping the
    // in-memory copy consistent for the reuse checks below.
    const existingCashier = order.payments.find(
      (p) => p.method === "KASIR" && p.status === "UNPAID"
    );
    if (existingCashier) {
      // Mirror the pending supersede into the in-memory copy so the reuse
      // checks below never treat the cash row as a live QRIS intent.
      existingCashier.status = "CANCELLED";
    }

    // Handle existing PENDING/FAILED/EXPIRED QRIS or VA payment (the
    // superseded cash row above is excluded from the live-intent search).
    const latestPayment =
      order.payments.find((p) => p.id !== existingCashier?.id) ||
      order.payments[0];
    if (latestPayment) {
      // If PENDING and not expired, return it (QR still valid)
      if (
        latestPayment.status === "PENDING" &&
        latestPayment.expiresAt &&
        new Date(latestPayment.expiresAt).getTime() > now.getTime()
      ) {
        return {
          payment: latestPayment,
          kind: "pending_existing" as const,
          message: "QRIS payment still active",
        };
      }

      // Expired or failed - allow retry by marking stale row expired first
      if (
        latestPayment.status === "EXPIRED" ||
        latestPayment.status === "FAILED" ||
        (latestPayment.status === "PENDING" &&
          latestPayment.expiresAt &&
          new Date(latestPayment.expiresAt).getTime() <= now.getTime())
      ) {
        // Mark stale row as EXPIRED if it was PENDING
        if (latestPayment.status === "PENDING") {
          await prisma.payment.updateMany({
            where: { id: latestPayment.id, status: "PENDING" },
            data: { status: "EXPIRED" },
          });
        }
        // Re-check no new payment was created concurrently
        const checkPayment = await prisma.payment.findFirst({
          where: {
            orderId: order.id,
            status: { in: ["PENDING", "PAID"] },
          },
        });
        if (checkPayment) {
          return {
            payment: checkPayment,
            kind: "pending_existing" as const,
            message: "Active payment now exists for this order",
          };
        }
      }
    }

    // Create new QRIS payment
    const result = await this.createPayment(order.id, restaurantId, {
      method: "QRIS",
    }, branchFilters);

    return {
      payment: result,
      kind: "qris_created" as const,
      message: "QRIS payment created successfully",
    };
  }
}

export const paymentService = new PaymentService();
