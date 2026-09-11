// ============================================================
// CLIENT-SIDE API wrapper (browser bundle) — thin axios calls into /api.
// The server-side implementation lives in ./simulation/simulation.service.ts
// ============================================================
import api from "@/lib/axios";

export type SimulationMode = "price" | "hpp" | "target_margin" | "combined";
export type SimulationCostStatus = "COMPLETE" | "INCOMPLETE" | "NO_RECIPE";

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
  costStatus: SimulationCostStatus;
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

export interface SimulationRequest {
  productId: string;
  branchId: string;
  mode: SimulationMode;
  priceChangePercent?: number;
  hppChangePercent?: number;
  targetMarginPercent?: number;
}

export const simulationService = {
  async simulate(input: SimulationRequest): Promise<SimulationResponse> {
    const response = await api.post("/admin/simulation/what-if", input);
    return response.data.data;
  },
};