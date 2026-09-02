import { Worker, Job } from "bullmq";
import { prisma } from "@/lib/prisma";
import IORedis from "ioredis";

// ============================================================
// Redis connection (standalone)
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

interface NotificationJobData {
  restaurantId: string;
  type:
    | "ORDER_RECEIVED"
    | "ORDER_CONFIRMED"
    | "ORDER_PROCESSING"
    | "ORDER_COMPLETED"
    | "ORDER_CANCELLED"
    | "PAYMENT_REQUEST"
    | "PAYMENT_SUCCESS"
    | "PAYMENT_FAILED";
  title: string;
  message: string;
  data?: Record<string, unknown>;
}

// ============================================================
// Worker
// ============================================================

const notificationWorker = new Worker(
  "notification",
  async (job: Job<NotificationJobData>) => {
    const { restaurantId, type, title, message, data } = job.data;

    console.log(
      `[Notification Worker] Processing job ${job.id}: ${type}`
    );

    // Save notification to database
    await prisma.notification.create({
      data: {
        restaurantId,
        type,
        title,
        message,
        data: data ? JSON.parse(JSON.stringify(data)) : undefined,
      },
    });

    console.log(
      `[Notification Worker] Job ${job.id} completed`
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

notificationWorker.on("completed", (job) => {
  console.log(
    `[Notification Worker] Job ${job.id} completed successfully`
  );
});

notificationWorker.on("failed", (job, err) => {
  console.error(
    `[Notification Worker] Job ${job?.id} failed:`,
    err.message
  );
});

notificationWorker.on("ready", () => {
  console.log(
    "[Notification Worker] Worker is ready and listening for jobs"
  );
});

// ============================================================
// Graceful shutdown
// ============================================================

async function gracefulShutdown() {
  console.log("[Notification Worker] Shutting down...");
  await notificationWorker.close();
  await connection.quit();
  process.exit(0);
}

process.on("SIGINT", gracefulShutdown);
process.on("SIGTERM", gracefulShutdown);

console.log("[Notification Worker] Starting worker...");

export { notificationWorker };
