"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  BRANDING_DEFAULT_COLORS,
  getContrastText,
  isValidBrandingColor,
  normalizeBrandingColor,
} from "@/lib/branding";

// ============================================================
// BrandingProvider — per-restaurant website branding.
//
// Holds the tenant's branding in React state and mirrors it onto CSS custom
// properties on <html> (--brand-primary / --brand-secondary / --brand-accent
// and their foregrounds). Tailwind theme colors (bg-brand-primary, ...) are
// mapped to these variables in globals.css, so every customer page picks up
// the theme without touching component styles individually.
//
// Foregrounds are computed from the color luminance (WCAG contrast) so a
// custom theme can never produce unreadable combinations. Colors are always
// validated #RRGGBB before being applied — arbitrary CSS never reaches the
// DOM.
//
// Usage: <BrandingProvider> wraps the customer layout; pages call
// applyBranding(...) once they know the restaurant (menu page, table page).
// Branding only changes on initial load / restaurant context change — no
// polling, no intervals.
// ============================================================

export interface Branding {
  siteName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export const BRANDING_FALLBACK: Branding = {
  siteName: "Restoran",
  logoUrl: null,
  primaryColor: BRANDING_DEFAULT_COLORS.primaryColor,
  secondaryColor: BRANDING_DEFAULT_COLORS.secondaryColor,
  accentColor: BRANDING_DEFAULT_COLORS.accentColor,
};

interface BrandingContextValue {
  branding: Branding;
  /**
   * Merge a partial branding payload into the current state and re-apply the
   * theme. Values are sanitized (colors validated + normalized, siteName
   * trimmed, logoUrl passed through as-is — it is server-validated).
   */
  applyBranding: (next: Partial<Branding>) => void;
}

const BrandingContext = createContext<BrandingContextValue | null>(null);

function sanitizeBranding(next: Partial<Branding>): Partial<Branding> {
  const out: Partial<Branding> = {};
  if (typeof next.siteName === "string") {
    out.siteName = next.siteName.trim() || BRANDING_FALLBACK.siteName;
  }
  if (next.logoUrl === null || typeof next.logoUrl === "string") {
    out.logoUrl = next.logoUrl;
  }
  for (const field of [
    "primaryColor",
    "secondaryColor",
    "accentColor",
  ] as const) {
    const value = next[field];
    if (typeof value === "string" && isValidBrandingColor(value)) {
      out[field] = normalizeBrandingColor(value);
    }
  }
  return out;
}

export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(BRANDING_FALLBACK);

  const applyBranding = useCallback((next: Partial<Branding>) => {
    setBranding((prev) => ({ ...prev, ...sanitizeBranding(next) }));
  }, []);

  // Apply the theme CSS variables whenever branding changes (including the
  // initial mount, which re-applies the defaults — a visual no-op).
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--brand-primary", branding.primaryColor);
    root.style.setProperty(
      "--brand-primary-foreground",
      getContrastText(branding.primaryColor)
    );
    root.style.setProperty("--brand-secondary", branding.secondaryColor);
    root.style.setProperty(
      "--brand-secondary-foreground",
      getContrastText(branding.secondaryColor)
    );
    root.style.setProperty("--brand-accent", branding.accentColor);
    root.style.setProperty(
      "--brand-accent-foreground",
      getContrastText(branding.accentColor)
    );
  }, [branding]);

  const value = useMemo(
    () => ({ branding, applyBranding }),
    [branding, applyBranding]
  );

  return (
    <BrandingContext.Provider value={value}>
      {children}
    </BrandingContext.Provider>
  );
}

export function useBranding(): BrandingContextValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) {
    throw new Error("useBranding must be used within a BrandingProvider");
  }
  return ctx;
}