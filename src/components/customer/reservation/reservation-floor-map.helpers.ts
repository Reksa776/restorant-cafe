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
//   - Tables in availability but NOT in the layout keep working through the
//     existing card list (no invented geometry).
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
}

/** Merge result: layout geometry + authoritative availability for one table. */
export interface FloorMapTable extends FloorMapLayoutItem {
  remainingSeats: number;
  available: boolean;
}

/**
 * Merge layout geometry with the availability snapshot using `tableId` as the
 * key. The layout supplies the visual placement; the availability snapshot
 * supplies the booleans. A placed table with no availability row (or an
 * explicit `available: false`) is rendered as UNAVAILABLE — availability can
 * never be inferred from geometry/layout presence alone.
 */
export function mergeFloorMap(
  layoutItems: readonly FloorMapLayoutItem[],
  availability: readonly FloorMapAvailabilityTable[]
): FloorMapTable[] {
  const byTableId = new Map(availability.map((a) => [a.tableId, a]));
  return layoutItems.map((item) => {
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
    };
  });
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