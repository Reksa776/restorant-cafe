import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  Building2,
  Calculator,
  CalendarDays,
  CreditCard,
  QrCode,
  Receipt,
  Store,
} from "lucide-react";
import {
  PLAN_CATALOG,
  STARTER_TRIAL_DAYS,
  minimumPlanForFeature,
  type PlanCode,
  type PlanFeatureKey,
} from "@/lib/subscription";

// ============================================================
// SAAS LANDING — shared copy/derived data.
//
// Commercial numbers are NEVER duplicated here: prices, limits and add-on
// prices are read from PLAN_CATALOG (src/lib/subscription.ts), the same module
// /admin/billing uses. Feature badges are DERIVED from the plan catalog too, so
// a plan change can never leave the marketing page out of sync.
// ============================================================

const rawAppName = (process.env.NEXT_PUBLIC_APP_NAME ?? "").trim();
/** Marketing brand (env-configurable, sensible fallback). */
export const APP_NAME = rawAppName || "RestoPOS Cloud";

const rawRootDomain = (process.env.NEXT_PUBLIC_ROOT_DOMAIN ?? "")
  .trim()
  .replace(/^[a-z]+:\/\//i, "")
  .replace(/\/+$/, "");
/** Root domain used in the hero's example storefront address. */
export const ROOT_DOMAIN = rawRootDomain || "domainlo.com";

/** Example tenant address shown above the fold. */
export const EXAMPLE_STOREFRONT = `kopisenja.${ROOT_DOMAIN}`;

/** Seeded demo tenant (prisma/seed.ts) — lets prospects browse a real menu. */
export const DEMO_STORE_PATH = "/r/demo-resto";

/** Trial length comes from the billing catalog. */
export const TRIAL_LABEL = `Free Trial ${STARTER_TRIAL_DAYS} hari`;
export const TRIAL_CTA = `Coba Gratis ${STARTER_TRIAL_DAYS} Hari`;

/** `99000` → `Rp99.000` (same format as /admin/billing). */
export function formatRupiah(value: number): string {
  return `Rp${Number(value || 0).toLocaleString("id-ID")}`;
}

/** Compact form for the add-on summary (`59000` → `Rp59rb`). */
export function formatRupiahShort(value: number): string {
  if (value >= 1_000_000) {
    return `Rp${(value / 1_000_000).toLocaleString("id-ID", {
      maximumFractionDigits: 2,
    })}jt`;
  }
  if (value >= 1_000) return `Rp${Math.round(value / 1_000)}rb`;
  return formatRupiah(value);
}

export interface LandingFeature {
  title: string;
  description: string;
  icon: LucideIcon;
  /** Plan-gated capability key; the badge is derived from PLAN_CATALOG. */
  feature?: PlanFeatureKey;
  /** Tier for a capability that has no single PLAN_FEATURES key. */
  unlockAt?: PlanCode;
  /** Multi-branch: sold as a branch add-on (and fully unlocked on Enterprise). */
  addonBadge?: boolean;
}

export const LANDING_FEATURES: LandingFeature[] = [
  {
    title: "POS Kasir Cepat & Manajemen Shift",
    description:
      "Kasir sentuh untuk dine-in, take away, dan antar. Buka/tutup shift, hitung kas awal-akhir, dan cetak struk thermal langsung dari browser.",
    icon: Receipt,
  },
  {
    title: "QRIS & Virtual Account Otomatis (iPaymu)",
    description:
      "Pelanggan membayar dengan QRIS atau VA. Status pembayaran masuk otomatis lewat webhook, tanpa perlu konfirmasi manual satu per satu.",
    icon: CreditCard,
  },
  {
    title: "Self-Order QR Meja & Denah Meja Interaktif",
    description:
      "Tempel QR di meja, pelanggan memesan sendiri dari HP-nya. Pesanan langsung masuk dapur, lengkap dengan denah meja yang bisa diatur.",
    icon: QrCode,
    feature: "qrOrder",
  },
  {
    title: "Website Toko Subdomain Sendiri",
    description:
      "Toko online resto Anda langsung aktif di alamat sendiri, misalnya kopisenja.domainlo.com, siap dibagikan ke pelanggan tanpa biaya hosting tambahan.",
    icon: Store,
    unlockAt: "PRO",
  },
  {
    title: "Resep (BOM), Potong Bahan Baku & HPP Otomatis",
    description:
      "Setiap menu terhubung ke resepnya. Stok bahan baku terpotong otomatis saat terjual, dan HPP dihitung dengan metode rata-rata (WAC).",
    icon: Calculator,
    feature: "recipeHpp",
  },
  {
    title: "Laporan Laba Rugi (P&L) & Menu Engineering",
    description:
      "Lihat margin per menu, biaya bahan, pengeluaran operasional, dan laba rugi per periode — bukan cuma angka penjualan.",
    icon: BarChart3,
    feature: "accountingPl",
  },
  {
    title: "Reservasi Meja & Notifikasi WhatsApp Otomatis",
    description:
      "Terima reservasi meja dan kirim konfirmasi/pengingat ke pelanggan lewat WhatsApp otomatis, tanpa harus membalas chat satu per satu.",
    icon: CalendarDays,
    feature: "reservations",
  },
  {
    title: "Multi-Cabang & Laporan Konsolidasi",
    description:
      "Tambah kuota cabang kapan saja, bandingkan performa antar-outlet, dan lihat laporan konsolidasi seluruh cabang dalam satu layar.",
    icon: Building2,
    feature: "multiOutletReport",
  },
];

const BADGE_TONE = {
  starter: "ring-emerald-200 bg-emerald-50 text-emerald-700",
  pro: "ring-amber-200 bg-amber-50 text-amber-800",
  enterprise: "ring-indigo-200 bg-indigo-50 text-indigo-700",
} as const;

/**
 * Tier badge for a feature card, derived from the plan catalog:
 *   not gated            → "Termasuk Starter"
 *   gated on PRO/BASIC   → "Buka di <plan>"
 *   gated on ENTERPRISE  → "Buka di Enterprise"
 */
export function featureBadge(item: LandingFeature): {
  label: string;
  className: string;
} {
  if (item.addonBadge) {
    return {
      label: `Add-On Cabang / ${PLAN_CATALOG.ENTERPRISE.name}`,
      className: `ring-1 ${BADGE_TONE.enterprise}`,
    };
  }

  const code: PlanCode = item.feature
    ? minimumPlanForFeature(item.feature) ?? "ENTERPRISE"
    : item.unlockAt ?? "STARTER";

  if (code === "STARTER") {
    return {
      label: `Termasuk ${PLAN_CATALOG.STARTER.name}`,
      className: `ring-1 ${BADGE_TONE.starter}`,
    };
  }

  return {
    label: `Buka di ${PLAN_CATALOG[code].name}`,
    className:
      code === "ENTERPRISE"
        ? `ring-1 ${BADGE_TONE.enterprise}`
        : `ring-1 ${BADGE_TONE.pro}`,
  };
}

