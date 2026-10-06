// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios call into
// /api/admin/audit-logs. The server implementation lives in
// ./audit/audit.service.ts (Prisma). Keeping the two trees distinct avoids
// importing Prisma into client components.
// ============================================================
import api from "@/lib/axios";

/** Audit row as returned by GET /api/admin/audit-logs (redacted server-side). */
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

export interface AuditLogListResult {
  items: AuditLogView[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AuditLogListParams {
  page?: number;
  limit?: number;
  action?: string;
  entityType?: string;
  entityId?: string;
  userId?: string;
  /** Explicit branch filter — server-validated (authorizedBranches). */
  branchId?: string;
  /** `YYYY-MM-DD` */
  dateFrom?: string;
  /** `YYYY-MM-DD` */
  dateTo?: string;
  search?: string;
}

/**
 * Thin admin audit-log client. Branch scoping via the global x-branch-id
 * header is applied by the shared axios interceptor; an explicit `branchId`
 * param here is an additional server-validated view filter.
 */
export const auditLogService = {
  async list(params: AuditLogListParams = {}): Promise<AuditLogListResult> {
    const response = await api.get("/admin/audit-logs", { params });
    return response.data.data as AuditLogListResult;
  },
};
