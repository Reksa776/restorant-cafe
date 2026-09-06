import { NextRequest } from "next/server";
import { productImageUploadService } from "@/services/upload/product-image-upload.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin } from "@/lib/auth-helpers";

/**
 * POST /api/admin/uploads/product-image
 *
 * Multipart upload of a product image (field name: `file`).
 * ADMIN-only. Validates size + real MIME (magic bytes) server-side and
 * persists the file to the local upload directory. Returns the public URL:
 *
 *   { success, message, data: { url, mime, size } }
 *
 * The caller stores `url` into Product.imageUrl via the regular JSON
 * create/update endpoints — this keeps the existing product CRUD contract
 * untouched (backward compatible).
 */
export async function POST(request: NextRequest) {
  try {
    const { restaurantId } = await requireAdmin();

    const formData = await request.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string") {
      throw new ValidationError("No image file provided");
    }

    const result = await productImageUploadService.save(file, restaurantId);

    return successResponse(
      result,
      "Image uploaded successfully",
      201
    );
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error uploading product image:", error);
    return errorResponse("Upload failed", "UPLOAD_FAILED", 500);
  }
}
