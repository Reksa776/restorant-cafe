import { z } from "zod/v4";

// ============================================================
// Recipe / BOM Validation Schemas (F.3)
// Restaurant-level composition of one product. Quantity is a
// string decimal ("0.150") — kept as Prisma.Decimal in the service,
// never a JS number.
// ============================================================

export const recipeUnits = ["PCS", "GRAM", "KG", "ML", "LITER"] as const;

export const RecipeItemInputSchema = z.object({
  ingredientId: z.string().min(1, "Bahan baku wajib dipilih"),
  quantity: z
    .string()
    .min(1, "Quantity wajib diisi")
    .regex(/^\d+(\.\d+)?$/, "Quantity harus angka desimal positif"),
  unit: z.enum(recipeUnits, "Unit tidak valid"),
});

export const SaveRecipeSchema = z
  .object({
    items: z
      .array(RecipeItemInputSchema)
      .min(1, "Recipe minimal harus memiliki 1 bahan baku"),
  })
  .refine(
    (val) => {
      const ids = val.items.map((i) => i.ingredientId);
      return new Set(ids).size === ids.length;
    },
    { message: "Bahan baku tidak boleh duplikat" }
  );

// ============================================================
// Types
// ============================================================

export type RecipeItemInput = z.infer<typeof RecipeItemInputSchema>;
export type SaveRecipeInput = z.infer<typeof SaveRecipeSchema>;

/** GET response item — composition only, no cost/stock/supplier data. */
export interface RecipeItemDto {
  id: string;
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  quantity: string;
  unit: string;
}

export interface RecipeDto {
  id: string;
  productId: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  items: RecipeItemDto[];
}