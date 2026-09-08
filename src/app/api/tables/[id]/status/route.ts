import { NextRequest } from "next/server";
import { tableService } from "@/services/table/table.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireRoles, branchHintFrom, authorizedBranches } from "@/lib/auth-helpers";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const branchId = branchHintFrom(request);
    const ctx = await requireRoles(["ADMIN", "CASHIER"], branchId);
    const { id } = await params;
    const body = await request.json();

    if (!body.status) {
      throw new ValidationError("Status is required");
    }

    const table = await tableService.updateTableStatus(
      id,
      ctx.restaurantId,
      body.status,
      authorizedBranches(ctx)
    );

    return successResponse(table, "Table status updated successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error updating table status:", error);
    return errorResponse(
      "Failed to update table status",
      "INTERNAL_ERROR",
      500
    );
  }
}
