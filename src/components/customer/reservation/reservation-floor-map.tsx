"use client";

import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  FLOOR_MAP_CANVAS_HEIGHT,
  FLOOR_MAP_CANVAS_WIDTH,
  isFloorTableSelectable,
  splitFloorMapTables,
} from "./reservation-floor-map.helpers";
import type {
  FloorMapStatus,
  FloorMapTable,
} from "./reservation-floor-map.helpers";

interface ReservationFloorMapProps {
  /** Merged layout+availability rows (includes unavailable tables). */
  tables: readonly FloorMapTable[];
  selectedTableId: string | null;
  onSelectTable: (tableId: string) => void;
}

/**
 * Minimum canvas scale on narrow screens.
 *
 * The admin canvas is a fixed 900×600 virtual space. Scaling it 1:1 with the
 * viewport made mobile tables unreadable (~0.42× at 375px → ~4px labels and
 * ~46×29px hit areas). We clamp the scale to this floor so a table keeps a
 * comfortably tappable area and a legible label; when the floor scale makes
 * the canvas wider than its frame, the frame itself scrolls horizontally —
 * never the page.
 */
const FLOOR_MAP_MIN_SCALE = 0.8;

/** Per-status visual language (design-system colors). */
const STATUS_STYLES: Record<
  FloorMapStatus,
  { box: string; badge: string; dot: string; label: string; hint: string }
> = {
  AVAILABLE: {
    box: "border-green-500 bg-green-50 text-green-900 hover:bg-green-100",
    badge: "bg-green-600",
    dot: "bg-green-500",
    label: "Tersedia",
    hint: "tersedia dan dapat dipilih",
  },
  RESERVED: {
    box: "border-amber-400 bg-amber-50 text-amber-900",
    badge: "bg-amber-500",
    dot: "bg-amber-500",
    label: "Dipesan",
    hint: "sudah ada reservasi pada jam ini",
  },
};

/**
 * Scales the fixed 900×600 virtual canvas to the container width, clamped to
 * [FLOOR_MAP_MIN_SCALE, 1]. The geometry (x/y/width/height/rotation/shape)
 * itself is never touched — only the uniform display scale changes.
 */
function useCanvasScale() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0);
  const [containerWidth, setContainerWidth] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const compute = () => {
      const width = el.clientWidth;
      if (width <= 0) return;
      setContainerWidth(width);
      const fit = width / FLOOR_MAP_CANVAS_WIDTH;
      setScale(Math.max(FLOOR_MAP_MIN_SCALE, Math.min(1, fit)));
    };
    compute();
    const observer = new ResizeObserver(compute);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { containerRef, scale, containerWidth };
}

function statusLabelClass(table: FloorMapTable): string {
  return STATUS_STYLES[table.status].badge;
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
  const styleDef = STATUS_STYLES[table.status];
  const accessibleName = [
    `Meja ${table.number}`,
    table.name ? `, ${table.name}` : "",
    `, kapasitas ${table.capacity} orang`,
    `, status ${styleDef.label}`,
    selectable ? ", dapat dipilih" : ", tidak dapat dipilih",
  ].join("");

  const shapeClass = table.shape === "CIRCLE" ? "rounded-full" : "rounded-md";
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
      <span
        className={`mt-0.5 block max-w-full truncate rounded-full px-1.5 py-px text-[8px] font-semibold leading-none text-white ${statusLabelClass(
          table
        )}`}
      >
        {styleDef.label}
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
        title={accessibleName}
        className={`absolute flex flex-col items-center justify-center border text-center opacity-80 ${shapeClass} ${styleDef.box}`}
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
          : styleDef.box
      }`}
    >
      {label}
    </button>
  );
}

/** Fallback card for a table that has no TableLayoutItem (no geometry). */
function FallbackTableCard({
  table,
  selected,
  onSelect,
}: {
  table: FloorMapTable;
  selected: boolean;
  onSelect: (tableId: string) => void;
}) {
  const selectable = isFloorTableSelectable(table);
  const styleDef = STATUS_STYLES[table.status];

  const inner = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-gray-900">
          Meja {table.number}
        </p>
        {table.name && (
          <p className="mt-0.5 text-xs text-gray-500 break-words">{table.name}</p>
        )}
        <p className="mt-1.5 text-[11px] font-medium text-gray-400">
          Kapasitas {table.capacity} orang
        </p>
      </div>
      <span
        className={`shrink-0 rounded-full text-xs font-bold px-3 py-1 text-white ${styleDef.badge}`}
      >
        {styleDef.label}
      </span>
    </div>
  );

  if (!selectable) {
    return (
      <div
        aria-disabled="true"
        aria-label={`Meja ${table.number}, ${styleDef.label}, tidak dapat dipilih`}
        className={`w-full rounded-xl border border-dashed p-4 opacity-80 ${styleDef.box}`}
      >
        {inner}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(table.tableId)}
      aria-pressed={selected}
      className={`w-full rounded-xl border p-4 text-left transition-colors ${
        selected
          ? "border-brand-primary bg-brand-secondary ring-2 ring-brand-primary/40"
          : styleDef.box
      }`}
    >
      {inner}
    </button>
  );
}

export function ReservationFloorMap({
  tables,
  selectedTableId,
  onSelectTable,
}: ReservationFloorMapProps) {
  const { containerRef, scale, containerWidth } = useCanvasScale();
  const scaledWidth = FLOOR_MAP_CANVAS_WIDTH * scale;
  const scaledHeight = FLOOR_MAP_CANVAS_HEIGHT * scale;
  const hasDrawn = scale > 0;
  // True only when the floor scale kicked in (narrow screen): the frame
  // scrolls horizontally, the page never does.
  const isScrollable = hasDrawn && scaledWidth > containerWidth + 1;

  const { placed, unplaced } = splitFloorMapTables(tables);

  return (
    <figure className="w-full">
      <figcaption className="sr-only">
        Denah meja restoran. Hijau tersedia dan dapat dipilih, jingga sudah
        dipesan pada jam ini (tidak dapat dipilih). Status meja di halaman
        reservasi hanya ditentukan oleh reservasi. Meja yang tidak dapat
        dipilih tetap ditampilkan. Alternatif yang dapat diakses: gunakan
        daftar meja.
      </figcaption>

      <ul
        className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5"
        aria-label="Legenda denah meja"
      >
        {(["AVAILABLE", "RESERVED"] as FloorMapStatus[]).map((status) => (
          <li
            key={status}
            className="flex items-center gap-1.5 text-xs text-gray-600"
          >
            <span
              aria-hidden="true"
              className={`h-2.5 w-2.5 rounded-full ${STATUS_STYLES[status].dot}`}
            />
            {STATUS_STYLES[status].label}
            <span className="sr-only">— {STATUS_STYLES[status].hint}</span>
          </li>
        ))}
        <li className="flex items-center gap-1.5 text-xs text-gray-600">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-brand-primary"
          />
          Dipilih
        </li>
      </ul>

      {/* Outer wrapper only reserves the canvas height before the first
          measurement (aspect-ratio) and otherwise follows the frame. */}
      <div
        className="relative w-full"
        style={{
          aspectRatio: hasDrawn
            ? undefined
            : `${FLOOR_MAP_CANVAS_WIDTH} / ${FLOOR_MAP_CANVAS_HEIGHT}`,
        }}
      >
        {/* Horizontally scrollable on narrow screens; clamped to the viewport
            width on tablets/desktop so no page overflow ever appears. */}
        <div
          ref={containerRef}
          role="group"
          aria-label="Denah meja interaktif"
          className="w-full max-w-full overflow-x-auto overflow-y-hidden overscroll-x-contain rounded-xl border border-gray-200 bg-white"
          style={{ height: hasDrawn ? scaledHeight : undefined }}
        >
          {hasDrawn && (
            <div
              className="relative"
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
                {placed.map((table) => (
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
      </div>

      {isScrollable && (
        <p className="mt-2 text-center text-xs text-gray-400">
          Geser denah untuk melihat meja lainnya
        </p>
      )}

      {unplaced.length > 0 && (
        <div className="mt-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-3">
          <p className="mb-2 text-xs font-medium text-gray-500">
            Meja belum ditata di denah — tetap dapat dipilih.
          </p>
          <div className="grid gap-2.5 grid-cols-1 sm:grid-cols-2">
            {unplaced.map((table) => (
              <FallbackTableCard
                key={table.tableId}
                table={table}
                selected={table.tableId === selectedTableId}
                onSelect={onSelectTable}
              />
            ))}
          </div>
        </div>
      )}
    </figure>
  );
}
