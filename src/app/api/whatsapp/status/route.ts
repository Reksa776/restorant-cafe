
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";
import { getWhatsAppQueueStats } from "@/services/whatsapp/whatsapp.queue";

export async function GET() {
  try {
    const { restaurantId } = await requireAdmin();

    const status = await whatsappSessionManager.getStatus(restaurantId);
    const queueStats = await getWhatsAppQueueStats();

    return successResponse({
      ...status,
      queue: queueStats,
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching WhatsApp status:", error);
    return errorResponse(
      "Failed to fetch WhatsApp status",
      "INTERNAL_ERROR",
      500
    );
  }
}
