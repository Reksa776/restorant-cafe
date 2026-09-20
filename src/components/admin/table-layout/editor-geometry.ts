// ============================================================
// FLOOR LAYOUT EDITOR — pure geometry helpers.
//
// DOM/React-free on purpose: the canvas math (drag clamping, resize
// min/max, rotation, free-spot placement) is unit-tested without any UI.
//
// All coordinates are VIRTUAL-CANVAS pixels on the fixed 900×600 grid —
// the same convention as the persisted TableLayoutItem (layout.types.ts).
// The editor never persists pixel/screen sizes; it persists virtual px.
//
// Constants mirror the server-side ones (LAYOUT_CANVAS_WIDTH etc. in
// services/layout/layout.types.ts). They are duplicated here deliberately so
// this client module imports NO zod (the types file pulls zod/v4 in) — and a
// test pins the two to the same values so they cannot drift silently.
// ============================================================

export const EDITOR_CANVAS_WIDTH = 900;
export const EDITOR_CANVAS_HEIGHT = 600;
export const EDITOR_MIN_DIMENSION = 20;
export const EDITOR_MAX_DIMENSION = 400;

export type EditorShape = "RECTANGLE" | "CIRCLE";

/** The editable geometry of one placed table (the layout item, not the table). */
export interface DraftTableItem {
  tableId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  shape: EditorShape;
}

export type ResizeCorner = "nw" | "ne" | "sw" | "se";

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Wrap any finite degree value into [0, 360) — identical semantics to the
 * server helper `normalizeLayoutRotation` so the editor shows and saves the
 * same value the API will persist.
 */
export function normalizeRotation(degrees: number): number {
  const wrapped = degrees % 360;
  return round1(wrapped < 0 ? wrapped + 360 : wrapped);
}

/** Move a table by an incremental virtual delta, clamped inside the canvas. */
export function moveTable(
  item: DraftTableItem,
  dx: number,
  dy: number
): DraftTableItem {
  return {
    ...item,
    x: round1(clamp(item.x + dx, 0, EDITOR_CANVAS_WIDTH - item.width)),
    y: round1(clamp(item.y + dy, 0, EDITOR_CANVAS_HEIGHT - item.height)),
  };
}

/**
 * Resize from one corner. The pointer delta (virtual px, world axes) is
 * rotated back into the table's own (unrotated) axes first, so resizing feels
 * natural even for rotated tables. Width/height clamp to [MIN,MAX] and the
 * result stays fully inside the canvas.
 */
export function resizeTable(
  item: DraftTableItem,
  corner: ResizeCorner,
  dx: number,
  dy: number
): DraftTableItem {
  const rad = (item.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const localDx = dx * cos + dy * sin;
  const localDy = -dx * sin + dy * cos;

  let x = item.x;
  let y = item.y;
  let width = item.width;
  let height = item.height;

  if (corner === "se") {
    width += localDx;
    height += localDy;
  } else if (corner === "nw") {
    x += localDx;
    y += localDy;
    width -= localDx;
    height -= localDy;
  } else if (corner === "sw") {
    x += localDx;
    width -= localDx;
    height += localDy;
  } else {
    // ne
    width += localDx;
    y += localDy;
    height -= localDy;
  }

  width = clamp(width, EDITOR_MIN_DIMENSION, EDITOR_MAX_DIMENSION);
  height = clamp(height, EDITOR_MIN_DIMENSION, EDITOR_MAX_DIMENSION);

  // Keep every edge inside the canvas.
  x = clamp(x, 0, Math.max(0, EDITOR_CANVAS_WIDTH - width));
  y = clamp(y, 0, Math.max(0, EDITOR_CANVAS_HEIGHT - height));

  return {
    ...item,
    x: round1(x),
    y: round1(y),
    width: round1(width),
    height: round1(height),
  };
}

/**
 * Rotation angle (degrees, [0,360)) of a pointer around the given center —
 * the rotate knob "follows" the cursor around the table's center.
 */
export function rotationAngleToPointer(
  centerX: number,
  centerY: number,
  pointerX: number,
  pointerY: number
): number {
  const deltaX = pointerX - centerX;
  const deltaY = pointerY - centerY;
  if (deltaX === 0 && deltaY === 0) return 0;
  return normalizeRotation((Math.atan2(deltaY, deltaX) * 180) / Math.PI);
}

function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
): boolean {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

/**
 * Find a free spot to drop a newly-placed table: scan fixed slots (a simple
 * ~140×110 grid with margins) and return the first slot whose axis-aligned
 * box does not overlap any already-placed table. Falls back to a default
 * corner spot when the canvas is (nearly) full.
 */
export function findFreeSpot(
  items: DraftTableItem[],
  size: Pick<DraftTableItem, "width" | "height"> = { width: 96, height: 72 }
): { x: number; y: number } {
  const stepX = 140;
  const stepY = 110;
  const margin = 20;
  for (let y = margin; y + size.height < EDITOR_CANVAS_HEIGHT - margin; y += stepY) {
    for (let x = margin; x + size.width < EDITOR_CANVAS_WIDTH - margin; x += stepX) {
      const candidate = { x, y, width: size.width, height: size.height };
      if (!items.some((item) => intersects(item, candidate))) {
        return candidate;
      }
    }
  }
  return { x: margin, y: margin };
}

/**
 * Equality of two ordered item lists by identity (tableId) — ignoring item
 * order. Used to decide "dirty" (local draft vs last saved snapshot).
 */
export function itemListsEqual(a: DraftTableItem[], b: DraftTableItem[]): boolean {
  if (a.length !== b.length) return false;
  const source = new Map(a.map((item) => [item.tableId, item]));
  return b.every((item) => {
    const other = source.get(item.tableId);
    return (
      !!other &&
      Math.abs(other.x - item.x) < 1e-6 &&
      Math.abs(other.y - item.y) < 1e-6 &&
      Math.abs(other.width - item.width) < 1e-6 &&
      Math.abs(other.height - item.height) < 1e-6 &&
      Math.abs(other.rotation - item.rotation) < 1e-6 &&
      other.shape === item.shape
    );
  });
}