import { NextRequest } from "next/server";
import { tableService } from "@/services/table/table.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id } = await params;
    const result = await tableService.generateQrCode(id, restaurantId);

    return successResponse(result, "QR code generated successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error generating QR code:", error);
    return errorResponse("Failed to generate QR code", "INTERNAL_ERROR", 500);
  }
}
