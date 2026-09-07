// P3018 diagnostics — READ-ONLY. Never writes to the database.
// Run on the production VPS from the app directory (uses .env DATABASE_URL):
//   node scripts/diag-p3018.mjs
//
// Purpose: prove whether the production DB is already equivalent to the
// baseline migration before deciding on `prisma migrate resolve --applied`.
// Prints:
//   1. The rows in _prisma_migrations (what Prisma thinks is applied).
//   2. Whether the user_restaurantId_fkey constraint already exists.
//   3. Whether the baseline tables already exist (state equivalence check).
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { readdirSync } from "node:fs";

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
const prisma = new PrismaClient({ adapter, log: ["error", "warn"] });

const str = (v) => (typeof v === "bigint" ? v.toString() : v);
const fmt = (rows) => rows.map((r) => JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, str(v)]))).replace(/\\"/g, '"'));
const log = (line) => console.log(line);

try {
  await prisma.$queryRawUnsafe("SELECT 1");
  log("CONNECTION: OK");
} catch (e) {
  log(`CONNECTION FAILED: ${e.message}`);
  process.exit(1);
}

console.log("\n=== 1. migrations present in this checkout (prisma/migrations) ===");
let dirs = [];
try {
  dirs = readdirSync("prisma/migrations", { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  log(dirs.join("\n"));
} catch (e) {
  log(`  (could not read prisma/migrations: ${e.message})`);
}

console.log("\n=== 2. _prisma_migrations rows (what Prisma believes is applied) ===");
try {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT migration_name, finished_at, applied_steps_count, rolled_back_at, logs FROM _prisma_migrations ORDER BY started_at"
  );
  if (rows.length === 0) {
    log("  (no rows — _prisma_migrations is EMPTY)");
  } else {
    for (const r of rows) log(fmt([r]).join(""));
  }
} catch (e) {
  log(`  ERROR reading _prisma_migrations: ${e.message}`);
}

console.log("\n=== 3. user_restaurantId_fkey already exists? ===");
try {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT CONSTRAINT_NAME, TABLE_NAME FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND CONSTRAINT_NAME = 'user_restaurantId_fkey'"
  );
  if (rows.length === 0) {
    log("  NOT FOUND — the FK does NOT exist on db.");
  } else {
    for (const r of rows) log(fmt([r]).join(""));
    log("  FK EXISTS on db => a baseline (0_baseline / 0000_init_schema) ALREADY created it.");
  }
} catch (e) {
  log(`  ERROR checking FK: ${e.message}`);
}

console.log("\n=== 4. baseline table 'user' exists? (state-equivalence check) ===");
try {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('user','restaurant','order','payment','paymenttransaction')"
  );
  const cnt = Number(rows[0]?.cnt ?? 0);
  log(`  baseline tables present: ${cnt} / 5 expected`);
  if (cnt === 5) log("  DB SCHEMA ALREADY MATCHES BASELINE for these tables.");
} catch (e) {
  log(`  ERROR checking tables: ${e.message}`);
}

console.log("\n=== 5. does the Restaurant/Branding tables table exist? (latest migration check) ===");
try {
  const rows = await prisma.$queryRawUnsafe(
    "SELECT COUNT(*) AS cnt FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'restaurantsettings'"
  );
  const cnt = Number(rows[0]?.cnt ?? 0);
  log(`  restaurantsettings table present: ${cnt > 0 ? "YES" : "NO"}`);
  if (cnt > 0) log("  The LATEST migration (20260908_add_restaurant_branding) is also present.");
} catch (e) {
  log(`  ERROR checking restaurantsettings: ${e.message}`);
}

await prisma.$disconnect();

console.log("\n=== RECOVERY RECOMMENDATION (read-only — do not run blindly) ===");
console.log(`
Diagnosis branches:

A) If FK 'user_restaurantId_fkey' EXISTS in db AND _prisma_migrations is EMPTY or
   missing the baseline row:
   -> The DB schema state ALREADY equals the baseline. Safe to record it without
      re-running the SQL:
        npx prisma migrate resolve --applied 0_baseline
   (Use the EXACT migration name that exists in prisma/migrations on the VPS,
    i.e. either '0_baseline' or '0000_init_schema'.)

B) If _prisma_migrations row for baseline EXISTS but the DB still errors:
   -> The migration was recorded but some OTHER FK in the same migration also
      pre-exists. Diagnose WHICH constraint by reading the baseline SQL and
      checking each FK name. Do NOT resolve --applied for the whole migration.

C) If the FK does NOT exist AND the tables are NOT present:
   -> The DB really is missing the baseline; resolve is WRONG here. Investigate
      why 0_baseline fails differently (name clash from a later migration).
`);
