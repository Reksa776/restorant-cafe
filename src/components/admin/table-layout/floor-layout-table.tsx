"use client";

import { useRef } from "react";
import type { RestaurantTable } from "@/services/table.service";
import { cn } from "@/lib/utils";
import {
  type DraftTableItem,
  type ResizeCorner,
  rotationAngleToPointer,
} from "./editor-geometry";

const STATUS_DOT: Record<string, string> = {
  AVAILABLE: "bg-green-500",
  OCCUPIED: "bg-red-500",
  MAINTENANCE: "bg-amber-500",
};

type ToVirtual = (e: { clientX: number; clientY: number }) => {
  x: number;
  y: number;
};

type Gesture =
  | { mode: "move"; lastVirtual: { x: number; y: number } }
  | { mode: "resize"; corner: ResizeCorner; lastVirtual: { x: number; y: number } }
  | { mode: "rotate"; lastVirtual: { x: number; y: number } };

interface FloorLayoutTableProps {
  item: DraftTableItem;
  table: RestaurantTable;
  selected: boolean;
  /** false for muted, non-interactive persisted items of INACTIVE tables. */
  interactive: boolean;
  toVirtual: ToVirtual;
  onSelect: (tableId: string) => void;
  onMove: (tableId: string, dx: number, dy: number) => void;
  onResize: (tableId: string, corner: ResizeCorner, dx: number, dy: number) => void;
  onRotate: (tableId: string, angle: number) => void;
}

/**
 * One placed table on the canvas. Rendering + pointer gestures only — NO API
 * calls. All drag/resize/rotate math happens on local draft state (the pure
 * helpers in editor-geometry.ts) and only a later explicit Save persists it.
 *
 * Native pointer events with pointer capture: pointerdown → select + capture,
 * pointermove → update the local draft position/size/rotation, pointerup →
 * release. World↔virtual conversion goes through `toVirtual`, which reads the
 * live canvas rect, so zoom changes are handled automatically.
 */
export function FloorLayoutTable({
  item,
  table,
  selected,
  interactive,
  toVirtual,
  onSelect,
  onMove,
  onResize,
  onRotate,
}: FloorLayoutTableProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);

  const capture = (pointerId: number) => {
    rootRef.current?.setPointerCapture(pointerId);
  };

  const select = (tableId: string) => {
    onSelect(tableId);
  };

  const handleBodyPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    select(item.tableId);
    capture(e.pointerId);
    gesture.current = { mode: "move", lastVirtual: toVirtual(e) };
  };

  const startResize = (corner: ResizeCorner) => (e: React.PointerEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    select(item.tableId);
    capture(e.pointerId);
    gesture.current = { mode: "resize", corner, lastVirtual: toVirtual(e) };
  };

  const startRotate = (e: React.PointerEvent) => {
    if (!interactive) return;
    e.stopPropagation();
    select(item.tableId);
    capture(e.pointerId);
    gesture.current = { mode: "rotate", lastVirtual: toVirtual(e) };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g || !interactive) return;
    const p = toVirtual(e);
    if (g.mode === "move") {
      onMove(item.tableId, p.x - g.lastVirtual.x, p.y - g.lastVirtual.y);
    } else if (g.mode === "resize") {
      onResize(item.tableId, g.corner, p.x - g.lastVirtual.x, p.y - g.lastVirtual.y);
    } else {
      const cx = item.x + item.width / 2;
      const cy = item.y + item.height / 2;
      onRotate(item.tableId, rotationAngleToPointer(cx, cy, p.x, p.y));
    }
    g.lastVirtual = p;
  };

  const endGesture = () => {
    gesture.current = null;
  };

  const corners: ResizeCorner[] = ["nw", "ne", "sw", "se"];
  const cornerPosition: Record<ResizeCorner, string> = {
    nw: "-top-1.5 -left-1.5 cursor-nw-resize",
    ne: "-top-1.5 -right-1.5 cursor-ne-resize",
    sw: "-bottom-1.5 -left-1.5 cursor-sw-resize",
    se: "-bottom-1.5 -right-1.5 cursor-se-resize",
  };

  const compact = item.width < 60 || item.height < 44;

  return (
    <div
      ref={rootRef}
      data-table-id={item.tableId}
      role={interactive ? "button" : undefined}
      aria-label={`Meja ${table.number}${table.name ? ` ${table.name}` : ""}`}
      aria-selected={selected}
      title={interactive ? `Meja ${table.number} — seret untuk memindahkan` : `Meja ${table.number} (nonaktif)`}
      onPointerDown={interactive ? handleBodyPointerDown : undefined}
      onPointerMove={interactive ? handlePointerMove : undefined}
      onPointerUp={interactive ? endGesture : undefined}
      onPointerCancel={interactive ? endGesture : undefined}
      style={{
        left: item.x,
        top: item.y,
        width: item.width,
        height: item.height,
        transform: `rotate(${item.rotation}deg)`,
        borderRadius: item.shape === "CIRCLE" ? "9999px" : "10px",
        touchAction: "none",
      }}
      className={cn(
        "absolute flex items-center justify-center select-none",
        // Visual layer only — geometry is driven by the draft item, never by status.
        interactive
          ? cn("cursor-grab active:cursor-grabbing", selected ? "cursor-move" : "hover:brightness-95")
          : "grayscale opacity-60 cursor-not-allowed",
        selected && interactive && "outline-2 outline-offset-2 outline-brand-primary outline"
      )}
    >
      {/* Number / name / capacity label + informational status dot (status
          never drives geometry). */}
      <div className="pointer-events-none flex flex-col items-center justify-center gap-0.5 px-1 text-center leading-tight">
        {!compact && (
          <span className="flex items-center gap-1" title={`Status: ${table.status}`}>
            <span
              className={cn(
                "inline-block h-1.5 w-1.5 rounded-full",
                STATUS_DOT[table.status] ?? "bg-gray-400"
              )}
            />
          </span>
        )}
        <span className="text-sm font-bold text-gray-800 drop-shadow-sm">
          {table.number}
        </span>
        {table.name && !compact && (
          <span className="max-w-full truncate text-[10px] font-medium text-gray-600">
            {table.name}
          </span>
        )}
        {!compact && (
          <span className="text-[9px] font-medium text-gray-500">
            {table.capacity} org
          </span>
        )}
      </div>

      {/* Selection decoration: rotate knob + 4 corner resize handles. */}
      {selected && interactive && (
        <>
          <div
            className="absolute -top-7 left-1/2 -translate-x-1/2 cursor-grab active:cursor-grabbing touch-none"
            onPointerDown={startRotate}
            title="Putar meja (seret untuk memutar)"
            aria-label="Putar meja"
          >
            <div className="mx-auto h-0.5 w-5 bg-brand-primary" />
            <div className="mx-auto h-2.5 w-2.5 rounded-full border border-brand-primary bg-white shadow-sm" />
          </div>
          {corners.map((corner) => (
            <div
              key={corner}
              className={cn(
                "absolute h-3 w-3 rounded-full border border-brand-primary bg-white shadow-sm",
                cornerPosition[corner]
              )}
              onPointerDown={startResize(corner)}
              title={`Ubah ukuran (pojok ${corner.toUpperCase()})`}
              aria-label={`Ubah ukuran meja dari pojok ${corner.toUpperCase()}`}
            />
          ))}
        </>
      )}
    </div>
  );
}