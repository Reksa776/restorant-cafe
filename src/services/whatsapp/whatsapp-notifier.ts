import { prisma } from "@/lib/prisma";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";

// ============================================================
// WHATSAPP NOTIFICATION SENDER — DEMO (WEB is the sole Baileys owner).
//
// Web-side replacement for the former worker `send_message` job. It reuses the
// EXISTING session manager and Baileys provider — no new engine, no new
// session, no new socket, no queue consumer.
//
// It performs exactly the two steps the worker used to perform:
//   1. whatsappSessionManager.sendMessage(restaurantId, to, message)
//   2. record the OUTGOING row in `whatsappmessage`
//
// Contract: best-effort and it NEVER throws. The order/reservation engines stay
// authoritative — a WhatsApp problem can never fail, roll back, or mutate a
// business entity. The caller learns the truth from the boolean:
//   true  = the message was handed to a CONNECTED socket
//   false = nothing was delivered (no session / not CONNECTED / send error)
//
// A `sent` row is never written for a failed send (no fake success), and a
// bookkeeping failure after a delivered message never turns success into
// failure (that would invite a duplicate resend).
//
// Security: `restaurantId` and `to` are always resolved server-side by the
// caller from domain data. Nothing here reads a client-supplied recipient,
// restaurant id, message, order total, or payment state.
// ============================================================

export async function sendWhatsAppNotification(
  restaurantId: string,
  to: string,
  message: string
): Promise<boolean> {
  try {
    await whatsappSessionManager.sendMessage(restaurantId, to, message);
  } catch (error) {
    console.error(
      `[WhatsApp] Notification not sent for restaurant ${restaurantId}:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }

  // Delivered at this point — only record it, never fail the send because of it.
  try {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { phone: true },
    });

    await prisma.whatsAppMessage.create({
      data: {
        restaurantId,
        direction: "OUTGOING",
        from: restaurant?.phone || "system",
        to,
        content: message,
        type: "text",
        status: "sent",
      },
    });
  } catch (error) {
    console.error(
      `[WhatsApp] Failed to record outgoing message for restaurant ${restaurantId}:`,
      error instanceof Error ? error.message : error
    );
  }

  return true;
}
