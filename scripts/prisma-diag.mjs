// Read-only Prisma diagnostic — uses the SAME adapter path as src/lib/prisma.ts.
// Safe to run on local AND on the VPS (never writes):
//   node scripts/prisma-diag.mjs
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

function mask(url) {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.username}:***@${u.hostname}:${u.port || "3306"}${u.pathname}`;
  } catch {
    return "(unparseable)";
  }
}

const raw = process.env.DATABASE_URL;
if (!raw) {
  console.error("FATAL: DATABASE_URL is not set in this environment.");
  process.exit(1);
}
console.log("DATABASE_URL (masked):", mask(raw));

const url = new URL(raw);
const adapter = new PrismaMariaDb({
  host: url.hostname,
  port: parseInt(url.port || "3306"),
  user: url.username,
  password: url.password,
  database: url.pathname.replace("/", ""),
  connectionLimit: 2,
});
const prisma = new PrismaClient({ adapter, log: ["query", "error", "warn"] });

const str = (v) => (typeof v === "bigint" ? v.toString() : v);
const fmt = (row) => JSON.stringify(Object.fromEntries(Object.entries(row).map(([k, v]) => [k, str(v)])));
const log = (line) => console.log(line);

try {
  const rows = await prisma.$queryRawUnsafe("SELECT DATABASE() AS db, @@lower_case_table_names AS lctn");
  log(`SELECT DATABASE()/lower_case_table_names => ${fmt(rows[0])}`);
} catch (e) {
  log(`connection probe FAILED: ${e.message}`);
  process.exit(1);
}

try {
  const tables = await prisma.$queryRawUnsafe("SHOW TABLES");
  const names = tables.map((r) => str(Object.values(r)[0]));
  log(`SHOW TABLES (${names.length}): ${names.join(", ")}`);
} catch (e) {
  log(`SHOW TABLES FAILED: ${e.message}`);
}

// The two models named in the P2021 error
try {
  const r = await prisma.restaurant.findFirst({ select: { id: true, name: true } });
  log(`prisma.restaurant.findFirst() => ${JSON.stringify(r)}`);
} catch (e) {
  log(`prisma.restaurant.findFirst() FAILED: ${e.message}`);
}
try {
  const t = await prisma.table.findFirst({ select: { id: true, number: true, name: true } });
  log(`prisma.table.findFirst() => ${JSON.stringify(t)}`);
} catch (e) {
  log(`prisma.table.findFirst() FAILED: ${e.message}`);
}

await prisma.$disconnect();
