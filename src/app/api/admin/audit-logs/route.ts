import { NextRequest } from "next/server";
import { auditService } from "@/services/audit/audit.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

/**
 * GET /api/admin/audit-logs
 * ADMIN-only audit log viewer. Restaurant-scoped always; branch-scoped through
 * authorizedBranches when the admin is branch-scoped. Server-side pagination +
 * safe filters (see AuditLogListQuerySchema). `details` is redacted on read.
 *
 * Optional `?facets=actions` returns the distinct action values available to
 * this caller (same tenant/branch scope) for the viewer's Action picker:
 *   { success, data: { actions: string[] } }
 * Everything else keeps the plain paginated list response unchanged.
 */
export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireAdmin(branchId);

    const params = Object.fromEntries(request.nextUrl.searchParams.entries());

    if (request.nextUrl.searchParams.has("facets")) {
      if (params.facets !== "actions") {
        return errorResponse("Parameter facets tidak valid", "VALIDATION_ERROR", 400);
      }
      const actions = await auditService.listActionOptions(
        ctx.restaurantId,
        params,
        authorizedBranches(ctx)
      );
      return successResponse({ actions });
    }

    const result = await auditService.list(
      ctx.restaurantId,
      params,
      authorizedBranches(ctx)
    );

    return successResponse(result);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error listing audit logs:", error);
    return errorResponse("Gagal memuat log audit", "INTERNAL_ERROR", 500);
  }
}
