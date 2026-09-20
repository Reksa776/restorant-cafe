// ============================================================
// CASHIER TABLE MAP — PURE client helpers (POS "Buat Pesanan").
//
// Reuses the existing floor-layout data WITHOUT duplicating the layout
// engine: table identity/status/capacity always come from `GET /tables`
// (the server truth, exactly what the old <select> used); only the visual
// SHAPE (RECTANGLE/CIRCLE) is borrowed from the branch layout API when it is
// available. There is no canvas/geometry here — the cashier picker is a
// responsive grid of shaped table cards, so x/y/width/height/rotation are
// intentionally ignored (a grid renders cards, not a floor map).
//
// Rules:
//   - status/name/capacity are never read from the layout DTO.
//   - a table with no layout row defaults to RECTANGLE (like the layout
//     editor's default) so the grid always renders.
//   - output order follows the input `tables` order (server sorts by
//     number), so the cashier sees the same ordering as the old <select>.
//   - MAINTENANCE tables are never selectable (matches the old <select>
//     which filtered them out) — here they stay visible but disabled.
// ============================================================

export type CashierTableStatus = "AVAILABLE" | "OCCUPIED" | "MAINTENANCE";

/** The table row the POS already receives from GET /tables. */
export interface CashierTable {
  id: string;
  number: number;
  name: string;
  capacity: number;
  status: string;
  branchId: string | null;
}

/** Shape info borrowed from GET /admin/branches/:id/layout items. */
export interface CashierLayoutItem {
  tableId: string;
  shape: "RECTANGLE" | "CIRCLE";
}

/** One rendered table card: server metadata + layout shape (if any). */
export interface CashierMapTable {
  tableId: string;
  number: number;
  name: string;
  capacity: number;
  status: string;
  shape: "RECTANGLE" | "CIRCLE";
}

/**
 * Merge the branch layout's shapes onto the cashier table list. The layout
 * supplies ONLY `shape` (defaulting to RECTANGLE); every other field is
 * copied from the `tables` row. Layout items whose table is not in the list
 * are ignored (the grid renders exactly what `tables` provides).
 */
export function mergeCashierTables(
  tables: readonly CashierTable[],
  layoutItems: readonly CashierLayoutItem[]
): CashierMapTable[] {
  const shapeByTableId = new Map(
    layoutItems.map((item) => [item.tableId, item.shape])
  );
  return tables.map((table) => ({
    tableId: table.id,
    number: table.number,
    name: table.name,
    capacity: table.capacity,
    status: table.status,
    shape: shapeByTableId.get(table.id) ?? "RECTANGLE",
  }));
}

/** A table is pickable unless it is under maintenance (old <select> rule). */
export function isCashierTableSelectable(status: string): boolean {
  return status !== "MAINTENANCE";
}