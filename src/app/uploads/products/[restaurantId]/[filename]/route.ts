import { promises as fs } from "fs";
import path from "path";
import { NextRequest, NextResponse } from "next/server";
import {
  PRODUCT_UPLOAD_ROOT,
  PRODUCT_UPLOAD_URL_PREFIX,
} from "@/services/upload/product-image-upload.service";

/**
 * GET /uploads/products/:restaurantId/:filename
 *
 * Public read-only serving of locally uploaded product images. Storage is a
 * PRIVATE runtime directory (NOT Next's public/ folder, which is indexed at
 * server boot — runtime files would be invisible until a restart). This route
 * reads the file from disk on every request so uploads are served immediately
 * in dev, `next start`, PM2 and standalone modes.
 *
 * Security:
 *  - both params are validated against strict safe patterns;
 *  - the resolved path is confined under PRODUCT_UPLOAD_ROOT;
 *  - content-type is derived from the extension (jpeg/png/webp/gif only);
 *  - never lists, mutates or executes anything.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ restaurantId: string; filename: string }> }
) {
  try {
    const { restaurantId, filename } = await params;

    // Strict, safe shapes only (CUID-ish restaurant ids + uuid.ext).
    if (!/^[A-Za-z0-9]+$/.test(restaurantId)) {
      return notFound();
    }
    const match = /^([0-9a-fA-F-]{36})\.(jpg|png|webp|gif)$/.exec(filename);
    if (!match) {
      return notFound();
    }

    // Confine to the upload root (defense in depth; ids above cannot contain
    // separators, but resolve + prefix check costs nothing).
    const absolute = path.resolve(PRODUCT_UPLOAD_ROOT, restaurantId, filename);
    const rootWithSep = PRODUCT_UPLOAD_ROOT.endsWith(path.sep)
      ? PRODUCT_UPLOAD_ROOT
      : `${PRODUCT_UPLOAD_ROOT}${path.sep}`;
    if (!absolute.startsWith(rootWithSep)) {
      return notFound();
    }

    const mimeByExt: Record<string, string> = {
      jpg: "image/jpeg",
      png: "image/png",
      webp: "image/webp",
      gif: "image/gif",
    };
    const contentType = mimeByExt[match[2]];
    if (!contentType) return notFound();

    const file = await fs.readFile(absolute);

    return new NextResponse(new Uint8Array(file), {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(file.byteLength),
        // Names are content-unique UUIDs → safe to cache forever.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      },
    });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return notFound();
    }
    console.error("Error serving product image:", error);
    return new NextResponse("Internal server error", { status: 500 });
  }
}

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

// Keep the URL prefix import referenced so the contract stays obvious if the
// constant ever changes.
export const PRODUCT_IMAGE_SERVE_PREFIX = PRODUCT_UPLOAD_URL_PREFIX;
