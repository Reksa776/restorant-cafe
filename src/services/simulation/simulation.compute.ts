import { Prisma } from "@prisma/client";
import type { SimulationMode } from "./simulation.types";

// ============================================================
// F.7 — WHAT-IF SIMULATION PURE COMPUTATION
//
// Zero side effects: no DB, no external calls. Imported by both
// the service (for orchestration) and the unit test (for assertions).
// ============================================================

const ROUND = Prisma.Decimal.ROUND_HALF_UP;
const HUNDRED = new Prisma.Decimal(100);
const ONE = new Prisma.Decimal(1);

export function money(v: Prisma.Decimal): string {
  return v.toDecimalPlaces(2, ROUND).toFixed(2);
}

export function moneyOrNull(v: Prisma.Decimal | null): string | null {
  return v === null ? null : money(v);
}

export interface SimulationCoreInput {
  currentPrice: Prisma.Decimal;
  currentHpp: Prisma.Decimal | null;
  costStatus: "COMPLETE" | "INCOMPLETE" | "NO_RECIPE";
  missingReasons: Array<string | null>;
  mode: SimulationMode;
  priceChangePercent: number | null;
  hppChangePercent: number | null;
  targetMarginPercent: number | null;
}

export interface SimulationCoreResult {
  projectedPrice: Prisma.Decimal | null;
  projectedHpp: Prisma.Decimal | null;
  grossProfit: Prisma.Decimal | null;
  marginPct: Prisma.Decimal | null;
  foodCostPct: Prisma.Decimal | null;
  profitPerUnit: Prisma.Decimal | null;
  profitChangePct: Prisma.Decimal | null;
  warnings: string[];
}

export function computeSimulation(
  input: SimulationCoreInput
): SimulationCoreResult {
  const { currentPrice, currentHpp, mode } = input;
  const warnings: string[] = [];

  const pPct =
    input.priceChangePercent == null
      ? null
      : new Prisma.Decimal(input.priceChangePercent);
  const hPct =
    input.hppChangePercent == null
      ? null
      : new Prisma.Decimal(input.hppChangePercent);
  const tMargin =
    input.targetMarginPercent == null
      ? null
      : new Prisma.Decimal(input.targetMarginPercent);

  let projectedPrice: Prisma.Decimal | null = currentPrice;
  let projectedHpp: Prisma.Decimal | null = currentHpp;

  if (mode === "price") {
    projectedPrice = currentPrice.mul(
      ONE.add((pPct ?? new Prisma.Decimal(0)).div(HUNDRED))
    );
  } else if (mode === "hpp") {
    projectedHpp =
      currentHpp === null
        ? null
        : currentHpp.mul(ONE.add((hPct ?? new Prisma.Decimal(0)).div(HUNDRED)));
  } else if (mode === "target_margin") {
    if (currentHpp === null) {
      projectedPrice = null;
      projectedHpp = null;
    } else {
      projectedPrice = currentHpp.div(
        ONE.sub((tMargin ?? new Prisma.Decimal(0)).div(HUNDRED))
      );
      projectedHpp = currentHpp;
    }
  } else if (mode === "combined") {
    projectedPrice = currentPrice.mul(
      ONE.add((pPct ?? new Prisma.Decimal(0)).div(HUNDRED))
    );
    projectedHpp =
      currentHpp === null
        ? null
        : currentHpp.mul(ONE.add((hPct ?? new Prisma.Decimal(0)).div(HUNDRED)));
  }

  if (currentHpp === null) {
    if (input.costStatus === "NO_RECIPE") {
      warnings.push("Resep belum tersedia");
    } else if (input.missingReasons.includes("MISSING_WAC")) {
      warnings.push("WAC belum tersedia");
    } else if (input.missingReasons.includes("INACTIVE_INGREDIENT")) {
      warnings.push("Bahan tidak aktif");
    } else {
      warnings.push("HPP tidak tersedia");
    }
  }

  const currentGrossProfit =
    currentHpp === null ? null : currentPrice.sub(currentHpp);

  let grossProfit: Prisma.Decimal | null = null;
  if (projectedPrice !== null && projectedHpp !== null) {
    grossProfit = projectedPrice.sub(projectedHpp);
  }

  let marginPct: Prisma.Decimal | null = null;
  let foodCostPct: Prisma.Decimal | null = null;
  if (
    projectedPrice !== null &&
    projectedHpp !== null &&
    projectedPrice.greaterThan(0)
  ) {
    marginPct = grossProfit!.div(projectedPrice).mul(HUNDRED);
    foodCostPct = projectedHpp.div(projectedPrice).mul(HUNDRED);
  }

  let profitPerUnit: Prisma.Decimal | null = null;
  let profitChangePct: Prisma.Decimal | null = null;
  if (grossProfit !== null && currentGrossProfit !== null) {
    profitPerUnit = grossProfit.sub(currentGrossProfit);
    if (!currentGrossProfit.isZero()) {
      profitChangePct = profitPerUnit.div(currentGrossProfit).mul(HUNDRED);
    }
  }

  if (projectedPrice !== null && projectedPrice.lessThanOrEqualTo(0)) {
    warnings.push("Harga jual nol");
  }
  if (marginPct !== null && marginPct.lessThan(0)) {
    warnings.push("Margin negatif");
  }

  return {
    projectedPrice,
    projectedHpp,
    grossProfit,
    marginPct,
    foodCostPct,
    profitPerUnit,
    profitChangePct,
    warnings,
  };
}
