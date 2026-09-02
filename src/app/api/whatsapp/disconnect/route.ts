
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, NotFoundError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";

export async function POST() {
  try {
    const { restaurantId } = await requireAdmin();

    // Check if there's a session to disconnect
    const currentStatus = await whatsappSessionManager.getStatus(
      restaurantId
    );
    if (currentStatus.status === "DISCONNECTED") {
      throw new NotFoundError("No active WhatsApp session to disconnect");
    }

    const sessionInfo = await whatsappSessionManager.disconnect(
      restaurantId
    );

    return successResponse(sessionInfo, "WhatsApp disconnected successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error disconnecting WhatsApp:", error);
    return errorResponse(
      "Failed to disconnect WhatsApp",
      "INTERNAL_ERROR",
      500
    );
  }
}
