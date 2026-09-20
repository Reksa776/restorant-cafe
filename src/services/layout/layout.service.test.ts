import "dotenv/config";
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "@/lib/prisma";
import { layoutService } from "./layout.service";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";

// ============================================================
// FLOOR LAYOUT SERVICE — INTEGRATION TESTS.
//
// Real local DB with fully isolated fixtures (mirrors the R2
// reservation.service.test.ts conventions): every scenario gets its own
// branch so tests never depend on file ordering. The version lock is handled
// with a read-then-write pattern except where a stale version is the point.
//
// Run with: npx tsx --test src/services/layout/layout.service.test.ts
// ============================================================

let restAId = "";
let restBId = "";

// Restaurant A branches
let branchMain = ""; // LAY-MAIN: tMain, tMain2, tInactive
let branchAlt = ""; // LAY-ALT: tAlt
let branchEmpty = ""; // LAY-EMPTY: no tables, never written
let branchCreate = ""; // LAY-CREATE: tCreate
let branchReplace = ""; // LAY-REPLACE: tRep1, tRep2
let branchDup = ""; // LAY-DUP: tDup
let branchGeom = ""; // LAY-GEOM: tGeom
let branchInactive = ""; // LAY-INACT: tInactiveBr
let branchScope = ""; // LAY-SCOPE: tScope
let branchRollback = ""; // LAY-ROLLBACK: tRb

let tMain = ""; // cap 4  — main happy-path table
let tAlt = ""; //          on branchAlt (cross-branch rejection)
let tCreate = ""; //       on branchCreate
let tRep1 = ""; //         on branchReplace
let tRep2 = ""; //         on branchReplace
let tDup = ""; //          on branchDup
let tGeom = ""; //         on branchGeom
let tInactiveBr = ""; //   isActive=false (on branchInactive)
let tScope = ""; //        on branchScope
let tRb = ""; //           on branchRollback

// Restaurant B
let branchB = ""; // LAY-B: tRestB
let tRestB = ""; // cap 4  — cross-restaurant rejection

async function branch(restaurantId: string, code: string, name: string) {
  const row = await prisma.branch.create({
    data: { restaurantId, code, name },
  });
  return row.id;
}

async function table(
  branchId: string,
  number: number,
  capacity: number,
  name: string,
  overrides: Record<string, unknown> = {}
) {
  const row = await prisma.table.create({
    data: {
      restaurantId: restAId,
      branchId,
      number,
      name,
      capacity,
      isActive: true,
      status: "AVAILABLE",
      ...overrides,
    },
  });
  return row.id;
}

function layoutItem(tableId: string, overrides: Record<string, unknown> = {}) {
  return {
    tableId,
    x: 100,
    y: 100,
    width: 120,
    height: 80,
    rotation: 0,
    shape: "RECTANGLE",
    ...overrides,
  };
}

before(async () => {
  const restA = await prisma.restaurant.create({
    data: { name: `QA Layout A ${Date.now()}` },
  });
  const restB = await prisma.restaurant.create({
    data: { name: `QA Layout B ${Date.now()}` },
  });
  restAId = restA.id;
  restBId = restB.id;

  branchMain = await branch(restAId, "LAY-MAIN", "QA Layout Main");
  branchAlt = await branch(restAId, "LAY-ALT", "QA Layout Alt");
  branchEmpty = await branch(restAId, "LAY-EMPTY", "QA Layout Empty");
  branchCreate = await branch(restAId, "LAY-CREATE", "QA Layout Create");
  branchReplace = await branch(restAId, "LAY-REPLACE", "QA Layout Replace");
  branchDup = await branch(restAId, "LAY-DUP", "QA Layout Dup");
  branchGeom = await branch(restAId, "LAY-GEOM", "QA Layout Geom");
  branchInactive = await branch(restAId, "LAY-INACT", "QA Layout Inactive");
  branchScope = await branch(restAId, "LAY-SCOPE", "QA Layout Scope");
  branchRollback = await branch(restAId, "LAY-ROLLBACK", "QA Layout Rollback");
  branchB = await branch(restBId, "LAY-B", "QA Layout B Rest");

  tMain = await table(branchMain, 1001, 4, "LAY-A1");
  tAlt = await table(branchAlt, 1004, 4, "LAY-ALT");
  tCreate = await table(branchCreate, 1005, 2, "LAY-CREATE");
  tRep1 = await table(branchReplace, 1006, 4, "LAY-REP1");
  tRep2 = await table(branchReplace, 1007, 2, "LAY-REP2");
  tDup = await table(branchDup, 1008, 4, "LAY-DUP");
  tGeom = await table(branchGeom, 1009, 4, "LAY-GEOM");
  tInactiveBr = await table(branchInactive, 1010, 4, "LAY-INACT-BR", {
    isActive: false,
  });
  tScope = await table(branchScope, 1011, 4, "LAY-SCOPE");
  tRb = await table(branchRollback, 1012, 4, "LAY-ROLLBACK");

  const tB = await prisma.table.create({
    data: {
      restaurantId: restBId,
      branchId: branchB,
      number: 1101,
      name: "LAY-B",
      capacity: 4,
      isActive: true,
      status: "AVAILABLE",
    },
  });
  tRestB = tB.id;
});

after(async () => {
  await prisma.tableLayout.deleteMany({
    where: { restaurantId: { in: [restAId, restBId] } },
  });
  await prisma.table.deleteMany({
    where: { restaurantId: { in: [restAId, restBId] } },
  });
  await prisma.branch.deleteMany({
    where: { restaurantId: { in: [restAId, restBId] } },
  });
  await prisma.restaurant.deleteMany({
    where: { id: { in: [restAId, restBId] } },
  });
  await prisma.$disconnect();
});

describe("layout.service — getBranchLayout", () => {
  it("1. empty branch returns version 1 + empty items (no 404)", async () => {
    const layout = await layoutService.getBranchLayout(restAId, branchEmpty);
    assert.equal(layout.branchId, branchEmpty);
    assert.equal(layout.version, 1);
    assert.deepEqual(layout.canvas, { width: 900, height: 600 });
    assert.deepEqual(layout.items, []);
  });

  it("2. existing layout returns items enriched with table metadata / rotation normalized", async () => {
    const before = await layoutService.getBranchLayout(restAId, branchMain);
    const saved = await layoutService.saveBranchLayout(
      restAId,
      branchMain,
      {
        version: before.version,
        items: [
          layoutItem(tMain, {
            shape: "CIRCLE",
            x: 50,
            y: 40,
            width: 100,
            height: 100,
            rotation: 450,
          }),
        ],
      },
    );
    assert.equal(saved.version, before.version + 1);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].tableId, tMain);
    assert.equal(saved.items[0].number, 1001);
    assert.equal(saved.items[0].name, "LAY-A1");
    assert.equal(saved.items[0].capacity, 4);
    assert.equal(saved.items[0].shape, "CIRCLE");
    assert.equal(saved.items[0].rotation, 90); // normalized from 450
    assert.equal(saved.items[0].x, 50);

    const fetched = await layoutService.getBranchLayout(restAId, branchMain);
    assert.equal(fetched.version, before.version + 1);
    assert.equal(fetched.items.length, 1);
    assert.equal(fetched.items[0].tableId, tMain);
    assert.equal(fetched.items[0].number, 1001);
  });
});

describe("layout.service — saveBranchLayout", () => {
  it("3. saves a layout over an empty branch (creates row, bumps version)", async () => {
    const before = await layoutService.getBranchLayout(restAId, branchCreate);
    assert.equal(before.version, 1);

    const saved = await layoutService.saveBranchLayout(
      restAId,
      branchCreate,
      { version: 1, items: [layoutItem(tCreate, { x: 10, y: 20 })] },
    );
    assert.equal(saved.version, 2);
    assert.equal(saved.items.length, 1);
    assert.equal(saved.items[0].tableId, tCreate);
    assert.equal(saved.items[0].x, 10);
    assert.equal(saved.items[0].y, 20);

    const fetched = await layoutService.getBranchLayout(restAId, branchCreate);
    assert.equal(fetched.version, 2);
    assert.equal(fetched.items.length, 1);
  });

  it("4. replaces the existing layout (old items removed, version bumped)", async () => {
    const first = await layoutService.saveBranchLayout(
      restAId,
      branchReplace,
      { version: 1, items: [layoutItem(tRep1)] },
    );
    assert.equal(first.version, 2);
    assert.equal(first.items[0].tableId, tRep1);

    const second = await layoutService.saveBranchLayout(
      restAId,
      branchReplace,
      { version: 2, items: [layoutItem(tRep2)] },
    );
    assert.equal(second.version, 3);
    assert.equal(second.items.length, 1);
    assert.equal(second.items[0].tableId, tRep2);
    assert.equal(second.items[0].capacity, 2);

    const fetched = await layoutService.getBranchLayout(restAId, branchReplace);
    assert.equal(fetched.version, 3);
    assert.equal(fetched.items.length, 1);
    assert.equal(fetched.items[0].tableId, tRep2);
  });

  it("5. stale version is rejected with ConflictError (409) and layout is unchanged", async () => {
    const current = await layoutService.getBranchLayout(restAId, branchCreate);
    await assert.rejects(
      layoutService.saveBranchLayout(restAId, branchCreate, {
        version: current.version + 7,
        items: [],
      }),
      ConflictError,
    );
    const after = await layoutService.getBranchLayout(restAId, branchCreate);
    assert.equal(after.version, current.version);
    assert.equal(after.items.length, 1);
  });

  it("6. duplicate tableId in one save is rejected", async () => {
    assert.equal((await layoutService.getBranchLayout(restAId, branchDup)).version, 1);
    await assert.rejects(
      layoutService.saveBranchLayout(restAId, branchDup, {
        version: 1,
        items: [layoutItem(tDup), layoutItem(tDup)],
      }),
      ValidationError,
    );
    const after = await layoutService.getBranchLayout(restAId, branchDup);
    assert.equal(after.version, 1);
    assert.deepEqual(after.items, []);
  });

  it("7. invalid geometry is rejected (out of canvas / non-finite)", async () => {
    const cases = [
      layoutItem(tGeom, { x: 850, width: 100 }), // x + width > 900
      layoutItem(tGeom, { y: -5 }), // negative y
      layoutItem(tGeom, { width: 0 }), // zero footprint
      layoutItem(tGeom, { rotation: Number.POSITIVE_INFINITY }),
    ];
    for (const item of cases) {
      await assert.rejects(
        layoutService.saveBranchLayout(restAId, branchGeom, {
          version: 1,
          items: [item],
        }),
        ValidationError,
      );
    }
    const after = await layoutService.getBranchLayout(restAId, branchGeom);
    assert.equal(after.version, 1);
    assert.deepEqual(after.items, []);
  });

  it("8. inactive table cannot be placed", async () => {
    await assert.rejects(
      layoutService.saveBranchLayout(restAId, branchInactive, {
        version: 1,
        items: [layoutItem(tInactiveBr)],
      }),
      ValidationError,
    );
    const after = await layoutService.getBranchLayout(restAId, branchInactive);
    assert.equal(after.version, 1);
    assert.deepEqual(after.items, []);
  });

  it("9. table from another branch is rejected", async () => {
    const current = await layoutService.getBranchLayout(restAId, branchMain);
    await assert.rejects(
      layoutService.saveBranchLayout(restAId, branchMain, {
        version: current.version,
        items: [layoutItem(tAlt)],
      }),
      ForbiddenError,
    );
    const after = await layoutService.getBranchLayout(restAId, branchMain);
    assert.equal(after.version, current.version);
  });

  it("10. table from another restaurant is rejected", async () => {
    const current = await layoutService.getBranchLayout(restAId, branchMain);
    await assert.rejects(
      layoutService.saveBranchLayout(restAId, branchMain, {
        version: current.version,
        items: [layoutItem(tRestB)],
      }),
      NotFoundError,
    );
    const after = await layoutService.getBranchLayout(restAId, branchMain);
    assert.equal(after.version, current.version);
  });

  it("11. cashier branch scope: denied for another branch, allowed for assigned branch", async () => {
    // Branch-scoped to LAY-MAIN: reading/writing LAY-SCOPE must be a 403.
    await assert.rejects(
      layoutService.getBranchLayout(restAId, branchScope, [branchMain]),
      ForbiddenError,
    );
    await assert.rejects(
      layoutService.saveBranchLayout(
        restAId,
        branchScope,
        { version: 1, items: [] },
        [branchMain],
      ),
      ForbiddenError,
    );

    // Branch-scoped to LAY-SCOPE itself: allowed (read-then-write version).
    const current = await layoutService.getBranchLayout(restAId, branchScope, [
      branchScope,
    ]);
    const saved = await layoutService.saveBranchLayout(
      restAId,
      branchScope,
      { version: current.version, items: [layoutItem(tScope)] },
      [branchScope],
    );
    assert.equal(saved.version, current.version + 1);
    assert.equal(saved.items[0].tableId, tScope);
  });

  it("12. a failed validation rolls back the entire save (no partial rows, no version bump)", async () => {
    const ok = await layoutService.saveBranchLayout(restAId, branchRollback, {
      version: 1,
      items: [layoutItem(tRb)],
    });
    assert.equal(ok.version, 2);

    // One valid table + one foreign table — the whole save must be rolled back.
    await assert.rejects(
      layoutService.saveBranchLayout(restAId, branchRollback, {
        version: 2,
        items: [layoutItem(tRb), layoutItem(tRestB)],
      }),
      NotFoundError,
    );

    const after = await layoutService.getBranchLayout(restAId, branchRollback);
    assert.equal(after.version, 2); // NOT bumped to 3
    assert.equal(after.items.length, 1); // only tRb survived
    assert.equal(after.items[0].tableId, tRb);
  });

  it("13. legacy NULL-branch table cannot be placed (refused, version unchanged)", async () => {
    // Pre-multi-branch tables keep branchId NULL; they must never enter a
    // branch floor plan (same rule the reservation service applies to them).
    const legacy = await prisma.table.create({
      data: {
        restaurantId: restAId,
        branchId: null,
        number: 1099,
        name: "LAY-LEGACY",
        capacity: 4,
        isActive: true,
        status: "AVAILABLE",
      },
    });
    const current = await layoutService.getBranchLayout(restAId, branchMain);
    await assert.rejects(
      layoutService.saveBranchLayout(restAId, branchMain, {
        version: current.version,
        items: [layoutItem(legacy.id)],
      }),
      ForbiddenError,
    );
    const after = await layoutService.getBranchLayout(restAId, branchMain);
    assert.equal(after.version, current.version); // NOT bumped
    assert.ok(after.items.every((i) => i.tableId !== legacy.id)); // never placed
  });
});