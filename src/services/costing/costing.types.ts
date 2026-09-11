import { z } from "zod/v4";

// ============================================================
// Costing Engine (F.4) — CURRENT per-branch product HPP.
//
// HPP = Σ (RecipeItem.quantity × BranchIngredient.averageCost)
//
// Server only computes; no DB migration, no tables/columns added.
// All money/percentage values travel as decimal strings to avoid
// JS number precision loss. Never returns NaN/Infinity.
// ============================================================

export const costStatuses = ["NO_RECIPE", "COMPLETE", "INCOMPLETE"] as const;
export type CostStatus = (typeof costStatuses)[number];

export const missingReasons = ["MISSING_WAC", "INACTIVE_INGREDIENT"] as const;
export type MissingReason = (typeof missingReasons)[number];

// -----------------------------------------------
// Query schemas — bounded pagination, no unlimited limits.
// -----------------------------------------------

export const GetCostingListSchema = z.object({
  branchId: z.string().min(1, "Cabang wajib dipilih"),
  categoryId: z.string().optional(),
  search: z.string().optional(),
  status: z.enum(costStatuses, "Status tidak valid").optional(),
  page: z.coerce.number().int("Halaman harus bilangan bulat").positive("Halaman harus lebih dari 0").default(1),
  limit: z.coerce
    .number()
    .int("Limit harus bilangan bulat")
    .positive("Limit harus lebih dari 0")
    .max(100, "Limit maksimal 100")
    .default(20),
});

export const GetCostingDetailSchema = z.object({
  branchId: z.string().min(1, "Cabang wajib dipilih"),
});

export type GetCostingListInput = z.infer<typeof GetCostingListSchema>;
export type GetCostingDetailInput = z.infer<typeof GetCostingDetailSchema>;

// -----------------------------------------------
// DTOs
// -----------------------------------------------

/** Per-ingredient line in the detail (cost data only — no supplier/stock). */
export interface CostingItemDto {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  quantity: string;
  unit: string;
  wac: string | null;
  cost: string | null;
  zeroCost: boolean;
  missingReason: MissingReason | null;
}

/** List row — current HPP + margin for one product in one branch. */
export interface CostingListItemDto {
  productId: string;
  name: string;
  categoryId: string;
  categoryName: string;
  sellingPrice: string;
  hpp: string | null;
  grossProfit: string | null;
  grossMarginPct: string | null;
  foodCostPct: string | null;
  costStatus: CostStatus;
  coveredItems: number;
  totalItems: number;
}

/** Detail — list row + the recipe lines that produced the HPP. */
export interface CostingDetailDto extends CostingListItemDto {
  recipeId: string | null;
  items: CostingItemDto[];
}

export interface CostingListResponse {
  items: CostingListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}