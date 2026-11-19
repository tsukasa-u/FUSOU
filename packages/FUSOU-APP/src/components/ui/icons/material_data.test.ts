import { describe, expect, it } from "vitest";
import {
  getMaterialIconExpansionShelfRows,
  getMaterialIconFurnitureStoreRows,
  getMaterialIconItemNumbersAtCell,
  getMaterialIconLocation,
  getMaterialIconResourceShelfRows,
  getMaterialIconShelfCell,
  getMaterialIconShelfRows,
} from "./material_data";

describe("getMaterialIconItemNumbersAtCell", () => {
  it("resolves item ids for occupied cells, including the expansion shelf LT cell", () => {
    expect(getMaterialIconItemNumbersAtCell(1, "B1")).toEqual([57]);
    expect(getMaterialIconItemNumbersAtCell(4, "A0")).toEqual([31]);
    expect(getMaterialIconItemNumbersAtCell(2, "A1")).toEqual([
      80, 85, 86, 87, 88, 89, 90, 93, 96, 97,
    ]);
    expect(getMaterialIconItemNumbersAtCell(1, "A1")).toEqual([]);
  });
});

describe("getMaterialIconLocation", () => {
  it("resolves table, row, and column from a grid cell code", () => {
    expect(getMaterialIconLocation(1)).toEqual({
      cell: "A3",
      tableId: 1,
      row: 3,
      column: "A",
    });
    expect(getMaterialIconLocation(57)).toEqual({
      cell: "B1",
      tableId: 1,
      row: 1,
      column: "B",
    });
  });

  it("includes the current expansion items in their occupied shelf cells", () => {
    expect([103, 104, 105].map(getMaterialIconLocation)).toEqual([
      { cell: "E1", tableId: 2, row: 1, column: "E" },
      { cell: "E2", tableId: 2, row: 2, column: "E" },
      { cell: "D3", tableId: 2, row: 3, column: "D" },
    ]);
  });

  it("creates four-row shelves without the zero-indexed row", () => {
    const shelfRows = getMaterialIconShelfRows(1);

    expect(shelfRows[0][1]).toEqual({
      cell: "B1",
      row: 1,
      column: "B",
      present: true,
      occupied: true,
    });
    expect(shelfRows).toHaveLength(4);
    expect(shelfRows[0][0].cell).toBe("A1");
    expect(shelfRows[0][0].present).toBe(false);
    expect(shelfRows[0][6].present).toBe(false);
    expect(shelfRows[2][3].present).toBe(false);
    expect(shelfRows[3][7].cell).toBe("H4");
    expect(shelfRows[2][7].occupied).toBe(false);
  });

  it("orders the resource shelf as a two-by-two layout", () => {
    expect(
      getMaterialIconResourceShelfRows().map((row) =>
        row.map(({ cell, occupied }) => [cell, occupied]),
      ),
    ).toEqual([
      [
        ["A0", true],
        ["C0", true],
      ],
      [
        ["B0", true],
        ["D0", true],
      ],
    ]);
  });

  it("builds a five-column expansion shelf and places LT at A1", () => {
    const shelfRows = getMaterialIconExpansionShelfRows();

    expect(shelfRows).toHaveLength(4);
    expect(shelfRows[0]).toHaveLength(5);
    expect(shelfRows[0][0]).toMatchObject({
      cell: "A1",
      present: true,
      occupied: true,
      label: "LT",
    });
    expect(shelfRows[0][4]).toMatchObject({
      cell: "E1",
      present: false,
      occupied: false,
    });
    expect(shelfRows[1][4].occupied).toBe(true);
    expect(shelfRows[2][3].occupied).toBe(true);
    expect(getMaterialIconShelfCell(80)).toBe("A1");
    expect(getMaterialIconShelfCell(105)).toBe("D3");
    expect(getMaterialIconShelfCell(103)).toBe(null);
  });

  it("builds an eight-column purchase shelf", () => {
    const shelfRows = getMaterialIconShelfRows(3);

    expect(shelfRows).toHaveLength(4);
    expect(shelfRows[0]).toHaveLength(8);
    expect(shelfRows[2][3].cell).toBe("D3");
    expect(shelfRows[2][3].occupied).toBe(true);
  });

  it("places the furniture coin in the separate furniture store shelf", () => {
    expect(getMaterialIconFurnitureStoreRows()[0][0]).toMatchObject({
      cell: "E0",
      present: true,
      occupied: true,
    });
    expect(getMaterialIconShelfCell(44)).toBe("E0");
    expect(getMaterialIconShelfCell(49)).toBe(null);
    expect(getMaterialIconShelfCell(55)).toBe(null);
    expect(getMaterialIconShelfCell(61)).toBe(null);
  });

  it("does not treat special icon codes as grid cells", () => {
    expect(getMaterialIconLocation(68)).toMatchObject({
      cell: "LT",
      row: null,
      column: null,
    });
    expect(getMaterialIconLocation(79)).toMatchObject({
      cell: "UC",
      row: null,
      column: null,
    });
    expect(getMaterialIconLocation(999)).toMatchObject({
      cell: "UN",
      row: null,
      column: null,
    });
  });
});
