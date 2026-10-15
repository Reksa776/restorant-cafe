import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { parseDatabaseUrl } from "@/lib/database-url";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Build a Prisma client for `databaseUrl` (defaults to `DATABASE_URL`).
 *
 * Exported so the STEP 2C.4 (F-2) regression suite can drive the real wiring
 * with a differently-encoded credential instead of re-implementing it.
 */
export function createPrismaClient(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  // F-2: `new URL(...).username/.password` return the *encoded* userinfo and the
  // MariaDB adapter passes an object config to the driver verbatim, so the
  // credentials must be decoded exactly once here (see `@/lib/database-url`).
  const { host, port, user, password, database } = parseDatabaseUrl(databaseUrl);
  const adapter = new PrismaMariaDb({
    host,
    port,
    user,
    password,
    database,
    connectionLimit: 5,
  });

  return new PrismaClient({
    adapter,
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
