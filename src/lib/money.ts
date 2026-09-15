// ============================================================
// Shared monetary rounding utility.
//
// All money/percentage values pass through round2() at the final
// boundary before returning to the client. Half-cent tolerance
// (MONEY_EPSILON) is used for Decimal comparisons.
// ============================================================

/**
 * Round a number to 2 decimal places (monetary standard).
 * Uses the Number.EPSILON addition to avoid IEEE 754 truncation
 * (e.g. 1.005 → 1.01 instead of 1.00).
 */
export function round2(v: number): number {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

/**
 * Convert a Prisma aggregate result (Decimal, bigint, string, null)
 * to a safe JS number rounded to 2dp.
 */
export function num(v: unknown): number {
  const n = Number(v ?? 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Half-cent tolerance for Decimal comparisons. */
export const MONEY_EPSILON = 0.005;
