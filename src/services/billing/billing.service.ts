import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  PlanLimitError,
  ValidationError,
} from "@/lib/errors";
import {
  MAX_ADDON_BRANCHES_PER_INVOICE,
  PLAN_CATALOG,
  PLAN_ORDER,
  branchQuota,
  computeCheckoutAmount,
  daysRemaining,
  getPlan,
  type BillingCycleCode,
  type InvoiceType,
  type PlanCode,
} from "@/lib/subscription";
import { getOrCreateSubscription } from "./plan-guard.service";
import { createSaasPayment, isSaasPaymentMockMode } from "./saas-payment";

// ============================================================
// SAAS BILLING SERVICE
//
// Every amount is computed from PLAN_CATALOG on the server; `amount` is never
// accepted from the client. Invoices and subscription changes are written in
// ONE transaction on confirmation, so a paid invoice can never leave the
// subscription half-updated (and re-delivering a webhook is idempotent).
// ============================================================

export interface BillingCheckoutInput {
  type: InvoiceType;
  planCode: PlanCode;
  billingCycle: BillingCycleCode;
  addonBranchesQty?: number;
}

type InvoiceRow = {
  id: string;
  invoiceNumber: string;
  restaurantId: string;
  type: string;
  targetPlanCode: PlanCode;
  billingCycle: BillingCycleCode;
  addonBranchesQty: number;
  amount: number;
  status: string;
  paymentUrl: string | null;
  externalRef: string | null;
  paidAt: Date | null;
  createdAt: Date;
};

function toInvoiceDto(invoice: InvoiceRow) {
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    type: invoice.type,
    targetPlanCode: invoice.targetPlanCode,
    billingCycle: invoice.billingCycle,
    addonBranchesQty: invoice.addonBranchesQty,
    amount: invoice.amount,
    status: invoice.status,
    paymentUrl: invoice.paymentUrl,
    paidAt: invoice.paidAt,
    createdAt: invoice.createdAt,
  };
}

function startOfMonth(now: Date = new Date()): Date {
  const start = new Date(now);
  start.setDate(1);
  start.setHours(0, 0, 0, 0);
  return start;
}

/** Calendar-month addition that never overflows into the next month. */
function addMonths(date: Date, months: number): Date {
  const next = new Date(date);
  const day = next.getDate();
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  const lastDay = new Date(next.getFullYear(), next.getMonth() + 1, 0).getDate();
  next.setDate(Math.min(day, lastDay));
  return next;
}

const INVOICE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateInvoiceNumber(now: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  const datePart = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(
    now.getDate()
  )}`;
  let suffix = "";
  for (let i = 0; i < 6; i += 1) {
    suffix +=
      INVOICE_ALPHABET[Math.floor(Math.random() * INVOICE_ALPHABET.length)];
  }
  return `INV-SAAS-${datePart}-${suffix}`;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export class BillingService {
  /** Current plan, quota usage and invoice history for one tenant. */
  async getOverview(restaurantId: string) {
    const sub = await getOrCreateSubscription(restaurantId);
    const plan = getPlan(sub.planCode);
    const monthStart = startOfMonth();

    const [branchesUsed, staffUsed, transactionsUsed, invoices] =
      await Promise.all([
        prisma.branch.count({ where: { restaurantId } }),
        prisma.user.count({ where: { restaurantId } }),
        prisma.order.count({
          where: {
            restaurantId,
            createdAt: { gte: monthStart },
            status: { not: "CANCELLED" },
          },
        }),
        prisma.saasInvoice.findMany({
          where: { restaurantId },
          orderBy: { createdAt: "desc" },
          take: 25,
        }),
      ]);

    return {
      subscription: {
        planCode: sub.planCode,
        planName: plan.name,
        billingCycle: sub.billingCycle,
        status: sub.status,
        extraBranchesCount: sub.extraBranchesCount,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        daysRemaining: daysRemaining(sub.currentPeriodEnd),
      },
      usage: {
        branches: {
          used: branchesUsed,
          limit: branchQuota(sub.extraBranchesCount),
          extra: sub.extraBranchesCount,
        },
        staff: { used: staffUsed, limit: plan.maxStaff },
        transactions: {
          used: transactionsUsed,
          limit: plan.maxTransactionsPerMonth,
          periodStart: monthStart,
        },
      },
      catalog: PLAN_ORDER.map((code) => PLAN_CATALOG[code]),
      paymentMode: isSaasPaymentMockMode() ? "MOCK" : "IPAYMU",
      invoices: invoices.map((invoice) =>
        toInvoiceDto(invoice as unknown as InvoiceRow)
      ),
    };
  }

  /**
   * Create a PENDING invoice for a plan upgrade or branch add-on and start the
   * master-iPaymu payment. A payment failure marks the invoice FAILED (never
   * leaves a PENDING invoice the merchant cannot pay).
   */
  async checkout(restaurantId: string, input: BillingCheckoutInput) {
    const sub = await getOrCreateSubscription(restaurantId);
    const plan = getPlan(sub.planCode);
    const isAddon = input.type === "BRANCH_ADDON";
    const qty = isAddon ? Math.trunc(input.addonBranchesQty ?? 0) : 0;

    if (isAddon) {
      if (!plan.canBuyBranchAddon) {
        throw new PlanLimitError(
          "UPGRADE_REQUIRED",
          "Paket Starter tidak mendukung Add-On cabang. Upgrade ke Basic atau lebih tinggi terlebih dahulu."
        );
      }
      if (qty < 1 || qty > MAX_ADDON_BRANCHES_PER_INVOICE) {
        throw new ValidationError(
          `Jumlah cabang tambahan harus antara 1 dan ${MAX_ADDON_BRANCHES_PER_INVOICE}.`
        );
      }
    } else {
      if (input.planCode === "STARTER") {
        throw new ValidationError(
          "Paket Starter adalah free trial dan tidak dapat dibeli."
        );
      }
      if (sub.planCode === input.planCode && sub.status === "ACTIVE") {
        throw new ValidationError(
          `Paket ${getPlan(input.planCode).name} sudah aktif.`
        );
      }
      const currentIndex = PLAN_ORDER.indexOf(sub.planCode);
      const targetIndex = PLAN_ORDER.indexOf(input.planCode);
      const isLapsed = sub.status === "EXPIRED" || sub.status === "CANCELLED";
      if (!isLapsed && targetIndex < currentIndex) {
        throw new ValidationError(
          "Downgrade paket belum didukung. Hubungi dukungan untuk mengubah paket."
        );
      }
    }

    // BRANCH_ADDON is priced by the CURRENT plan tier; upgrades by the target.
    const targetPlanCode = isAddon ? sub.planCode : input.planCode;
    const amount = computeCheckoutAmount({
      type: input.type,
      planCode: targetPlanCode,
      billingCycle: input.billingCycle,
      addonBranchesQty: qty,
    });

    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { name: true, email: true, phone: true },
    });
    if (!restaurant) {
      throw new NotFoundError("Restoran tidak ditemukan");
    }

    let invoice: InvoiceRow | null = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        invoice = (await prisma.saasInvoice.create({
          data: {
            invoiceNumber: generateInvoiceNumber(),
            restaurantId,
            type: input.type,
            targetPlanCode,
            billingCycle: input.billingCycle,
            addonBranchesQty: qty,
            amount,
            status: "PENDING",
          },
        })) as unknown as InvoiceRow;
        break;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 4) throw error;
      }
    }
    if (!invoice) {
      throw new ValidationError("Gagal membuat nomor invoice. Coba lagi.");
    }

    const description = isAddon
      ? `Add-On ${qty} Cabang — ${plan.name} (${input.billingCycle})`
      : `Paket ${getPlan(targetPlanCode).name} (${input.billingCycle})`;

    try {
      const payment = await createSaasPayment({
        invoiceNumber: invoice.invoiceNumber,
        amount,
        description,
        customerName: restaurant.name,
        customerEmail: restaurant.email || "billing@example.com",
        customerPhone: restaurant.phone || "081000000000",
      });

      const updated = (await prisma.saasInvoice.update({
        where: { id: invoice.id },
        data: {
          paymentUrl: payment.paymentUrl,
          externalRef: payment.externalRef,
          rawResponse: payment.raw as Prisma.InputJsonValue,
        },
      })) as unknown as InvoiceRow;

      return {
        invoice: toInvoiceDto(updated),
        paymentMode: payment.mode,
      };
    } catch (error) {
      await prisma.saasInvoice
        .update({ where: { id: invoice.id }, data: { status: "FAILED" } })
        .catch(() => {
          // The original payment error is what the caller must see.
        });
      throw error;
    }
  }

  /** Tenant-scoped invoice lookup (used by the confirm-mock endpoint). */
  async getInvoiceForRestaurant(invoiceId: string, restaurantId: string) {
    const invoice = await prisma.saasInvoice.findFirst({
      where: { id: invoiceId, restaurantId },
    });
    if (!invoice) {
      throw new NotFoundError("Invoice tidak ditemukan");
    }
    return toInvoiceDto(invoice as unknown as InvoiceRow);
  }

  /**
   * Mark an invoice PAID and apply its entitlement in ONE transaction.
   * Idempotent: an already-PAID invoice is returned untouched, so repeated
   * webhook deliveries can never double-increment branch add-ons.
   */
  async confirmInvoicePaid(invoiceId: string) {
    return prisma.$transaction(async (tx) => {
      const invoice = await tx.saasInvoice.findUnique({
        where: { id: invoiceId },
      });
      if (!invoice) {
        throw new NotFoundError("Invoice tidak ditemukan");
      }
      if (invoice.status === "PAID") {
        return toInvoiceDto(invoice as unknown as InvoiceRow);
      }

      const now = new Date();
      const paid = await tx.saasInvoice.update({
        where: { id: invoice.id },
        data: { status: "PAID", paidAt: now },
      });

      if (invoice.type === "BRANCH_ADDON") {
        const qty = Math.max(0, invoice.addonBranchesQty);
        await tx.restaurantSubscription.upsert({
          where: { restaurantId: invoice.restaurantId },
          create: {
            restaurantId: invoice.restaurantId,
            planCode: invoice.targetPlanCode,
            billingCycle: invoice.billingCycle,
            status: "ACTIVE",
            extraBranchesCount: qty,
            currentPeriodStart: now,
            currentPeriodEnd: addMonths(
              now,
              invoice.billingCycle === "YEARLY" ? 12 : 1
            ),
          },
          update: { extraBranchesCount: { increment: qty } },
        });
      } else {
        const months = invoice.billingCycle === "YEARLY" ? 12 : 1;
        const period = {
          planCode: invoice.targetPlanCode,
          billingCycle: invoice.billingCycle,
          status: "ACTIVE" as const,
          currentPeriodStart: now,
          currentPeriodEnd: addMonths(now, months),
        };
        await tx.restaurantSubscription.upsert({
          where: { restaurantId: invoice.restaurantId },
          create: { restaurantId: invoice.restaurantId, ...period },
          update: period,
        });
      }

      return toInvoiceDto(paid as unknown as InvoiceRow);
    });
  }

  /**
   * Resolve a webhook notification to its invoice and settle it. Returns null
   * for non-success statuses (nothing to do, no error).
   */
  async handleWebhook(payload: {
    invoiceNumber?: string | null;
    externalRef?: string | null;
    status?: string | null;
  }) {
    const normalizedStatus = (payload.status || "").trim().toUpperCase();
    const successStatuses = [
      "PAID",
      "SUCCESS",
      "COMPLETED",
      "SETTLED",
      "BERHASIL",
    ];
    if (normalizedStatus && !successStatuses.includes(normalizedStatus)) {
      return null;
    }

    const filters: Array<{ invoiceNumber: string } | { externalRef: string }> =
      [];
    if (payload.invoiceNumber) {
      filters.push({ invoiceNumber: payload.invoiceNumber });
    }
    if (payload.externalRef) {
      filters.push({ externalRef: payload.externalRef });
    }
    if (filters.length === 0) {
      throw new ValidationError("Referensi invoice wajib diisi");
    }

    const invoice = await prisma.saasInvoice.findFirst({
      where: { OR: filters },
      select: { id: true, externalRef: true },
    });
    if (!invoice) {
      throw new NotFoundError("Invoice tidak ditemukan");
    }
    if (invoice.externalRef?.startsWith("MOCK-")) {
      // Simulated invoices must be settled through the authenticated
      // confirm-mock endpoint, never by an anonymous webhook caller.
      throw new NotFoundError("Invoice tidak ditemukan");
    }

    return this.confirmInvoicePaid(invoice.id);
  }
}

export const billingService = new BillingService();
