// ============================================================
// F.6 — MENU ENGINEERING CONSTANTS
//
// Data-driven guards only. No hardcoded business thresholds
// (e.g. "qty >= 100" or "profit >= Rp(...)") — the classification
// axes always use the MEDIAN of the selected scope.
// ============================================================

/** Minimum unique orders before a product can be classified into a quadrant. */
export const MIN_ORDER_COUNT = 2;

/** Minimum sold quantity before a product can be classified. */
export const MIN_QTY_SOLD = 1;

/** A product is "new" when created within this window (days). */
export const NEW_PRODUCT_DAYS = 14;

/** Category medians are used only when the category has >= this many analyzed products. */
export const CATEGORY_MEDIAN_MIN_PRODUCTS = 5;

/** Product table default / maximum page size. */
export const DEFAULT_LIMIT = 25;
export const MAX_LIMIT = 100;

/** Bounded fetches when reading full datasets from the existing engines. */
export const PROFITABILITY_FETCH_LIMIT = 200;
export const COSTING_FETCH_LIMIT = 100;
export const MAX_ACTIVE_PRODUCTS = 5000;
export const MAX_FETCH_PAGES = 10;

/** Deterministic (non-AI) insight copy per classification. */
export const CLASSIFICATION_INSIGHTS: Record<
  string,
  string
> = {
  STAR: "High sales volume and strong profitability.",
  PLOWHORSE: "High sales volume but profitability is below the scope median.",
  PUZZLE: "Strong profitability but sales volume is below the scope median.",
  DOG: "Low sales volume and low profitability.",
  NEGATIVE_MARGIN: "Current selling price is below current HPP.",
  UNCOSTED: "Profitability unavailable because historical cost coverage is incomplete.",
  NO_DATA: "No sales in the selected period.",
  INSUFFICIENT_DATA: "Not enough sales data for reliable classification.",
  NEW: "New product — monitor performance.",
} as const;

// ============================================================
// Pure classification + threshold helpers (dependency-free so they
// can be unit-tested without a database / Next runtime).
// ============================================================

const round2 = (v: number): number =>
  Math.round((v + Number.EPSILON) * 100) / 100;

/** Median of a numeric set — the ONLY default axis threshold (never the mean). */
export function calculateMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? round2((sorted[mid - 1] + sorted[mid]) / 2)
    : round2(sorted[mid]);
}

/**
 * Resolve which scope the MEDIAN is computed in.
 * Category scope is used ONLY when the category has at least
 * CATEGORY_MEDIAN_MIN_PRODUCTS analyzed products; otherwise it falls
 * back to the previous scope (branch if a branch is active, else restaurant).
 */
export function resolveMedianScope(opts: {
  categorySelected: boolean;
  branchSelected: boolean;
  categoryCandidateCount: number;
}): "restaurant" | "branch" | "category" {
  if (
    opts.categorySelected &&
    opts.categoryCandidateCount >= CATEGORY_MEDIAN_MIN_PRODUCTS
  ) {
    return "category";
  }
  if (opts.branchSelected) return "branch";
  return "restaurant";
}

export interface ClassifyInput {
  qtySold: number;
  orderCount: number;
  grossProfit: number | null;
  currentSellingPrice: number | null;
  isNew: boolean;
  uncostedItems: number;
  legacyItems: number;
  uncostedStatus: string | null;
  negativeMargin: boolean;
  /** null = no threshold available (no sufficient+profitable products). */
  qtyMedian: number | null;
  profitMedian: number | null;
}

export interface ClassifyResult {
  classification: "STAR" | "PLOWHORSE" | "PUZZLE" | "DOG" | "NEW" | "NO_DATA" | "INSUFFICIENT_DATA" | "UNCOSTED" | "NO_PRICE";
  classificationReason: string | null;
  insight: string;
  negativeMargin: boolean;
}

export function classifyProduct(input: ClassifyInput): ClassifyResult {
  const { qtySold, orderCount, grossProfit, currentSellingPrice, isNew } = input;

  // 1. No sales → NEW (recently created) / NO_DATA.
  if (qtySold === 0 || orderCount === 0) {
    if (isNew) {
      return {
        classification: "NEW",
        classificationReason: "Created in the last 14 days / within the selected period.",
        insight: CLASSIFICATION_INSIGHTS.NEW,
        negativeMargin: input.negativeMargin,
      };
    }
    return {
      classification: "NO_DATA",
      classificationReason: null,
      insight: CLASSIFICATION_INSIGHTS.NO_DATA,
      negativeMargin: input.negativeMargin,
    };
  }

  // 2. Data sufficiency.
  if (orderCount < MIN_ORDER_COUNT || qtySold < MIN_QTY_SOLD) {
    return {
      classification: "INSUFFICIENT_DATA",
      classificationReason: null,
      insight: CLASSIFICATION_INSIGHTS.INSUFFICIENT_DATA,
      negativeMargin: input.negativeMargin,
    };
  }

  // 3. Coverage — never synthesize COGS/profit.
  if (grossProfit === null) {
    let reason: string | null = null;
    if (input.legacyItems > 0 && input.uncostedItems === 0) {
      reason = "LEGACY";
    } else if (input.uncostedItems > 0) {
      reason = input.uncostedStatus ?? "NO_RECIPE";
    } else {
      reason = "PARTIAL_COVERAGE";
    }
    return {
      classification: "UNCOSTED",
      classificationReason: reason,
      insight: CLASSIFICATION_INSIGHTS.UNCOSTED,
      negativeMargin: input.negativeMargin,
    };
  }

  // 4. No current price → cannot be placed on the current-profit axis.
  if (currentSellingPrice === null || currentSellingPrice <= 0) {
    return {
      classification: "NO_PRICE",
      classificationReason: "Current selling price is not set (<= 0).",
      insight: "No current selling price set.",
      negativeMargin: input.negativeMargin,
    };
  }

  // 5. Quadrant (median-based).
  if (input.qtyMedian === null || input.profitMedian === null) {
    return {
      classification: "INSUFFICIENT_DATA",
      classificationReason: null,
      insight: CLASSIFICATION_INSIGHTS.INSUFFICIENT_DATA,
      negativeMargin: input.negativeMargin,
    };
  }

  const highQty = qtySold >= input.qtyMedian;
  const highProfit = grossProfit >= input.profitMedian;
  let classification: ClassifyResult["classification"];
  let insight: string;
  if (highQty && highProfit) {
    classification = "STAR";
    insight = CLASSIFICATION_INSIGHTS.STAR;
  } else if (highQty) {
    classification = "PLOWHORSE";
    insight = CLASSIFICATION_INSIGHTS.PLOWHORSE;
  } else if (highProfit) {
    classification = "PUZZLE";
    insight = CLASSIFICATION_INSIGHTS.PUZZLE;
  } else {
    classification = "DOG";
    insight = CLASSIFICATION_INSIGHTS.DOG;
  }
  if (input.negativeMargin) {
    insight = `${insight} ${CLASSIFICATION_INSIGHTS.NEGATIVE_MARGIN}`;
  }
  return {
    classification,
    classificationReason: null,
    insight,
    negativeMargin: input.negativeMargin,
  };
}