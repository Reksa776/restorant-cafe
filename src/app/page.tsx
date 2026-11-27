import type { Metadata } from "next";
import FeatureSection from "@/components/landing/feature-section";
import FaqSection from "@/components/landing/faq-section";
import HeroSection from "@/components/landing/hero-section";
import HowItWorksSection from "@/components/landing/how-it-works-section";
import LandingFooter from "@/components/landing/landing-footer";
import LandingNavbar from "@/components/landing/landing-navbar";
import PricingSection from "@/components/landing/pricing-section";
import { APP_NAME, TRIAL_LABEL } from "@/components/landing/landing-data";

// ============================================================
// "/" — SAAS MARKETING & ONBOARDING LANDING PAGE (main domain only).
//
// Tenant storefronts never reach this page: `src/middleware.ts` rewrites
// `<slug>.<ROOT_DOMAIN>/` to `/menu` BEFORE routing, so a merchant subdomain
// always renders its own storefront. On the main domain (or an IP host, where
// there is no tenant subdomain) this landing page is shown instead of forcing
// a redirect to /login or /menu.
//
// Fully static: no cookies, no headers(), no searchParams — cheap to render on
// a small VPS. All commercial numbers come from PLAN_CATALOG.
// ============================================================

export const metadata: Metadata = {
  title: `${APP_NAME} — Kasir, QR Order Meja & Stok Bahan Baku Resto`,
  description: `POS restoran multi-cabang dengan subdomain otomatis, pembayaran QRIS, QR self-order meja, resep & HPP, serta laporan laba rugi. ${TRIAL_LABEL} untuk akun baru.`,
};

export default function HomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      <LandingNavbar />
      <main className="flex-1">
        <HeroSection />
        <FeatureSection />
        <HowItWorksSection />
        <PricingSection />
        <FaqSection />
      </main>
      <LandingFooter />
    </div>
  );
}
