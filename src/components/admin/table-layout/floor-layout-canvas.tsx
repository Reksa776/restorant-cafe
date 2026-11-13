"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RestaurantTable } from "@/services/table.service";
import {
  EDITOR_CANVAS_HEIGHT,
  EDITOR_CANVAS_WIDTH,
  type DraftTableItem,
  type DraftLayoutZone,
  type ResizeCorner,
} from "./editor-geometry";
import { FloorLayoutTable } from "./floor-layout-table";

const GRID_LINES = 60;
const MIN_FIT_SCALE = 0.25;
const MAX_FIT_SCALE = 1.5;

function ZoneCanvasItem({
  zone, selected, toVirtual, onSelect, onMove, onResize,
}: {
  zone: DraftLayoutZone;
  selected: boolean;
  toVirtual: (point: { clientX: number; clientY: number }) => { x: number; y: number };
  onSelect: (id: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onResize: (id: string, corner: ResizeCorner, dx: number, dy: number) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ corner: ResizeCorner | null; point: { x: number; y: number } } | null>(null);
  const begin = (e: React.PointerEvent, corner: ResizeCorner | null) => {
    e.stopPropagation();
    e.preventDefault();
    onSelect(zone.id);
    root.current?.setPointerCapture(e.pointerId);
    gesture.current = { corner, point: toVirtual(e) };
  };
  const move = (e: React.PointerEvent) => {
    const current = gesture.current;
    if (!current) return;
    const point = toVirtual(e);
    const dx = point.x - current.point.x;
    const dy = point.y - current.point.y;
    if (current.corner) onResize(zone.id, current.corner, dx, dy);
    else onMove(zone.id, dx, dy);
    current.point = point;
  };
  const handles: Array<{ corner: ResizeCorner; className: string }> = [
    { corner: "nw", className: "-left-1.5 -top-1.5 cursor-nw-resize" },
    { corner: "ne", className: "-right-1.5 -top-1.5 cursor-ne-resize" },
    { corner: "sw", className: "-bottom-1.5 -left-1.5 cursor-sw-resize" },
    { corner: "se", className: "-bottom-1.5 -right-1.5 cursor-se-resize" },
  ];
  const color = zone.type === "SMOKING" ? "border-orange-500 bg-orange-100/40" : zone.type === "TERRACE" ? "border-emerald-600 bg-emerald-100/40" : "border-sky-500 bg-sky-100/40";
  return <div ref={root} data-zone-id={zone.id} role="button" tabIndex={0} aria-label={`${zone.name}, pilih dan seret untuk memindahkan`} onPointerDown={(e) => begin(e, null)} onPointerMove={move} onPointerUp={() => { gesture.current = null; }} onPointerCancel={() => { gesture.current = null; }} className={`absolute z-0 touch-none rounded-xl border-2 border-dashed ${color} ${selected ? "border-solid ring-2 ring-brand-primary/50" : "cursor-move"}`} style={{ left: zone.x, top: zone.y, width: zone.width, height: zone.height }}>
    <span className="pointer-events-none absolute left-2 top-2 rounded bg-white/90 px-2 py-1 text-xs font-semibold text-gray-800">{zone.name}</span>
    {selected && handles.map(({ corner, className }) => <span key={corner} aria-hidden="true" onPointerDown={(e) => begin(e, corner)} className={`absolute z-30 h-3 w-3 rounded-sm border-2 border-brand-primary bg-white ${className}`} />)}
  </div>;
}

interface FloorLayoutCanvasProps {
  zones: DraftLayoutZone[];
  selectedZoneId: string | null;
  onSelectZone: (zoneId: string | null) => void;
  onMoveZone: (zoneId: string, dx: number, dy: number) => void;
  onResizeZone: (zoneId: string, corner: ResizeCorner, dx: number, dy: number) => void;
  /** Active placed tables (editable draft). */
  items: DraftTableItem[];
  /** Persisted items of INACTIVE tables — rendered muted, never editable. */
  inactiveItems: DraftTableItem[];
  /** Table metadata by id (number/name/capacity/status). */
  tables: Map<string, RestaurantTable>;
  selectedId: string | null;
  /** Zoom multiplier applied on top of the responsive fit scale. */
  zoom: number;
  onSelect: (tableId: string | null) => void;
  onMove: (tableId: string, dx: number, dy: number) => void;
  onResize: (tableId: string, corner: ResizeCorner, dx: number, dy: number) => void;
  onRotate: (tableId: string, angle: number) => void;
  /** Removes the selected table from the LOCAL draft (Delete/Backspace key). */
  onUnplace: (tableId: string) => void;
}

/**
 * Responsive floor canvas on the fixed 900×600 virtual grid.
 *
 * Rendering: the 900×600 virtual canvas is scaled with CSS `transform: scale()`
 * (origin top-left) inside a container that reserves the scaled pixel size.
 * The persisted x/y/width/height/rotation are UNTOUCHED — only the presentation
 * scales, so the same layout looks right on a phone, tablet or desktop.
 *
 * Pointer gestures are handled per-table (pointer capture, local draft only —
 * no API calls), background clicks deselect, and arrow keys nudge the selected
 * table for keyboard access.
 */
export function FloorLayoutCanvas({
  zones,
  selectedZoneId,
  onSelectZone,
  onMoveZone,
  onResizeZone,
  items,
  inactiveItems,
  tables,
  selectedId,
  zoom,
  onSelect,
  onMove,
  onResize,
  onRotate,
  onUnplace,
}: FloorLayoutCanvasProps) {
  const virtualRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [viewportWidth, setViewportWidth] = useState(900);

  // Responsive fit: scale the 900px-wide virtual canvas to the container width.
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect?.width;
      if (width) setViewportWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const fitScale = Math.min(
    MAX_FIT_SCALE,
    Math.max(MIN_FIT_SCALE, viewportWidth / EDITOR_CANVAS_WIDTH)
  );
  const scale = fitScale * zoom;

  // Client → virtual-canvas conversion. Reads the live (scaled) canvas rect so
  // it stays correct through zoom changes; used by every drag/resize/rotate.
  const toVirtual = useCallback((e: { clientX: number; clientY: number }) => {
    const rect = virtualRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * EDITOR_CANVAS_WIDTH,
      y: ((e.clientY - rect.top) / rect.height) * EDITOR_CANVAS_HEIGHT,
    };
  }, []);

  const handleBackgroundPointerDown = (e: React.PointerEvent) => {
    // Clicking empty canvas deselects. (Table pointerdowns stopPropagation, so
    // they never reach here.)
    if ((e.target as HTMLElement).closest("[data-table-id]")) return;
    if ((e.target as HTMLElement).closest("[data-zone-id]")) return;
    onSelect(null);
    onSelectZone(null);
    (e.currentTarget as HTMLDivElement).focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!selectedId) return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      onUnplace(selectedId);
      return;
    }
    const step = e.shiftKey ? 10 : 1;
    const directions: Record<string, [number, number]> = {
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
    };
    const delta = directions[e.key];
    if (!delta) return;
    e.preventDefault();
    onMove(selectedId, delta[0], delta[1]);
  };

  return (
    <div ref={viewportRef} className="w-full overflow-auto">
      <div
        className="relative mx-auto overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm"
        style={{ width: EDITOR_CANVAS_WIDTH * scale, height: EDITOR_CANVAS_HEIGHT * scale }}
        aria-label="Canvas layout café"
      >
        <div
          ref={virtualRef}
          tabIndex={0}
          role="group"
          aria-label="Canvas layout — area 900 x 600. Klik kanvas kosong untuk deselect, panah untuk menggeser meja terpilih."
          onPointerDown={handleBackgroundPointerDown}
          onKeyDown={handleKeyDown}
          className="outline-none"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: EDITOR_CANVAS_WIDTH,
            height: EDITOR_CANVAS_HEIGHT,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            // Light grid on the virtual coordinate system (visual only).
            backgroundImage:
              "linear-gradient(to right, rgba(100,116,139,0.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,0.12) 1px, transparent 1px)",
            backgroundSize: `${GRID_LINES}px ${GRID_LINES}px`,
          }}
        >
          {zones.map((zone) => <ZoneCanvasItem key={zone.id} zone={zone} selected={zone.id === selectedZoneId} toVirtual={toVirtual} onSelect={(id) => { onSelect(null); onSelectZone(id); }} onMove={onMoveZone} onResize={onResizeZone} />)}
          {items.map((item) => {
            const table = tables.get(item.tableId);
            if (!table) return null;
            return (
              <FloorLayoutTable
                key={item.tableId}
                item={item}
                table={table}
                selected={selectedId === item.tableId}
                interactive
                toVirtual={toVirtual}
                onSelect={onSelect}
                onMove={onMove}
                onResize={onResize}
                onRotate={onRotate}
              />
            );
          })}

          {/* Persisted items of inactive tables: muted, read-only, never
              selectable, never silently removed during render. */}
          {inactiveItems.map((item) => {
            const table = tables.get(item.tableId);
            if (!table) return null;
            return (
              <FloorLayoutTable
                key={item.tableId}
                item={item}
                table={table}
                selected={false}
                interactive={false}
                toVirtual={toVirtual}
                onSelect={onSelect}
                onMove={onMove}
                onResize={onResize}
                onRotate={onRotate}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
