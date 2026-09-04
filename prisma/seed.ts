import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import bcrypt from "bcryptjs";

// Parse DATABASE_URL
const url = process.env.DATABASE_URL || "mysql://root:password@localhost:3306/restaurant_app";
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

async function main() {
  console.log("🌱 Seeding database...");

  // Create restaurant
  const restaurant = await prisma.restaurant.create({
    data: {
      name: "Restoran Bahagia",
      address: "Jl. Contoh No. 123, Jakarta",
      phone: "+6281234567890",
      email: "info@restobahagia.com",
    },
  });

  console.log(`✅ Restaurant created: ${restaurant.name}`);

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
          number: i + 1,
          name: `Table ${String(i + 1).padStart(2, "0")}`,
          capacity: i < 6 ? 4 : 6,
          status: "AVAILABLE",
        },
      })
    )
  );

  console.log(`✅ Tables created: ${tables.length}`);

  console.log("\n🎉 Seeding completed!");
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
