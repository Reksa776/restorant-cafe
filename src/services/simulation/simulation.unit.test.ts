import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  computeSimulation,
  type SimulationCoreInput,
} from "./simulation.compute";

// ============================================================
// F.7 — WHAT-IF SIMULATION UNIT TESTS
//
// All assertions use exact Decimal strings to guarantee round-trip
// precision. Tests run via: npx tsx --test simulation.unit.test.ts
// ============================================================

const D = (v: string | number) => new Prisma.Decimal(String(v));

function baseInput(overrides: Partial<SimulationCoreInput> = {}): SimulationCoreInput {
  return {
    currentPrice: D(50000),
    currentHpp: D(30000),
    costStatus: "COMPLETE",
    missingReasons: [],
    mode: "price",
    priceChangePercent: null,
    hppChangePercent: null,
    targetMarginPercent: null,
    ...overrides,
  };
}

function fmt(v: Prisma.Decimal | null): string | null {
  return v === null ? null : v.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
}

// -------------------------------------------------------
// Mode: price
// -------------------------------------------------------
describe("mode=price", () => {
  it("10% increase", () => {
    const r = computeSimulation(baseInput({
      mode: "price",
      priceChangePercent: 10,
    }));
    assert.equal(fmt(r.projectedPrice), "55000.00");
    assert.equal(fmt(r.projectedHpp), "30000.00");
    assert.equal(fmt(r.grossProfit), "25000.00");
    assert.equal(fmt(r.marginPct), "45.45");
    assert.equal(fmt(r.foodCostPct), "54.55");
    assert.equal(fmt(r.profitPerUnit), "5000.00");
    assert.equal(fmt(r.profitChangePct), "25.00");
    assert.deepEqual(r.warnings, []);
  });

  it("50% increase", () => {
    const r = computeSimulation(baseInput({
      mode: "price",
      priceChangePercent: 50,
    }));
    assert.equal(fmt(r.projectedPrice), "75000.00");
    assert.equal(fmt(r.grossProfit), "45000.00");
    assert.equal(fmt(r.marginPct), "60.00");
    assert.equal(fmt(r.foodCostPct), "40.00");
  });

  it("negative change (-10%)", () => {
    const r = computeSimulation(baseInput({
      mode: "price",
      priceChangePercent: -10,
    }));
    assert.equal(fmt(r.projectedPrice), "45000.00");
    assert.equal(fmt(r.grossProfit), "15000.00");
    assert.equal(fmt(r.marginPct), "33.33");
  });

  it("HPP=null → price mode returns projectedPrice but metrics null", () => {
    const r = computeSimulation(baseInput({
      currentHpp: null,
      costStatus: "COMPLETE",
      mode: "price",
      priceChangePercent: 10,
    }));
    assert.equal(fmt(r.projectedPrice), "55000.00");
    assert.equal(r.projectedHpp, null);
    assert.equal(r.grossProfit, null);
    assert.equal(r.marginPct, null);
    assert.equal(r.foodCostPct, null);
    assert.equal(r.profitPerUnit, null);
    assert.ok(r.warnings.some((w) => w === "HPP tidak tersedia"));
  });

  it("price=0 → warning Harga jual nol", () => {
    const r = computeSimulation(baseInput({
      currentPrice: D(0),
      mode: "price",
      priceChangePercent: 10,
    }));
    assert.equal(fmt(r.projectedPrice), "0.00");
    assert.ok(r.warnings.some((w) => w === "Harga jual nol"));
  });
});

// -------------------------------------------------------
// Mode: hpp
// -------------------------------------------------------
describe("mode=hpp", () => {
  it("20% HPP decrease", () => {
    const r = computeSimulation(baseInput({
      mode: "hpp",
      hppChangePercent: -20,
    }));
    assert.equal(fmt(r.projectedPrice), "50000.00");
    assert.equal(fmt(r.projectedHpp), "24000.00");
    assert.equal(fmt(r.grossProfit), "26000.00");
    assert.equal(fmt(r.marginPct), "52.00");
    assert.equal(fmt(r.foodCostPct), "48.00");
    assert.equal(fmt(r.profitPerUnit), "6000.00");
  });

  it("10% HPP increase", () => {
    const r = computeSimulation(baseInput({
      mode: "hpp",
      hppChangePercent: 10,
    }));
    assert.equal(fmt(r.projectedHpp), "33000.00");
    assert.equal(fmt(r.grossProfit), "17000.00");
    assert.equal(fmt(r.marginPct), "34.00");
  });

  it("HPP=null → incomplete result", () => {
    const r = computeSimulation(baseInput({
      currentHpp: null,
      mode: "hpp",
      hppChangePercent: 10,
    }));
    assert.equal(r.projectedHpp, null);
    assert.equal(r.grossProfit, null);
    assert.ok(r.warnings.some((w) => w === "HPP tidak tersedia"));
  });
});

// -------------------------------------------------------
// Mode: target_margin
// -------------------------------------------------------
describe("mode=target_margin", () => {
  it("target margin 40% → price = 30000/(1-0.4) = 50000", () => {
    const r = computeSimulation(baseInput({
      mode: "target_margin",
      targetMarginPercent: 40,
    }));
    assert.equal(fmt(r.projectedPrice), "50000.00");
    assert.equal(fmt(r.projectedHpp), "30000.00");
    assert.equal(fmt(r.grossProfit), "20000.00");
    assert.equal(fmt(r.marginPct), "40.00");
    assert.equal(fmt(r.foodCostPct), "60.00");
  });

  it("target margin 20% → price = 30000/(1-0.2) = 37500", () => {
    const r = computeSimulation(baseInput({
      mode: "target_margin",
      targetMarginPercent: 20,
    }));
    assert.equal(fmt(r.projectedPrice), "37500.00");
    assert.equal(fmt(r.marginPct), "20.00");
  });

  it("HPP=null → incomplete", () => {
    const r = computeSimulation(baseInput({
      currentHpp: null,
      mode: "target_margin",
      targetMarginPercent: 40,
    }));
    assert.equal(r.projectedPrice, null);
    assert.equal(r.projectedHpp, null);
    assert.ok(r.warnings.some((w) => w === "HPP tidak tersedia"));
  });
});

// -------------------------------------------------------
// Mode: combined
// -------------------------------------------------------
describe("mode=combined", () => {
  it("price +10%, hpp -10%", () => {
    const r = computeSimulation(baseInput({
      mode: "combined",
      priceChangePercent: 10,
      hppChangePercent: -10,
    }));
    assert.equal(fmt(r.projectedPrice), "55000.00");
    assert.equal(fmt(r.projectedHpp), "27000.00");
    assert.equal(fmt(r.grossProfit), "28000.00");
    assert.equal(fmt(r.marginPct), "50.91");
    assert.equal(fmt(r.profitPerUnit), "8000.00");
    assert.equal(fmt(r.profitChangePct), "40.00");
  });

  it("HPP=null → projectedHpp null, only price changes", () => {
    const r = computeSimulation(baseInput({
      currentHpp: null,
      mode: "combined",
      priceChangePercent: 10,
      hppChangePercent: 5,
    }));
    assert.equal(fmt(r.projectedPrice), "55000.00");
    assert.equal(r.projectedHpp, null);
    assert.equal(r.grossProfit, null);
  });
});

// -------------------------------------------------------
// Edge cases
// -------------------------------------------------------
describe("edge cases", () => {
  it("HPP=0 → margin 100%, foodCost 0%", () => {
    const r = computeSimulation(baseInput({
      currentHpp: D(0),
      mode: "price",
      priceChangePercent: 0,
    }));
    assert.equal(fmt(r.projectedPrice), "50000.00");
    assert.equal(fmt(r.projectedHpp), "0.00");
    assert.equal(fmt(r.grossProfit), "50000.00");
    assert.equal(fmt(r.marginPct), "100.00");
    assert.equal(fmt(r.foodCostPct), "0.00");
    assert.equal(fmt(r.profitPerUnit), "0.00");
    assert.equal(fmt(r.profitChangePct), "0.00");
  });

  it("HPP=null with NO_RECIPE → warning Resep belum tersedia", () => {
    const r = computeSimulation(baseInput({
      currentHpp: null,
      costStatus: "NO_RECIPE",
      mode: "price",
      priceChangePercent: 10,
    }));
    assert.ok(r.warnings.includes("Resep belum tersedia"));
  });

  it("HPP=null with MISSING_WAC → warning WAC belum tersedia", () => {
    const r = computeSimulation(baseInput({
      currentHpp: null,
      costStatus: "INCOMPLETE",
      missingReasons: ["MISSING_WAC"],
      mode: "price",
      priceChangePercent: 10,
    }));
    assert.ok(r.warnings.includes("WAC belum tersedia"));
  });

  it("HPP=null with INACTIVE_INGREDIENT → warning Bahan tidak aktif", () => {
    const r = computeSimulation(baseInput({
      currentHpp: null,
      costStatus: "INCOMPLETE",
      missingReasons: ["INACTIVE_INGREDIENT"],
      mode: "price",
      priceChangePercent: 10,
    }));
    assert.ok(r.warnings.includes("Bahan tidak aktif"));
  });

  it("margin 40% with negative result shows Margin negatif warning", () => {
    const r = computeSimulation(baseInput({
      currentPrice: D(50000),
      currentHpp: D(60000),
      mode: "price",
      priceChangePercent: -20,
    }));
    assert.equal(fmt(r.projectedPrice), "40000.00");
    assert.equal(fmt(r.projectedHpp), "60000.00");
    assert.equal(fmt(r.grossProfit), "-20000.00");
    assert.equal(fmt(r.marginPct), "-50.00");
    assert.ok(r.warnings.includes("Margin negatif"));
  });

  it("currentGrossProfit=0 → profitChangePct null (div-by-zero)", () => {
    const r = computeSimulation(baseInput({
      currentPrice: D(30000),
      currentHpp: D(30000),
      mode: "price",
      priceChangePercent: 10,
    }));
    assert.equal(fmt(r.projectedPrice), "33000.00");
    assert.equal(fmt(r.grossProfit), "3000.00");
    assert.equal(fmt(r.profitPerUnit), "3000.00");
    assert.equal(r.profitChangePct, null);
  });

  it("0% change → no difference", () => {
    const r = computeSimulation(baseInput({
      mode: "price",
      priceChangePercent: 0,
    }));
    assert.equal(fmt(r.projectedPrice), "50000.00");
    assert.equal(fmt(r.profitPerUnit), "0.00");
    assert.equal(fmt(r.profitChangePct), "0.00");
  });
});