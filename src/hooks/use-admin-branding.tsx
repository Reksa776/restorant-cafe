"use client";

import { useCallback, useEffect, type ReactNode } from "react";
import { BrandingProvider, useBranding } from "@/hooks/use-branding";

// localStorage key used only as a cross-tab sync channel (storage event).
// Branding persists in RestaurantSettings — localStorage is NEVER read as a
// source of truth, it only carries the latest saved payload between tabs.
const ADMIN_BRANDING_STORAGE_KEY = "admin.branding.latest";

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
        // requireRoles-guarded (ADMIN + CASHIER) and returns the resolved
        // branding DTO with safe fallbacks (siteName → Restaurant.name,
        // colors → default).
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

  // Cross-tab consistency WITHOUT polling: when the admin saves branding in
  // another tab, that tab writes the payload here; every open admin/kasir
  // tab applies it on the storage event. Fallback = the provider's initial
  // fetch (any reload / next mount re-reads the DB anyway).
  const handleStorage = useCallback(
    (e: StorageEvent) => {
      if (e.key !== ADMIN_BRANDING_STORAGE_KEY || !e.newValue) return;
      try {
        const branding = JSON.parse(e.newValue);
        if (branding && typeof branding === "object") {
          applyBranding(branding);
        }
      } catch {
        // Malformed payload — ignore; the next reload re-fetches from the DB.
      }
    },
    [applyBranding]
  );

  useEffect(() => {
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, [handleStorage]);

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
