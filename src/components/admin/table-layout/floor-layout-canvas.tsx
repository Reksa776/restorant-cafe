"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RestaurantTable } from "@/services/table.service";
import {
  EDITOR_CANVAS_HEIGHT,
  EDITOR_CANVAS_WIDTH,
  type DraftTableItem,
  type ResizeCorner,
} from "./editor-geometry";
import { FloorLayoutTable } from "./floor-layout-table";

const GRID_LINES = 60;
const MIN_FIT_SCALE = 0.25;
const MAX_FIT_SCALE = 1.5;

interface FloorLayoutCanvasProps {
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
    onSelect(null);
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