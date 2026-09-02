
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ConflictError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";

export async function POST() {
  try {
    const { restaurantId } = await requireAdmin();

    // Check if already connected
    const currentStatus = await whatsappSessionManager.getStatus(
      restaurantId
    );
    if (
      currentStatus.status === "CONNECTED" ||
      currentStatus.status === "CONNECTING" ||
      currentStatus.status === "QR_REQUIRED"
    ) {
      throw new ConflictError(
        `WhatsApp is already ${currentStatus.status.toLowerCase()} for this restaurant`
      );
    }

    // Initiate connection
    const sessionInfo = await whatsappSessionManager.connect(restaurantId);

    return successResponse(sessionInfo, "WhatsApp connection initiated");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error connecting WhatsApp:", error);
    return errorResponse(
      "Failed to connect WhatsApp",
      "INTERNAL_ERROR",
      500
    );
  }
}
