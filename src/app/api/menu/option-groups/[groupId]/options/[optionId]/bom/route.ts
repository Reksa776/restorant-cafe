import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, requireRoles } from "@/lib/auth-helpers";
import { SaveBomSchema } from "@/services/menu/menu-bom.types";

// ============================================================
// H4.1 — OPTION MINI-BOM
//
// GET    /api/menu/option-groups/[groupId]/options/[optionId]/bom
//   Composition of ONE option selection (no WAC/cost/stock fields).
//   ADMIN + CASHIER (read-only, mirrors the recipe route).
// PUT    .../bom   — full replace (ADMIN). Body: { items: [{ingredientId, quantity, unit}] }
// DELETE .../bom   — clears all lines; ?ingredientId= removes a single line (ADMIN).
//
// Option selection quantity is implicitly 1 — H4.1 stores composition only
// and never invents multi-quantity option selection.
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; optionId: string }> }
) {
  try {
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const { groupId, optionId } = await params;
    const items = await menuService.getOptionBom(optionId, groupId, restaurantId);
    return successResponse({ optionId, items });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching option BOM:", error);
    return errorResponse("Gagal memuat komposisi bahan", "INTERNAL_ERROR", 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; optionId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { groupId, optionId } = await params;
    const body = await request.json();
    const parsed = SaveBomSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const items = await menuService.saveOptionBom(
      optionId,
      groupId,
      restaurantId,
      parsed.data
    );
    return successResponse({ optionId, items }, "Komposisi bahan berhasil disimpan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error saving option BOM:", error);
    return errorResponse("Gagal menyimpan komposisi bahan", "INTERNAL_ERROR", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ groupId: string; optionId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { groupId, optionId } = await params;
    const { searchParams } = new URL(request.url);
    const ingredientId = searchParams.get("ingredientId");
    if (ingredientId) {
      await menuService.deleteOptionBomLine(optionId, groupId, restaurantId, ingredientId);
    } else {
      await menuService.deleteOptionBom(optionId, groupId, restaurantId);
    }
    return successResponse(null, "Komposisi bahan berhasil dihapus");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deleting option BOM:", error);
    return errorResponse("Gagal menghapus komposisi bahan", "INTERNAL_ERROR", 500);
  }
}
