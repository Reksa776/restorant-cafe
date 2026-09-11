import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { costingService } from "@/services/costing/costing.service";
import type { AuthenticatedContext } from "@/lib/auth-helpers";
import { ForbiddenError } from "@/lib/errors";
import type {
  SimulationRequest,
  SimulationResponse,
} from "./simulation.types";
import {
  computeSimulation,
  money,
  moneyOrNull,
} from "./simulation.compute";

// ============================================================
// F.7 — WHAT-IF SIMULATION SERVICE
//
// Pure, deterministic, CURRENT-cost simulation. F.4 costingService
// is the SOLE source of truth for current HPP / effective selling
// price / recipe / WAC / cost status. F.7 NEVER recalculates HPP.
//
// - READ ONLY: no prisma create/update/delete/upsert anywhere.
// - All arithmetic is Prisma.Decimal; Number() only at the narrow
//   input boundary (validated percentages). Outputs are 2-dp
//   ROUND_HALF_UP strings; division-by-zero is null, never NaN.
// - Profit impact is PER ITEM ("per unit") — never extrapolated to
//   historical order quantities (F.5 territory).
// ============================================================

// ------------------------------------------------------------
// Service — current data from F.4, then pure calculation.
// ------------------------------------------------------------

class SimulationService {
  async simulateWhatIf(
    input: SimulationRequest,
    ctx: AuthenticatedContext
  ): Promise<SimulationResponse> {
    // F.4 is the source of truth for current HPP + effective price.
    // Also validates branch scope + product/restaurant ownership (404).
    const detail = await costingService.getCostingDetail(
      input.productId,
      input.branchId,
      ctx
    );

    const branch = await prisma.branch.findFirst({
      where: { id: input.branchId, restaurantId: ctx.restaurantId },
      select: { id: true, name: true },
    });
    if (!branch) {
      throw new ForbiddenError("Cabang tidak ditemukan");
    }

    const currentPrice = new Prisma.Decimal(detail.sellingPrice);
    const currentHpp =
      detail.hpp === null ? null : new Prisma.Decimal(detail.hpp);

    const core = computeSimulation({
      currentPrice,
      currentHpp,
      costStatus: detail.costStatus,
      missingReasons: detail.items.map((i) => i.missingReason),
      mode: input.mode,
      priceChangePercent: input.priceChangePercent ?? null,
      hppChangePercent: input.hppChangePercent ?? null,
      targetMarginPercent: input.targetMarginPercent ?? null,
    });

    const currentGrossProfit =
      currentHpp === null ? null : currentPrice.sub(currentHpp);

    return {
      product: {
        id: detail.productId,
        name: detail.name,
        categoryName: detail.categoryName,
      },
      branch: { id: branch.id, name: branch.name },
      current: {
        price: money(currentPrice),
        hpp: moneyOrNull(currentHpp),
        grossProfit: moneyOrNull(currentGrossProfit),
        marginPct: detail.grossMarginPct,
        foodCostPct: detail.foodCostPct,
        costStatus: detail.costStatus,
      },
      projected: {
        price: moneyOrNull(core.projectedPrice),
        hpp: moneyOrNull(core.projectedHpp),
        grossProfit: moneyOrNull(core.grossProfit),
        marginPct: moneyOrNull(core.marginPct),
        foodCostPct: moneyOrNull(core.foodCostPct),
      },
      impact: {
        profitPerUnit: moneyOrNull(core.profitPerUnit),
        profitChangePct: moneyOrNull(core.profitChangePct),
      },
      input: {
        mode: input.mode,
        priceChangePercent: input.priceChangePercent ?? null,
        hppChangePercent: input.hppChangePercent ?? null,
        targetMarginPercent: input.targetMarginPercent ?? null,
      },
      warnings: core.warnings,
    };
  }
}

export const simulationService = new SimulationService();