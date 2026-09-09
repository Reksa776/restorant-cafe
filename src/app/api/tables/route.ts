import { NextRequest } from "next/server";
import { tableService } from "@/services/table/table.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches, effectiveWriteBranchId, assertBranchInScope } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const tables = await tableService.getTables(
      ctx.restaurantId,
      { status },
      authorizedBranches(ctx)
    );

    return successResponse(tables);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching tables:", error);
    return errorResponse("Failed to fetch tables", "INTERNAL_ERROR", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const body = await request.json();

    if (!body.number || !body.name) {
      throw new ValidationError("Table number and name are required");
    }

    // Branch resolution for writes:
    // - Branch-scoped users MUST write into an authorized branch
    //   (effectiveWriteBranchId rejects ambiguous/no-context cases).
    // - Unrestricted admins writing from the Tables page do NOT send a body
    //   branchId, but may have an active branch selection (x-branch-id
    //   header, already server-validated) — the table must be created in
    //   THAT branch, not silently branch-less. An explicit body branchId
    //   (when sent) is validated against the restaurant/assignments below.
    let targetBranch: string | null;
    if (ctx.branchScoped) {
      targetBranch = effectiveWriteBranchId(ctx);
    } else {
      const bodyBranchId = typeof body.branchId === "string" ? body.branchId : null;
      if (bodyBranchId) {
        await assertBranchInScope(ctx, bodyBranchId);
      }
      // effectiveWriteBranchId honors the validated header branch first
      // (same rule every other write endpoint uses), then the body value.
      targetBranch = effectiveWriteBranchId(ctx, bodyBranchId);
    }

    const table = await tableService.createTable(
      ctx.restaurantId,
      body,
      targetBranch
    );

    return createdResponse(table, "Table created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating table:", error);
    return errorResponse("Failed to create table", "INTERNAL_ERROR", 500);
  }
}
