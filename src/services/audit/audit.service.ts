import { prisma } from "@/lib/prisma";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { clientIp } from "@/lib/rate-limit";
import { AuditLogFacetsQuerySchema, AuditLogListQuerySchema } from "./audit.types";

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

// ============================================================
// Request-derived client IP.
//
// Audit writers are plain service functions, so they have no request object.
// Instead of a global/global-mutable request state (race-prone) or threading
// an `ipAddress` argument through every route + service signature, the IP is
// resolved once per audit write from the CURRENT request scope that Next.js
// already exposes (an AsyncLocalStorage-backed accessor — request-scoped, not
// process-global).
//
// The header parsing is delegated to the project's existing `clientIp()`
// helper (src/lib/rate-limit.ts) so audit rows use exactly the same trusted-
// proxy convention as rate limiting: CF-Connecting-IP → first X-Forwarded-For
// hop → X-Real-IP. `clientIp()` returns the literal "unknown" when no proxy
// header is present — that sentinel is NOT stored as data (a row would get the
// bogus value "unknown" instead of NULL).
//
// Outside a request scope (whatsapp worker, seed/test scripts) the accessor
// throws and the row simply keeps `ipAddress = NULL`, as every historical row
// does. No backfill, no widening of what is collected.
// ============================================================
async function requestIpAddress(): Promise<string | null> {
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const ip = clientIp({ headers: { get: (name: string) => h.get(name) } } as unknown as Request);
    return ip === "unknown" ? null : ip;
  } catch {
    return null;
  }
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
    /** Explicit override. Omitted/null → the current request's client IP. */
    ipAddress?: string | null;
  }): Promise<void> {
    try {
      // An explicit value always wins; otherwise derive it from the request
      // that is currently being served (NULL outside a request scope).
      const ipAddress = input.ipAddress ?? (await requestIpAddress());
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
          ipAddress: ipAddress || null,
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

    const where: Record<string, unknown> = {
      restaurantId,
      ...this.branchPredicate(q.branchId, branchFilters),
    };
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
   * Branch predicate shared by `list()` and `listActionOptions()` so the two
   * can never drift apart.
   *
   * A branch-scoped caller can never widen or redirect a query to a branch
   * outside their assignments (explicit `branchId` outside the list → 403).
   * Otherwise: the explicit branch, else every authorized branch, else the
   * whole restaurant (undefined = no branch predicate).
   */
  private branchPredicate(
    requestedBranchId: string | null | undefined,
    branchFilters?: string[] | null
  ): Record<string, unknown> {
    if (requestedBranchId && branchFilters?.length && !branchFilters.includes(requestedBranchId)) {
      throw new ForbiddenError("Anda tidak memiliki akses ke cabang ini");
    }
    if (requestedBranchId) return { branchId: requestedBranchId };
    if (branchFilters?.length) return { branchId: { in: branchFilters } };
    return {};
  }

  /**
   * Distinct `action` values the caller may filter by — the Action picker's
   * source. Same tenant scope (always) and same branch predicate as `list()`,
   * including the explicit `branchId` filter, so the picker offers exactly the
   * actions reachable through the current view and can never widen the scope.
   * Read-only; capped so a pathological tenant cannot return an unbounded list.
   */
  async listActionOptions(
    restaurantId: string,
    raw: unknown,
    branchFilters?: string[] | null
  ): Promise<string[]> {
    const parsed = AuditLogFacetsQuerySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const where: Record<string, unknown> = {
      restaurantId,
      ...this.branchPredicate(parsed.data.branchId, branchFilters),
    };
    const rows = await prisma.auditLog.findMany({
      where,
      distinct: ["action"],
      select: { action: true },
      orderBy: { action: "asc" },
      take: 200,
    });
    return rows.map((r) => r.action);
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
