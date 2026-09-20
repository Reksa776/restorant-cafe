import { NextRequest } from "next/server";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import {
  requireRoles,
  authorizedBranches,
} from "@/lib/auth-helpers";
import { layoutService } from "@/services/layout/layout.service";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/branches/[id]/layout
 * ADMIN/CASHIER. Returns the floor plan of one branch (version 1 + empty
 * items when the branch was never edited — never a 404).
 *
 * The `[id]` segment (the branchId) comes from the URL and is
 * server-validated by `requireRoles(["ADMIN", "CASHIER"], id)` (branch must
 * belong to the authenticated user's restaurant AND, for branch-scoped users,
 * be one of their assigned branches). restaurantId is derived from the
 * authenticated session — never from the client. No rate limit (authenticated).
 */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireRoles(["ADMIN", "CASHIER"], id);

    const layout = await layoutService.getBranchLayout(
      ctx.restaurantId,
      id,
      authorizedBranches(ctx)
    );

    return successResponse(layout);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching branch layout:", error);
    return errorResponse("Gagal memuat layout", "INTERNAL_ERROR", 500);
  }
}

/**
 * PUT /api/admin/branches/[id]/layout
 * ADMIN/CASHIER. Full-state replace of the branch floor plan with an
 * optimistic version lock (409 on conflict).
 *
 * The `[id]` segment (the branchId) comes from the URL; restaurantId is
 * always session-derived. Body `{ version?, items[] }` is validated ENTIRELY
 * by LayoutService via the existing SaveBranchLayoutSchema in layout.types.ts
 * — this route never duplicates a validation rule. Every tableId is
 * re-checked service-side against this restaurant + branch; client-supplied
 * restaurantId/table metadata is never trusted.
 *
 * Error mapping (service AppErrors → HTTP):
 *   400 validation, 403 cross-branch/out-of-scope table, 404 branch/table not
 *   found, 409 version conflict. Prisma/stack internals never leak.
 */
export async function PUT(request: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const ctx = await requireRoles(["ADMIN", "CASHIER"], id);

    // Only guard against a non-JSON body here; every real field validation is
    // delegated to the service's Zod schema (no duplicated rules).
    const body = (await request.json().catch(() => null)) as unknown;
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("Invalid request body", "VALIDATION_ERROR", 400);
    }

    const layout = await layoutService.saveBranchLayout(
      ctx.restaurantId,
      id,
      body,
      authorizedBranches(ctx)
    );

    return successResponse(layout, "Layout berhasil disimpan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error saving branch layout:", error);
    return errorResponse("Gagal menyimpan layout", "INTERNAL_ERROR", 500);
  }
}