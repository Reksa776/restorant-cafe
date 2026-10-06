import { prisma } from "@/lib/prisma";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { AuditLogListQuerySchema } from "./audit.types";

/**
 * Centralized audit trail. Every sensitive/financial action records one row
 * with who (userId), what (action), where (restaurantId + optional branchId),
 * which entity, extra context (details), and the caller's IP when available.
 *
 * Actions are free-form stable strings — e.g. "PAYMENT_RECEIVED",
 * "SHIFT_OPENED", "SHIFT_CLOSED", "REFUND_APPROVED", "REFUND_DENIED",
 * "ORDER_CANCELLED", "SHIFT_OVERRIDE_REQUESTED", "ADMIN_OVERRIDE",
 * "BRANCH_CREATED", "BRANCH_UPDATED".
 *
 * Never throws — auditing must never break the business write it follows.
 */

// ============================================================
// Sensitivity redaction.
//
// `details` is free-form JSON written by many domains. Even though current
// writers store no secrets, the READ surface must never be a way to leak one,
// so every outbound `details` value is defensively redacted: any object key
// that looks like a credential/token/secret has its value replaced. This is
// display-time only — the stored row is untouched.
// ============================================================

const SENSITIVE_KEY =
  /(pass(word|phrase)?|token|secret|api[_-]?key|credential|authorization|auth[_-]?header|cookie|session)/i;

const REDACTED = "[REDACTED]";
const MAX_REDACT_DEPTH = 6;

export function redactAuditDetails(value: unknown, depth = 0): unknown {
  if (depth > MAX_REDACT_DEPTH) return "[TRUNCATED]";
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditDetails(item, depth + 1));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY.test(key)
        ? REDACTED
        : redactAuditDetails(item, depth + 1);
    }
    return out;
  }
  return value;
}

/** Safe, read-only projection of an AuditLog row for the admin viewer. */
export interface AuditLogView {
  id: string;
  restaurantId: string;
  branchId: string | null;
  branch: { id: string; code: string; name: string } | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actor: {
    id: string;
    name: string | null;
    email: string | null;
    role: string;
  } | null;
}

export class AuditService {
  async log(input: {
    restaurantId: string;
    branchId?: string | null;
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
          branchId: input.branchId || null,
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

  /**
   * List audit logs (admin viewer). Latest first, server-side pagination +
   * filters, tenant-scoped ALWAYS and branch-scoped through `branchFilters`
   * (authorizedBranches) when the caller is branch-scoped.
   */
  async list(
    restaurantId: string,
    raw: unknown,
    branchFilters?: string[] | null
  ): Promise<{
    items: AuditLogView[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const parsed = AuditLogListQuerySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const q = parsed.data;
    const skip = (q.page - 1) * q.limit;

    // A branch-scoped caller can never widen or redirect the listing to a
    // branch outside their assignments.
    if (q.branchId && branchFilters?.length && !branchFilters.includes(q.branchId)) {
      throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
    }

    const where: Record<string, unknown> = { restaurantId };
    if (q.branchId) {
      where.branchId = q.branchId;
    } else if (branchFilters?.length) {
      where.branchId = { in: branchFilters };
    }
    if (q.action) where.action = q.action;
    if (q.entityType) where.entityType = q.entityType;
    if (q.entityId) where.entityId = q.entityId;
    if (q.userId) where.userId = q.userId;
    if (q.dateFrom || q.dateTo) {
      // Day-bounded range on the created-at timestamp (local-day semantics).
      where.createdAt = {
        ...(q.dateFrom ? { gte: new Date(`${q.dateFrom}T00:00:00.000`) } : {}),
        ...(q.dateTo ? { lte: new Date(`${q.dateTo}T23:59:59.999`) } : {}),
      };
    }
    if (q.search) {
      where.OR = [
        { action: { contains: q.search } },
        { entityType: { contains: q.search } },
        { entityId: { contains: q.search } },
      ];
    }

    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: { select: { id: true, name: true, email: true, role: true } },
        },
        orderBy: { createdAt: "desc" },
        skip,
        take: q.limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    const items = await this.toViews(rows);

    return {
      items,
      total,
      page: q.page,
      limit: q.limit,
      totalPages: Math.ceil(total / q.limit),
    };
  }

  /**
   * Single audit log by id. Always restaurant-scoped; when `branchFilters` is
   * provided the row must belong to one of those branches.
   */
  async getById(
    id: string,
    restaurantId: string,
    branchFilters?: string[] | null
  ): Promise<AuditLogView> {
    const row = await prisma.auditLog.findFirst({
      where: {
        id,
        restaurantId,
        branchId: branchFilters?.length ? { in: branchFilters } : undefined,
      },
      include: {
        user: { select: { id: true, name: true, email: true, role: true } },
      },
    });
    if (!row) {
      throw new NotFoundError("Log audit tidak ditemukan");
    }
    const [view] = await this.toViews([row]);
    return view;
  }

  /**
   * Map raw rows to the safe DTO: redacted `details` and branch display names
   * resolved with a single batched lookup (AuditLog has no branch relation).
   */
  private async toViews(
    rows: Array<{
      id: string;
      restaurantId: string;
      branchId: string | null;
      action: string;
      entityType: string | null;
      entityId: string | null;
      details: unknown;
      ipAddress: string | null;
      createdAt: Date;
      user: {
        id: string;
        name: string | null;
        email: string | null;
        role: string;
      } | null;
    }>
  ): Promise<AuditLogView[]> {
    const branchIds = [
      ...new Set(rows.map((r) => r.branchId).filter((id): id is string => Boolean(id))),
    ];
    const branches = branchIds.length
      ? await prisma.branch.findMany({
          where: { id: { in: branchIds } },
          select: { id: true, code: true, name: true },
        })
      : [];
    const branchMap = new Map(branches.map((b) => [b.id, b]));

    return rows.map((r) => ({
      id: r.id,
      restaurantId: r.restaurantId,
      branchId: r.branchId,
      branch: r.branchId ? (branchMap.get(r.branchId) ?? null) : null,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      details: r.details
        ? (redactAuditDetails(r.details) as Record<string, unknown>)
        : null,
      ipAddress: r.ipAddress,
      createdAt: r.createdAt.toISOString(),
      actor: r.user
        ? {
            id: r.user.id,
            name: r.user.name,
            email: r.user.email,
            role: r.user.role,
          }
        : null,
    }));
  }
}

export const auditService = new AuditService();
