import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { createdResponse, errorResponse } from "@/lib/api-response";
import { AppError, ConflictError, ValidationError } from "@/lib/errors";
import { assertRateLimit, rateLimitKey } from "@/lib/rate-limit";
import { generateUniqueSlug, setTenantCookie } from "@/lib/tenant";
import { buildTenantPublicUrl } from "@/lib/tenant-url";
import { STARTER_TRIAL_DAYS, addDays } from "@/lib/subscription";
import { getOrCreateWallet } from "@/services/wallet/wallet.service";

// ============================================================
// POST /api/public/merchants/register — SELF-SERVICE SAAS ONBOARDING
//
// Creates a brand-new tenant in ONE atomic transaction:
//   Restaurant (active, unique slug) → first Branch → RestaurantSettings →
//   ADMIN User (bcrypt cost 12) → UserBranch → default ExpenseCategories.
//
// Isolation notes:
// - The slug is generated server-side from the restaurant name (random suffix
//   on collision). A client can never choose/claim another tenant's slug.
// - Email is globally unique (User.email), checked here and enforced by the
//   unique index; a duplicate rolls the whole transaction back.
// - Nothing is written for an existing tenant; each registration is a new
//   restaurant row, so one merchant's data can never attach to another's.
// ============================================================

export const DEFAULT_EXPENSE_CATEGORIES = [
  "Bahan Baku",
  "Operasional",
  "Gaji",
  "Sewa & Utilitas",
  "Lainnya",
] as const;

const RegisterMerchantSchema = z.object({
  restaurantName: z
    .string()
    .trim()
    .min(2, "Nama restoran minimal 2 karakter")
    .max(120, "Nama restoran maksimal 120 karakter"),
  // Optional: registration always creates the tenant's central branch, named
  // "Cabang Pusat" unless the caller explicitly names it.
  branchName: z
    .string()
    .trim()
    .min(2, "Nama cabang minimal 2 karakter")
    .max(120, "Nama cabang maksimal 120 karakter")
    .optional(),
  ownerName: z
    .string()
    .trim()
    .min(2, "Nama pemilik minimal 2 karakter")
    .max(120, "Nama pemilik maksimal 120 karakter"),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .email("Email tidak valid")
    .max(190),
  password: z
    .string()
    .min(8, "Password minimal 8 karakter")
    .max(72, "Password maksimal 72 karakter"),
  phone: z
    .string()
    .trim()
    .min(8, "Nomor HP minimal 8 digit")
    .max(30, "Nomor HP maksimal 30 karakter"),
  address: z.string().trim().max(300).optional(),
});

type RegisterMerchantInput = z.infer<typeof RegisterMerchantSchema>;

function isUniqueViolation(error: unknown, target?: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  if (!target) return true;
  const metaTarget = error.meta?.target;
  return Array.isArray(metaTarget)
    ? metaTarget.some((t) => String(t).includes(target))
    : String(metaTarget ?? "").includes(target);
}

async function createTenant(input: RegisterMerchantInput) {
  const passwordHash = await bcrypt.hash(input.password, 12);

  return prisma.$transaction(async (tx) => {
    const existingUser = await tx.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existingUser) {
      throw new ConflictError("Email sudah terdaftar. Silakan masuk atau gunakan email lain.");
    }

    const slug = await generateUniqueSlug(tx, input.restaurantName);

    const restaurant = await tx.restaurant.create({
      data: {
        slug,
        name: input.restaurantName,
        address: input.address?.trim() || null,
        phone: input.phone,
        email: input.email,
        isActive: true,
      },
      select: { id: true, slug: true, name: true },
    });

    const branch = await tx.branch.create({
      data: {
        restaurantId: restaurant.id,
        code: "PUSAT",
        name: input.branchName?.trim() || "Cabang Pusat",
        address: input.address?.trim() || null,
        phone: input.phone,
        isActive: true,
      },
      select: { id: true, code: true, name: true },
    });

    // Default row so branding settings exist immediately (all fields null →
    // the app falls back to Restaurant.name and the default palette).
    await tx.restaurantSettings.create({
      data: { restaurantId: restaurant.id },
    });

    // Phase 4 — every new tenant starts on the STARTER free trial (14 days,
    // 1 branch, 150 transactions/month, 2 staff). Created in the SAME
    // transaction as the tenant, so a registration can never leave a
    // restaurant without a subscription row.
    await tx.restaurantSubscription.create({
      data: {
        restaurantId: restaurant.id,
        planCode: "STARTER",
        billingCycle: "MONTHLY",
        status: "TRIAL",
        extraBranchesCount: 0,
        currentPeriodStart: new Date(),
        currentPeriodEnd: addDays(new Date(), STARTER_TRIAL_DAYS),
      },
    });

    // Merchant wallet — created with the tenant so the owner can immediately
    // see incoming online revenue and request a payout (0 balance until the
    // first PAID online order). Existing tenants self-heal on first read.
    await getOrCreateWallet(restaurant.id, tx);

    const user = await tx.user.create({
      data: {
        restaurantId: restaurant.id,
        name: input.ownerName,
        email: input.email,
        password: passwordHash,
        role: "ADMIN",
        isActive: true,
      },
      select: { id: true },
    });

    await tx.userBranch.create({
      data: { userId: user.id, branchId: branch.id },
    });

    // Finance features are usable immediately.
    await tx.expenseCategory.createMany({
      data: DEFAULT_EXPENSE_CATEGORIES.map((name) => ({
        restaurantId: restaurant.id,
        name,
      })),
    });

    return { restaurant, branch };
  });
}

export async function POST(request: NextRequest) {
  try {
    // Anti-abuse: merchant registration is the most attractive endpoint to
    // spam (it writes a whole tenant). 5 attempts / 10 minutes / IP.
    assertRateLimit(rateLimitKey("merchant-register", request), 5, 10 * 60_000);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      throw new ValidationError("Body tidak valid");
    }

    const parsed = RegisterMerchantSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }

    let created: Awaited<ReturnType<typeof createTenant>>;
    try {
      created = await createTenant(parsed.data);
    } catch (error) {
      // Slug race: another registration claimed the generated slug between
      // the check and the insert. Retry once with a fresh suffix.
      if (isUniqueViolation(error, "slug")) {
        created = await createTenant(parsed.data);
      } else {
        throw error;
      }
    }

    const response = createdResponse(
      {
        restaurant: {
          slug: created.restaurant.slug,
          name: created.restaurant.name,
        },
        branch: created.branch,
        loginUrl: "/login",
        storeUrl: `/r/${created.restaurant.slug}`,
        // Canonical storefront: https://<slug>.<ROOT_DOMAIN> when configured
        // (or derivable from the host), otherwise the /r/<slug> fallback.
        subdomainUrl: buildTenantPublicUrl(
          created.restaurant.slug,
          request.headers
        ),
      },
      "Restoran berhasil didaftarkan. Silakan masuk dengan email dan password Anda."
    );

    // Convenience: remember the tenant on this browser so the merchant can
    // immediately preview their own storefront at /menu.
    setTenantCookie(response, created.restaurant.slug);
    return response;
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error registering merchant:", error);
    return errorResponse("Gagal mendaftarkan restoran", "INTERNAL_ERROR", 500);
  }
}
