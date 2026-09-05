// ============================================================
// Product image constants & validation helpers.
//
// This module is PURE (no node built-ins / fs) so it is safe to
// import from both server code (route handlers, services) and
// client components (admin product form).
// ============================================================

export const PRODUCT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const PRODUCT_IMAGE_MAX_MB = 5;

export const PRODUCT_IMAGE_ALLOWED_MIME = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type ProductImageMime = (typeof PRODUCT_IMAGE_ALLOWED_MIME)[number];

export function isAllowedImageMime(mime: string): mime is ProductImageMime {
  return (PRODUCT_IMAGE_ALLOWED_MIME as readonly string[]).includes(mime);
}

// Extension mapping — derived from the *detected* MIME, never from a
// user-supplied filename (which may be spoofed or malicious).
export const PRODUCT_IMAGE_EXT_BY_MIME: Record<ProductImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

// Column is VARCHAR(191) — hard cap stored URLs well below it.
export const PRODUCT_IMAGE_URL_MAX_LENGTH = 190;

/**
 * Detect the real image MIME from the file's magic bytes (first bytes).
 * The browser-sent Content-Type is never trusted on its own.
 * Returns null when the content is not a supported image.
 */
export function sniffProductImageMime(
  bytes: Uint8Array
): ProductImageMime | null {
  if (bytes.length < 12) {
    // Still check short-but-valid headers below where possible
  }

  // JPEG: FF D8 FF
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    return "image/png";
  }

  // GIF: "GIF87a" / "GIF89a"
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return "image/gif";
  }

  // WEBP: "RIFF" .... "WEBP"
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }

  return null;
}

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "::1",
  "[::1]",
]);

/**
 * True when the host is a loopback/self address (localhost, 127.0.0.0/8,
 * ::1). These are rejected for external product image URLs.
 */
function isLoopbackHost(host: string): boolean {
  if (LOOPBACK_HOSTS.has(host)) return true;
  if (/^127\./.test(host)) return true;
  return false;
}

/** Is the value a valid http(s) URL or a local upload path? */
export function isValidProductImageUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.length > PRODUCT_IMAGE_URL_MAX_LENGTH) return false;

  // Local uploaded asset (never user-controlled beyond the generated name).
  if (trimmed.startsWith("/uploads/products/")) {
    return !/[\s<>"']/.test(trimmed);
  }

  // External URL — http/https only (blocks javascript:, data:, blob:, file:,
  // ftp: etc.). NOTE: this is SYNTAX-only. The server NEVER fetches the URL
  // (SSRF-safe): it is stored and rendered by the customer's browser.
  // Loopback hosts are still rejected so an admin cannot point product
  // images at self/device-local addresses.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  if (!parsed.hostname || isLoopbackHost(parsed.hostname)) {
    return false;
  }
  return true;
}

/**
 * Normalize a user-supplied image value for storage.
 * Returns the trimmed value when valid, or an error message describing why
 * it is rejected (used for consistent 400 responses).
 */
export function normalizeProductImageUrl(
  value: string
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: "Invalid image URL" };
  }
  if (trimmed.length > PRODUCT_IMAGE_URL_MAX_LENGTH) {
    return { ok: false, error: "Image URL is too long (max 190 characters)" };
  }
  if (!isValidProductImageUrl(trimmed)) {
    return { ok: false, error: "Invalid image URL. Only http/https URLs or uploaded assets are allowed" };
  }
  return { ok: true, value: trimmed };
}
