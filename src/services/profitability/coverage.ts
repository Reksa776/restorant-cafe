import type {
  ProfitabilityCogsState,
  ProfitabilityCoverage,
} from "./profitability.types";

// ============================================================
// D1 — COGS COVERAGE RULES (pure, DB-free)
//
// Shared by Profitabilitas and Menu Engineering so the "is the COGS known?"
// decision can never diverge between reports. No I/O here: every function is
// a deterministic function of the disjoint coverage buckets.
//
// The D1 fix: an EMPTY scope (totalItems === 0) is NOT covered. Previously
// `totalItems === 0` was reported as COVERED, which let a revenue period with
// no in-scope OrderItem (or no snapshot rows at all) display Gross Profit as
// if COGS were 0. An empty scope means the COGS is UNVERIFIED, never zero.
//
// A VALID zero cost is unaffected: an item with status SNAPSHOTTED and
// hppTotal = 0 still counts in `costed`, so `costed === totalItems` (with
// totalItems > 0) remains COVERED and its profit is legitimately computed.
// ============================================================

/**
 * Derive the COGS state from the DISJOINT buckets. Status decides coverage —
 * never the money value — so a valid SNAPSHOTTED COGS of 0 still counts as
 * COVERED.
 *
 *   NO_ITEMS     — no in-scope OrderItem at all (COGS unverifiable; D1)
 *   COVERED      — at least one item and every item is SNAPSHOTTED
 *   PARTIAL      — some items covered, others not (any reason)
 *   PENDING_COGS — PAID but NOT COMPLETED (COGS not yet incurred)
 *   UNCOVERED    — snapshot exists but status <> SNAPSHOTTED
 *   LEGACY       — COMPLETED but no snapshot row
 */
export function deriveCogsState(counts: {
  totalItems: number;
  costed: number;
  uncosted: number;
  legacy: number;
  pending: number;
}): ProfitabilityCogsState {
  const { totalItems, costed, uncosted, legacy, pending } = counts;
  // D1 — empty scope is NOT coverage. Must be checked BEFORE `costed === total`.
  if (totalItems === 0) return "NO_ITEMS";
  if (costed === totalItems) return "COVERED";
  if (costed > 0) return "PARTIAL";
  if (pending > 0) return "PENDING_COGS";
  if (uncosted > 0) return "UNCOVERED";
  return "LEGACY";
}

/**
 * D1 — summary coverage is complete ONLY when at least one in-scope item
 * exists AND every one of them is SNAPSHOTTED. An empty scope is never
 * "complete" (previously it was vacuously true, so Gross Profit = Net Sales).
 */
export function isCoverageComplete(coverage: ProfitabilityCoverage): boolean {
  return (
    coverage.totalOrderItems > 0 &&
    coverage.uncostedOrderItems +
      coverage.legacyOrderItems +
      coverage.pendingOrderItems ===
      0
  );
}

/**
 * D1 — item-set coverage for an aggregated group (Menu Engineering category).
 * Complete only when the group has at least one item and none is
 * uncosted / legacy / pending.
 */
export function isItemSetCoverageComplete(counts: {
  costedItems: number;
  uncostedItems: number;
  legacyItems: number;
  pendingItems: number;
}): boolean {
  const total =
    counts.costedItems +
    counts.uncostedItems +
    counts.legacyItems +
    counts.pendingItems;
  return (
    total > 0 &&
    counts.uncostedItems + counts.legacyItems + counts.pendingItems === 0
  );
}
