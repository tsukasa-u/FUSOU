import { describe, expect, it } from "vitest";
import {
  getMaterialIconExpansionShelfRows,
  getMaterialIconFurnitureStoreRows,
  getMaterialIconItemNumbersAtCell,
  getMaterialIconLocation,
  getMaterialIconPurchasedShelfRows,
  getMaterialIconResourceShelfRows,
  getMaterialIconShelfCell,
  getMaterialIconShelfRows,
  getPayItemIdsAtCell,
  getPayItemShelfCell,
} from "./material_data";

describe("getMaterialIconItemNumbersAtCell", () => {
  it("resolves only owned items at valid shelf cells", () => {
    expect(getMaterialIconItemNumbersAtCell(1, "A1", [55])).toEqual([55]);
    expect(getMaterialIconItemNumbersAtCell(1, "B1", [57])).toEqual([57]);
    expect(getMaterialIconItemNumbersAtCell(1, "G1", [61])).toEqual([61]);
    expect(getMaterialIconItemNumbersAtCell(1, "D3", [49])).toEqual([49]);
    expect(getMaterialIconItemNumbersAtCell(1, "C1", [4])).toEqual([4]);
    expect(getMaterialIconItemNumbersAtCell(4, "A0", [31])).toEqual([31]);
    expect(getMaterialIconItemNumbersAtCell(2, "A1", [96])).toEqual([96]);
    expect(getMaterialIconItemNumbersAtCell(1, "A1", [57])).toEqual([]);
  });

  it("places provisions and canned food in their game shelf cells", () => {
    const ownedNormalItems = [65, 66, 67, 69];

    expect(
      ownedNormalItems.map((itemNumber) =>
        getMaterialIconShelfCell(itemNumber),
      ),
    ).toEqual(["B4", "E4", "F4", "D4"]);
    expect(getMaterialIconItemNumbersAtCell(1, "E4", ownedNormalItems)).toEqual(
      [66],
    );
    expect(getMaterialIconItemNumbersAtCell(1, "D4", ownedNormalItems)).toEqual(
      [69],
    );
    expect(getMaterialIconShelfCell(76)).toBe("A3");
    expect(getMaterialIconItemNumbersAtCell(2, "A3", [76])).toEqual([76]);
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
    expect(
      [89, 90, 95, 97, 103, 104, 105].map(getMaterialIconLocation),
    ).toEqual([
      { cell: "B1", tableId: 2, row: 1, column: "B" },
      { cell: "C4", tableId: 2, row: 4, column: "C" },
      { cell: "H4", tableId: 1, row: 4, column: "H" },
      { cell: "H3", tableId: 1, row: 3, column: "H" },
      { cell: "E1", tableId: 2, row: 1, column: "E" },
      { cell: "E2", tableId: 2, row: 2, column: "E" },
      { cell: "D3", tableId: 2, row: 3, column: "D" },
    ]);
  });

  it("marks only owned cells on four-row shelves", () => {
    const shelfRows = getMaterialIconShelfRows(1, undefined, [49, 55, 57, 61]);

    expect(shelfRows[0][1]).toEqual({
      cell: "B1",
      row: 1,
      column: "B",
      present: true,
      occupied: true,
    });
    expect(shelfRows).toHaveLength(4);
    expect(shelfRows[0][0]).toMatchObject({
      cell: "A1",
      present: true,
      occupied: true,
    });
    expect(shelfRows[0][6].occupied).toBe(true);
    expect(shelfRows[2][3].occupied).toBe(true);
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
        ["A0", false],
        ["C0", false],
      ],
      [
        ["B0", false],
        ["D0", false],
      ],
    ]);
    expect(
      getMaterialIconResourceShelfRows([31, 33]).map((row) =>
        row.map(({ cell, occupied }) => [cell, occupied]),
      ),
    ).toEqual([
      [
        ["A0", true],
        ["C0", true],
      ],
      [
        ["B0", false],
        ["D0", false],
      ],
    ]);
  });

  it("shows expansion cells only for owned items, including LT at A1", () => {
    const emptyShelfRows = getMaterialIconExpansionShelfRows();
    expect(emptyShelfRows[0][0]).toMatchObject({
      cell: "A1",
      present: true,
      occupied: false,
    });
    expect(emptyShelfRows[0][0]).not.toHaveProperty("label");

    const shelfRows = getMaterialIconExpansionShelfRows([
      96, 89, 103, 104, 91, 94, 90, 105,
    ]);

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
      present: true,
      occupied: true,
    });
    expect(shelfRows[1][4].occupied).toBe(true);
    expect(shelfRows[2][3].occupied).toBe(true);
    expect(shelfRows[0][1].occupied).toBe(true);
    expect(shelfRows[3][2].occupied).toBe(true);
    expect(getMaterialIconShelfCell(96)).toBe("A1");
    expect(getMaterialIconShelfCell(80)).toBe(null);
    expect(getMaterialIconShelfCell(105)).toBe("D3");
    expect(getMaterialIconShelfCell(103)).toBe("E1");
  });

  it("builds an eight-column purchase shelf", () => {
    const shelfRows = getMaterialIconShelfRows(3);

    expect(shelfRows).toHaveLength(4);
    expect(shelfRows[0]).toHaveLength(8);
    expect(shelfRows[2][3].cell).toBe("D3");
    expect(shelfRows[2][3].occupied).toBe(false);
  });

  it("uses the game's payitem order for purchased-shelf coordinates", () => {
    const purchasedRows = getMaterialIconPurchasedShelfRows(
      [11, 14, 15, 16, 29],
      [53],
    );

    expect(getPayItemShelfCell(11)).toBe("E1");
    expect(getPayItemShelfCell(14)).toBe("F1");
    expect(getPayItemShelfCell(15)).toBe("B3");
    expect(getPayItemShelfCell(30)).toBe("H1");
    expect(getPayItemShelfCell(25)).toBe("G2");
    expect(getPayItemShelfCell(16)).toBe("D3");
    expect(getPayItemShelfCell(32)).toBe("H3");
    expect(getPayItemShelfCell(29)).toBe("G4");
    expect(getPayItemShelfCell(-1)).toBe(null);
    expect(getPayItemIdsAtCell("E1", [11, 14, 16])).toEqual([11]);
    expect(purchasedRows[0][4].occupied).toBe(true);
    expect(purchasedRows[0][5].occupied).toBe(true);
    expect(purchasedRows[2][1].occupied).toBe(true);
    expect(purchasedRows[2][3].occupied).toBe(true);
    expect(purchasedRows[3][6].occupied).toBe(true);
    expect(purchasedRows[3][7].occupied).toBe(false);
    expect(getMaterialIconShelfCell(50)).toBe("E3");
    expect(purchasedRows[2][4].occupied).toBe(false);
    expect(getMaterialIconShelfRows(1, undefined, [50])[2][4].occupied).toBe(
      true,
    );
  });

  it("places the furniture coin in the separate furniture store shelf", () => {
    expect(getMaterialIconFurnitureStoreRows()[0][0]).toMatchObject({
      cell: "E0",
      present: true,
      occupied: false,
    });
    expect(getMaterialIconFurnitureStoreRows([44])[0][0].occupied).toBe(true);
    expect(getMaterialIconShelfCell(44)).toBe("E0");
    expect(getMaterialIconShelfCell(49)).toBe("D3");
    expect(getMaterialIconShelfCell(55)).toBe("A1");
    expect(getMaterialIconShelfCell(61)).toBe("G1");
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
