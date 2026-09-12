import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Prisma } from "@prisma/client";
import {
  computeHistoricalHpp,
  type HistoricalHppProduct,
} from "./historical-snapshot";

// ============================================================
// G.1 — HISTORICAL HPP RESOLUTION UNIT TESTS
//
// Verifies the pure snapshot resolver honors the per-branch costing mode:
//   INGREDIENT → Σ(RecipeItem.quantity × BranchIngredient.averageCost)
//   MANUAL     → BranchProduct.manualHpp (0 is valid; null is incomplete)
// No DB required. Run via:
//   npx tsx --test src/services/costing/historical-snapshot.unit.test.ts
// ============================================================

const D = (v: string | number) => new Prisma.Decimal(String(v));

function product(
  overrides: Partial<HistoricalHppProduct> = {}
): HistoricalHppProduct {
  return {
    id: "p1",
    recipe: null,
    branchProducts: [],
    ...overrides,
  };
}

function hppStr(v: Prisma.Decimal | null): string | null {
  return v === null ? null : v.toFixed(2);
}

describe("INGREDIENT mode (automatic — unchanged)", () => {
  it("sums quantity × WAC", () => {
    const rows = computeHistoricalHpp([
      product({
        id: "burger",
        branchProducts: [{ costingMode: "INGREDIENT", manualHpp: D(999) }],
        recipe: {
          items: [
            {
              quantity: D("0.1"),
              ingredient: {
                id: "i-ayam",
                isActive: true,
                branchIngredients: [{ averageCost: D(40000) }],
              },
            },
            {
              quantity: D("1"),
              ingredient: {
                id: "i-bun",
                isActive: true,
                branchIngredients: [{ averageCost: D(3000) }],
              },
            },
          ],
        },
      }),
    ]);
    const r = rows.get("burger")!;
    assert.equal(r.status, "SNAPSHOTTED");
    // 0.1*40000 + 1*3000 = 7000
    assert.equal(hppStr(r.hpp), "7000.00");
  });

  it("no recipe → NO_RECIPE with null hpp", () => {
    const rows = computeHistoricalHpp([
      product({ id: "x", branchProducts: [{ costingMode: "INGREDIENT", manualHpp: null }] }),
    ]);
    assert.equal(rows.get("x")!.status, "NO_RECIPE");
    assert.equal(rows.get("x")!.hpp, null);
  });

  it("missing WAC → MISSING_WAC, never 0", () => {
    const rows = computeHistoricalHpp([
      product({
        id: "x",
        branchProducts: [{ costingMode: "INGREDIENT", manualHpp: null }],
        recipe: {
          items: [
            {
              quantity: D("1"),
              ingredient: {
                id: "i",
                isActive: true,
                branchIngredients: [{ averageCost: null }],
              },
            },
          ],
        },
      }),
    ]);
    assert.equal(rows.get("x")!.status, "MISSING_WAC");
    assert.equal(rows.get("x")!.hpp, null);
  });

  it("no BranchProduct row defaults to INGREDIENT", () => {
    const rows = computeHistoricalHpp([
      product({
        id: "x",
        recipe: {
          items: [
            {
              quantity: D("2"),
              ingredient: {
                id: "i",
                isActive: true,
                branchIngredients: [{ averageCost: D(5000) }],
              },
            },
          ],
        },
      }),
    ]);
    assert.equal(rows.get("x")!.status, "SNAPSHOTTED");
    assert.equal(hppStr(rows.get("x")!.hpp), "10000.00");
  });
});

describe("MANUAL mode (G.1)", () => {
  it("uses manualHpp and ignores recipe/WAC", () => {
    const rows = computeHistoricalHpp([
      product({
        id: "burger",
        branchProducts: [{ costingMode: "MANUAL", manualHpp: D(15000) }],
        recipe: {
          items: [
            {
              quantity: D("1"),
              ingredient: {
                id: "i",
                isActive: true,
                branchIngredients: [{ averageCost: D(999999) }],
              },
            },
          ],
        },
      }),
    ]);
    const r = rows.get("burger")!;
    assert.equal(r.status, "SNAPSHOTTED");
    assert.equal(hppStr(r.hpp), "15000.00");
  });

  it("manualHpp = 0 is a VALID cost (SNAPSHOTTED, 0)", () => {
    const rows = computeHistoricalHpp([
      product({
        id: "freebie",
        branchProducts: [{ costingMode: "MANUAL", manualHpp: D(0) }],
      }),
    ]);
    assert.equal(rows.get("freebie")!.status, "SNAPSHOTTED");
    assert.equal(hppStr(rows.get("freebie")!.hpp), "0.00");
  });

  it("MANUAL without a value → incomplete (MISSING_WAC), never coerced to 0", () => {
    const rows = computeHistoricalHpp([
      product({
        id: "burger",
        branchProducts: [{ costingMode: "MANUAL", manualHpp: null }],
      }),
    ]);
    assert.equal(rows.get("burger")!.status, "MISSING_WAC");
    assert.equal(rows.get("burger")!.hpp, null);
  });

  it("rounds manual HPP to 2dp", () => {
    const rows = computeHistoricalHpp([
      product({
        id: "b",
        branchProducts: [{ costingMode: "MANUAL", manualHpp: D("15000.005") }],
      }),
    ]);
    assert.equal(hppStr(rows.get("b")!.hpp), "15000.01");
  });
});
