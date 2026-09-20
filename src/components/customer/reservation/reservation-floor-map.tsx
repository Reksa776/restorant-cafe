"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  FLOOR_MAP_CANVAS_HEIGHT,
  FLOOR_MAP_CANVAS_WIDTH,
  isFloorTableSelectable,
} from "./reservation-floor-map.helpers";
import type { FloorMapTable } from "./reservation-floor-map.helpers";

interface ReservationFloorMapProps {
  /** Merged layout+availability rows (includes unavailable tables). */
  tables: readonly FloorMapTable[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
}

/** Scales the fixed 900×600 virtual canvas to fit the container width (≤1×). */
function useCanvasScale() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      setScale(Math.min(1, width / FLOOR_MAP_CANVAS_WIDTH));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { containerRef, scale };
}

function TableNode({
  table,
  selected,
  onSelect,
}: {
  table: FloorMapTable;
  selected: boolean;
  onSelect: (tableId: string) => void;
}) {
  const selectable = isFloorTableSelectable(table);
  const accessibleName = [
    `Meja ${table.number}`,
    table.name ? `, ${table.name}` : "",
    `, kapasitas ${table.capacity} orang`,
    selectable ? ", tersedia" : ", tidak tersedia",
  ].join("");

  const shapeClass =
    table.shape === "CIRCLE" ? "rounded-full" : "rounded-md";
  const style: CSSProperties = {
    left: table.x,
    top: table.y,
    width: table.width,
    height: table.height,
    transform: `rotate(${table.rotation}deg)`,
  };

  const label = (
    <>
      <span className="block max-w-full truncate px-1 text-[10px] font-bold leading-none">
        Meja {table.number}
      </span>
      {table.name && (
        <span className="block max-w-full truncate px-1 text-[9px] leading-none">
          {table.name}
        </span>
      )}
      <span className="block max-w-full truncate px-1 text-[9px] leading-none opacity-80">
        {table.capacity} org
      </span>
    </>
  );

  if (!selectable) {
    return (
      <div
        style={style}
        role="button"
        aria-disabled="true"
        aria-label={accessibleName}
        tabIndex={-1}
        className={`absolute flex flex-col items-center justify-center border border-dashed border-gray-300 bg-gray-100 text-gray-500 text-center ${shapeClass}`}
      >
        {label}
      </div>
    );
  }

  return (
    <button
      type="button"
      style={style}
      aria-label={accessibleName}
      aria-pressed={selected}
      title={accessibleName}
      onClick={() => onSelect(table.tableId)}
      className={`absolute flex flex-col items-center justify-center border text-center outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${shapeClass} ${
        selected
          ? "border-brand-primary bg-brand-secondary text-brand-primary ring-2 ring-brand-primary/50"
          : "border-green-500 bg-green-50 text-green-900 hover:bg-green-100"
      }`}
    >
      {label}
    </button>
  );
}

export function ReservationFloorMap({
  tables,
  selectedTableId,
  onSelectTable,
}: ReservationFloorMapProps) {
  const { containerRef, scale } = useCanvasScale();
  const scaledWidth = FLOOR_MAP_CANVAS_WIDTH * scale;
  const scaledHeight = FLOOR_MAP_CANVAS_HEIGHT * scale;
  const hasDrawn = scale > 0;

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        Denah meja restoran. Meja hijau tersedia dan dapat dipilih, meja abu-abu
        tidak tersedia. Alternatif yang dapat diakses: gunakan daftar meja.
      </figcaption>

      <ul
        className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5"
        aria-label="Legenda denah meja"
      >
        <li className="flex items-center gap-1.5 text-xs text-gray-600">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-green-500" />
          Tersedia
          <span className="sr-only">— meja dapat dipilih</span>
        </li>
        <li className="flex items-center gap-1.5 text-xs text-gray-600">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full border border-gray-300 bg-gray-100" />
          Tidak tersedia
          <span className="sr-only">— meja tidak dapat dipilih</span>
        </li>
        <li className="flex items-center gap-1.5 text-xs text-gray-600">
          <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-brand-primary" />
          Dipilih
          <span className="sr-only">— meja yang sedang dipilih</span>
        </li>
      </ul>

      <div
        ref={containerRef}
        role="group"
        aria-label="Denah meja interaktif"
        className="relative w-full overflow-hidden rounded-xl border border-gray-200 bg-white"
        style={{ aspectRatio: `${FLOOR_MAP_CANVAS_WIDTH} / ${FLOOR_MAP_CANVAS_HEIGHT}` }}
      >
        {hasDrawn && (
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
            style={{ width: scaledWidth, height: scaledHeight }}
          >
            <div
              className="relative"
              style={{
                width: FLOOR_MAP_CANVAS_WIDTH,
                height: FLOOR_MAP_CANVAS_HEIGHT,
                transform: `scale(${scale})`,
                transformOrigin: "top left",
              }}
            >
              {tables.map((table) => (
                <TableNode
                  key={table.tableId}
                  table={table}
                  selected={table.tableId === selectedTableId}
                  onSelect={onSelectTable}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </figure>
  );
}