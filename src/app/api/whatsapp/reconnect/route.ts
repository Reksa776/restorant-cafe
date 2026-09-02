import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";

export async function POST() {
  try {
    const { restaurantId } = await requireAdmin();

    // Force reconnect — closes existing connection and reconnects from scratch
    const sessionInfo = await whatsappSessionManager.forceReconnect(
      restaurantId
    );

    return successResponse(
      sessionInfo,
      "WhatsApp reconnection initiated"
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error reconnecting WhatsApp:", error);
    return errorResponse(
      "Failed to reconnect WhatsApp",
      "INTERNAL_ERROR",
      500
    );
  }
}
