import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  deriveCogsState,
  isCoverageComplete,
  isItemSetCoverageComplete,
} from "./coverage";
import { computeNetProfit } from "../accounting/pnl.rules";
import { buildCsv } from "@/lib/csv";

// ============================================================
// D1 — COGS INTEGRITY REGRESSION TESTS (no DB required)
//
// Covers the exact defects fixed in ACCOUNTING PHASE D1:
//   1. an EMPTY scope (totalItems === 0) is NOT covered;
//   2. a valid SNAPSHOTTED zero cost IS covered;
//   3. normal positive coverage is unchanged;
//   4. pending / uncosted items are not covered;
//   5. Menu Engineering (category item-set) empty scope is not covered;
//   6. CSV never turns a null profit into 0.
// ============================================================

const state = (over: Partial<Parameters<typeof deriveCogsState>[0]> = {}) =>
  deriveCogsState({
    totalItems: 0,
    costed: 0,
    uncosted: 0,
    legacy: 0,
    pending: 0,
    ...over,
  });

describe("deriveCogsState (D1)", () => {
  it("empty scope → NO_ITEMS, never COVERED", () => {
    assert.equal(state(), "NO_ITEMS");
    assert.equal(
      state({ totalItems: 0, costed: 0, uncosted: 0, legacy: 0, pending: 0 }),
      "NO_ITEMS"
    );
  });

  it("all items SNAPSHOTTED → COVERED (includes valid zero cost)", () => {
    // A SNAPSHOTTED hppTotal = 0 still lands in `costed`; status alone decides.
    assert.equal(state({ totalItems: 3, costed: 3 }), "COVERED");
  });

  it("some items costed, others not → PARTIAL", () => {
    assert.equal(state({ totalItems: 3, costed: 1, uncosted: 2 }), "PARTIAL");
  });

  it("paid but not completed → PENDING_COGS", () => {
    assert.equal(state({ totalItems: 2, costed: 0, pending: 2 }), "PENDING_COGS");
  });

  it("snapshot exists but not SNAPSHOTTED → UNCOVERED", () => {
    assert.equal(state({ totalItems: 2, costed: 0, uncosted: 2 }), "UNCOVERED");
  });

  it("completed without snapshot → LEGACY", () => {
    assert.equal(state({ totalItems: 2, costed: 0, legacy: 2 }), "LEGACY");
  });
});

describe("isCoverageComplete (D1)", () => {
  const cov = (o: Partial<{
    totalOrderItems: number;
    costedOrderItems: number;
    uncostedOrderItems: number;
    legacyOrderItems: number;
    pendingOrderItems: number;
  }> = {}) => ({
    totalOrderItems: 0,
    costedOrderItems: 0,
    uncostedOrderItems: 0,
    legacyOrderItems: 0,
    pendingOrderItems: 0,
    ...o,
  });

  it("empty scope is NOT complete (revenue with no items)", () => {
    assert.equal(isCoverageComplete(cov()), false);
  });

  it("every item SNAPSHOTTED (incl. valid zero) IS complete", () => {
    assert.equal(
      isCoverageComplete(cov({ totalOrderItems: 4, costedOrderItems: 4 })),
      true
    );
  });

  it("any uncosted / legacy / pending item is NOT complete", () => {
    assert.equal(
      isCoverageComplete(cov({ totalOrderItems: 3, costedOrderItems: 2, uncostedOrderItems: 1 })),
      false
    );
    assert.equal(
      isCoverageComplete(cov({ totalOrderItems: 3, costedOrderItems: 2, legacyOrderItems: 1 })),
      false
    );
    assert.equal(
      isCoverageComplete(cov({ totalOrderItems: 3, costedOrderItems: 2, pendingOrderItems: 1 })),
      false
    );
  });
});

describe("isItemSetCoverageComplete (Menu Engineering, D1)", () => {
  const cat = (o: Partial<{
    costedItems: number;
    uncostedItems: number;
    legacyItems: number;
    pendingItems: number;
  }> = {}) => ({
    costedItems: 0,
    uncostedItems: 0,
    legacyItems: 0,
    pendingItems: 0,
    ...o,
  });

  it("empty category (0 item) is NOT complete", () => {
    assert.equal(isItemSetCoverageComplete(cat()), false);
  });

  it("all costed IS complete", () => {
    assert.equal(isItemSetCoverageComplete(cat({ costedItems: 5 })), true);
  });

  it("uncosted/legacy/pending present is NOT complete", () => {
    assert.equal(
      isItemSetCoverageComplete(cat({ costedItems: 4, uncostedItems: 1 })),
      false
    );
    assert.equal(
      isItemSetCoverageComplete(cat({ costedItems: 4, pendingItems: 1 })),
      false
    );
  });
});

describe("computeNetProfit (D1)", () => {
  it("unknown gross profit (null) → null, never revenue − 0", () => {
    assert.equal(computeNetProfit(null, 0), null);
    assert.equal(computeNetProfit(null, 1000), null);
  });

  it("known gross profit → gross profit − opex", () => {
    assert.equal(computeNetProfit(487000, 0), 487000);
    assert.equal(computeNetProfit(100000, 25000), 75000);
  });
});

describe("CSV null handling (D1)", () => {
  it("null profit cell is EMPTY, a real 0 stays 0", () => {
    const csv = buildCsv(["grossProfit", "cogs"], [[null, 0]]);
    assert.equal(csv, "\uFEFFgrossProfit,cogs\r\n,0");
    // Guard against regressing to `0` for an unknown profit.
    assert.ok(!csv.includes("\r\n0,0"), "null must not be serialized as 0");
  });
});
