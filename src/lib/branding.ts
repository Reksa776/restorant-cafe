// ============================================================
// Website branding — constants & validation helpers.
//
// This module is PURE (no node built-ins / fs) so it is safe to
// import from both server code (route handlers, services) and
// client components (admin settings form, customer theme
// provider). All color values that ever reach the DOM are
// validated against ^#[0-9A-Fa-f]{6}$ here — never arbitrary
// CSS from the database.
// ============================================================

import { sniffProductImageMime } from "@/lib/product-image";

/** Strict hex color accepted for theme colors (normalized to lowercase). */
export const BRANDING_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;

/** Default theme colors — the application's existing neutral palette. */
export const BRANDING_DEFAULT_COLORS = {
  primaryColor: "#111827", // gray-900 — primary CTAs / brand
  secondaryColor: "#f3f4f6", // gray-100 — secondary buttons
  accentColor: "#e5e7eb", // gray-200 — hover emphasis
} as const;

export type BrandingColorName = keyof typeof BRANDING_DEFAULT_COLORS;

/** Max length of the website/brand display name. */
export const BRANDING_SITE_NAME_MAX_LENGTH = 80;

/** Logo upload limits — small files only (PNG/JPEG/WebP, max 2 MB). */
export const BRANDING_LOGO_MAX_BYTES = 2 * 1024 * 1024; // 2 MB
export const BRANDING_LOGO_MAX_MB = 2;

export const BRANDING_LOGO_ALLOWED_MIME = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export type BrandingLogoMime = (typeof BRANDING_LOGO_ALLOWED_MIME)[number];

export function isAllowedBrandingLogoMime(
  mime: string
): mime is BrandingLogoMime {
  return (BRANDING_LOGO_ALLOWED_MIME as readonly string[]).includes(mime);
}

/** Extension mapping — derived from the *detected* MIME, never the client. */
export const BRANDING_LOGO_EXT_BY_MIME: Record<BrandingLogoMime, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/**
 * Detect the real logo MIME from magic bytes. Reuses the generic image
 * sniffer and rejects GIF (logos are PNG/JPEG/WebP only). Returns null when
 * the content is not an allowed image.
 */
export function sniffBrandingLogoMime(
  bytes: Uint8Array
): BrandingLogoMime | null {
  const mime = sniffProductImageMime(bytes);
  if (!mime || !isAllowedBrandingLogoMime(mime)) {
    return null;
  }
  return mime;
}

/** True when the value is a valid #RRGGBB hex color (any case). */
export function isValidBrandingColor(value: string): boolean {
  return BRANDING_COLOR_REGEX.test(value);
}

/** Normalize a validated hex color to lowercase (#RRGGBB). */
export function normalizeBrandingColor(value: string): string {
  return value.toLowerCase();
}

/**
 * Pick a readable foreground (#ffffff or the app's near-black #111827) for a
 * given #RRGGBB background, using WCAG relative luminance. Prevents custom
 * themes from producing unreadable combinations (e.g. white text on white).
 */
export function getContrastText(hex: string): string {
  const match = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(
    hex
  );
  if (!match) {
    // Unknown value → assume a dark background (white foreground).
    return "#ffffff";
  }
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(parseInt(match[1], 16));
  const g = toLinear(parseInt(match[2], 16));
  const b = toLinear(parseInt(match[3], 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.45 ? "#111827" : "#ffffff";
}

/**
 * True when the value is a locally managed branding logo URL belonging to the
 * given restaurant: /uploads/branding/<restaurantId>/<uuid>.<png|jpg|webp>.
 * Filenames are server-generated (UUID), so this is a strict structural
 * check — arbitrary URLs or cross-tenant paths are rejected.
 */
export function isValidBrandingLogoUrl(
  url: string,
  restaurantId: string
): boolean {
  if (!/^[A-Za-z0-9]+$/.test(restaurantId)) {
    return false;
  }
  const prefix = `/uploads/branding/${restaurantId}/`;
  if (!url.startsWith(prefix)) {
    return false;
  }
  const filename = url.slice(prefix.length);
  return /^[0-9a-fA-F-]{36}\.(png|jpg|webp)$/.test(filename);
}