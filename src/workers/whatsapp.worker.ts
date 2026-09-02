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
        await whatsappSessionManager.connect(restaurantId);
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

export { whatsappWorker };
