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
// Phase G.1 — per-branch HPP method.
//
// INGREDIENT = automatic HPP from Recipe × BranchIngredient.averageCost.
// MANUAL     = HPP read from BranchProduct.manualHpp (recipe/WAC ignored).
// -----------------------------------------------

export const costingModes = ["INGREDIENT", "MANUAL"] as const;
export type CostingMode = (typeof costingModes)[number];

/**
 * Body fields for the per-branch costing method, accepted by the existing
 * branch-product mutation endpoint (reused — no new costing endpoint).
 *
 * - MANUAL requires a `manualHpp` (0 IS valid).
 * - INGREDIENT clears/ignores `manualHpp`.
 * Precision: at most 2 decimals, finite, >= 0 (server rounds to 2dp).
 */
export const BranchCostingSchema = z.object({
  costingMode: z.enum(costingModes, "Metode HPP tidak valid").optional(),
  manualHpp: z
    .union([z.number(), z.null()])
    .optional()
    .refine(
      (v) => v == null || (Number.isFinite(v) && v >= 0),
      "HPP manual harus berupa angka >= 0"
    )
    .refine(
      (v) =>
        v == null ||
        Math.abs(v * 100 - Math.round(v * 100)) < 1e-9,
      "HPP manual maksimal 2 angka desimal"
    ),
});
export type BranchCostingInput = z.infer<typeof BranchCostingSchema>;

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
  /** Total CURRENT HPP. Equals `baseHpp` in the product-level view (no
   * customization selection); a selection-aware call returns the full
   * base + addon + option total. */
  hpp: string | null;
  grossProfit: string | null;
  grossMarginPct: string | null;
  foodCostPct: string | null;
  costStatus: CostStatus;
  coveredItems: number;
  totalItems: number;
  /** G.1 — which method produced `hpp` for this branch. */
  costingMode: CostingMode;
  /** G.1 — stored manual HPP for this branch (null when unset). */
  manualHpp: string | null;
  // ----------------------------------------------------------------
  // H4.2 — HPP breakdown. `hpp` stays the authoritative total; these are
  // additive so the admin UI can label each component. Addon/option HPP is
  // null when the component cost could not be resolved (never a fake 0).
  // ----------------------------------------------------------------
  /** Base product HPP: recipe × WAC (INGREDIENT) or manualHpp (MANUAL). */
  baseHpp: string | null;
  /** Selected addon HPP (0 in the product-level view — nothing selected). */
  addonHpp: string | null;
  /** Selected option HPP (0 in the product-level view — nothing selected). */
  optionHpp: string | null;
  /** baseHpp + addonHpp + optionHpp — null when any part is incomplete. */
  totalHpp: string | null;
}

// ----------------------------------------------------------------
// H4.2 — addon / option components (mini-BOM costing).
// ----------------------------------------------------------------

export const componentKinds = ["ADDON", "OPTION"] as const;
export type ComponentKindDto = (typeof componentKinds)[number];

export const componentStatuses = ["COMPLETE", "INCOMPLETE"] as const;
export type ComponentStatus = (typeof componentStatuses)[number];

/** Why a component's HPP is unknown. Never means "cost = 0". */
export const componentReasons = [
  "NO_BOM",
  "MISSING_WAC",
  "INACTIVE_INGREDIENT",
  "INACTIVE_COMPONENT",
  "NOT_FOUND",
  "INVALID_QUANTITY",
  "MALFORMED_CUSTOMIZATION",
] as const;
export type ComponentReason = (typeof componentReasons)[number];

/** Per-ingredient line of an addon/option mini-BOM. */
export interface CostingComponentItemDto {
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

/**
 * ONE addon/option with its per-1-unit HPP. `sellingPrice` is display-only —
 * it is the addon price / option price adjustment and is NEVER used as cost.
 */
export interface CostingComponentDto {
  kind: ComponentKindDto;
  id: string;
  name: string;
  sellingPrice: string;
  /** HPP for ONE unit — null when incomplete (never fabricated 0). */
  hpp: string | null;
  status: ComponentStatus;
  reasons: ComponentReason[];
  items: CostingComponentItemDto[];
}

/** Detail — list row + the recipe lines that produced the HPP. */
export interface CostingDetailDto extends CostingListItemDto {
  recipeId: string | null;
  items: CostingItemDto[];
  /** H4.2 — configured active addons of this product, with per-unit HPP. */
  addons: CostingComponentDto[];
  /** H4.2 — configured active options of this product, with per-unit HPP. */
  options: CostingComponentDto[];
}

/**
 * H4.2 — selection-aware HPP (base + selected addons + selected options).
 * This is the value a completion will freeze (H4.3) and the value the
 * addon/option stock consumption will mirror (H4.4).
 */
export interface SelectionCostingDto {
  productId: string;
  branchId: string;
  costingMode: CostingMode;
  sellingPrice: string;
  baseHpp: string | null;
  addonHpp: string | null;
  optionHpp: string | null;
  totalHpp: string | null;
  costStatus: CostStatus;
  reasons: ComponentReason[];
  addons: CostingComponentDto[];
  options: CostingComponentDto[];
  /** Per-unit customization subtotal, before OrderItem.quantity. */
  customizationHpp: string | null;
}

export interface CostingListResponse {
  items: CostingListItemDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}