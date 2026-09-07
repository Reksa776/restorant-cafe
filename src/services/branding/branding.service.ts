import { prisma } from "@/lib/prisma";
import {
  BRANDING_DEFAULT_COLORS,
  BRANDING_SITE_NAME_MAX_LENGTH,
  isValidBrandingColor,
  isValidBrandingLogoUrl,
  normalizeBrandingColor,
} from "@/lib/branding";
import { ValidationError } from "@/lib/errors";
import { brandingUploadService } from "@/services/upload/branding-upload.service";

// ============================================================
// Restaurant branding service — reads/writes RestaurantSettings with
// safe fallbacks (siteName → Restaurant.name, colors → default theme
// palette), so restaurants without a configuration keep working.
// ============================================================

export interface BrandingDto {
  siteName: string;
  logoUrl: string | null;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
}

export interface UpdateBrandingInput {
  siteName?: string | null;
  logoUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
  accentColor?: string | null;
}

/**
 * Shape of the persisted settings row subset used to build a branding DTO.
 */
export interface BrandingSettingsRow {
  siteName: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  accentColor: string | null;
}

/**
 * Build the public branding DTO with safe fallbacks: siteName → restaurant
 * name, colors → default palette. Pure so it can be shared by the admin API,
 * the public restaurant API and the table lookup without extra queries.
 */
export function resolveBranding(
  restaurantName: string,
  settings: BrandingSettingsRow | null | undefined
): BrandingDto {
  return {
    siteName: settings?.siteName?.trim() || restaurantName || "Restoran",
    logoUrl: settings?.logoUrl || null,
    primaryColor: settings?.primaryColor || BRANDING_DEFAULT_COLORS.primaryColor,
    secondaryColor:
      settings?.secondaryColor || BRANDING_DEFAULT_COLORS.secondaryColor,
    accentColor: settings?.accentColor || BRANDING_DEFAULT_COLORS.accentColor,
  };
}

export async function getBranding(
  restaurantId: string
): Promise<BrandingDto> {
  const restaurant = await prisma.restaurant.findUnique({
    where: { id: restaurantId },
    select: {
      name: true,
      settings: {
        select: {
          siteName: true,
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          accentColor: true,
        },
      },
    },
  });

  return resolveBranding(restaurant?.name || "Restoran", restaurant?.settings);
}

/**
 * Upsert branding configuration for a restaurant.
 *
 * Semantics:
 *  - undefined field → unchanged (partial updates are safe)
 *  - null field → explicit reset (colors → default, logo → removed,
 *    siteName → Restaurant.name)
 *  - colors must match ^#[0-9A-Fa-f]{6}$ (stored lowercase)
 *  - logoUrl must be a locally managed URL owned by THIS restaurant
 *    (tenant isolation — a restaurant can never point at another tenant's
 *    file), and replacing/removing a logo deletes the old physical file
 *    (best-effort, path-guarded).
 */
export async function updateBranding(
  restaurantId: string,
  input: UpdateBrandingInput
): Promise<BrandingDto> {
  // ---- Validate siteName ----
  let siteName: string | null | undefined;
  if (input.siteName !== undefined) {
    if (input.siteName === null) {
      siteName = null;
    } else {
      const trimmed = input.siteName.trim();
      if (trimmed.length > BRANDING_SITE_NAME_MAX_LENGTH) {
        throw new ValidationError(
          `Website name is too long (max ${BRANDING_SITE_NAME_MAX_LENGTH} characters)`
        );
      }
      siteName = trimmed || null;
    }
  }

  // ---- Validate colors ----
  const colorFields: Array<"primaryColor" | "secondaryColor" | "accentColor"> =
    ["primaryColor", "secondaryColor", "accentColor"];
  const normalizedColors: Partial<Record<(typeof colorFields)[number], string | null>> = {};
  for (const field of colorFields) {
    if (input[field] === undefined) continue;
    const value = input[field];
    if (value === null || value === "") {
      normalizedColors[field] = null; // reset to default
      continue;
    }
    if (!isValidBrandingColor(value)) {
      throw new ValidationError(
        `Invalid ${field}. Use #RRGGBB hex format (e.g. #111827).`
      );
    }
    normalizedColors[field] = normalizeBrandingColor(value);
  }

  // ---- Validate logoUrl ----
  let logoUrl: string | null | undefined;
  if (input.logoUrl !== undefined) {
    const value = (input.logoUrl ?? "").trim();
    if (value === "") {
      logoUrl = null;
    } else {
      if (!isValidBrandingLogoUrl(value, restaurantId)) {
        throw new ValidationError("Invalid logo URL");
      }
      logoUrl = value;
    }
  }

  // Load existing row (for logo replacement cleanup).
  const existing = await prisma.restaurantSettings.findUnique({
    where: { restaurantId },
  });

  const data: {
    siteName?: string | null;
    logoUrl?: string | null;
    primaryColor?: string | null;
    secondaryColor?: string | null;
    accentColor?: string | null;
  } = {};
  if (siteName !== undefined) data.siteName = siteName;
  if (logoUrl !== undefined) data.logoUrl = logoUrl;
  if (normalizedColors.primaryColor !== undefined)
    data.primaryColor = normalizedColors.primaryColor;
  if (normalizedColors.secondaryColor !== undefined)
    data.secondaryColor = normalizedColors.secondaryColor;
  if (normalizedColors.accentColor !== undefined)
    data.accentColor = normalizedColors.accentColor;

  await prisma.restaurantSettings.upsert({
    where: { restaurantId },
    create: { restaurantId, ...data },
    update: data,
  });

  // Replacement/removal cleanup: delete the old physical logo when it was
  // swapped or cleared. Best-effort — a missing file never fails the write.
  const oldUrl = existing?.logoUrl ?? null;
  const newUrl = logoUrl !== undefined ? logoUrl : oldUrl;
  if (oldUrl && newUrl !== oldUrl) {
    await brandingUploadService.deleteByUrl(oldUrl, restaurantId);
  }

  return getBranding(restaurantId);
}