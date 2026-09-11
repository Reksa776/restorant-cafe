import { z } from "zod/v4";
import type { CostStatus } from "@/services/costing/costing.types";

// ============================================================
// F.7 — WHAT-IF SIMULATION TYPES
//
// Pure simulation on CURRENT cost data (F.4 costingService).
// NO database writes — results are computed in memory and returned
// as decimal strings. Nothing here ever persists.
// ============================================================

export const simulationModes = [
  "price",
  "hpp",
  "target_margin",
  "combined",
] as const;
export type SimulationMode = (typeof simulationModes)[number];

const percentRange = (min: number, max: number, label: string) =>
  z
    .number()
    .finite("Harus angka valid (bukan NaN/Infinity)")
    .min(min, `${label} minimal ${min}`)
    .max(max, `${label} maksimal ${max}`);

export const SimulationRequestSchema = z
  .object({
    productId: z.string().min(1, "productId wajib"),
    branchId: z.string().min(1, "branchId wajib"),
    mode: z.enum(simulationModes, "Mode simulasi tidak valid"),
    priceChangePercent: percentRange(-100, 1000, "Price change").optional(),
    hppChangePercent: percentRange(-100, 1000, "HPP change").optional(),
    targetMarginPercent: percentRange(0, 99.99, "Target margin").optional(),
  })
  .superRefine((data, ctx) => {
    if (data.mode === "price" && data.priceChangePercent == null) {
      ctx.addIssue({
        code: "custom",
        message: "priceChangePercent wajib untuk mode price",
        path: ["priceChangePercent"],
      });
    }
    if (data.mode === "hpp" && data.hppChangePercent == null) {
      ctx.addIssue({
        code: "custom",
        message: "hppChangePercent wajib untuk mode hpp",
        path: ["hppChangePercent"],
      });
    }
    if (data.mode === "target_margin" && data.targetMarginPercent == null) {
      ctx.addIssue({
        code: "custom",
        message: "targetMarginPercent wajib untuk mode target_margin",
        path: ["targetMarginPercent"],
      });
    }
    if (
      data.mode === "combined" &&
      (data.priceChangePercent == null || data.hppChangePercent == null)
    ) {
      ctx.addIssue({
        code: "custom",
        message: "priceChangePercent dan hppChangePercent wajib untuk mode combined",
        path: ["combined"],
      });
    }
  });

export type SimulationRequest = z.infer<typeof SimulationRequestSchema>;

export interface SimulationProductDto {
  id: string;
  name: string;
  categoryName: string | null;
}

export interface SimulationBranchDto {
  id: string;
  name: string;
}

export interface SimulationCurrentDto {
  price: string;
  hpp: string | null;
  grossProfit: string | null;
  marginPct: string | null;
  foodCostPct: string | null;
  costStatus: CostStatus;
}

export interface SimulationProjectedDto {
  price: string | null;
  hpp: string | null;
  grossProfit: string | null;
  marginPct: string | null;
  foodCostPct: string | null;
}

export interface SimulationImpactDto {
  profitPerUnit: string | null;
  profitChangePct: string | null;
}

export interface SimulationInputDto {
  mode: SimulationMode;
  priceChangePercent: number | null;
  hppChangePercent: number | null;
  targetMarginPercent: number | null;
}

export interface SimulationResponse {
  product: SimulationProductDto;
  branch: SimulationBranchDto;
  current: SimulationCurrentDto;
  projected: SimulationProjectedDto;
  impact: SimulationImpactDto;
  input: SimulationInputDto;
  warnings: string[];
}