import { Prisma } from "@prisma/client";

// ============================================================
// H4.2 — Tolerant reader for the stored `OrderItem.customizations` snapshot.
//
// The column is `Json` but the writer stores `JSON.stringify(...)`, so the
// value can legitimately be a JSON *string* (double-encoded). Existing
// readers already defend against this (kitchen ticket, order card, bill
// print, public order API). This module is the SERVER-side equivalent and
// additionally extracts ONLY the reference IDs + quantities that costing is
// allowed to trust.
//
// Costing rules enforced here:
//   - never trust `price` / `priceAdjustment` / `name` — those are display
//     snapshots and must never be used as cost.
//   - only `addons[].addonId`, `addons[].quantity` and `selections[].optionId`
//     are read.
//   - malformed / unknown shapes never throw: they surface as
//     `malformed: true` (or an addon with `invalidQuantity`), which the
//     costing engine turns into an explicit INCOMPLETE state instead of an
//     arbitrary / fabricated cost.
// ============================================================

/** One selected addon: the addon ID + how many units were selected. */
export interface SelectedAddon {
  addonId: string;
  /** Stored quantity; defaults to 1 when the stored value was missing. */
  quantity: number;
  /**
   * true when a stored quantity was PRESENT but not a positive integer
   * (0 / negative / fractional / non-numeric). A missing quantity is NOT
   * invalid — it defaults to 1.
   */
  invalidQuantity: boolean;
}

/** One selected option. Option selection quantity is implicitly 1. */
export interface SelectedOption {
  optionId: string;
}

export interface CustomizationSelection {
  addons: SelectedAddon[];
  options: SelectedOption[];
  /**
   * true when a NON-EMPTY customization value could not be interpreted at all
   * (malformed JSON, JSON scalar, JSON array, …). Costing treats this as an
   * incomplete customization state, never as "no customization".
   */
  malformed: boolean;
}

/**
 * Parse a stored customization value into an object, tolerating:
 *   1. a Json object
 *   2. a JSON string containing an object (single or double encoded)
 *   3. null / undefined / empty string  → null
 *   4. malformed / legacy values        → null (never throws)
 */
export function parseCustomizations(value: unknown): Record<string, unknown> | null {
  if (value == null) return null;

  let current: unknown = value;
  // A Json column written with JSON.stringify can be encoded twice — unwrap
  // up to 3 levels, then require a plain object.
  for (let depth = 0; depth < 3; depth++) {
    if (typeof current !== "string") break;
    const trimmed = current.trim();
    if (!trimmed) return null;
    try {
      current = JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  if (typeof current !== "object" || current === null || Array.isArray(current)) {
    return null;
  }
  return current as Record<string, unknown>;
}

/** Extract the only customization data costing may trust: IDs + quantities. */
export function extractSelection(value: unknown): CustomizationSelection {
  const isEmptyInput =
    value == null || (typeof value === "string" && value.trim() === "");
  if (isEmptyInput) return { addons: [], options: [], malformed: false };

  const parsed = parseCustomizations(value);
  if (!parsed) return { addons: [], options: [], malformed: true };

  const addons: SelectedAddon[] = [];
  if (Array.isArray(parsed.addons)) {
    for (const entry of parsed.addons) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.addonId !== "string" || row.addonId === "") continue;
      const q = row.quantity;
      // A MISSING quantity is a legitimate default of 1 (order creation always
      // stores it, but legacy/hand-written payloads may omit it). A PRESENT
      // but non-positive-integer quantity is untrustworthy and is flagged so
      // costing marks it INCOMPLETE and consumption BLOCKS the completion.
      if (q == null) {
        addons.push({ addonId: row.addonId, quantity: 1, invalidQuantity: false });
        continue;
      }
      const valid = typeof q === "number" && Number.isInteger(q) && q > 0;
      addons.push({
        addonId: row.addonId,
        quantity: valid ? (q as number) : 1,
        invalidQuantity: !valid,
      });
    }
  }

  const options: SelectedOption[] = [];
  if (Array.isArray(parsed.selections)) {
    for (const entry of parsed.selections) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.optionId === "string" && row.optionId !== "") {
        options.push({ optionId: row.optionId });
      }
    }
  }

  return { addons, options, malformed: false };
}

// ============================================================
// Shared row shapes + cost math for ONE addon / ONE option.
// Used by the product-level catalog AND the selection-aware HPP so both
// paths agree by construction.
// ============================================================

export interface ComponentIngredientRow {
  id: string;
  name: string;
  baseUnit: string;
  isActive: boolean;
  branchIngredients: Array<{ averageCost: Prisma.Decimal | null }>;
}

export interface ComponentBomRow {
  quantity: Prisma.Decimal;
  unit: string;
  ingredient: ComponentIngredientRow;
}

export interface ComponentRow {
  id: string;
  name: string;
  /** Active state of the addon/option — an inactive component is incomplete. */
  isActive: boolean;
  /** Addon selling price, or option price adjustment — NEVER used as cost. */
  sellingPrice: Prisma.Decimal;
  ingredients: ComponentBomRow[];
}

export type ComponentKind = "ADDON" | "OPTION";

/** Reasons a component's HPP cannot be resolved — no silent zero. */
export type ComponentReason =
  | "NO_BOM"
  | "MISSING_WAC"
  | "INACTIVE_INGREDIENT"
  | "INACTIVE_COMPONENT"
  | "NOT_FOUND"
  | "INVALID_QUANTITY"
  | "MALFORMED_CUSTOMIZATION";

export interface ComponentIngredientCost {
  ingredientId: string;
  ingredientName: string;
  baseUnit: string;
  quantity: string;
  unit: string;
  wac: Prisma.Decimal | null;
  cost: Prisma.Decimal | null;
  zeroCost: boolean;
  missingReason: "MISSING_WAC" | "INACTIVE_INGREDIENT" | null;
}

export interface ComponentCost {
  kind: ComponentKind;
  id: string;
  name: string;
  sellingPrice: Prisma.Decimal;
  /** Per ONE component unit (before any addon quantity multiplication). */
  unitHpp: Prisma.Decimal | null;
  status: "COMPLETE" | "INCOMPLETE";
  reasons: ComponentReason[];
  items: ComponentIngredientCost[];
}

/**
 * Cost ONE addon/option unit from its mini-BOM × the branch WAC.
 *
 * - no BOM line at all          → INCOMPLETE (NO_BOM) — never a fabricated 0
 * - inactive ingredient         → INCOMPLETE (INACTIVE_INGREDIENT)
 * - missing BranchIngredient/WAC→ INCOMPLETE (MISSING_WAC)
 * - averageCost = 0             → COMPLETE with cost 0 (a real zero cost)
 */
export function computeComponentCost(
  kind: ComponentKind,
  row: ComponentRow
): ComponentCost {
  const items: ComponentIngredientCost[] = [];
  const reasons = new Set<ComponentReason>();
  let sum = new Prisma.Decimal(0);
  let covered = 0;

  for (const line of row.ingredients) {
    const ingredient = line.ingredient;
    const branchIngredient = ingredient.branchIngredients[0] ?? null;

    if (!ingredient.isActive) {
      reasons.add("INACTIVE_INGREDIENT");
      items.push(toIngredientCost(line, null, null, false, "INACTIVE_INGREDIENT"));
      continue;
    }
    if (!branchIngredient || branchIngredient.averageCost == null) {
      reasons.add("MISSING_WAC");
      items.push(toIngredientCost(line, null, null, false, "MISSING_WAC"));
      continue;
    }

    const wac = branchIngredient.averageCost;
    const cost = line.quantity.mul(wac);
    sum = sum.add(cost);
    covered += 1;
    items.push(toIngredientCost(line, wac, cost, wac.isZero(), null));
  }

  if (row.ingredients.length === 0) reasons.add("NO_BOM");

  const status =
    reasons.size === 0 && covered === row.ingredients.length ? "COMPLETE" : "INCOMPLETE";

  return {
    kind,
    id: row.id,
    name: row.name,
    sellingPrice: row.sellingPrice,
    unitHpp: status === "COMPLETE" ? sum : null,
    status,
    reasons: [...reasons],
    items,
  };
}

// ============================================================
// H4.3 — Aggregate a WHOLE order-item selection into its HPP contribution.
//
// Shared by the historical snapshot (H4.3) and, by construction, identical to
// the per-component math used by the current selection-aware costing (H4.2)
// because both call `computeComponentCost`. A frozen cost can therefore never
// disagree with the live one.
//
// `addonRows` / `optionRows` are ALREADY scoped to the order item's product by
// the caller, so a foreign addon/option can never contribute cost.
// ============================================================

export interface SelectionCost {
  /** true when the stored customization referenced at least one component. */
  hasSelection: boolean;
  /** Per-one-unit addon contribution; null when any selected addon is incomplete. */
  addonHpp: Prisma.Decimal | null;
  /** Per-one-unit option contribution; null when any selected option is incomplete. */
  optionHpp: Prisma.Decimal | null;
  /** true only when every selected component resolves (and nothing is malformed). */
  complete: boolean;
  reasons: ComponentReason[];
}

export function aggregateSelectionCost(
  selection: CustomizationSelection,
  addonRows: Map<string, ComponentRow>,
  optionRows: Map<string, ComponentRow>
): SelectionCost {
  const reasons = new Set<ComponentReason>();
  if (selection.malformed) reasons.add("MALFORMED_CUSTOMIZATION");

  let addonSum = new Prisma.Decimal(0);
  let addonOk = !selection.malformed;
  for (const selected of selection.addons) {
    const row = addonRows.get(selected.addonId);
    if (!row || !row.isActive) {
      reasons.add(row ? "INACTIVE_COMPONENT" : "NOT_FOUND");
      addonOk = false;
      continue;
    }
    // A stored quantity that is not a positive integer is not trustworthy.
    if (selected.invalidQuantity) {
      reasons.add("INVALID_QUANTITY");
      addonOk = false;
      continue;
    }
    const cost = computeComponentCost("ADDON", row);
    if (cost.status !== "COMPLETE" || cost.unitHpp == null) {
      cost.reasons.forEach((r) => reasons.add(r));
      addonOk = false;
      continue;
    }
    addonSum = addonSum.add(cost.unitHpp.mul(selected.quantity));
  }

  let optionSum = new Prisma.Decimal(0);
  let optionOk = !selection.malformed;
  for (const selected of selection.options) {
    const row = optionRows.get(selected.optionId);
    if (!row || !row.isActive) {
      reasons.add(row ? "INACTIVE_COMPONENT" : "NOT_FOUND");
      optionOk = false;
      continue;
    }
    const cost = computeComponentCost("OPTION", row);
    if (cost.status !== "COMPLETE" || cost.unitHpp == null) {
      cost.reasons.forEach((r) => reasons.add(r));
      optionOk = false;
      continue;
    }
    optionSum = optionSum.add(cost.unitHpp);
  }

  const hasSelection =
    selection.malformed ||
    selection.addons.length > 0 ||
    selection.options.length > 0;
  const complete = !selection.malformed && addonOk && optionOk;

  return {
    hasSelection,
    addonHpp:
      selection.addons.length === 0
        ? new Prisma.Decimal(0)
        : addonOk
          ? addonSum
          : null,
    optionHpp:
      selection.options.length === 0
        ? new Prisma.Decimal(0)
        : optionOk
          ? optionSum
          : null,
    complete,
    reasons: [...reasons],
  };
}

function toIngredientCost(
  line: ComponentBomRow,
  wac: Prisma.Decimal | null,
  cost: Prisma.Decimal | null,
  zeroCost: boolean,
  missingReason: "MISSING_WAC" | "INACTIVE_INGREDIENT" | null
): ComponentIngredientCost {
  return {
    ingredientId: line.ingredient.id,
    ingredientName: line.ingredient.name,
    baseUnit: line.ingredient.baseUnit,
    quantity: line.quantity.toString(),
    unit: line.unit,
    wac,
    cost,
    zeroCost,
    missingReason,
  };
}

