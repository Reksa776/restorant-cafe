// ============================================================
// PHASE 5 — CUSTOMER RESERVATION FLOOR MAP — PURE client helpers.
//
// Same discipline as reservation-flow.ts: DOM/React/axios-free so the
// merge and view decisions are unit-testable without a browser or a server.
//
// Truth rules (the server stays authoritative everywhere):
//   - GEOMETRY comes ONLY from the public layout endpoint (virtual-canvas px
//     DTO: tableId, number, name, capacity, shape, x, y, width, height,
//     rotation). Nothing here invents geometry for tables the admin did not
//     place.
//   - AVAILABILITY comes ONLY from the existing public availability
//     endpoint's per-slot `tables` (which carries a row per ACTIVE branch
//     table, available or not).
//   - A table is SELECTABLE only when availability says `available === true`.
//     This module never derives availability from `Table.status`, layout
//     presence, or any other signal.
//   - EVERY active table the server returns is kept: placed tables carry real
//     admin geometry; tables with no `TableLayoutItem` get a `hasLayout: false`
//     row so the caller renders them in a clearly-marked fallback section
//     instead of silently dropping them (no invented on-canvas geometry).
// ============================================================

/** Virtual-canvas size shared with the admin editor / persisted layout. */
export const FLOOR_MAP_CANVAS_WIDTH = 900;
export const FLOOR_MAP_CANVAS_HEIGHT = 600;

export type FloorMapShape = "RECTANGLE" | "CIRCLE";

/** One placed table as returned by GET /public/branches/:code/layout. */
export interface FloorMapLayoutItem {
  tableId: string;
  number: number;
  name: string;
  capacity: number;
  shape: FloorMapShape;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

/** One branch table as returned by the existing availability endpoint. */
export interface FloorMapAvailabilityTable {
  tableId: string;
  number: number;
  name: string;
  capacity: number;
  remainingSeats: number;
  available: boolean;
  /** Slot-aware status from the server (falls back to AVAILABLE if absent). */
  status?: string;
}

/** The four display statuses a customer sees on the floor map / list. */
export type FloorMapStatus =
  | "AVAILABLE"
  | "OCCUPIED"
  | "RESERVED"
  | "MAINTENANCE";

function normalizeStatus(status: string | undefined): FloorMapStatus {
  return status === "OCCUPIED" ||
    status === "RESERVED" ||
    status === "MAINTENANCE"
    ? status
    : "AVAILABLE";
}

/**
 * Merge result: layout geometry (when placed) + authoritative availability for
 * one table. `hasLayout` distinguishes a table the admin placed on the canvas
 * (real geometry) from one that has no `TableLayoutItem` (rendered through the
 * clearly-marked fallback, never silently dropped).
 */
export interface FloorMapTable extends FloorMapLayoutItem {
  remainingSeats: number;
  available: boolean;
  status: FloorMapStatus;
  hasLayout: boolean;
}

/**
 * Union of the admin layout and the branch availability snapshot, keyed by
 * `tableId`:
 *   - every PLACED table keeps its exact admin geometry (x/y/width/height/
 *     rotation/shape) and gets the availability booleans/status;
 *   - every table that is ACTIVE in availability but was NOT placed keeps a
 *     `hasLayout: false` row (zeroed geometry) so the caller can render it in
 *     the fallback section instead of losing it.
 * Availability can never be inferred from layout presence alone: a placed
 * table with no availability row renders AVAILABLE-looking but NON-selectable
 * (`available: false`).
 */
export function mergeFloorMap(
  layoutItems: readonly FloorMapLayoutItem[],
  availability: readonly FloorMapAvailabilityTable[]
): FloorMapTable[] {
  const byTableId = new Map(availability.map((a) => [a.tableId, a]));
  const placed = layoutItems.map((item) => {
    const avail = byTableId.get(item.tableId);
    return {
      tableId: item.tableId,
      number: avail?.number ?? item.number,
      name: avail?.name ?? item.name,
      capacity: avail?.capacity ?? item.capacity,
      shape: item.shape,
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      rotation: item.rotation,
      remainingSeats: avail?.remainingSeats ?? 0,
      available: avail?.available === true,
      status: normalizeStatus(avail?.status),
      hasLayout: true,
    };
  });

  const placedIds = new Set(layoutItems.map((item) => item.tableId));
  const unplaced = availability
    .filter((a) => !placedIds.has(a.tableId))
    .map((a) => ({
      tableId: a.tableId,
      number: a.number,
      name: a.name,
      capacity: a.capacity,
      shape: "RECTANGLE" as const,
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      rotation: 0,
      remainingSeats: a.remainingSeats,
      available: a.available === true,
      status: normalizeStatus(a.status),
      hasLayout: false,
    }));

  return [...placed, ...unplaced];
}

/** Split merged rows into canvas-placed vs fallback (no geometry) tables. */
export function splitFloorMapTables(tables: readonly FloorMapTable[]): {
  placed: FloorMapTable[];
  unplaced: FloorMapTable[];
} {
  const placed: FloorMapTable[] = [];
  const unplaced: FloorMapTable[] = [];
  for (const table of tables) {
    (table.hasLayout ? placed : unplaced).push(table);
  }
  return { placed, unplaced };
}

/** A table is selectable only when the availability engine said `true`. */
export function isFloorTableSelectable(table: FloorMapTable): boolean {
  return table.available;
}

/**
 * Whether a previously chosen table should be dropped after an availability
 * refresh (page: clear selection + tell the customer to pick again).
 */
export function isFloorTableSelectionStale(
  tableId: string | null,
  tables: readonly FloorMapTable[]
): boolean {
  if (tableId == null) return false;
  const match = tables.find((t) => t.tableId === tableId);
  return !match || !match.available;
}

// ============================================================
// View decision (map vs list)
// ============================================================

export type FloorMapLoadStatus = "idle" | "loading" | "ready" | "error";

/**
 * Decide which picker the customer sees:
 *   - "map" ONLY when a ready layout with at least one placed table exists AND
 *     the customer prefers the map.
 *   - otherwise the reliable, keyboard-accessible card list ("list").
 * A layout failure / zero-item layout never leaves the wizard on a broken
 * canvas; it silently degrades to the existing card list.
 */
export function resolveFloorMapView(
  load: { status: FloorMapLoadStatus; itemCount: number },
  preference: "map" | "list"
): "map" | "list" {
  if (load.status === "ready" && load.itemCount > 0 && preference === "map") {
    return "map";
  }
  return "list";
}

// ============================================================
// Layout fetch scheduling
// ============================================================

/** Stable per-branch cache key (the public route normalizes to uppercase). */
export function floorMapCacheBranch(branchCode: string): string {
  return branchCode.trim().toUpperCase();
}

/**
 * Whether the wizard must (re)fetch the public layout:
 *   - never before the table step and without a branch,
 *   - only when the branch CHANGED or this branch was never fetched.
 * Changing date / party size / time (the slot) does NOT trigger a reload —
 * the layout is branch-scoped geometry, only availability varies per slot.
 */
export function shouldRefetchFloorLayout(args: {
  stepIsTable: boolean;
  branchCode: string;
  resolvedBranch: string | null;
}): boolean {
  if (!args.stepIsTable || !args.branchCode) return false;
  return args.resolvedBranch !== args.branchCode;
}

/** Customer-safe copy for the "layout not available" case. */
export function floorMapErrorMessage(
  error: { status?: number | null; message?: string } | null | undefined
): string {
  if (error?.status === 404) {
    return "Denah meja belum tersedia untuk cabang ini.";
  }
  if (error?.message) return error.message;
  return "Gagal memuat denah meja.";
}