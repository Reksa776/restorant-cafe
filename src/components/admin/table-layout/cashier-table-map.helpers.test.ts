import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CashierTable,
  CashierLayoutItem,
  isCashierTableSelectable,
  mergeCashierTables,
} from "./cashier-table-map.helpers";

const table = (
  id: string,
  number: number,
  overrides: Partial<CashierTable> = {}
): CashierTable => ({
  id,
  number,
  name: `Meja ${number}`,
  capacity: 4,
  status: "AVAILABLE",
  branchId: "branch-1",
  ...overrides,
});

describe("cashier table map — mergeCashierTables", () => {
  it("1. no layout → every table defaults to RECTANGLE, order preserved", () => {
    const tables = [
      table("t-1", 1),
      table("t-2", 2),
      table("t-3", 3, { status: "OCCUPIED" }),
    ];
    const merged = mergeCashierTables(tables, []);

    assert.deepEqual(
      merged.map((m) => ({
        tableId: m.tableId,
        number: m.number,
        shape: m.shape,
      })),
      [
        { tableId: "t-1", number: 1, shape: "RECTANGLE" },
        { tableId: "t-2", number: 2, shape: "RECTANGLE" },
        { tableId: "t-3", number: 3, shape: "RECTANGLE" },
      ]
    );
  });

  it("2. layout shapes are applied by tableId, rest default to RECTANGLE", () => {
    const tables = [
      table("t-1", 1),
      table("t-2", 2),
      table("t-3", 3),
    ];
    const layout: CashierLayoutItem[] = [
      { tableId: "t-1", shape: "CIRCLE" },
      { tableId: "t-3", shape: "CIRCLE" },
    ];
    const merged = mergeCashierTables(tables, layout);

    assert.deepEqual(merged.map((m) => m.shape), [
      "CIRCLE",
      "RECTANGLE",
      "CIRCLE",
    ]);
  });

  it("3. layout items for tables NOT in the list are ignored", () => {
    const tables = [table("t-1", 1)];
    const layout: CashierLayoutItem[] = [
      { tableId: "t-1", shape: "CIRCLE" },
      { tableId: "t-GONE", shape: "CIRCLE" },
    ];
    const merged = mergeCashierTables(tables, layout);

    assert.equal(merged.length, 1);
    assert.equal(merged[0].tableId, "t-1");
  });

  it("4. server metadata (status/name/capacity) always wins over layout", () => {
    const tables = [table("t-1", 1, { status: "OCCUPIED", name: "Sudut", capacity: 6 })];
    const layout: CashierLayoutItem[] = [
      { tableId: "t-1", shape: "CIRCLE" },
    ];
    const merged = mergeCashierTables(tables, layout)[0];

    assert.equal(merged.status, "OCCUPIED");
    assert.equal(merged.name, "Sudut");
    assert.equal(merged.capacity, 6);
    assert.equal(merged.shape, "CIRCLE");
  });

  it("5. status is copied as-is (client never derives it)", () => {
    const tables = [table("t-1", 1, { status: "MAINTENANCE" })];
    const [merged] = mergeCashierTables(tables, []);

    assert.equal(merged.status, "MAINTENANCE");
  });
});

describe("cashier table map — isCashierTableSelectable", () => {
  it("6. AVAILABLE and OCCUPIED are selectable (old <select> behaviour)", () => {
    assert.equal(isCashierTableSelectable("AVAILABLE"), true);
    assert.equal(isCashierTableSelectable("OCCUPIED"), true);
  });

  it("7. MAINTENANCE is not selectable", () => {
    assert.equal(isCashierTableSelectable("MAINTENANCE"), false);
  });
});