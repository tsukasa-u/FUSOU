import { describe, expect, it } from "vitest";
import { parseMstShipMap, parseMstSlotItemMap } from "../data-service";
import { normalizeNullableNumber } from "../helpers";

describe("battle master-data parsers", () => {
  it("normalizes only numeric stat values", () => {
    expect(normalizeNullableNumber("42")).toBe(42);
    expect(normalizeNullableNumber(0)).toBe(0);
    expect(normalizeNullableNumber(false)).toBeNull();
    expect(normalizeNullableNumber([])).toBeNull();
    expect(normalizeNullableNumber("not-a-number")).toBeNull();
  });

  it("normalizes valid ship ids and skips malformed rows", () => {
    const ships = parseMstShipMap([
      { id: "42", name: "Ship 42" },
      { id: 0, name: "invalid" },
      { id: "not-a-number", name: "invalid" },
      "not-a-record",
    ]);

    expect([...ships.entries()]).toEqual([
      [42, { id: 42, name: "Ship 42" }],
    ]);
  });

  it("keeps only array slot types while preserving valid records", () => {
    const slotItems = parseMstSlotItemMap([
      { id: 7, name: "Valid", type: [0, 0, 0, 3] },
      { id: "8", name: "Malformed type", type: "3" },
      { id: 9, type: [0, 0, 0, 5] },
    ]);

    expect(slotItems.get(7)).toEqual({
      id: 7,
      name: "Valid",
      type: [0, 0, 0, 3],
    });
    expect(slotItems.get(8)).toEqual({ id: 8, name: "Malformed type" });
    expect(slotItems.get(9)).toEqual({ id: 9, type: [0, 0, 0, 5] });
  });
});
