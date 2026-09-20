"use client";

import { useMemo } from "react";
import type { CashierLayoutItem, CashierTable, CashierMapTable } from "./cashier-table-map.helpers";
import {
  isCashierTableSelectable,
  mergeCashierTables,
} from "./cashier-table-map.helpers";

// ============================================================
// CASHIER TABLE MAP — POS "Buat Pesanan" table picker (DINE_IN).
//
// Replaces the old plain `<select>` with a responsive grid of shaped table
// cards. It is a GRID, not a canvas: RECTANGLE tables render as rounded
// rectangles and CIRCLE tables as circles so the "restaurant floor" feels
// present, while number stays the hero and status stays clearly labelled.
//
// Behaviour is identical to the old <select>:
//   - clicking a card calls onSelectTable(tableId) → setTableId() unchanged;
//   - MAINTENANCE tables are NOT pickable (old select filtered them out) —
//     here they stay visible but disabled;
//   - OCCUPIED tables remain pickable (flow/review already warns);
//   - every other field comes from GET /tables, never from the layout DTO.
// ============================================================

interface CashierTableMapProps {
  tables: readonly CashierTable[];
  layoutItems: readonly CashierLayoutItem[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
}

const STATUS_LABELS: Record<string, string> = {
  AVAILABLE: "Tersedia",
  OCCUPIED: "Terisi",
  MAINTENANCE: "Maintenance",
};

const STATUS_BORDER: Record<string, string> = {
  AVAILABLE: "border-green-400 bg-green-50 text-green-900",
  OCCUPIED: "border-red-300 bg-red-50 text-red-800",
  MAINTENANCE: "border-amber-300 bg-amber-50 text-amber-800",
};

const STATUS_BADGE: Record<string, string> = {
  AVAILABLE: "bg-green-100 text-green-700",
  OCCUPIED: "bg-red-100 text-red-700",
  MAINTENANCE: "bg-amber-100 text-amber-700",
};

const STATUS_DOT: Record<string, string> = {
  AVAILABLE: "bg-green-500",
  OCCUPIED: "bg-red-500",
  MAINTENANCE: "bg-amber-500",
};

function TableCard({
  table,
  selected,
  onSelect,
}: {
  table: CashierMapTable;
  selected: boolean;
  onSelect: (tableId: string) => void;
}) {
  const selectable = isCashierTableSelectable(table.status);
  const statusLabel = STATUS_LABELS[table.status] ?? table.status;
  const accessibleName = [
    `Meja ${table.number}`,
    table.name ? `, ${table.name}` : "",
    `, kapasitas ${table.capacity} orang`,
    `, ${statusLabel}`,
  ].join("");

  const shapeClasses =
    table.shape === "CIRCLE"
      ? "h-20 w-20 rounded-full"
      : "h-20 w-full rounded-xl";

  return (
    <li className="flex justify-center">
      <button
        type="button"
        disabled={!selectable}
        aria-pressed={selected}
        aria-label={accessibleName}
        title={accessibleName}
        onClick={() => onSelect(table.tableId)}
        className={`${shapeClasses} flex flex-col items-center justify-center border-2 px-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand-primary ${
          selectable ? "cursor-pointer" : "cursor-not-allowed opacity-60"
        } ${
          selected
            ? "border-brand-primary bg-brand-secondary text-brand-primary ring-2 ring-brand-primary/40"
            : STATUS_BORDER[table.status] ?? "border-gray-300 bg-gray-50 text-gray-700"
        }`}
      >
        <span className="block max-w-full truncate text-lg font-extrabold leading-none">
          {table.number}
        </span>
        <span className="mt-0.5 block max-w-full truncate text-[10px] font-medium leading-none opacity-80">
          {table.capacity} org
        </span>
        <span
          className={`mt-1 block max-w-full truncate rounded-full px-1.5 py-0.5 text-[9px] font-semibold leading-none ${
            selected
              ? "bg-brand-primary text-brand-primary-foreground"
              : STATUS_BADGE[table.status] ?? "bg-gray-100 text-gray-600"
          }`}
        >
          {statusLabel}
        </span>
      </button>
    </li>
  );
}

export function CashierTableMap({
  tables,
  layoutItems,
  selectedTableId,
  onSelectTable,
}: CashierTableMapProps) {
  const merged = useMemo(
    () => mergeCashierTables(tables, layoutItems),
    [tables, layoutItems]
  );

  return (
    <div className="space-y-2.5">
      <ul
        className="flex flex-wrap items-center gap-x-4 gap-y-1"
        aria-label="Legenda status meja"
      >
        {(["AVAILABLE", "OCCUPIED", "MAINTENANCE"] as const).map((status) => (
          <li key={status} className="flex items-center gap-1.5 text-xs text-gray-600">
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`}
            />
            {STATUS_LABELS[status]}
          </li>
        ))}
      </ul>

      {merged.length === 0 ? (
        <p className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-4 text-center text-sm text-gray-500">
          Belum ada meja untuk cabang ini.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {merged.map((table) => (
            <TableCard
              key={table.tableId}
              table={table}
              selected={table.tableId === selectedTableId}
              onSelect={onSelectTable}
            />
          ))}
        </ul>
      )}
    </div>
  );
}