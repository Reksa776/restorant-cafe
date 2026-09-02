import Redis from "ioredis";

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

function createRedisClient(): Redis {
  const client = new Redis(
    process.env.REDIS_URL || "redis://localhost:6379",
    {
      maxRetriesPerRequest: null,
      enableReadyCheck: false,
      retryStrategy(times) {
        // Limit reconnection attempts to prevent infinite loops
        if (times > 10) {
          return null; // Stop retrying
        }
        return Math.min(times * 200, 5000);
      },
      lazyConnect: true,
    }
  );

  // Prevent unhandled connection errors from crashing the process
  client.on("error", (err) => {
    // Only log — don't throw
    if (process.env.NODE_ENV === "development") {
      console.warn("[Redis] Connection error:", err.message);
    }
  });

  return client;
}

export const redis = globalForRedis.redis ?? createRedisClient();

if (process.env.NODE_ENV !== "production") {
  globalForRedis.redis = redis;
}
