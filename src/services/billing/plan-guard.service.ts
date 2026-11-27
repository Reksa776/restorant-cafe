import { prisma } from "@/lib/prisma";
import { PlanLimitError } from "@/lib/errors";
import {
  STARTER_TRIAL_DAYS,
  addDays,
  branchQuota,
  getPlan,
  minimumPlanForFeature,
  planHasFeature,
  type PlanFeatureKey,
} from "@/lib/subscription";

// ============================================================
// PLAN / QUOTA GUARDS (server-side enforcement)
//
// Every function is tenant-scoped by `restaurantId` supplied by the caller
// from the authenticated session — never from a request body. A tenant without
// a subscription row is self-healed into a STARTER trial (14 days), so
// pre-Phase-4 data keeps working and new tenants are never locked out.
//
// Failures throw PlanLimitError (HTTP 403) with a semantic code:
//   PLAN_LIMIT_REACHED — branch / staff / monthly transaction quota
//   UPGRADE_REQUIRED   — feature missing from the plan, or subscription
//                        expired/cancelled
// ============================================================

type SubscriptionRow = {
  id: string;
  restaurantId: string;
  planCode: "STARTER" | "BASIC" | "PRO" | "ENTERPRISE";
  billingCycle: "MONTHLY" | "YEARLY";
  status: "TRIAL" | "ACTIVE" | "PAST_DUE" | "CANCELLED" | "EXPIRED";
  extraBranchesCount: number;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
};

const subscriptionSelect = {
  id: true,
  restaurantId: true,
  planCode: true,
  billingCycle: true,
  status: true,
  extraBranchesCount: true,
  currentPeriodStart: true,
  currentPeriodEnd: true,
} as const;

/**
 * Read the tenant's subscription, creating the STARTER trial on first access.
 * The create is idempotent-safe: a concurrent create loses the unique race and
 * the winner's row is re-read.
 */
export async function getOrCreateSubscription(
  restaurantId: string
): Promise<SubscriptionRow> {
  const existing = await prisma.restaurantSubscription.findUnique({
    where: { restaurantId },
    select: subscriptionSelect,
  });
  if (existing) return existing;

  try {
    return await prisma.restaurantSubscription.create({
      data: {
        restaurantId,
        planCode: "STARTER",
        status: "TRIAL",
        currentPeriodEnd: addDays(new Date(), STARTER_TRIAL_DAYS),
      },
      select: subscriptionSelect,
    });
  } catch {
    // Unique race (another request created it) or FK failure. Re-read; if the
    // row is genuinely absent the original error is the real problem.
    const raced = await prisma.restaurantSubscription.findUnique({
      where: { restaurantId },
      select: subscriptionSelect,
    });
    if (!raced) {
      throw new PlanLimitError(
        "UPGRADE_REQUIRED",
        "Langganan restoran tidak ditemukan. Muat ulang halaman billing."
      );
    }
    return raced;
  }
}

/** Reject expired/cancelled subscriptions (and lazily persist EXPIRED). */
async function assertSubscriptionUsable(sub: SubscriptionRow): Promise<void> {
  if (sub.status === "EXPIRED" || sub.status === "CANCELLED") {
    throw new PlanLimitError(
      "UPGRADE_REQUIRED",
      "Masa langganan tidak aktif. Perpanjang paket di menu Paket & Billing."
    );
  }
  if (sub.currentPeriodEnd.getTime() <= Date.now()) {
    await prisma.restaurantSubscription
      .update({
        where: { restaurantId: sub.restaurantId },
        data: { status: "EXPIRED" },
      })
      .catch(() => {
        // Best-effort status write; the rejection below is what matters.
      });
    throw new PlanLimitError(
      "UPGRADE_REQUIRED",
      "Masa langganan telah berakhir. Perpanjang paket di menu Paket & Billing."
    );
  }
}

/**
 * Branch quota: `1 + extraBranchesCount`. Add-on purchases are the only way to
 * raise it; the check counts ALL branch rows (active or not) because a
 * deactivated outlet still occupies a slot in the commercial quota.
 */
export async function assertCanCreateBranch(
  restaurantId: string
): Promise<void> {
  const sub = await getOrCreateSubscription(restaurantId);
  const limit = branchQuota(sub.extraBranchesCount);
  const used = await prisma.branch.count({ where: { restaurantId } });

  if (used >= limit) {
    const plan = getPlan(sub.planCode);
    throw new PlanLimitError(
      "PLAN_LIMIT_REACHED",
      `Kuota cabang tercapai (${used}/${limit}) untuk paket ${plan.name}. ` +
        (plan.canBuyBranchAddon
          ? "Beli Add-On Cabang Baru di menu Paket & Billing untuk menambah cabang."
          : "Upgrade ke paket BASIC atau lebih tinggi untuk menambah cabang.")
    );
  }
}

/** Staff quota (2 on STARTER, 5 on BASIC, unlimited on PRO/ENTERPRISE). */
export async function assertCanCreateStaff(
  restaurantId: string
): Promise<void> {
  const sub = await getOrCreateSubscription(restaurantId);
  const plan = getPlan(sub.planCode);
  if (plan.maxStaff === null) return;

  const used = await prisma.user.count({ where: { restaurantId } });
  if (used >= plan.maxStaff) {
    throw new PlanLimitError(
      "PLAN_LIMIT_REACHED",
      `Kuota akun staf tercapai (${used}/${plan.maxStaff}) untuk paket ${plan.name}. ` +
        "Upgrade paket di menu Paket & Billing untuk menambah staf."
    );
  }
}

/**
 * Monthly transaction quota (STARTER: 150/month) + subscription validity.
 * Cancelled orders do not consume quota; the window is the current calendar
 * month (server time).
 */
export async function assertCanCreateOrder(
  restaurantId: string
): Promise<void> {
  const sub = await getOrCreateSubscription(restaurantId);
  await assertSubscriptionUsable(sub);

  const plan = getPlan(sub.planCode);
  if (plan.maxTransactionsPerMonth === null) return;

  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const used = await prisma.order.count({
    where: {
      restaurantId,
      createdAt: { gte: monthStart },
      status: { not: "CANCELLED" },
    },
  });

  if (used >= plan.maxTransactionsPerMonth) {
    throw new PlanLimitError(
      "PLAN_LIMIT_REACHED",
      `Batas ${plan.maxTransactionsPerMonth} transaksi/bulan paket ${plan.name} sudah tercapai. ` +
        "Upgrade paket di menu Paket & Billing untuk melanjutkan."
    );
  }
}

/**
 * Non-throwing feature check for OPTIONAL, best-effort paths (e.g. WhatsApp
 * notifications). Returns false when the feature is not included in the
 * tenant's plan, the subscription is expired/cancelled, or the lookup itself
 * fails — the caller then skips the optional work instead of failing the
 * business transaction it is attached to.
 */
export async function isPlanFeatureActive(
  restaurantId: string,
  feature: PlanFeatureKey
): Promise<boolean> {
  try {
    const sub = await getOrCreateSubscription(restaurantId);
    if (sub.status === "EXPIRED" || sub.status === "CANCELLED") return false;
    if (sub.currentPeriodEnd.getTime() <= Date.now()) return false;
    return planHasFeature(sub.planCode, feature);
  } catch (error) {
    console.error(
      `[PlanGuard] Feature check failed for "${feature}" (restaurant ${restaurantId}); treating it as unavailable:`,
      error instanceof Error ? error.message : error
    );
    return false;
  }
}

/**
 * Feature gate for Pro/Enterprise capabilities. Also rejects expired
 * subscriptions so a lapsed tenant cannot keep using paid features.
 */
export async function requirePlanFeature(
  restaurantId: string,
  feature: PlanFeatureKey
): Promise<void> {
  const sub = await getOrCreateSubscription(restaurantId);
  await assertSubscriptionUsable(sub);

  if (planHasFeature(sub.planCode, feature)) return;

  const minimum = minimumPlanForFeature(feature);
  const plan = getPlan(sub.planCode);
  throw new PlanLimitError(
    "UPGRADE_REQUIRED",
    minimum
      ? `Fitur ini tersedia mulai paket ${getPlan(minimum).name} (paket aktif: ${plan.name}). ` +
        "Upgrade di menu Paket & Billing."
      : `Fitur ini tidak tersedia pada paket ${plan.name}.`
  );
}
