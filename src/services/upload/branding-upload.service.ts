import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { AppError, ValidationError } from "@/lib/errors";
import {
  BRANDING_LOGO_MAX_BYTES,
  BRANDING_LOGO_EXT_BY_MIME,
  isAllowedBrandingLogoMime,
  sniffBrandingLogoMime,
  isValidBrandingLogoUrl,
  type BrandingLogoMime,
} from "@/lib/branding";

// ============================================================
// Local filesystem storage for restaurant branding logos.
//
// Files live under BRANDING_UPLOAD_ROOT/<restaurantId>/ — a PRIVATE runtime
// directory, served through the route handler at
// `src/app/uploads/branding/[restaurantId]/[filename]/route.ts` which maps
// the public URL `/uploads/branding/<restaurantId>/<uuid>.<ext>` to the
// storage file on every request (same pattern as product images, but in a
// separate directory so logos never collide with product files).
//
// Runtime data must be persisted OUTSIDE the build/deploy artifact. Local
// development should point BRANDING_UPLOAD_DIR at a gitignored path, e.g.
//   BRANDING_UPLOAD_DIR=".runtime-data/uploads/branding"
// Production/Docker keeps the default (<cwd>/uploads/branding — a mounted
// volume), so uploads survive PM2/Next restarts and builds.
//
// Security invariants (same as product images):
//  - filenames are server-generated (UUID + extension from detected magic
//    bytes) — the user-supplied filename is never used;
//  - MIME is validated by magic-byte sniffing, not the Content-Type;
//  - deletes require the exact tenant's managed URL and are confined to the
//    upload root (path traversal impossible);
//  - the serving route only streams files whose restaurant id + filename
//    match strict safe patterns under the upload root.
// ============================================================

function resolveBrandingUploadRoot(): string {
  const configured = process.env.BRANDING_UPLOAD_DIR?.trim();
  if (!configured) {
    return path.join(process.cwd(), "uploads", "branding");
  }
  return path.resolve(configured);
}

export const BRANDING_UPLOAD_ROOT = resolveBrandingUploadRoot();

export const BRANDING_UPLOAD_URL_PREFIX = "/uploads/branding/";

export class BrandingUploadService {
  /**
   * Upload a logo (multipart). Returns the public URL to store in
   * RestaurantSettings.logoUrl. Only ADMIN sessions are authorized.
   */
  async upload(
    file: File,
    restaurantId: string
  ): Promise<{ url: string; mime: string; size: number }> {
    if (!file) {
      throw new ValidationError("No logo file provided");
    }

    // Size check FIRST — before reading the whole payload into memory.
    if (file.size > BRANDING_LOGO_MAX_BYTES) {
      throw new AppError(
        `Logo exceeds maximum size of ${BRANDING_LOGO_MAX_BYTES / (1024 * 1024)} MB`,
        413,
        "LOGO_TOO_LARGE"
      );
    }

    // MIME from the (untrusted) Content-Type as a first cheap gate.
    if (!isAllowedBrandingLogoMime(file.type)) {
      throw new AppError(
        "Unsupported logo type. Use PNG, JPEG, or WebP.",
        400,
        "UNSUPPORTED_LOGO_TYPE"
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // Authoritative MIME check — sniff magic bytes.
    const mime = sniffBrandingLogoMime(bytes);
    if (!mime || !isAllowedBrandingLogoMime(mime)) {
      throw new AppError(
        "Unsupported logo type. Use PNG, JPEG, or WebP.",
        400,
        "UNSUPPORTED_LOGO_TYPE"
      );
    }

    // Generate a safe, unique filename.
    const ext = BRANDING_LOGO_EXT_BY_MIME[mime as BrandingLogoMime];
    const filename = `${crypto.randomUUID()}.${ext}`;
    const absoluteDir = path.join(BRANDING_UPLOAD_ROOT, restaurantId);

    try {
      await fs.mkdir(absoluteDir, { recursive: true });
      await fs.writeFile(path.join(absoluteDir, filename), bytes);
    } catch (error) {
      console.error("Failed to save uploaded logo:", error);
      throw new AppError("Upload failed", 500, "UPLOAD_FAILED");
    }

    return {
      url: `${BRANDING_UPLOAD_URL_PREFIX}${restaurantId}/${filename}`,
      mime,
      size: bytes.byteLength,
    };
  }

  /**
   * Best-effort removal of a locally stored logo. Only files under our
   * managed upload root are ever touched, and the URL must belong to the
   * given restaurant (tenant isolation). Path-traversal is guarded twice.
   */
  async deleteByUrl(
    url: string | null | undefined,
    restaurantId: string
  ): Promise<boolean> {
    if (!url || !isValidBrandingLogoUrl(url, restaurantId)) {
      return false;
    }

    const relativePart = url.slice(BRANDING_UPLOAD_URL_PREFIX.length);
    const absolute = path.resolve(BRANDING_UPLOAD_ROOT, relativePart);
    const rootWithSep = BRANDING_UPLOAD_ROOT.endsWith(path.sep)
      ? BRANDING_UPLOAD_ROOT
      : `${BRANDING_UPLOAD_ROOT}${path.sep}`;

    if (absolute !== BRANDING_UPLOAD_ROOT && !absolute.startsWith(rootWithSep)) {
      console.warn(`Refusing to delete logo outside upload root: ${url}`);
      return false;
    }

    try {
      await fs.unlink(absolute);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        // Log but never fail the business write — an orphaned file is
        // acceptable, a broken branding update is not.
        console.warn(`Failed to delete old logo ${url}:`, error);
      }
      return false;
    }
  }
}

export const brandingUploadService = new BrandingUploadService();
