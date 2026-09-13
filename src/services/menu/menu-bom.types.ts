import { z } from "zod/v4";
import { recipeUnits } from "@/services/recipe/recipe.types";

// ============================================================
// H4.1 — ADDON / OPTION MINI-BOM validation schemas.
//
// Mirrors the F.3 Recipe/RecipeItem contract exactly so both BOMs
// behave identically:
//   - quantity is a positive decimal STRING ("0.020"), never a JS float
//   - unit MUST equal Ingredient.baseUnit (no unit conversion)
//   - a given ingredient may appear at most once per addon/option
//
// `items: []` is allowed and means "no BOM" (clears any existing
// composition) — unlike Recipe, an addon/option is not required to
// have a composition.
// ============================================================

export const BomItemInputSchema = z.object({
  ingredientId: z.string().min(1, "Bahan baku wajib dipilih"),
  quantity: z
    .string()
    .min(1, "Quantity wajib diisi")
    .regex(/^\d+(\.\d+)?$/, "Quantity harus angka desimal positif"),
  unit: z.enum(recipeUnits, "Unit tidak valid"),
});

export const SaveBomSchema = z
  .object({
    items: z.array(BomItemInputSchema),
  })
  .refine(
    (val) => {
      const ids = val.items.map((i) => i.ingredientId);
      return new Set(ids).size === ids.length;
    },
    { message: "Bahan baku tidak boleh duplikat" }
  );

export type BomItemInput = z.infer<typeof BomItemInputSchema>;
export type SaveBomInput = z.infer<typeof SaveBomSchema>;

/**
 * GET response item — composition ONLY. Never exposes averageCost / WAC /
 * lastPurchaseCost / supplier / stock / cost, matching RecipeItemDto.
 */
export interface BomItemDto {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  quantity: string;
  unit: string;
}

/** BOM response. `addonId`/`optionId` identifies the owner of the lines. */
export interface BomDto {
  addonId?: string;
  optionId?: string;
  items: BomItemDto[];
}
