import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import IORedis from "ioredis";

// ============================================================
// Redis connection (standalone — not shared with Next.js)
// ============================================================

const connection = new IORedis(
  process.env.REDIS_URL || "redis://localhost:6379",
  {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  }
);

// ============================================================
// Job Types
// ============================================================

interface WhatsAppSendJobData {
  restaurantId: string;
  type: "send_message";
  to: string;
  message: string;
}

interface WhatsAppConnectJobData {
  restaurantId: string;
  type: "connect";
  /** R7.2 Phase 1 — true = ask for a fresh socket (existing forceReconnect()). */
  force?: boolean;
}

interface WhatsAppDisconnectJobData {
  restaurantId: string;
  type: "disconnect";
}

type WhatsAppJobData =
  | WhatsAppSendJobData
  | WhatsAppConnectJobData
  | WhatsAppDisconnectJobData;

// ============================================================
// Worker — dynamically imports session manager
// (avoids bundling Prisma/Baileys in the wrong context)
// ============================================================

const whatsappWorker = new Worker(
  "whatsapp",
  async (job: Job<WhatsAppJobData>) => {
    const { restaurantId, type } = job.data;

    console.log(
      `[WhatsApp Worker] Processing job ${job.id}: ${type} for restaurant ${restaurantId}`
    );

    // Validate restaurantId exists
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new Error(`Restaurant ${restaurantId} not found`);
    }

    // Dynamic import to avoid circular deps and edge issues
    const { whatsappSessionManager } = await import(
      "@/services/whatsapp/session-manager"
    );

    switch (type) {
      case "send_message": {
        const { to, message } = job.data as WhatsAppSendJobData;
        await whatsappSessionManager.sendMessage(restaurantId, to, message);

        // Store outgoing message in DB
        await prisma.whatsAppMessage.create({
          data: {
            restaurantId,
            direction: "OUTGOING",
            from: restaurant.phone || "system",
            to,
            content: message,
            type: "text",
            status: "sent",
          },
        });
        break;
      }
      case "connect": {
        // R7.2 Phase 1 — this worker is the ONLY Baileys socket owner. A
        // plain connect() is idempotent; force=true reuses the existing
        // forceReconnect() for the admin "reconnect" command.
        const { force } = job.data as WhatsAppConnectJobData;
        if (force) {
          await whatsappSessionManager.forceReconnect(restaurantId);
        } else {
          await whatsappSessionManager.connect(restaurantId);
        }
        break;
      }
      case "disconnect": {
        await whatsappSessionManager.disconnect(restaurantId);
        break;
      }
      default:
        console.warn(
          `[WhatsApp Worker] Unknown job type: ${type}`
        );
    }

    console.log(
      `[WhatsApp Worker] Job ${job.id} completed for restaurant ${restaurantId}`
    );
  },
  {
    connection,
    concurrency: 5,
  }
);

// ============================================================
// Event Handlers
// ============================================================

whatsappWorker.on("completed", (job) => {
  console.log(
    `[WhatsApp Worker] Job ${job.id} completed successfully`
  );
});

whatsappWorker.on("failed", (job, err) => {
  console.error(
    `[WhatsApp Worker] Job ${job?.id} failed:`,
    err.message
  );
});

whatsappWorker.on("ready", () => {
  console.log("[WhatsApp Worker] Worker is ready and listening for jobs");
});

// ============================================================
// Graceful shutdown
// ============================================================

async function gracefulShutdown() {
  console.log("[WhatsApp Worker] Shutting down...");
  await whatsappWorker.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

console.log("[WhatsApp Worker] Starting worker...");

// ============================================================
// R7.2 Phase 1 — SESSION RESTORE (worker is the sole Baileys owner)
//
// The worker owns the ONLY Baileys socket, so it is also the only process that
// may restore persisted sessions. This wires the EXISTING `restoreSessions()`
// to worker boot using the same lazy dynamic import the job handler already
// uses (no new infrastructure).
//
// With no valid credentials it restores 0 sessions — that is the normal,
// expected outcome: no dummy credentials are created, nothing is paired and no
// QR is requested here.
// ============================================================

void (async () => {
  try {
    const { whatsappSessionManager } = await import(
      "@/services/whatsapp/session-manager"
    );
    console.log(
      "[WhatsApp Worker] Restoring persisted WhatsApp sessions..."
    );
    await whatsappSessionManager.restoreSessions();
    console.log(
      "[WhatsApp Worker] Session restore finished"
    );
  } catch (error) {
    // Never crash the queue consumer because of a session-restore problem;
    // restoreSessions() already swallows per-session errors internally.
    console.error(
      "[WhatsApp Worker] Session restore failed:",
      error instanceof Error ? error.message : error
    );
  }
})();

export { whatsappWorker };
