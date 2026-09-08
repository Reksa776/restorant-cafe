import { prisma } from "@/lib/prisma";
import { ConflictError, NotFoundError, ValidationError, ForbiddenError } from "@/lib/errors";
import { auditService } from "@/services/audit/audit.service";

// ============================================================
// Branch Service — restaurant-scoped branch (outlet) management.
// ============================================================

const CODE_RE = /^[A-Za-z0-9_-]{1,20}$/;
const NAME_RE = /^.{2,100}$/;

export class BranchService {
  /**
   * List branches for a restaurant. When `allowedBranchIds` is provided,
   * only those branches are returned (branch-authorization aware).
   */
  async listBranches(
    restaurantId: string,
    allowedBranchIds?: string[]
  ) {
    const where: Record<string, unknown> = { restaurantId };
    if (allowedBranchIds && allowedBranchIds.length > 0) {
      where.id = { in: allowedBranchIds };
    }

    const branches = await prisma.branch.findMany({
      where,
      orderBy: { createdAt: "asc" },
    });
    return { items: branches };
  }

  /** Get a single branch, scoped to the restaurant. */
  async getBranch(id: string, restaurantId: string) {
    const branch = await prisma.branch.findFirst({
      where: { id, restaurantId },
    });
    if (!branch) {
      throw new NotFoundError("Cabang tidak ditemukan");
    }
    return branch;
  }

  /** Create a branch. `code` is unique per restaurant. */
  async createBranch(input: {
    restaurantId: string;
    userId: string;
    code: string;
    name: string;
    address?: string;
    phone?: string;
  }) {
    const { restaurantId } = input;
    const code = (input.code || "").trim().toUpperCase();
    const name = (input.name || "").trim();

    if (!NAME_RE.test(name)) {
      throw new ValidationError("Nama cabang minimal 2 karakter");
    }
    if (!CODE_RE.test(code)) {
      throw new ValidationError(
        "Kode cabang wajib diisi, maksimal 20 karakter (huruf, angka, -, _, tanpa spasi)"
      );
    }

    const existing = await prisma.branch.findFirst({
      where: { restaurantId, code },
    });
    if (existing) {
      throw new ConflictError(`Kode cabang "${code}" sudah digunakan`);
    }

    const branch = await prisma.branch.create({
      data: {
        restaurantId,
        code,
        name,
        address: input.address?.trim() || null,
        phone: input.phone?.trim() || null,
        isActive: true,
      },
    });

    await auditService.log({
      restaurantId,
      branchId: branch.id,
      userId: input.userId,
      action: "BRANCH_CREATED",
      entityType: "Branch",
      entityId: branch.id,
      details: { code, name },
    });

    return branch;
  }

  /** Update a non-code branch field. */
  async updateBranch(
    id: string,
    restaurantId: string,
    userId: string,
    data: {
      name?: string;
      address?: string;
      phone?: string;
    }
  ) {
    const branch = await this.getBranch(id, restaurantId);

    const name = data.name?.trim();
    if (name !== undefined && !NAME_RE.test(name)) {
      throw new ValidationError("Nama cabang minimal 2 karakter");
    }

    const updated = await prisma.branch.update({
      where: { id: branch.id },
      data: {
        name: name ?? undefined,
        address: data.address?.trim() || undefined,
        phone: data.phone?.trim() || undefined,
      },
    });

    await auditService.log({
      restaurantId,
      branchId: updated.id,
      userId,
      action: "BRANCH_UPDATED",
      entityType: "Branch",
      entityId: updated.id,
      details: { name: updated.name },
    });

    return updated;
  }

  /** Update the branch code (checking uniqueness). */
  async updateBranchCode(
    id: string,
    restaurantId: string,
    userId: string,
    code: string
  ) {
    const branch = await this.getBranch(id, restaurantId);
    const normalized = code.trim().toUpperCase();

    if (!CODE_RE.test(normalized)) {
      throw new ValidationError(
        "Kode cabang wajib diisi, maksimal 20 karakter (huruf, angka, -, _, tanpa spasi)"
      );
    }

    const existing = await prisma.branch.findFirst({
      where: { restaurantId, code: normalized, id: { not: branch.id } },
    });
    if (existing) {
      throw new ConflictError(`Kode cabang "${normalized}" sudah digunakan`);
    }

    const updated = await prisma.branch.update({
      where: { id: branch.id },
      data: { code: normalized },
    });

    await auditService.log({
      restaurantId,
      branchId: updated.id,
      userId,
      action: "BRANCH_UPDATED",
      entityType: "Branch",
      entityId: updated.id,
      details: { code: normalized },
    });

    return updated;
  }

  /** Activate / deactivate a branch. Deactivation keeps all data intact. */
  async setBranchActive(
    id: string,
    restaurantId: string,
    userId: string,
    isActive: boolean
  ) {
    const branch = await this.getBranch(id, restaurantId);

    // Never deactivate the last active branch: an outlet-less restaurant
    // would have no context for existing/backfilled data.
    if (!isActive && branch.isActive) {
      const activeCount = await prisma.branch.count({
        where: { restaurantId, isActive: true },
      });
      if (activeCount <= 1) {
        throw new ValidationError(
          "Tidak dapat menonaktifkan cabang terakhir yang aktif"
        );
      }
    }

    const updated = await prisma.branch.update({
      where: { id: branch.id },
      data: { isActive },
    });

    await auditService.log({
      restaurantId,
      branchId: updated.id,
      userId,
      action: isActive ? "BRANCH_ACTIVATED" : "BRANCH_DEACTIVATED",
      entityType: "Branch",
      entityId: updated.id,
    });

    return updated;
  }

  // ============================================================
  // User → Branch assignments (UserBranch)
  // ============================================================

  /**
   * Get the branch IDs a user is assigned to (for a given restaurant).
   * Empty array = user has no explicit assignment (all-branch access).
   */
  async getUserBranchIds(userId: string, restaurantId: string) {
    const rows = await prisma.userBranch.findMany({
      where: { userId, branch: { restaurantId } },
      select: { branchId: true },
    });
    return rows.map((r) => r.branchId);
  }

  /** Set a user's branch assignments (replace semantics). */
  async setUserBranches(
    restaurantId: string,
    adminId: string,
    targetUserId: string,
    branchIds: string[]
  ) {
    // Prevent an admin from granting themselves branch access through this
    // endpoint — a privilege is managed by another admin.
    if (targetUserId === adminId) {
      throw new ValidationError("Tidak dapat mengubah akses cabang sendiri");
    }

    const target = await prisma.user.findFirst({
      where: { id: targetUserId, restaurantId },
    });
    if (!target) {
      throw new NotFoundError("User tidak ditemukan");
    }

    const uniqueIds = [...new Set(branchIds)];
    if (uniqueIds.length > 0) {
      const validCount = await prisma.branch.count({
        where: { id: { in: uniqueIds }, restaurantId },
      });
      if (validCount !== uniqueIds.length) {
        throw new ValidationError("Cabang tidak valid");
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.userBranch.deleteMany({ where: { userId: targetUserId } });
      if (uniqueIds.length > 0) {
        await tx.userBranch.createMany({
          data: uniqueIds.map((branchId) => ({
            userId: targetUserId,
            branchId,
          })),
        });
      }
    });

    await auditService.log({
      restaurantId,
      branchId: null,
      userId: adminId,
      action: "USER_BRANCH_UPDATED",
      entityType: "User",
      entityId: targetUserId,
      details: { branchIds: uniqueIds },
    });

    return { branchIds: uniqueIds };
  }

  // ============================================================
  // Branch × Product availability/price (BranchProduct)
  // ============================================================

  /** List active products with their per-branch availability for a branch. */
  async listBranchProducts(
    restaurantId: string,
    branchId: string,
    allowedBranchFilters?: string[] | null
  ) {
    // A branch-scoped admin may only view/modify THEIR branches' product
    // availability — never every branch of the restaurant.
    if (allowedBranchFilters?.length && !allowedBranchFilters.includes(branchId)) {
      throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
    }
    const branch = await this.getBranch(branchId, restaurantId);
    const branchProducts = await prisma.branchProduct.findMany({
      where: { branchId: branch.id },
      select: {
        productId: true,
        isAvailable: true,
        priceOverride: true,
      },
    });
    const map = new Map(
      branchProducts.map((b) => [b.productId, b])
    );

    const products = await prisma.product.findMany({
      where: { restaurantId, isActive: true },
      select: {
        id: true,
        name: true,
        price: true,
        categoryId: true,
        isAvailable: true,
      },
      orderBy: { name: "asc" },
    });

    return {
      items: products.map((p) => {
        const bp = map.get(p.id);
        return {
          productId: p.id,
          name: p.name,
          price: Number(p.price),
          categoryId: p.categoryId,
          defaultAvailable: p.isAvailable,
          isAvailable: bp ? bp.isAvailable : p.isAvailable,
          priceOverride: bp?.priceOverride ? Number(bp.priceOverride) : null,
          effectivePrice: bp?.priceOverride
            ? Number(bp.priceOverride)
            : Number(p.price),
        };
      }),
    };
  }

  /** Set availability (and optional price override) for a branch product. */
  async updateBranchProduct(
    restaurantId: string,
    branchId: string,
    productId: string,
    userId: string,
    data: { isAvailable?: boolean; priceOverride?: number | null },
    allowedBranchFilters?: string[] | null
  ) {
    // A branch-scoped admin may only modify THEIR branches' product
    // availability — never every branch of the restaurant.
    if (allowedBranchFilters?.length && !allowedBranchFilters.includes(branchId)) {
      throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
    }
    await this.getBranch(branchId, restaurantId);

    const product = await prisma.product.findFirst({
      where: { id: productId, restaurantId },
    });
    if (!product) {
      throw new NotFoundError("Produk tidak ditemukan");
    }

    if (
      data.priceOverride !== undefined &&
      data.priceOverride !== null &&
      (data.priceOverride <= 0 || Number.isNaN(data.priceOverride))
    ) {
      throw new ValidationError("Harga override tidak valid");
    }

    const bp = await prisma.branchProduct.upsert({
      where: {
        branchId_productId: { branchId, productId },
      },
      update: {
        isAvailable: data.isAvailable ?? undefined,
        priceOverride:
          data.priceOverride === null ? null : (data.priceOverride ?? undefined),
      },
      create: {
        branchId,
        productId,
        isAvailable: data.isAvailable ?? product.isAvailable,
        priceOverride: data.priceOverride ?? null,
      },
    });

    await auditService.log({
      restaurantId,
      branchId,
      userId,
      action: "BRANCH_PRODUCT_UPDATED",
      entityType: "BranchProduct",
      entityId: bp.id,
      details: {
        productId,
        isAvailable: bp.isAvailable,
        priceOverride: bp.priceOverride ? Number(bp.priceOverride) : null,
      },
    });

    return bp;
  }

  // ============================================================
  // Helpers used by other services
  // ============================================================

  /** Resolve a branch by restaurant + code (public QR flow). */
  async findBranchByCode(restaurantId: string, code: string) {
    const branch = await prisma.branch.findFirst({
      where: { restaurantId, code: code.trim().toUpperCase(), isActive: true },
    });
    return branch;
  }

  /** The restaurant's first active branch (default context fallback). */
  async getDefaultBranch(restaurantId: string) {
    const branch = await prisma.branch.findFirst({
      where: { restaurantId, isActive: true },
      orderBy: { createdAt: "asc" },
    });
    return branch;
  }
}

export const branchService = new BranchService();