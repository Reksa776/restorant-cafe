import { z } from "zod/v4";

// ============================================================
// Ingredient Validation Schemas
// ============================================================

export const CreateIngredientSchema = z.object({
  name: z.string().min(1, "Nama bahan baku wajib diisi").max(100),
  baseUnit: z.enum(["PCS", "GRAM", "KG", "ML", "LITER"]).default("PCS"),
});

export const UpdateIngredientSchema = z.object({
  name: z.string().min(1, "Nama bahan baku wajib diisi").max(100).optional(),
  baseUnit: z.enum(["PCS", "GRAM", "KG", "ML", "LITER"]).optional(),
  isActive: z.boolean().optional(),
});

export const GetIngredientsSchema = z.object({
  search: z.string().optional(),
  isActive: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const AdjustIngredientStockSchema = z.object({
  branchId: z.string().min(1, "Cabang wajib dipilih"),
  targetStock: z.number().min(0, "Stok tidak boleh negatif"),
  reason: z.string().min(1, "Alasan penyesuaian wajib diisi").max(500),
});

// ============================================================
// Types
// ============================================================

export type CreateIngredientInput = z.infer<typeof CreateIngredientSchema>;
export type UpdateIngredientInput = z.infer<typeof UpdateIngredientSchema>;
export type GetIngredientsInput = z.infer<typeof GetIngredientsSchema>;
export type AdjustIngredientStockInput = z.infer<typeof AdjustIngredientStockSchema>;
