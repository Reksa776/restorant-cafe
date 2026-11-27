import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";
import { parseDatabaseUrl } from "../src/lib/database-url";

// Parse DATABASE_URL — credentials are percent-decoded exactly once (F-2).
const url = process.env.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app";
const { host, port, user, password, database } = parseDatabaseUrl(url);
const adapter = new PrismaMariaDb({
  host,
  port,
  user,
  password,
  database,
  connectionLimit: 5,
});

const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding database...");

  // Create restaurant
  const restaurant = await prisma.restaurant.create({
    data: {
      // Phase 2 — public tenant identifier. This is the demo tenant's store
      // URL: /r/demo-resto
      slug: "demo-resto",
      name: "Restoran Bahagia",
      address: "Jl. Contoh No. 123, Jakarta",
      phone: "+6281234567890",
      email: "info@restobahagia.com",
    },
  });

  console.log(`✅ Restaurant created: ${restaurant.name} (/r/${restaurant.slug})`);

  // Phase 2 — default finance categories so the demo tenant can record
  // expenses immediately (the self-service registration creates the same set).
  await prisma.expenseCategory.createMany({
    data: [
      { restaurantId: restaurant.id, name: "Bahan Baku" },
      { restaurantId: restaurant.id, name: "Operasional" },
      { restaurantId: restaurant.id, name: "Gaji" },
      { restaurantId: restaurant.id, name: "Sewa & Utilitas" },
      { restaurantId: restaurant.id, name: "Lainnya" },
    ],
  });
  console.log(`✅ Expense categories created: 5`);

  // Phase 2 — the demo tenant's first branch (same shape the self-service
  // registration creates). Tables are assigned to it below so the branch
  // selector and branch-scoped menu work out of the box.
  const mainBranch = await prisma.branch.create({
    data: {
      restaurantId: restaurant.id,
      code: "PUSAT",
      name: "Cabang Utama",
      address: "Jl. Contoh No. 123, Jakarta",
      phone: "+6281234567890",
      // Phase 3 — courier pickup origin (Monas, Jakarta Pusat). The delivery
      // flow is usable out of the box with the MOCK provider (no API key).
      latitude: -6.1753924,
      longitude: 106.8271528,
      postalCode: "10110",
      contactPhone: "+6281234567890",
      isActive: true,
    },
  });
  console.log(`✅ Branch created: ${mainBranch.name} (${mainBranch.code})`);

  // Phase 3 — demo delivery configuration (BYOK mock provider, dispatch when
  // paid). Tenants can switch to Biteship + their own API key in
  // /admin/settings.
  await prisma.restaurantSettings.create({
    data: {
      restaurantId: restaurant.id,
      deliveryEnabled: true,
      deliveryProvider: "MOCK",
      deliveryAutoDispatchOn: "PAID",
    },
  });
  console.log("✅ Delivery settings created: MOCK (dispatch on PAID)");

  // Phase 4 — the demo tenant runs PRO for a full year with 2 paid branch
  // add-ons (quota = 1 main + 2 = 3 branches) so every paid feature (QR
  // self-order, layout, BOM/HPP, purchasing, P&L, reservations, WhatsApp,
  // multi-outlet reports, custom branding) can be explored out of the box.
  await prisma.restaurantSubscription.create({
    data: {
      restaurantId: restaurant.id,
      planCode: "PRO",
      billingCycle: "YEARLY",
      status: "ACTIVE",
      extraBranchesCount: 2,
      currentPeriodStart: new Date(),
      currentPeriodEnd: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });
  console.log("✅ Subscription created: PRO (yearly, +2 branch add-ons)");

  // Create admin user
  const hashedPassword = await bcrypt.hash("admin123", 12);
  const admin = await prisma.user.create({
    data: {
      restaurantId: restaurant.id,
      name: "Admin",
      email: "admin@restobahagia.com",
      password: hashedPassword,
      role: "ADMIN",
    },
  });

  console.log(`✅ Admin user created: ${admin.email}`);

  // Create cashier user (RBAC) — operational role for the cash drawer flow.
  const cashierPassword = process.env.SEED_CASHIER_PASSWORD || "kasir123";
  const cashier = await prisma.user.create({
    data: {
      restaurantId: restaurant.id,
      name: "Kasir",
      email: "kasir@restobahagia.com",
      password: await bcrypt.hash(cashierPassword, 12),
      role: "CASHIER",
    },
  });
  console.log(`✅ Cashier user created: ${cashier.email}`);

  // Explicit branch assignments (multi-branch RBAC) — both demo staff users
  // belong to the main branch.
  await prisma.userBranch.createMany({
    data: [
      { userId: admin.id, branchId: mainBranch.id },
      { userId: cashier.id, branchId: mainBranch.id },
    ],
  });
  console.log(`✅ UserBranch assignments created: 2`);

  // Create categories
  const categories = await Promise.all([
    prisma.category.create({
      data: {
        restaurantId: restaurant.id,
        name: "Makanan",
        description: "Menu makanan utama",
        sortOrder: 1,
      },
    }),
    prisma.category.create({
      data: {
        restaurantId: restaurant.id,
        name: "Minuman",
        description: "Menu minuman",
        sortOrder: 2,
      },
    }),
    prisma.category.create({
      data: {
        restaurantId: restaurant.id,
        name: "Snack",
        description: "Camilan ringan",
        sortOrder: 3,
      },
    }),
  ]);

  console.log(`✅ Categories created: ${categories.length}`);

  // Create products
  const makananCategory = categories[0];
  const minumanCategory = categories[1];
  const snackCategory = categories[2];

  const products = await Promise.all([
    prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: makananCategory.id,
        name: "Nasi Goreng",
        description: "Nasi goreng spesial dengan telur dan ayam",
        price: 25000,
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: makananCategory.id,
        name: "Ayam Geprek",
        description: "Ayam goreng dengan sambal geprek",
        price: 30000,
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: makananCategory.id,
        name: "Mie Ayam",
        description: "Mie ayam dengan pangsit",
        price: 22000,
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: minumanCategory.id,
        name: "Es Teh",
        description: "Teh manis dingin",
        price: 8000,
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: minumanCategory.id,
        name: "Es Jeruk",
        description: "Jeruk segar dingin",
        price: 10000,
        isAvailable: true,
      },
    }),
    prisma.product.create({
      data: {
        restaurantId: restaurant.id,
        categoryId: snackCategory.id,
        name: "Kentang Goreng",
        description: "Kentang goreng renyah",
        price: 15000,
        isAvailable: true,
      },
    }),
  ]);

  console.log(`✅ Products created: ${products.length}`);

  // Create tables
  const tables = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      prisma.table.create({
        data: {
          restaurantId: restaurant.id,
          branchId: mainBranch.id,
          number: i + 1,
          name: `Table ${String(i + 1).padStart(2, "0")}`,
          capacity: i < 6 ? 4 : 6,
          status: "AVAILABLE",
        },
      })
    )
  );

  console.log(`✅ Tables created: ${tables.length}`);

  // Create demo promos (F3) — tenant-scoped marketing engine. Customers can
  // claim these from the menu after logging in, then use the code at checkout.
  const promos = await Promise.all([
    prisma.promo.create({
      data: {
        restaurantId: restaurant.id,
        code: "HEMAT10",
        name: "Diskon 10%",
        description: "Nikmati potongan 10% untuk semua pesanan.",
        type: "PERCENT",
        value: 10,
        minOrder: 50000,
        maxDiscount: 20000,
        perCustomerLimit: 1,
        maxUsage: 0,
        isActive: true,
      },
    }),
    prisma.promo.create({
      data: {
        restaurantId: restaurant.id,
        code: "GRATIS5K",
        name: "Potongan Rp5.000",
        description: "Potongan langsung Rp5.000 tanpa syarat minimum.",
        type: "FIXED",
        value: 5000,
        minOrder: 0,
        perCustomerLimit: 1,
        maxUsage: 100,
        isActive: true,
      },
    }),
  ]);

  console.log(`✅ Promos created: ${promos.map((p) => p.code).join(", ")}`);

  console.log("\n🎉 Seeding completed!");
  console.log("\n🎟️ Promo codes:");
  console.log("   HEMAT10 (10% maks Rp20.000, min order Rp50.000)");
  console.log("   GRATIS5K (Rp5.000, kuota 100)");

  console.log("\n📋 Login credentials:");
  console.log("   Email: admin@restobahagia.com");
  console.log("   Password: admin123");
  console.log("   Email: kasir@restobahagia.com");
  console.log("   Password: kasir123");
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
