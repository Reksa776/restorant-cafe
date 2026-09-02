
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";

export async function GET() {
  try {
    const { restaurantId } = await requireAdmin();

    const status = await whatsappSessionManager.getStatus(restaurantId);

    if (status.status !== "QR_REQUIRED") {
      return successResponse({
        qrCode: null,
        status: status.status,
        message:
          status.status === "CONNECTED"
            ? "WhatsApp is already connected"
            : `Status: ${status.status}. Connect first to generate QR code.`,
      });
    }

    const qrCode = whatsappSessionManager.getQrCode(restaurantId);

    return successResponse({
      qrCode,
      status: status.status,
      message: qrCode
        ? "Scan this QR code with WhatsApp"
        : "QR code is being generated, please wait...",
    });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching QR code:", error);
    return errorResponse(
      "Failed to fetch QR code",
      "INTERNAL_ERROR",
      500
    );
  }
}
