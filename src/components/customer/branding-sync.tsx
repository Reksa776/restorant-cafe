"use client";

import { useEffect } from "react";
import api from "@/lib/axios";
import { useCart } from "@/hooks/use-cart";
import { useBranding } from "@/hooks/use-branding";

// ============================================================
// BrandingSync — apply the restaurant's website branding once the
// customer's restaurant is known (persisted cart context).
//
// Only /menu and /t fetch branding today; /cart, /checkout,
// /payment/*, /order/* and /pilih-cabang relied on client-side
// navigation to inherit it — a hard refresh showed the fallback
// theme ("Restoran" + default gray). This component closes that
// gap: ONE fetch per restaurant per page load, applied through the
// existing BrandingProvider (no new theme system).
//
// The module-level Set keeps the fetch idempotent across client-
// side navigation (the layout never remounts), so a restaurant's
// branding is fetched at most once per load even though every
// customer page renders this component.
// ============================================================

const brandingFetchedFor = new Set<string>();

export function BrandingSync() {
  const { restaurantId, isHydrated } = useCart();
  const { applyBranding } = useBranding();

  useEffect(() => {
    if (!isHydrated || !restaurantId) return;
    if (brandingFetchedFor.has(restaurantId)) return;
    brandingFetchedFor.add(restaurantId);

    let cancelled = false;
    (async () => {
      try {
        const res = await api.get("/public/restaurant", {
          params: { id: restaurantId },
        });
        const branding = res.data?.data?.branding;
        if (!cancelled && branding) {
          applyBranding({
            siteName: branding.siteName,
            logoUrl: branding.logoUrl,
            primaryColor: branding.primaryColor,
            secondaryColor: branding.secondaryColor,
            accentColor: branding.accentColor,
          });
        }
      } catch {
        // Transient failure — allow a later mount to retry.
        brandingFetchedFor.delete(restaurantId);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isHydrated, restaurantId, applyBranding]);

  return null;
}