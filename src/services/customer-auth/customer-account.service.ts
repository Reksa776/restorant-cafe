import { prisma } from "@/lib/prisma";
import { UnauthorizedError } from "@/lib/errors";

// ============================================================
// Customer account — READ ONLY, session scoped.
//
// Every method receives `customerId` + `restaurantId` that the ROUTE took
// from the verified customer session (signed httpOnly cookie). Neither value
// is ever read from a query param or body.
//
// No new tables, no engine change: this only READS the existing PromoUsage
// (claims = orderId NULL, uses = orderId set) and Order rows, and never
// exposes payment credentials, provider payloads or other customers' data.
// ============================================================

/** Voucher status for the logged-in customer (computed server-side). */
export type AccountVoucherState = "AVAILABLE" | "CLAIMED" | "USED" | "EXPIRED";

export interface AccountVoucher {
  promoId: string;
  code: string;
  name: string;
  description: string | null;
  type: "PERCENT" | "FIXED";
  value: number;
  minOrder: number;
  maxDiscount: number | null;
  startsAt: Date | null;
  expiresAt: Date | null;
  isActive: boolean;
  /** Branch-only promo → the branch it is limited to (null = all branches). */
  branch: { id: string; code: string; name: string } | null;
  state: AccountVoucherState;
  /** Server-built display label — the client never recomputes the discount. */
  label: string;
  claimed: boolean;
  usedCount: number;
  perCustomerLimit: number;
}

export interface AccountOrder {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  orderType: string;
  grandTotal: unknown; // Prisma Decimal (serialized as string)
  createdAt: Date;
  branchName: string | null;
  itemCount: number;
}

export interface AccountOrdersPage {
  items: AccountOrder[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const rupiah = (v: number) => `Rp${Math.round(v).toLocaleString("id-ID")}`;

export class CustomerAccountService {
  /**
   * The session's customer must still exist, be ACTIVE and belong to the
   * SAME restaurant as the session — guards a deactivated account and a
   * cookie replayed against another tenant.
   */
  private async requireActiveCustomer(
    customerId: string,
    restaurantId: string
  ): Promise<void> {
    const customer = await prisma.customer.findFirst({
      where: { id: customerId, restaurantId, isActive: true },
      select: { id: true },
    });
    if (!customer) {
      throw new UnauthorizedError("Sesi customer tidak valid");
    }
  }

  /**
   * Vouchers of the logged-in customer: every promo they claimed and/or used.
   * A CLAIM (orderId NULL) is NEVER treated as a USE (orderId set).
   */
  async getAccountPromos(
    customerId: string,
    restaurantId: string
  ): Promise<AccountVoucher[]> {
    await this.requireActiveCustomer(customerId, restaurantId);

    // Only this customer's own usage rows; still restaurant-scoped as
    // defense in depth (the promo must belong to the session's tenant).
    const usages = await prisma.promoUsage.findMany({
      where: { customerId, promo: { restaurantId } },
      select: { promoId: true, orderId: true },
    });
    if (usages.length === 0) return [];

    const claimedIds = new Set(
      usages.filter((u) => u.orderId === null).map((u) => u.promoId)
    );
    const usedCountByPromo = new Map<string, number>();
    for (const usage of usages) {
      if (usage.orderId !== null) {
        usedCountByPromo.set(
          usage.promoId,
          (usedCountByPromo.get(usage.promoId) ?? 0) + 1
        );
      }
    }

    // Deduped promo ids (a promo can have BOTH a claim row and use rows).
    const promoIds = [
      ...new Set([...claimedIds, ...usedCountByPromo.keys()]),
    ];

    const promos = await prisma.promo.findMany({
      where: { id: { in: promoIds }, restaurantId },
      include: { branch: { select: { id: true, code: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    return promos.map((promo) => {
      const usedCount = usedCountByPromo.get(promo.id) ?? 0;
      const perCustomerLimit = promo.perCustomerLimit;
      const expired =
        !promo.isActive ||
        (promo.expiresAt !== null && promo.expiresAt < now);

      // Precedence: expired/disabled → USED (limit reached) → CLAIMED (an
      // unused claim exists) → AVAILABLE (still usable). A claim is never
      // counted as a use, so a freshly claimed voucher stays CLAIMED.
      let state: AccountVoucherState;
      if (expired) {
        state = "EXPIRED";
      } else if (perCustomerLimit > 0 && usedCount >= perCustomerLimit) {
        state = "USED";
      } else if (claimedIds.has(promo.id)) {
        state = "CLAIMED";
      } else {
        state = "AVAILABLE";
      }

      const value = Number(promo.value);
      const maxDiscount =
        promo.maxDiscount !== null ? Number(promo.maxDiscount) : null;

      return {
        promoId: promo.id,
        code: promo.code,
        name: promo.name,
        description: promo.description,
        type: promo.type === "PERCENT" ? "PERCENT" : "FIXED",
        value,
        minOrder: Number(promo.minOrder),
        maxDiscount,
        startsAt: promo.startsAt,
        expiresAt: promo.expiresAt,
        isActive: promo.isActive,
        branch: promo.branch
          ? {
              id: promo.branch.id,
              code: promo.branch.code,
              name: promo.branch.name,
            }
          : null,
        state,
        label:
          promo.type === "PERCENT"
            ? `Diskon ${value}%${
                maxDiscount !== null ? ` · maks ${rupiah(maxDiscount)}` : ""
              }`
            : `Diskon ${rupiah(value)}`,
        claimed: claimedIds.has(promo.id),
        usedCount,
        perCustomerLimit,
      };
    });
  }

  /**
   * The logged-in customer's OWN orders, newest first, paginated.
   * Safe projection only: no payments, no providerRef / paymentUrl /
   * qrString / qrImage, no gateway payload, no other customer's rows.
   */
  async getAccountOrders(
    customerId: string,
    restaurantId: string,
    opts?: { page?: number; limit?: number }
  ): Promise<AccountOrdersPage> {
    await this.requireActiveCustomer(customerId, restaurantId);

    const rawPage = Math.floor(Number(opts?.page ?? 1));
    const rawLimit = Math.floor(Number(opts?.limit ?? 5));
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
    const limit = Number.isFinite(rawLimit)
      ? Math.min(Math.max(rawLimit, 1), 20)
      : 5;

    const where = { customerId, restaurantId };

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        select: {
          orderNumber: true,
          status: true,
          paymentStatus: true,
          orderType: true,
          grandTotal: true,
          createdAt: true,
          branch: { select: { name: true } },
          _count: { select: { items: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.order.count({ where }),
    ]);

    return {
      items: orders.map((order) => ({
        orderNumber: order.orderNumber,
        status: order.status,
        paymentStatus: order.paymentStatus,
        orderType: order.orderType,
        grandTotal: order.grandTotal,
        createdAt: order.createdAt,
        branchName: order.branch?.name ?? null,
        itemCount: order._count.items,
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }
}

export const customerAccountService = new CustomerAccountService();
