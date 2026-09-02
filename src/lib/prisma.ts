import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is not set");
  }

  // Parse MySQL URL
  const urlObj = new URL(url);
  const adapter = new PrismaMariaDb({
    host: urlObj.hostname,
    port: parseInt(urlObj.port || "3306"),
    user: urlObj.username,
    password: urlObj.password,
    database: urlObj.pathname.replace("/", ""),
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
