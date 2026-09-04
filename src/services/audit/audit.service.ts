import { prisma } from "@/lib/prisma";

/**
 * Centralized audit trail. Every sensitive/financial action records one row
 * with who (userId), what (action), which entity, extra context (details),
 * and the caller's IP when available.
 *
 * Actions are free-form stable strings — e.g. "PAYMENT_RECEIVED",
 * "SHIFT_OPENED", "SHIFT_CLOSED", "REFUND_APPROVED", "REFUND_DENIED",
 * "ORDER_CANCELLED", "SHIFT_OVERRIDE_REQUESTED", "ADMIN_OVERRIDE".
 *
 * Never throws — auditing must never break the business write it follows.
 */
export class AuditService {
  async log(input: {
    restaurantId: string;
    userId?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: string | null;
    details?: Record<string, unknown> | null;
    ipAddress?: string | null;
  }): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          restaurantId: input.restaurantId,
          userId: input.userId || null,
          action: input.action,
          entityType: input.entityType || null,
          entityId: input.entityId || null,
          details:
            input.details && Object.keys(input.details).length > 0
              ? (input.details as object)
              : undefined,
          ipAddress: input.ipAddress || null,
        },
      });
    } catch (error) {
      // Audit is best-effort: never fail the underlying operation.
      console.error("[Audit] failed to write audit log:", error);
    }
  }

  /** List audit logs (admin). Latest first. */
  async list(input: {
    restaurantId: string;
    userId?: string;
    action?: string;
    page?: number;
    limit?: number;
  }) {
    const page = input.page || 1;
    const limit = input.limit || 50;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      restaurantId: input.restaurantId,
    };
    if (input.userId) where.userId = input.userId;
    if (input.action) where.action = input.action;

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return { items, total, page, limit, totalPages: Math.ceil(total / limit) };
  }
}

export const auditService = new AuditService();
