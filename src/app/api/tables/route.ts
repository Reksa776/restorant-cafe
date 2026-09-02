import { NextRequest } from "next/server";
import { tableService } from "@/services/table/table.service";
import { successResponse, createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function GET(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;

    const tables = await tableService.getTables(restaurantId, { status });

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
    const { restaurantId } = await requireAdmin();
    const body = await request.json();

    if (!body.number || !body.name) {
      throw new ValidationError("Table number and name are required");
    }

    const table = await tableService.createTable(restaurantId, body);

    return createdResponse(table, "Table created successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error creating table:", error);
    return errorResponse("Failed to create table", "INTERNAL_ERROR", 500);
  }
}
