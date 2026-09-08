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

    // A branch-scoped admin creates the table in their branch (their context
    // is authoritative); an admin with all-branch access may pass an explicit
    // branchId in the body, validated against the restaurant below.
    let targetBranch: string | null;
    if (ctx.branchScoped) {
      targetBranch = effectiveWriteBranchId(ctx);
    } else {
      const bodyBranchId = typeof body.branchId === "string" ? body.branchId : null;
      if (bodyBranchId) {
        await assertBranchInScope(ctx, bodyBranchId);
      }
      targetBranch = bodyBranchId;
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
