import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import { AppError, ValidationError } from "@/lib/errors";
import {
  PRODUCT_IMAGE_EXT_BY_MIME,
  PRODUCT_IMAGE_MAX_BYTES,
  isAllowedImageMime,
  sniffProductImageMime,
  type ProductImageMime,
} from "@/lib/product-image";

// ============================================================
// Local filesystem storage for product images.
//
// Files live under <cwd>/uploads/products/<restaurantId>/ — a PRIVATE
// runtime directory, NOT <public>. Next.js production servers index the
// public/ folder at boot, so files written there at runtime would not be
// served until a restart. Instead the app serves these assets through the
// route handler at `src/app/uploads/products/[restaurantId]/[filename]/route.ts`
// which maps the public URL `/uploads/products/<restaurantId>/<uuid>.<ext>`
// to the storage file on every request.
//
// Runtime data must be persisted OUTSIDE the build/deploy artifact (docker
// volume / host dir mounted at <app>/uploads), never copied into an image.
//
// Security invariants:
//  - filenames are server-generated (UUID + extension from detected
//    magic bytes) — the user-supplied filename is NEVER used, so path
//    traversal / extension spoofing is impossible;
//  - MIME is validated by magic-byte sniffing, not the Content-Type;
//  - deletes are confined to the upload root (defense in depth);
//  - the serving route only streams files whose restaurant id + filename
//    match strict safe patterns under the upload root.
// ============================================================

export const PRODUCT_UPLOAD_ROOT = path.join(
  process.cwd(),
  "uploads",
  "products"
);

export const PRODUCT_UPLOAD_URL_PREFIX = "/uploads/products/";

function isManagedLocalUrl(url: string): boolean {
  return url.startsWith(PRODUCT_UPLOAD_URL_PREFIX);
}

export class ProductImageUploadService {
  /**
   * Validate a web `File` and persist it to the local upload directory.
   * Returns the publicly reachable URL plus metadata.
   * Throws AppError subclasses for consistent error responses.
   */
  async save(
    file: File,
    restaurantId: string
  ): Promise<{ url: string; mime: string; size: number }> {
    if (!file) {
      throw new ValidationError("No image file provided");
    }

    // 1. Size check FIRST — before reading the whole payload into memory.
    if (file.size > PRODUCT_IMAGE_MAX_BYTES) {
      throw new AppError(
        "Image exceeds maximum size",
        413,
        "IMAGE_TOO_LARGE"
      );
    }

    // 2. MIME from the (untrusted) Content-Type as a first cheap gate.
    if (!isAllowedImageMime(file.type)) {
      throw new AppError(
        "Unsupported image type",
        400,
        "UNSUPPORTED_IMAGE_TYPE"
      );
    }

    const bytes = new Uint8Array(await file.arrayBuffer());

    // 3. Authoritative MIME check — sniff magic bytes.
    const mime = sniffProductImageMime(bytes);
    if (!mime || !isAllowedImageMime(mime)) {
      throw new AppError(
        "Unsupported image type",
        400,
        "UNSUPPORTED_IMAGE_TYPE"
      );
    }

    // 4. Generate a safe, unique filename.
    const ext = PRODUCT_IMAGE_EXT_BY_MIME[mime as ProductImageMime];
    const filename = `${crypto.randomUUID()}.${ext}`;
    const absoluteDir = path.join(PRODUCT_UPLOAD_ROOT, restaurantId);

    try {
      await fs.mkdir(absoluteDir, { recursive: true });
      await fs.writeFile(path.join(absoluteDir, filename), bytes);
    } catch (error) {
      console.error("Failed to save uploaded image:", error);
      throw new AppError("Upload failed", 500, "UPLOAD_FAILED");
    }

    return {
      url: `${PRODUCT_UPLOAD_URL_PREFIX}${restaurantId}/${filename}`,
      mime,
      size: bytes.byteLength,
    };
  }

  /**
   * Best-effort removal of a locally stored product image. Only files under
   * our managed upload root are ever touched — external URLs (remote
   * hosting) are never deleted. Path-traversal is guarded twice.
   */
  async deleteByUrl(url: string | null | undefined): Promise<boolean> {
    if (!url || !isManagedLocalUrl(url)) {
      return false;
    }

    // Resolve the relative part against the upload root and confirm the
    // result still lives inside it before unlinking.
    const relativePart = url.slice(PRODUCT_UPLOAD_URL_PREFIX.length);
    const absolute = path.resolve(PRODUCT_UPLOAD_ROOT, relativePart);
    const rootWithSep = PRODUCT_UPLOAD_ROOT.endsWith(path.sep)
      ? PRODUCT_UPLOAD_ROOT
      : `${PRODUCT_UPLOAD_ROOT}${path.sep}`;

    if (absolute !== PRODUCT_UPLOAD_ROOT && !absolute.startsWith(rootWithSep)) {
      console.warn(`Refusing to delete image outside upload root: ${url}`);
      return false;
    }

    try {
      await fs.unlink(absolute);
      return true;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        // Log but never fail the business write — an orphaned file is
        // acceptable, a broken product update is not.
        console.warn(`Failed to delete old product image ${url}:`, error);
      }
      return false;
    }
  }
}

export const productImageUploadService = new ProductImageUploadService();
