"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
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

// Pages that resolve the restaurant (and apply its branding) themselves:
// the menu page (loadMenu), the QR table landing (/t) and the branch
// selector (/pilih-cabang). BrandingSync only needs to cover hard refreshes
// on the OTHER customer pages (/cart, /checkout, /payment/*, /order/*) —
// skipping these paths avoids a duplicate /api/public/restaurant fetch per
// load on exactly the pages the customer sees first.
const SELF_BRANDING_PREFIXES = ["/menu", "/t/", "/pilih-cabang"];

export function BrandingSync() {
  const { restaurantId, isHydrated } = useCart();
  const { applyBranding } = useBranding();
  const pathname = usePathname();

  useEffect(() => {
    if (!isHydrated || !restaurantId) return;
    if (SELF_BRANDING_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) {
      return;
    }
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
  }, [isHydrated, restaurantId, applyBranding, pathname]);

  return null;
}