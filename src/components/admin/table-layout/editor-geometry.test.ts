import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EDITOR_CANVAS_HEIGHT,
  EDITOR_CANVAS_WIDTH,
  EDITOR_MAX_DIMENSION,
  EDITOR_MIN_DIMENSION,
  DraftTableItem,
  clamp,
  findFreeSpot,
  itemListsEqual,
  moveTable,
  normalizeRotation,
  resizeTable,
  rotationAngleToPointer,
} from "./editor-geometry";

// ============================================================
// FLOOR LAYOUT EDITOR — pure geometry helper tests (no DOM).
//
// Run with: npx tsx --test src/components/admin/table-layout/editor-geometry.test.ts
//
// Covers the editor behaviors from the PHASE 4 checklist that live in the
// pure geometry layer: drag clamping, resize min/max + canvas clamping,
// rotation normalization (consistent with the server helper) and free-spot
// placement.
// ============================================================

function item(overrides: Partial<DraftTableItem> = {}): DraftTableItem {
  return {
    tableId: "t1",
    x: 100,
    y: 120,
    width: 100,
    height: 60,
    rotation: 0,
    shape: "RECTANGLE",
    ...overrides,
  };
}

describe("normalizeRotation", () => {
  it("normalizes consistently with the server helper (0..360)", () => {
    assert.equal(normalizeRotation(90), 90);
    assert.equal(normalizeRotation(-90), 270);
    assert.equal(normalizeRotation(360), 0);
    assert.equal(normalizeRotation(450), 90);
    assert.equal(normalizeRotation(-450), 270);
    assert.equal(normalizeRotation(0), 0);
  });
});

describe("moveTable", () => {
  it("moves to the requested position", () => {
    const moved = moveTable(item(), 30, -20);
    assert.deepEqual([moved.x, moved.y], [130, 100]);
  });

  it("clamps x/y to the canvas (left and top edges)", () => {
    const moved = moveTable(item({ x: 10, y: 10 }), -50, -60);
    assert.deepEqual([moved.x, moved.y], [0, 0]);
  });

  it("clamps right/bottom so the footprint stays inside 900x600", () => {
    const moved = moveTable(
      item({ x: 880, y: 570, width: 20, height: 30 }),
      50,
      50
    );
    assert.deepEqual([moved.x, moved.y], [880, 570]);
  });
});

describe("resizeTable", () => {
  it("grows from the SE corner", () => {
    const resized = resizeTable(item({ width: 100, height: 60 }), "se", 40, 30);
    assert.deepEqual([resized.x, resized.y, resized.width, resized.height], [
      100,
      120,
      140,
      90,
    ]);
  });

  it("respects the min dimension (20)", () => {
    const resized = resizeTable(item(), "se", -500, -500);
    assert.equal(resized.width, EDITOR_MIN_DIMENSION);
    assert.equal(resized.height, EDITOR_MIN_DIMENSION);
  });

  it("respects the max dimension (400)", () => {
    const resized = resizeTable(item(), "se", 5000, 5000);
    assert.equal(resized.width, EDITOR_MAX_DIMENSION);
    assert.equal(resized.height, EDITOR_MAX_DIMENSION);
  });

  it("clamps the result inside the canvas when growing", () => {
    const resized = resizeTable(
      item({ x: 880, y: 570, width: 20, height: 30 }),
      "se",
      80,
      80
    );
    assert.equal(resized.x + resized.width, EDITOR_CANVAS_WIDTH);
    assert.equal(resized.y + resized.height, EDITOR_CANVAS_HEIGHT);
  });

  it("NW corner shrinks and moves the top-left edge inward", () => {
    const resized = resizeTable(item(), "nw", 20, 10);
    assert.deepEqual([resized.x, resized.y, resized.width, resized.height], [
      120,
      130,
      80,
      50,
    ]);
  });

  it("NW corner grows outward when the pointer goes up-left", () => {
    const resized = resizeTable(item(), "nw", -20, -10);
    assert.deepEqual([resized.x, resized.y, resized.width, resized.height], [
      80,
      110,
      120,
      70,
    ]);
  });

  it("rotated tables resize along their own axes (rotation kept at 30deg)", () => {
    const base = item({ rotation: 30, width: 100, height: 60, x: 300, y: 200 });
    const resized = resizeTable(base, "se", 100, 100);
    // World (100,100) projects onto the 30° local axes: width +136.6,
    // height +36.6. Both must grow along the table's own axes (not screen
    // axes) and the rotation must be preserved.
    assert.ok(Math.abs(resized.width - 236.6) < 0.2, `width=${resized.width}`);
    assert.ok(Math.abs(resized.height - 96.6) < 0.2, `height=${resized.height}`);
    assert.equal(resized.rotation, 30);
    assert.ok(resized.x >= 0 && resized.x + resized.width <= EDITOR_CANVAS_WIDTH);
    assert.ok(resized.y >= 0 && resized.y + resized.height <= EDITOR_CANVAS_HEIGHT);
  });
});

describe("rotationAngleToPointer", () => {
  it("returns the angle of the pointer around the table center (east = 0)", () => {
    const cx = 150;
    const cy = 150;
    assert.equal(rotationAngleToPointer(cx, cy, cx + 10, cy), 0);
    assert.equal(rotationAngleToPointer(cx, cy, cx, cy + 10), 90);
    assert.equal(rotationAngleToPointer(cx, cy, cx - 10, cy), 180);
    assert.equal(rotationAngleToPointer(cx, cy, cx, cy - 10), 270);
  });
});

describe("findFreeSpot", () => {
  it("returns a spot that does not overlap existing placed tables", () => {
    const existing = item({ x: 40, y: 60, width: 96, height: 72 });
    const spot = findFreeSpot([existing]);
    const pair = skipSize(spot, existing);
    assert.ok(!overlaps(pair, existing), "placement must not overlap");
    assert.ok(spot.x >= 0 && spot.y >= 0);
  });

  it("falls back to a margin spot even on a full canvas", () => {
    const floor = [
      item({ x: 40, y: 40, width: 860, height: 560 }),
    ];
    const spot = findFreeSpot(floor);
    assert.deepEqual(spot, { x: 20, y: 20 });
  });

  it("honors a custom size", () => {
    const spot = findFreeSpot([], { width: 200, height: 120 });
    assert.equal(spot.x, 20);
    assert.equal(spot.y, 20);
  });
});

function skipSize(
  a: { x: number; y: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return { x: a.x, y: a.y, width: b.width, height: b.height };
}

function overlaps(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number }
) {
  return !(
    a.x + a.width <= b.x ||
    b.x + b.width <= a.x ||
    a.y + a.height <= b.y ||
    b.y + b.height <= a.y
  );
}

describe("itemListsEqual", () => {
  it("detects identical lists", () => {
    const a = [item(), item({ tableId: "t2", x: 200, y: 200 })];
    const b = [item({ tableId: "t2", x: 200, y: 200 }), item()];
    assert.equal(itemListsEqual(a, b), true);
  });

  it("detects geometry/order differences", () => {
    const a = [item()];
    assert.equal(itemListsEqual(a, [item({ x: 101 })]), false);
    assert.equal(itemListsEqual(a, []), false);
    assert.equal(itemListsEqual([item({ shape: "CIRCLE" })], a), false);
  });
});

describe("clamp", () => {
  it("bounds values", () => {
    assert.equal(clamp(5, 0, 10), 5);
    assert.equal(clamp(-1, 0, 10), 0);
    assert.equal(clamp(11, 0, 10), 10);
  });
});