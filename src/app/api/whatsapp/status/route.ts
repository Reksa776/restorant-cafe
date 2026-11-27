import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";
import { whatsappSessionManager } from "@/services/whatsapp/session-manager";

// ============================================================
// GET /api/whatsapp/status
//
// PHASE 5 — SINGLE WHATSAPP OWNER.
//
// The Next.js process (web) owns the ONLY Baileys socket. The former
// BullMQ `whatsapp` worker was removed, so this route no longer reports
// queue counters (they were always zero).
//
// Because the web process now has no boot hook, persisted sessions are
// restored lazily on the first status poll after a restart — exactly once
// per process, and the session manager itself skips tenants that already
// have a provider in memory.
// ============================================================

let restorePromise: Promise<void> | null = null;

function restorePersistedSessionsOnce(): Promise<void> {
  restorePromise ??= whatsappSessionManager.restoreSessions();
  return restorePromise;
}

export async function GET() {
  try {
    const { restaurantId } = await requireAdmin();

    await restorePersistedSessionsOnce();

    const status = await whatsappSessionManager.getStatus(restaurantId);

    return successResponse(status);
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
