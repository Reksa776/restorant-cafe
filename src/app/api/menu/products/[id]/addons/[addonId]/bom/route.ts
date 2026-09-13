import { NextRequest } from "next/server";
import { menuService } from "@/services/menu/menu.service";
import { successResponse, errorResponse } from "@/lib/api-response";
import { AppError, ValidationError } from "@/lib/errors";
import { requireAdmin, requireRoles } from "@/lib/auth-helpers";
import { SaveBomSchema } from "@/services/menu/menu-bom.types";

// ============================================================
// H4.1 — ADDON MINI-BOM
//
// GET    /api/menu/products/[id]/addons/[addonId]/bom
//   Composition of ONE addon unit (no WAC/cost/stock fields).
//   ADMIN + CASHIER (read-only, mirrors the recipe route).
// PUT    .../bom   — full replace (ADMIN). Body: { items: [{ingredientId, quantity, unit}] }
// DELETE .../bom   — clears all lines; ?ingredientId= removes a single line (ADMIN).
//
// Composition only: pricing/HPP/COGS/inventory are untouched (H4.2+).
// ============================================================

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  try {
    const { restaurantId } = await requireRoles(["ADMIN", "CASHIER"]);
    const { id, addonId } = await params;
    const items = await menuService.getAddonBom(addonId, id, restaurantId);
    return successResponse({ addonId, items });
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error fetching addon BOM:", error);
    return errorResponse("Gagal memuat komposisi bahan", "INTERNAL_ERROR", 500);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id, addonId } = await params;
    const body = await request.json();
    const parsed = SaveBomSchema.safeParse(body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.message);
    }
    const items = await menuService.saveAddonBom(
      addonId,
      id,
      restaurantId,
      parsed.data
    );
    return successResponse({ addonId, items }, "Komposisi bahan berhasil disimpan");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error saving addon BOM:", error);
    return errorResponse("Gagal menyimpan komposisi bahan", "INTERNAL_ERROR", 500);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; addonId: string }> }
) {
  try {
    const { restaurantId } = await requireAdmin();
    const { id, addonId } = await params;
    const { searchParams } = new URL(request.url);
    const ingredientId = searchParams.get("ingredientId");
    if (ingredientId) {
      await menuService.deleteAddonBomLine(addonId, id, restaurantId, ingredientId);
    } else {
      await menuService.deleteAddonBom(addonId, id, restaurantId);
    }
    return successResponse(null, "Komposisi bahan berhasil dihapus");
  } catch (error) {
    if (error instanceof AppError) {
      return errorResponse(error.message, error.code, error.statusCode);
    }
    console.error("Error deleting addon BOM:", error);
    return errorResponse("Gagal menghapus komposisi bahan", "INTERNAL_ERROR", 500);
  }
}
