import { Queue } from "bullmq";

// ============================================================
// Lazy Redis connection — only connects when actually used
// ============================================================

let whatsappQueue: Queue | null = null;

function getWhatsAppQueue(): Queue {
  if (!whatsappQueue) {
    // Lazy require to avoid eager Redis connection at module load time
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const redisModule = require("@/lib/redis") as { redis: InstanceType<typeof import("ioredis").default> };
    whatsappQueue = new Queue("whatsapp", {
      connection: redisModule.redis,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: "exponential",
          delay: 1000,
        },
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 50 },
      },
    });
  }
  return whatsappQueue;
}

// ============================================================
// Queue Helpers
// ============================================================

/**
 * Queue a WhatsApp message to be sent by the worker.
 */
export async function queueWhatsAppMessage(
  restaurantId: string,
  to: string,
  message: string
) {
  const queue = getWhatsAppQueue();
  const job = await queue.add(
    "send_message",
    {
      restaurantId,
      type: "send_message",
      to,
      message,
    },
    {
      priority: 1,
    }
  );

  console.log(
    `[WhatsApp Queue] Message job ${job.id} queued for restaurant ${restaurantId}`
  );
  return job;
}

/**
 * Queue a WhatsApp notification for order ready.
 * Uses orderNumber as job ID for idempotency — prevents duplicate notifications.
 */
export async function queueWhatsAppNotification(
  restaurantId: string,
  customerId: string,
  orderNumber: string,
  to: string,
  message: string
) {
  const queue = getWhatsAppQueue();

  // Idempotency: use orderNumber as job key to prevent duplicate notifications
  const jobId = `notification-${orderNumber}`;

  const job = await queue.add(
    "send_message",
    {
      restaurantId,
      type: "send_message",
      to,
      message,
    },
    {
      jobId,
      priority: 1,
    }
  );

  console.log(
    `[WhatsApp Queue] Notification job ${job.id} queued for order ${orderNumber}`
  );
  return job;
}

/**
 * Queue a WhatsApp connection request.
 */
export async function queueWhatsAppConnect(restaurantId: string) {
  const queue = getWhatsAppQueue();
  const job = await queue.add(
    "connect",
    {
      restaurantId,
      type: "connect",
    },
    {
      priority: 0,
    }
  );

  console.log(
    `[WhatsApp Queue] Connect job ${job.id} queued for restaurant ${restaurantId}`
  );
  return job;
}

/**
 * Queue a WhatsApp disconnection request.
 */
export async function queueWhatsAppDisconnect(restaurantId: string) {
  const queue = getWhatsAppQueue();
  const job = await queue.add(
    "disconnect",
    {
      restaurantId,
      type: "disconnect",
    },
    {
      priority: 0,
    }
  );

  console.log(
    `[WhatsApp Queue] Disconnect job ${job.id} queued for restaurant ${restaurantId}`
  );
  return job;
}

/**
 * Get queue stats — safely handles Redis unavailability.
 */
export async function getWhatsAppQueueStats() {
  try {
    const queue = getWhatsAppQueue();
    const [waiting, active, completed, failed] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
    ]);

    return { waiting, active, completed, failed };
  } catch {
    // Redis unavailable — return zero stats
    return { waiting: 0, active: 0, completed: 0, failed: 0 };
  }
}

export { getWhatsAppQueue };
