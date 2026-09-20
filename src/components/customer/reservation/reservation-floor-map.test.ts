import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FLOOR_MAP_CANVAS_HEIGHT,
  FLOOR_MAP_CANVAS_WIDTH,
  FloorMapAvailabilityTable,
  FloorMapLayoutItem,
  floorMapCacheBranch,
  floorMapErrorMessage,
  isFloorTableSelectable,
  isFloorTableSelectionStale,
  mergeFloorMap,
  resolveFloorMapView,
  shouldRefetchFloorLayout,
} from "./reservation-floor-map.helpers";

const layoutItems: FloorMapLayoutItem[] = [
  {
    tableId: "t-1",
    number: 1,
    name: "Sudut",
    capacity: 4,
    shape: "RECTANGLE",
    x: 40,
    y: 50,
    width: 120,
    height: 70,
    rotation: 0,
  },
  {
    tableId: "t-2",
    number: 2,
    name: "",
    capacity: 2,
    shape: "CIRCLE",
    x: 300,
    y: 120,
    width: 80,
    height: 80,
    rotation: 0,
  },
  {
    tableId: "t-3",
    number: 3,
    name: "Jendela",
    capacity: 6,
    shape: "RECTANGLE",
    x: 500,
    y: 300,
    width: 160,
    height: 90,
    rotation: 45,
  },
];

const availability: FloorMapAvailabilityTable[] = [
  { tableId: "t-1", number: 1, name: "Sudut", capacity: 4, remainingSeats: 4, available: true },
  // t-2 exists in layout but the engine says NO seats left / unavailable.
  { tableId: "t-2", number: 2, name: "", capacity: 2, remainingSeats: 0, available: false },
  // t-3 not in availability at all (defensive) — still not selectable.
  { tableId: "t-9", number: 9, name: "Teras", capacity: 8, remainingSeats: 8, available: true },
];

describe("reservation floor map (customer reservation UI pure helpers)", () => {
  describe("1. layout + availability merge by tableId", () => {
    it("merges matching tables by tableId", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const t1 = merged.find((t) => t.tableId === "t-1");
      assert.ok(t1);
      // Geometry from the layout.
      assert.equal(t1.x, 40);
      assert.equal(t1.y, 50);
      assert.equal(t1.width, 120);
      assert.equal(t1.height, 70);
      assert.equal(t1.shape, "RECTANGLE");
      // Availability from the availability snapshot.
      assert.equal(t1.available, true);
      assert.equal(t1.remainingSeats, 4);
    });

    it("keeps layout geometry for tables with zero remaining seats (still rendered, unavailable)", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const t2 = merged.find((t) => t.tableId === "t-2");
      assert.ok(t2);
      assert.equal(t2.shape, "CIRCLE");
      assert.equal(t2.available, false);
      assert.equal(t2.remainingSeats, 0);
    });

    it("availability-only tables are NOT part of the map (kept for card list, no invented geometry)", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      assert.ok(!merged.some((t) => t.tableId === "t-9"));
    });

    it("a placed table with no availability row is rendered but unavailable", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const t3 = merged.find((t) => t.tableId === "t-3");
      assert.ok(t3);
      assert.equal(t3.rotation, 45);
      assert.equal(t3.available, false);
      assert.equal(t3.remainingSeats, 0);
    });
  });

  describe("2. available table is selectable", () => {
    it("returns true only for tables the engine marked available", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const t1 = merged.find((t) => t.tableId === "t-1")!;
      assert.equal(isFloorTableSelectable(t1), true);
    });
  });

  describe("3. unavailable table is disabled", () => {
    it("returns false for unavailable and for no-availability rows", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const t2 = merged.find((t) => t.tableId === "t-2")!;
      const t3 = merged.find((t) => t.tableId === "t-3")!;
      assert.equal(isFloorTableSelectable(t2), false);
      assert.equal(isFloorTableSelectable(t3), false);
    });

    it("never derives availability from Table.status / layout presence", () => {
      // Geometry alone (no availability row) must stay disabled.
      const merged = mergeFloorMap(
        [
          {
            tableId: "t-x",
            number: 99,
            name: "",
            capacity: 4,
            shape: "RECTANGLE",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            rotation: 0,
          },
        ],
        []
      );
      assert.equal(isFloorTableSelectable(merged[0]), false);
    });
  });

  describe("4. selection uses the existing tableId", () => {
    it("the merged row keeps the availability table's tableId unchanged", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const t1 = merged.find((t) => t.tableId === "t-1")!;
      assert.equal(t1.tableId, availability[0].tableId);
    });

    it("an available row does not read as stale, so it is kept", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const t1 = merged.find((t) => t.tableId === "t-1")!;
      assert.equal(isFloorTableSelectionStale(t1.tableId, merged), false);
    });
  });

  describe("5. zero-layout fallback", () => {
    it("falls back to the card list when a ready layout has no items", () => {
      assert.equal(
        resolveFloorMapView({ status: "ready", itemCount: 0 }, "map"),
        "list"
      );
    });
  });

  describe("6. layout API failure fallback", () => {
    it("falls back to the card list on layout error and never blocks the wizard", () => {
      assert.equal(
        resolveFloorMapView({ status: "error", itemCount: 0 }, "map"),
        "list"
      );
    });

    it("renders the list while the layout is still loading or idle", () => {
      assert.equal(
        resolveFloorMapView({ status: "loading", itemCount: 0 }, "map"),
        "list"
      );
      assert.equal(
        resolveFloorMapView({ status: "idle", itemCount: 0 }, "map"),
        "list"
      );
    });

    it("produces a customer-safe copy for 404", () => {
      assert.equal(
        floorMapErrorMessage({ status: 404 }),
        "Denah meja belum tersedia untuk cabang ini."
      );
    });
  });

  describe("7. branch change reloads the layout", () => {
    it("refetches when the cache holds a different branch", () => {
      assert.equal(
        shouldRefetchFloorLayout({
          stepIsTable: true,
          branchCode: "USD",
          resolvedBranch: "BDG",
        }),
        true
      );
    });

    it("refetches when the branch was never fetched", () => {
      assert.equal(
        shouldRefetchFloorLayout({
          stepIsTable: true,
          branchCode: "BDG",
          resolvedBranch: null,
        }),
        true
      );
    });
  });

  describe("8. time change does not reload the layout", () => {
    it("stays cached when only the slot (time) changes", () => {
      // Same branch, already resolved for it → no reload regardless of slot.
      assert.equal(
        shouldRefetchFloorLayout({
          stepIsTable: true,
          branchCode: "BDG",
          resolvedBranch: "BDG",
        }),
        false
      );
    });

    it("never fetches before the table step or without a branch", () => {
      assert.equal(
        shouldRefetchFloorLayout({
          stepIsTable: false,
          branchCode: "BDG",
          resolvedBranch: "OLD",
        }),
        false
      );
      assert.equal(
        shouldRefetchFloorLayout({
          stepIsTable: true,
          branchCode: "",
          resolvedBranch: "BDG",
        }),
        false
      );
    });
  });

  describe("9. unavailable selected table clears correctly", () => {
    it("flags the selection as stale when refresh removes availability", () => {
      // First the table is available…
      const before = mergeFloorMap(layoutItems, availability);
      assert.equal(
        isFloorTableSelectionStale("t-1", before),
        false,
        "available table is not stale"
      );

      // …then a refresh marks the same table unavailable.
      const afterRefresh = mergeFloorMap(layoutItems, [
        {
          tableId: "t-1",
          number: 1,
          name: "Sudut",
          capacity: 4,
          remainingSeats: 0,
          available: false,
        },
      ]);
      assert.equal(
        isFloorTableSelectionStale("t-1", afterRefresh),
        true,
        "unavailable table is stale and must be cleared"
      );
    });
  });

  describe("10. no restaurantId exposed to the public client", () => {
    it("the merged map rows are an explicit allow-list (no tenant internals)", () => {
      const merged = mergeFloorMap(layoutItems, availability);
      const expectedKeys = [
        "available",
        "capacity",
        "height",
        "name",
        "number",
        "remainingSeats",
        "rotation",
        "shape",
        "tableId",
        "width",
        "x",
        "y",
      ].sort();
      for (const row of merged) {
        assert.deepEqual(Object.keys(row).sort(), expectedKeys);
        assert.ok(!("restaurantId" in row));
        assert.ok(!("layoutId" in row));
        assert.ok(!("status" in row));
      }
    });

    it("cache keys are the branchCode only (uppercased), never a tenant id", () => {
      assert.equal(floorMapCacheBranch("  bdg "), "BDG");
      assert.equal(floorMapCacheBranch("BDG"), "BDG");
    });
  });

  describe("canvas size is shared with the persisted layout", () => {
    it("uses the 900×600 virtual-canvas grid", () => {
      assert.equal(FLOOR_MAP_CANVAS_WIDTH, 900);
      assert.equal(FLOOR_MAP_CANVAS_HEIGHT, 600);
    });
  });
});