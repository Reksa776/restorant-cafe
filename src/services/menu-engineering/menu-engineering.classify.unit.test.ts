import { test } from "node:test";
import assert from "node:assert/strict";
import {
  calculateMedian,
  classifyProduct,
  resolveMedianScope,
  MIN_ORDER_COUNT,
  MIN_QTY_SOLD,
  CATEGORY_MEDIAN_MIN_PRODUCTS,
  type ClassifyInput,
} from "./menu-engineering.constants";

// ------------------------------------------------------------
// F.6 unit tests — pure threshold + classification logic.
// Run: node --test src/services/menu-engineering/menu-engineering.classify.unit.test.ts
// ------------------------------------------------------------

function baseInput(overrides: Partial<ClassifyInput> = {}): ClassifyInput {
  return {
    qtySold: 10,
    orderCount: 5,
    grossProfit: 500,
    currentSellingPrice: 20000,
    isNew: false,
    uncostedItems: 0,
    legacyItems: 0,
    uncostedStatus: null,
    negativeMargin: false,
    qtyMedian: 8,
    profitMedian: 300,
    ...overrides,
  };
}

test("calculateMedian: empty / single / odd / even", () => {
  assert.equal(calculateMedian([]), 0);
  assert.equal(calculateMedian([7]), 7);
  assert.equal(calculateMedian([1, 2, 3]), 2);
  assert.equal(calculateMedian([1, 2, 3, 4]), 2.5);
  assert.equal(calculateMedian([10, 1, 3, 2, 1]), 2);
  assert.equal(calculateMedian([500, 100]), 300);
});

test("calculateMedian: does not mutate input", () => {
  const input = [3, 1, 2];
  calculateMedian(input);
  assert.deepEqual(input, [3, 1, 2]);
});

test("resolveMedianScope: category >= MIN -> category", () => {
  assert.equal(
    resolveMedianScope({
      categorySelected: true,
      branchSelected: false,
      categoryCandidateCount: CATEGORY_MEDIAN_MIN_PRODUCTS,
    }),
    "category"
  );
});

test("resolveMedianScope: category < MIN + branch -> branch fallback", () => {
  assert.equal(
    resolveMedianScope({
      categorySelected: true,
      branchSelected: true,
      categoryCandidateCount: CATEGORY_MEDIAN_MIN_PRODUCTS - 1,
    }),
    "branch"
  );
});

test("resolveMedianScope: category < MIN, no branch -> restaurant fallback", () => {
  assert.equal(
    resolveMedianScope({
      categorySelected: true,
      branchSelected: false,
      categoryCandidateCount: CATEGORY_MEDIAN_MIN_PRODUCTS - 1,
    }),
    "restaurant"
  );
});

test("resolveMedianScope: branch only -> branch; none -> restaurant", () => {
  assert.equal(
    resolveMedianScope({
      categorySelected: false,
      branchSelected: true,
      categoryCandidateCount: 0,
    }),
    "branch"
  );
  assert.equal(
    resolveMedianScope({
      categorySelected: false,
      branchSelected: false,
      categoryCandidateCount: 0,
    }),
    "restaurant"
  );
});

test("classify: STAR (high qty + high profit)", () => {
  const r = classifyProduct(baseInput());
  assert.equal(r.classification, "STAR");
});

test("classify: PLOWHORSE (high qty, low profit)", () => {
  const r = classifyProduct(baseInput({ grossProfit: 100 }));
  assert.equal(r.classification, "PLOWHORSE");
});

test("classify: PUZZLE (low qty, high profit)", () => {
  const r = classifyProduct(
    baseInput({ qtySold: 1, orderCount: 3 })
  );
  assert.equal(r.classification, "PUZZLE");
});

test("classify: DOG (low qty, low profit)", () => {
  const r = classifyProduct(
    baseInput({ qtySold: 1, orderCount: 3, grossProfit: 100 })
  );
  assert.equal(r.classification, "DOG");
});

test("classify: boundary is inclusive (>= median)", () => {
  const r = classifyProduct(baseInput({ qtySold: 8, grossProfit: 300 }));
  assert.equal(r.classification, "STAR");
});

test("classify: orderCount < MIN_ORDER_COUNT -> INSUFFICIENT_DATA", () => {
  const r = classifyProduct(baseInput({ orderCount: MIN_ORDER_COUNT - 1 }));
  assert.equal(r.classification, "INSUFFICIENT_DATA");
});

test("classify: qtySold 0 with sales-related orderCount -> NO_DATA (guard order)", () => {
  const r = classifyProduct(baseInput({ qtySold: 0, orderCount: 5 }));
  assert.equal(r.classification, "NO_DATA");
});

test("classify: qtySold 0 + old -> NO_DATA", () => {
  const r = classifyProduct(baseInput({ qtySold: 0, orderCount: 0 }));
  assert.equal(r.classification, "NO_DATA");
});

test("classify: qtySold 0 + new -> NEW", () => {
  const r = classifyProduct(baseInput({ qtySold: 0, orderCount: 0, isNew: true }));
  assert.equal(r.classification, "NEW");
});

test("classify: grossProfit null + uncostedItems>0 + status -> UNCOSTED with reason", () => {
  const r = classifyProduct(
    baseInput({ grossProfit: null, uncostedItems: 2, uncostedStatus: "NO_RECIPE" })
  );
  assert.equal(r.classification, "UNCOSTED");
  assert.equal(r.classificationReason, "NO_RECIPE");
});

test("classify: grossProfit null + legacy only -> UNCOSTED LEGACY", () => {
  const r = classifyProduct(
    baseInput({ grossProfit: null, legacyItems: 3, uncostedItems: 0 })
  );
  assert.equal(r.classification, "UNCOSTED");
  assert.equal(r.classificationReason, "LEGACY");
});

test("classify: grossProfit null, no uncosted/legacy -> UNCOSTED PARTIAL_COVERAGE", () => {
  const r = classifyProduct(baseInput({ grossProfit: null }));
  assert.equal(r.classification, "UNCOSTED");
  assert.equal(r.classificationReason, "PARTIAL_COVERAGE");
});

test("classify: currentSellingPrice null -> NO_PRICE", () => {
  const r = classifyProduct(baseInput({ currentSellingPrice: null }));
  assert.equal(r.classification, "NO_PRICE");
});

test("classify: currentSellingPrice 0 -> NO_PRICE (no div-by-zero)", () => {
  const r = classifyProduct(baseInput({ currentSellingPrice: 0 }));
  assert.equal(r.classification, "NO_PRICE");
});

test("classify: no threshold -> INSUFFICIENT_DATA", () => {
  const r = classifyProduct(baseInput({ qtyMedian: null, profitMedian: null }));
  assert.equal(r.classification, "INSUFFICIENT_DATA");
});

test("classify: negative margin keeps classification + flags insight", () => {
  const r = classifyProduct(
    baseInput({ grossProfit: 100, qtySold: 1, orderCount: 3, negativeMargin: true })
  );
  assert.equal(r.classification, "DOG");
  assert.equal(r.negativeMargin, true);
  assert.match(r.insight, /Current selling price is below current HPP/);
});

test("classify: HPP zero is NOT treated as insufficient (profit present)", () => {
  const r = classifyProduct(baseInput({ grossProfit: 400, qtySold: 20, orderCount: 8 }));
  assert.equal(r.classification, "STAR");
});