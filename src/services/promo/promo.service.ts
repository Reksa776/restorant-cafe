import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  NotFoundError,
  ValidationError,
  ConflictError,
} from "@/lib/errors";

// ============================================================
// Promo service (F3) — tenant-scoped marketing/coupon engine.
//
// ALL validation is server-side; the client never sends a discount
// amount. Quota + per-customer limits are enforced under a per-promo
// row lock (SELECT ... FOR UPDATE) so concurrent claims/applies can
// never oversell.
//
//  - Claim:  PromoUsage row with orderId = NULL (reserves the promo).
//  - Use:    PromoUsage row with orderId set (applied to an order).
// ============================================================

type Tx = Prisma.TransactionClient;

function assertPromoUsable(promo: {
  isActive: boolean;
  startsAt: Date | null;
  expiresAt: Date | null;
}) {
  const now = new Date();
  if (!promo.isActive) {
    throw new ConflictError("Promo tidak aktif");
  }
  if (promo.startsAt && promo.startsAt > now) {
    throw new ConflictError("Promo belum dimulai");
  }
  if (promo.expiresAt && promo.expiresAt < now) {
    throw new ConflictError("Promo sudah kedaluwarsa");
  }
}

// A promo with branchId === null is restaurant-wide; otherwise it only
// applies at that one branch. Throw when the active branch does not match.
function assertPromoBranchScope(
  promoBranchId: string | null,
  branchId: string | null | undefined
) {
  if (promoBranchId !== null && promoBranchId !== branchId) {
    throw new ConflictError("Promo tidak tersedia di cabang ini");
  }
}

export class PromoService {
  /**
   * Public list of active promos for a restaurant (menu page).
   * When `branchId` is set, only restaurant-wide promos + the branch's own
   * promos are returned. Without a branch context, only restaurant-wide
   * promos (branchId null) are visible.
   */
  async listActivePromos(
    restaurantId: string,
    branchId?: string | null,
    customerId?: string
  ) {
    const now = new Date();

    const promos = await prisma.promo.findMany({
      where: {
        restaurantId,
        isActive: true,
        AND: [
          ...(branchId
            ? [{ OR: [{ branchId: null }, { branchId }] }]
            : [{ branchId: null }]),
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: "desc" },
    });

    // Optional per-customer state (claimed / used counts) — only ever for
    // THIS customer; never exposes other customers' data.
    let claimedSet = new Set<string>();
    let usedCountByPromo = new Map<string, number>();
    if (customerId) {
      const usages = await prisma.promoUsage.findMany({
        where: { promoId: { in: promos.map((p) => p.id) }, customerId },
        select: { promoId: true, orderId: true },
      });
      claimedSet = new Set(
        usages.filter((u) => u.orderId === null).map((u) => u.promoId)
      );
      usedCountByPromo = usages
        .filter((u) => u.orderId !== null)
        .reduce((m, u) => {
          m.set(u.promoId, (m.get(u.promoId) || 0) + 1);
          return m;
        }, new Map<string, number>());
    }

    return promos.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      type: p.type,
      value: Number(p.value),
      minOrder: Number(p.minOrder),
      maxDiscount: p.maxDiscount !== null ? Number(p.maxDiscount) : null,
      startsAt: p.startsAt,
      expiresAt: p.expiresAt,
      isActive: p.isActive,
      branchId: p.branchId,
      ...(customerId
        ? {
            claimed: claimedSet.has(p.id),
            usedCount: usedCountByPromo.get(p.id) || 0,
            perCustomerLimit: p.perCustomerLimit,
          }
        : {}),
    }));
  }

  /**
   * Race-safe claim: a customer claims a promo (reserves the right to use
   * it). Validates tenant scope, activity window, global quota and the
   * per-customer claim limit under a per-promo row lock.
   */
  async claimPromo(
    restaurantId: string,
    branchId: string | null | undefined,
    customerId: string,
    promoId: string
  ) {
    const promo = await prisma.promo.findFirst({
      where: { id: promoId, restaurantId },
    });
    if (!promo) {
      throw new NotFoundError("Promo tidak ditemukan");
    }
    assertPromoBranchScope(promo.branchId, branchId);

    const result = await prisma.$transaction(async (tx) => {
      // Serialize concurrent claims on the same promo (MySQL FOR UPDATE).
      await tx.$queryRaw`SELECT id FROM \`promo\` WHERE id = ${promo.id} FOR UPDATE`;

      const locked = await tx.promo.findUnique({ where: { id: promo.id } });
      if (!locked) {
        throw new NotFoundError("Promo tidak ditemukan");
      }
      assertPromoUsable(locked);
      assertPromoBranchScope(locked.branchId, branchId);

      // Per-customer claim limit (claims = rows with orderId NULL).
      const claimedCount = await tx.promoUsage.count({
        where: { promoId: locked.id, customerId, orderId: null },
      });
      if (claimedCount >= locked.perCustomerLimit) {
        throw new ConflictError("Promo sudah diklaim");
      }

      // Global quota still applies to what the promo can actually serve.
      if (locked.maxUsage > 0) {
        const used = await tx.promoUsage.count({
          where: { promoId: locked.id, orderId: { not: null } },
        });
        if (used >= locked.maxUsage) {
          throw new ConflictError("Kuota promo sudah habis");
        }
      }

      await tx.promoUsage.create({
        data: { promoId: locked.id, customerId, orderId: null, branchId },
      });
      return locked;
    });

    return result;
  }

  /**
   * NON-MUTATING preview/validation of a promo code or id (F2).
   *
   * Used by the checkout "Cek Voucher" step. It NEVER creates a
   * PromoUsage row and NEVER consumes quota — the authoritative
   * validation + consumption still happens inside applyPromoToOrder when
   * the order is actually created.
   *
   * `subtotal` is client-supplied and only used to compute the preview
   * discount; the order-creation path recomputes subtotal from DB prices.
   * Throws the same errors the order path would (expired, minOrder,
   * quota, per-customer limit) so the UI can show them before submit.
   */
  async validatePromoPreview(
    restaurantId: string,
    branchId: string | null | undefined,
    customerId: string,
    input: { promoCode?: string; promoId?: string },
    subtotal: number
  ) {
    const promo = await prisma.promo.findFirst({
      where: {
        restaurantId,
        ...(input.promoId ? { id: input.promoId } : {}),
        ...(input.promoCode ? { code: input.promoCode } : {}),
      },
    });
    if (!promo) {
      throw new ValidationError("Kode promo tidak ditemukan");
    }
    assertPromoUsable(promo);
    assertPromoBranchScope(promo.branchId, branchId);

    if (Number(subtotal) < Number(promo.minOrder)) {
      throw new ValidationError(
        `Minimum order Rp${Number(promo.minOrder).toLocaleString("id-ID")} untuk memakai promo ini`
      );
    }

    // Global usage quota (rows with an order attached).
    if (promo.maxUsage > 0) {
      const used = await prisma.promoUsage.count({
        where: { promoId: promo.id, orderId: { not: null } },
      });
      if (used >= promo.maxUsage) {
        throw new ConflictError("Kuota promo sudah habis");
      }
    }

    // Per-customer usage limit.
    if (promo.perCustomerLimit > 0) {
      const customerUsed = await prisma.promoUsage.count({
        where: {
          promoId: promo.id,
          customerId,
          orderId: { not: null },
        },
      });
      if (customerUsed >= promo.perCustomerLimit) {
        throw new ConflictError(
          "Kuota penggunaan promo untuk akun Anda sudah habis"
        );
      }
    }

    // Same authoritative discount math as applyPromoToOrder (server-side).
    let discount: number;
    if (promo.type === "PERCENT") {
      discount = Math.round(subtotal * (Number(promo.value) / 100));
      if (promo.maxDiscount !== null && discount > Number(promo.maxDiscount)) {
        discount = Number(promo.maxDiscount);
      }
    } else {
      discount = Number(promo.value);
    }
    discount = Math.min(discount, subtotal);
    discount = Math.round(discount * 100) / 100;

    return {
      valid: true,
      promo: {
        id: promo.id,
        code: promo.code,
        name: promo.name,
        description: promo.description,
        type: promo.type,
        value: Number(promo.value),
        minOrder: Number(promo.minOrder),
        maxDiscount: promo.maxDiscount !== null ? Number(promo.maxDiscount) : null,
        expiresAt: promo.expiresAt,
        branchId: promo.branchId,
      },
      subtotal,
      discount,
      finalSubtotal: Math.max(subtotal - discount, 0),
    };
  }

  /**
   * Validate + compute the discount for a promo code. Runs INSIDE the order
   * creation transaction so the quota checks and the usage row are atomic
   * with the order itself. Throws when the promo is not applicable.
   *
   * Returns the authoritative server-side discount + promo reference.
   */
  async applyPromoToOrder(
    tx: Tx,
    restaurantId: string,
    orderBranchId: string | null | undefined,
    customerId: string,
    promoCode: string,
    subtotal: number
  ): Promise<{ discount: number; promoId: string; promoCode: string }> {
    const promo = await tx.promo.findFirst({
      where: { code: promoCode, restaurantId },
    });
    if (!promo) {
      throw new ValidationError("Kode promo tidak ditemukan");
    }

    // Serialize quota consumption on this promo.
    await tx.$queryRaw`SELECT id FROM \`promo\` WHERE id = ${promo.id} FOR UPDATE`;
    const locked = await tx.promo.findUnique({ where: { id: promo.id } });
    if (!locked) {
      throw new ValidationError("Kode promo tidak ditemukan");
    }
    assertPromoUsable(locked);
    // Branch-only promo must match the order's branch.
    if (locked.branchId !== null && locked.branchId !== orderBranchId) {
      throw new ValidationError("Promo tidak tersedia di cabang ini");
    }

    if (Number(subtotal) < Number(locked.minOrder)) {
      throw new ValidationError(
        `Minimum order Rp${Number(locked.minOrder).toLocaleString("id-ID")} untuk memakai promo ini`
      );
    }

    // Global usage quota (rows with an order attached).
    if (locked.maxUsage > 0) {
      const used = await tx.promoUsage.count({
        where: { promoId: locked.id, orderId: { not: null } },
      });
      if (used >= locked.maxUsage) {
        throw new ConflictError("Kuota promo sudah habis");
      }
    }

    // Per-customer usage limit.
    if (locked.perCustomerLimit > 0) {
      const customerUsed = await tx.promoUsage.count({
        where: {
          promoId: locked.id,
          customerId,
          orderId: { not: null },
        },
      });
      if (customerUsed >= locked.perCustomerLimit) {
        throw new ConflictError(
          "Kuota penggunaan promo untuk akun Anda sudah habis"
        );
      }
    }

    // Discount math (server-authoritative).
    let discount: number;
    if (locked.type === "PERCENT") {
      discount = Math.round(subtotal * (Number(locked.value) / 100));
      if (locked.maxDiscount !== null && discount > Number(locked.maxDiscount)) {
        discount = Number(locked.maxDiscount);
      }
    } else {
      discount = Number(locked.value);
    }
    discount = Math.min(discount, subtotal);
    discount = Math.round(discount * 100) / 100;

    return { discount, promoId: locked.id, promoCode: locked.code };
  }

  // ============================================================
  // Admin (ADMIN role) management — tenant-scoped, no client trust.
  // ============================================================

  /** All promos for a restaurant (admin), with usage counts + branch scope. */
  async listPromosAdmin(restaurantId: string, branchFilters?: string[] | null) {
    const promos = await prisma.promo.findMany({
      where: {
        restaurantId,
        ...(branchFilters?.length
          ? { OR: [{ branchId: null }, { branchId: { in: branchFilters } }] }
          : {}),
      },
      include: {
        _count: { select: { usages: true } },
        branch: { select: { id: true, code: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    const usedRows = await prisma.promoUsage.groupBy({
      by: ["promoId"],
      where: {
        promoId: { in: promos.map((p) => p.id) },
        orderId: { not: null },
      },
      _count: { _all: true },
    });
    const usedByPromo = new Map(
      usedRows.map((r) => [r.promoId, r._count._all])
    );

    return promos.map((p) => ({
      id: p.id,
      code: p.code,
      name: p.name,
      description: p.description,
      type: p.type,
      value: Number(p.value),
      minOrder: Number(p.minOrder),
      maxDiscount: p.maxDiscount !== null ? Number(p.maxDiscount) : null,
      startsAt: p.startsAt,
      expiresAt: p.expiresAt,
      maxUsage: p.maxUsage,
      perCustomerLimit: p.perCustomerLimit,
      isActive: p.isActive,
      createdAt: p.createdAt,
      branchId: p.branchId,
      branch: p.branch ? { id: p.branch.id, code: p.branch.code, name: p.branch.name } : null,
      usageCount: usedByPromo.get(p.id) || 0,
      claimCount: p._count.usages,
    }));
  }

  /** Create a promo (admin). Validates the code is unique per restaurant. */
  async createPromo(
    restaurantId: string,
    input: {
      code: string;
      name: string;
      description?: string;
      type: "PERCENT" | "FIXED";
      value: number;
      minOrder?: number;
      maxDiscount?: number | null;
      startsAt?: string | null;
      expiresAt?: string | null;
      maxUsage?: number;
      perCustomerLimit?: number;
      isActive?: boolean;
      branchId?: string | null;
    }
  ) {
    const code = input.code.trim().toUpperCase();
    const existing = await prisma.promo.findFirst({
      where: { restaurantId, code },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictError("Kode promo sudah digunakan");
    }

    if (input.type === "PERCENT" && (input.value <= 0 || input.value > 100)) {
      throw new ValidationError("Nilai persen harus antara 1-100");
    }
    if (input.type === "FIXED" && input.value <= 0) {
      throw new ValidationError("Nilai diskon harus lebih dari 0");
    }

    // Validate the optional branch belongs to this restaurant.
    if (input.branchId) {
      const branch = await prisma.branch.findFirst({
        where: { id: input.branchId, restaurantId },
        select: { id: true },
      });
      if (!branch) {
        throw new ValidationError("Cabang tidak ditemukan");
      }
    }

    return prisma.promo.create({
      data: {
        restaurantId,
        branchId: input.branchId ?? null,
        code,
        name: input.name.trim(),
        description: input.description?.trim() || null,
        type: input.type,
        value: input.value,
        minOrder: input.minOrder ?? 0,
        maxDiscount: input.maxDiscount ?? null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        maxUsage: input.maxUsage ?? 0,
        perCustomerLimit: input.perCustomerLimit ?? 1,
        isActive: input.isActive ?? true,
      },
    });
  }

  /** Toggle a promo active/inactive (admin). */
  async setPromoActive(
    restaurantId: string,
    promoId: string,
    isActive: boolean,
    branchFilters?: string[] | null
  ) {
    const promo = await prisma.promo.findFirst({
      where: {
        id: promoId,
        restaurantId,
        // Branch-scoped admin may only touch their own (or restaurant-wide)
        // promos.
        ...(branchFilters?.length
          ? { OR: [{ branchId: null }, { branchId: { in: branchFilters } }] }
          : {}),
      },
    });
    if (!promo) {
      throw new NotFoundError("Promo tidak ditemukan");
    }
    return prisma.promo.update({
      where: { id: promo.id },
      data: { isActive },
    });
  }

  /** Record that a promo was actually applied to an order (inside the tx). */
  async recordPromoUse(
    tx: Tx,
    promoId: string,
    customerId: string,
    orderId: string,
    orderBranchId?: string | null
  ) {
    // Upgrade an existing claim (orderId NULL) to a real use, else create
    // the usage row directly (use without prior claim).
    const claim = await tx.promoUsage.findFirst({
      where: { promoId, customerId, orderId: null },
    });
    if (claim) {
      await tx.promoUsage.update({
        where: { id: claim.id },
        data: { orderId, branchId: orderBranchId ?? claim.branchId },
      });
    } else {
      await tx.promoUsage.create({
        data: { promoId, customerId, orderId, branchId: orderBranchId },
      });
    }
  }
}

export const promoService = new PromoService();