"use client";

import { useEffect, type ReactNode } from "react";
import { BrandingProvider, useBranding } from "@/hooks/use-branding";

// ============================================================
// AdminBrandingProvider — apply the SAME restaurant website
// branding (RestaurantSettings → resolveBranding) inside the
// Admin/Dashboard/Kasir shell.
//
// This is NOT a second theme system: it wraps the existing
// BrandingProvider and feeds it from the existing authenticated
// GET /api/admin/settings/branding endpoint (requireRoles —
// ADMIN and CASHIER share the restaurant's branding).
//
// Tenant security: restaurantId is derived from the staff session
// server-side — no ?restaurantId= / x-restaurant-id input is
// honored here, so a staff member can only ever receive their own
// restaurant's branding.
//
// Dynamic updates: the settings page calls applyBranding(...)
// (from the same BrandingProvider context) right after a
// successful save — the whole admin shell re-themes instantly
// without a rebuild, and the next hard refresh reads the persisted
// settings through this provider. No polling, no per-page fetch.
// ============================================================

function AdminBrandingSync() {
  const { applyBranding } = useBranding();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // The shared axios instance (staff session cookie). The endpoint is
        // requireRoles-guarded and returns the resolved branding DTO with
        // safe fallbacks (siteName → Restaurant.name, colors → default).
        const { default: api } = await import("@/lib/axios");
        const res = await api.get("/admin/settings/branding");
        const branding = res.data?.data?.branding;
        if (alive && branding) {
          applyBranding({
            siteName: branding.siteName,
            logoUrl: branding.logoUrl,
            primaryColor: branding.primaryColor,
            secondaryColor: branding.secondaryColor,
            accentColor: branding.accentColor,
          });
        }
      } catch {
        // Unauthenticated (login page) or transient failure — the existing
        // fallback theme (BRANDING_FALLBACK) stays applied. Non-blocking.
      }
    })();
    return () => {
      alive = false;
    };
  }, [applyBranding]);

  return null;
}

export function AdminBrandingProvider({ children }: { children: ReactNode }) {
  return (
    <BrandingProvider>
      <AdminBrandingSync />
      {children}
    </BrandingProvider>
  );
}
