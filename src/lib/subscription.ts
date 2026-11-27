// ============================================================
// SAAS PLAN CATALOG — single source of truth for commercial rules.
//
// PURE module (no Prisma / no Node APIs) so it can be imported by the billing
// UI, the API routes and the server-side guards. Amounts are ALWAYS computed
// from here on the server — a client-supplied price is never trusted.
//
// Branch model: every plan includes ONE main branch. Paid plans can buy
// branch add-ons; the effective limit is `1 + extraBranchesCount`.
// ============================================================

export const PLAN_CODES = ["STARTER", "BASIC", "PRO", "ENTERPRISE"] as const;
export type PlanCode = (typeof PLAN_CODES)[number];

export const BILLING_CYCLES = ["MONTHLY", "YEARLY"] as const;
export type BillingCycleCode = (typeof BILLING_CYCLES)[number];

export const INVOICE_TYPES = ["PLAN_UPGRADE", "BRANCH_ADDON", "RENEWAL"] as const;
export type InvoiceType = (typeof INVOICE_TYPES)[number];

export type PlanFeatureKey =
  | "qrOrder"
  | "floorLayout"
  | "recipeHpp"
  | "purchasing"
  | "accountingPl"
  | "reservations"
  | "whatsappNotif"
  | "multiOutletReport"
  | "customBranding";

/** Feature keys with human labels (used by guards' error messages + UI). */
export const PLAN_FEATURES: ReadonlyArray<{
  key: PlanFeatureKey;
  label: string;
}> = [
  { key: "qrOrder", label: "QR Self-Order Meja" },
  { key: "floorLayout", label: "Floor Layout" },
  { key: "recipeHpp", label: "Resep (BOM) & HPP Otomatis (WAC)" },
  { key: "purchasing", label: "Purchasing & Supplier" },
  { key: "accountingPl", label: "Laporan Laba Rugi (P&L)" },
  { key: "reservations", label: "Reservasi Meja" },
  { key: "whatsappNotif", label: "Notifikasi WhatsApp" },
  { key: "multiOutletReport", label: "Laporan Konsolidasi Multi-Cabang" },
  { key: "customBranding", label: "Custom Branding (Warna/Logo)" },
];

export const STARTER_TRIAL_DAYS = 14;
export const STARTER_MONTHLY_ORDER_LIMIT = 150;
export const MAX_ADDON_BRANCHES_PER_INVOICE = 10;

type FeatureSet = Record<PlanFeatureKey, boolean>;

function features(enabled: readonly PlanFeatureKey[]): FeatureSet {
  const set = new Set<PlanFeatureKey>(enabled);
  return Object.fromEntries(
    PLAN_FEATURES.map(({ key }) => [key, set.has(key)])
  ) as FeatureSet;
}

export interface PlanDefinition {
  code: PlanCode;
  name: string;
  tagline: string;
  /** Rupiah, integer. 0 for the free trial plan. */
  monthlyPrice: number;
  yearlyPrice: number;
  /** Rupiah per extra branch, per cycle. 0 when add-ons are not sold. */
  addonBranchMonthly: number;
  addonBranchYearly: number;
  canBuyBranchAddon: boolean;
  /** null = unlimited */
  maxTransactionsPerMonth: number | null;
  /** null = unlimited */
  maxStaff: number | null;
  features: FeatureSet;
  highlights: string[];
}

export const PLAN_CATALOG: Record<PlanCode, PlanDefinition> = {
  STARTER: {
    code: "STARTER",
    name: "Starter",
    tagline: "Free trial 14 hari untuk mencoba seluruh alur operasional dasar.",
    monthlyPrice: 0,
    yearlyPrice: 0,
    addonBranchMonthly: 0,
    addonBranchYearly: 0,
    canBuyBranchAddon: false,
    maxTransactionsPerMonth: STARTER_MONTHLY_ORDER_LIMIT,
    maxStaff: 2,
    features: features([]),
    highlights: [
      "1 cabang utama",
      "150 transaksi/bulan",
      "Maks. 2 akun staf",
      "POS Kasir & QRIS/VA iPaymu",
      "Shift & Buku Kas",
      "Stok produk dasar",
    ],
  },
  BASIC: {
    code: "BASIC",
    name: "Basic",
    tagline: "Operasional harian tanpa batas transaksi.",
    monthlyPrice: 99_000,
    yearlyPrice: 990_000,
    addonBranchMonthly: 59_000,
    addonBranchYearly: 590_000,
    canBuyBranchAddon: true,
    maxTransactionsPerMonth: null,
    maxStaff: 5,
    features: features([]),
    highlights: [
      "1 cabang utama (+ Add-On cabang)",
      "Transaksi unlimited",
      "Maks. 5 akun staf",
      "Semua fitur Starter",
      "Laporan penjualan lengkap & export CSV",
    ],
  },
  PRO: {
    code: "PRO",
    name: "Pro",
    tagline: "Paket terlaris untuk kafe dengan dapur & meja sendiri.",
    monthlyPrice: 169_000,
    yearlyPrice: 1_690_000,
    addonBranchMonthly: 89_000,
    addonBranchYearly: 890_000,
    canBuyBranchAddon: true,
    maxTransactionsPerMonth: null,
    maxStaff: null,
    features: features([
      "qrOrder",
      "floorLayout",
      "recipeHpp",
      "purchasing",
      "accountingPl",
      "reservations",
      "whatsappNotif",
    ]),
    highlights: [
      "1 cabang utama (+ Add-On cabang)",
      "Transaksi & staf unlimited",
      "Semua fitur Basic",
      "QR self-order meja & floor layout",
      "Resep (BOM) & HPP otomatis (WAC)",
      "Purchasing & supplier",
      "Laporan P&L & menu engineering",
      "Reservasi meja & notifikasi WhatsApp",
    ],
  },
  ENTERPRISE: {
    code: "ENTERPRISE",
    name: "Enterprise",
    tagline: "Kontrol penuh multi-cabang dengan branding sendiri.",
    monthlyPrice: 249_000,
    yearlyPrice: 2_490_000,
    addonBranchMonthly: 119_000,
    addonBranchYearly: 1_190_000,
    canBuyBranchAddon: true,
    maxTransactionsPerMonth: null,
    maxStaff: null,
    features: features(PLAN_FEATURES.map(({ key }) => key)),
    highlights: [
      "1 cabang utama (+ Add-On cabang)",
      "Transaksi & staf unlimited",
      "Semua fitur Pro",
      "Laporan konsolidasi multi-cabang",
      "Custom branding warna & logo penuh",
    ],
  },
};

export const PLAN_ORDER: readonly PlanCode[] = PLAN_CODES;

export function isPlanCode(value: unknown): value is PlanCode {
  return (
    typeof value === "string" &&
    (PLAN_CODES as readonly string[]).includes(value)
  );
}

export function isBillingCycle(value: unknown): value is BillingCycleCode {
  return (
    typeof value === "string" &&
    (BILLING_CYCLES as readonly string[]).includes(value)
  );
}

export function getPlan(code: PlanCode): PlanDefinition {
  return PLAN_CATALOG[code];
}

export function planHasFeature(
  code: PlanCode,
  feature: PlanFeatureKey
): boolean {
  return PLAN_CATALOG[code].features[feature] === true;
}

/** Cheapest plan that includes `feature` (null = no plan sells it). */
export function minimumPlanForFeature(
  feature: PlanFeatureKey
): PlanCode | null {
  for (const code of PLAN_ORDER) {
    if (PLAN_CATALOG[code].features[feature]) return code;
  }
  return null;
}

export function planPrice(code: PlanCode, cycle: BillingCycleCode): number {
  const plan = PLAN_CATALOG[code];
  return cycle === "YEARLY" ? plan.yearlyPrice : plan.monthlyPrice;
}

export function addonBranchPrice(
  code: PlanCode,
  cycle: BillingCycleCode
): number {
  const plan = PLAN_CATALOG[code];
  return cycle === "YEARLY"
    ? plan.addonBranchYearly
    : plan.addonBranchMonthly;
}

/**
 * Server-authoritative invoice amount.
 *
 * PLAN_UPGRADE / RENEWAL → price of `planCode` for the cycle.
 * BRANCH_ADDON           → add-on price of the CURRENT plan × quantity
 *                          (`planCode` is the current plan in that case).
 */
export function computeCheckoutAmount(input: {
  type: InvoiceType;
  planCode: PlanCode;
  billingCycle: BillingCycleCode;
  addonBranchesQty?: number;
}): number {
  if (input.type === "BRANCH_ADDON") {
    const qty = Math.max(1, Math.trunc(input.addonBranchesQty ?? 1));
    return addonBranchPrice(input.planCode, input.billingCycle) * qty;
  }
  return planPrice(input.planCode, input.billingCycle);
}

/** Effective branch quota for a subscription row. */
export function branchQuota(extraBranchesCount: number): number {
  return 1 + Math.max(0, extraBranchesCount);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

/** Whole days left until `end` (0 when already past). */
export function daysRemaining(end: Date, now: Date = new Date()): number {
  const diff = end.getTime() - now.getTime();
  return diff <= 0 ? 0 : Math.ceil(diff / (24 * 60 * 60 * 1000));
}
