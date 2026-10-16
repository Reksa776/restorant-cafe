/** Supported unit conversions. Quantities are converted to the ingredient's base unit. */
const UNIT_GROUP: Record<string, { family: string; factor: string }> = {
  PCS: { family: "count", factor: "1" },
  GRAM: { family: "mass", factor: "1" },
  KG: { family: "mass", factor: "1000" },
  ML: { family: "volume", factor: "1" },
  LITER: { family: "volume", factor: "1000" },
};

/** Multiply a quantity in `from` units by this exact factor to get `to` units. */
export function ingredientUnitFactor(from: string, to: string): string | null {
  const source = UNIT_GROUP[from];
  const target = UNIT_GROUP[to];
  if (!source || !target || source.family !== target.family) return null;
  return from === to ? "1" : String(Number(source.factor) / Number(target.factor));
}

/** Unit choices that can safely be converted to an ingredient's base unit. */
export function compatibleIngredientUnits(baseUnit: string): string[] {
  const base = UNIT_GROUP[baseUnit];
  if (!base) return [];
  return Object.keys(UNIT_GROUP).filter((unit) => UNIT_GROUP[unit].family === base.family);
}
