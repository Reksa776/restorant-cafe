import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { brandingUploadService } from "@/services/upload/branding-upload.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

// Guard helper to detect multipart requests (used for 400 on invalid content type)
function isMultipartRequest(request: NextRequest): boolean {
  const contentType = request.headers.get("content-type") ?? "";
  return contentType.startsWith("multipart/form-data");
}

/**
 * POST /api/admin/uploads/branding
 *
 * Multipart upload of a restaurant logo (field name: `file`).
 * ADMIN-only. Validates size + real MIME (magic bytes) server-side and
 * persists the file to the tenant's branding upload directory. Returns the
 * public URL:
 *
 *   { success, message, data: { url, mime, size } }
 *
 * The caller stores `url` into branding via PUT /api/admin/settings/branding
 * — upload and save are separate steps (same contract as product images).
 */
export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();

    // Reject non-multipart requests early with 400 (instead of 500)
    if (!isMultipartRequest(request)) {
      return errorResponse(
        "Invalid request: multipart/form-data required",
        "INVALID_CONTENT_TYPE",
        400
      );
    }

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      throw new ValidationError("No logo file provided");
    }

    const result = await brandingUploadService.upload(file, restaurantId);

    return successResponse(result, "Logo uploaded successfully", 201);
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error uploading branding logo:", error);
    return errorResponse("Upload failed", "UPLOAD_FAILED", 500);
  }
}

/**
 * DELETE /api/admin/uploads/branding
 *
 * Removes the restaurant's current logo: deletes the physical file
 * (path-guarded, tenant-confined) and clears logoUrl in the database.
 * Idempotent — succeeds even when no logo is configured.
 */
export async function DELETE() {
  try {
    const { restaurantId } = await requireAdmin();

    const existing = await prisma.restaurantSettings.findUnique({
      where: { restaurantId },
      select: { logoUrl: true },
    });

    if (existing?.logoUrl) {
      await brandingUploadService.deleteByUrl(existing.logoUrl, restaurantId);
      await prisma.restaurantSettings.update({
        where: { restaurantId },
        data: { logoUrl: null },
      });
    }

    return successResponse(null, "Logo removed successfully");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error removing branding logo:", error);
    return errorResponse("Failed to remove logo", "INTERNAL_ERROR", 500);
  }
}
