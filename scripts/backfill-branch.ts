import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";

// ============================================================
// Branch Backfill Script
// ============================================================
// Creates a default "Main Outlet" (code: MAIN) branch for every existing
// restaurant, then backfills all branch-scoped operational data to it and
// assigns every user + active product to the default branch.
//
// SAFE: idempotent, uses transactions per restaurant, never deletes data.
// Run AFTER the add_branch_multi_cabang migration.
//
// Usage:
//   npx tsx scripts/backfill-branch.ts
// ============================================================

const url =
  process.env.DATABASE_URL ||
  "mysql://root:password@localhost:3306/restaurant_app";
const urlObj = new URL(url);
const adapter = new PrismaMariaDb({
  host: urlObj.hostname,
  port: parseInt(urlObj.port || "3306"),
  user: urlObj.username,
  password: urlObj.password,
  database: urlObj.pathname.replace("/", ""),
  connectionLimit: 5,
});

const prisma = new PrismaClient({ adapter });

type BranchId = string;

async function backfillRestaurant(restaurantId: string): Promise<BranchId> {
  return prisma.$transaction(async (tx) => {
    const restaurant = await tx.restaurant.findUnique({
      where: { id: restaurantId },
    });
    if (!restaurant) {
      throw new Error(`Restaurant ${restaurantId} not found`);
    }

    // Reuse an existing MAIN branch if the script is re-run (idempotent).
    const existing = await tx.branch.findFirst({
      where: { restaurantId, code: "MAIN" },
    });
    if (existing) {
      return existing.id;
    }

    const branch = await tx.branch.create({
      data: {
        restaurantId,
        code: "MAIN",
        name: "Main Outlet",
        address: restaurant.address,
        phone: restaurant.phone,
        isActive: true,
      },
    });

    // Backfill all branch-scoped operational data.
    await tx.table.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.order.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.payment.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.cashierShift.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.shiftOverride.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.refund.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.cancellationRequest.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.auditLog.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.notification.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });
    await tx.promo.updateMany({
      where: { restaurantId },
      data: { branchId: branch.id },
    });

    // Assign every user to the default branch.
    const users = await tx.user.findMany({
      where: { restaurantId },
      select: { id: true },
    });
    for (const user of users) {
      const exists = await tx.userBranch.findFirst({
        where: { userId: user.id, branchId: branch.id },
      });
      if (!exists) {
        await tx.userBranch.create({
          data: { userId: user.id, branchId: branch.id },
        });
      }
    }

    // Create BranchProduct rows for all active products (default availability,
    // no price override — product master price is used).
    const products = await tx.product.findMany({
      where: { restaurantId, isActive: true },
      select: { id: true, isAvailable: true },
    });
    for (const product of products) {
      const exists = await tx.branchProduct.findFirst({
        where: { branchId: branch.id, productId: product.id },
      });
      if (!exists) {
        await tx.branchProduct.create({
          data: {
            branchId: branch.id,
            productId: product.id,
            isAvailable: product.isAvailable,
            priceOverride: null,
          },
        });
      }
    }

    return branch.id;
  });
}

async function auditNulls(): Promise<void> {
  console.log("\n=== AUDIT: records with branchId IS NULL ===");
  const checks: Array<[string, string]> = [
    ["orders", "order"],
    ["tables", "table"],
    ["payments", "payment"],
    ["cashier shifts", "cashiershift"],
    ["shift overrides", "shiftoverride"],
    ["refunds", "refund"],
    ["cancellation requests", "cancellationrequest"],
    ["audit logs", "auditlog"],
    ["notifications", "notification"],
    ["promos", "promo"],
  ];

  let anyNull = false;
  for (const [label, table] of checks) {
    // Use count with a raw query since some models may be empty.
    try {
      const res =
        await prisma.$queryRawUnsafe<Array<{ cnt: bigint }>>(
          `SELECT COUNT(*) AS cnt FROM \`${table}\` WHERE \`branchId\` IS NULL`
        );
      const cnt = Number(res[0]?.cnt ?? 0);
      console.log(`  ${label.padEnd(22)}: ${cnt}`);
      if (cnt > 0) anyNull = true;
    } catch (e) {
      console.log(`  ${label.padEnd(22)}: ERROR - ${(e as Error).message}`);
    }
  }

  // Users not assigned to any branch.
  const unassignedUsers = await prisma.$queryRawUnsafe<
    Array<{ cnt: bigint }>
  >(
    `SELECT COUNT(*) AS cnt FROM \`user\` u
     LEFT JOIN \`userbranch\` ub ON ub.\`userId\` = u.\`id\`
     WHERE ub.\`id\` IS NULL`
  );
  console.log(
    `  ${"users without branch".padEnd(22)}: ${Number(
      unassignedUsers[0]?.cnt ?? 0
    )}`
  );

  console.log(anyNull ? "\n⚠️  Some records still lack branchId." : "\n✅ No orphan records with NULL branchId.");
}

async function main() {
  console.log("🏢 Backfilling branches...\n");

  const restaurants = await prisma.restaurant.findMany({
    select: { id: true, name: true },
  });

  if (restaurants.length === 0) {
    console.log("No restaurants found. Nothing to backfill.");
    await auditNulls();
    return;
  }

  for (const r of restaurants) {
    try {
      const branchId = await backfillRestaurant(r.id);
      console.log(`✅ ${r.name}: Main Outlet ready (${branchId})`);
    } catch (e) {
      console.error(`❌ ${r.name}: ${(e as Error).message}`);
    }
  }

  await auditNulls();

  console.log("\n🎉 Backfill completed!");
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
