import { describe, expect, it } from "vitest";
import {
  finiteNumberOrNull,
  jsonRecordsOf,
  nullableNumberArray,
} from "../payload-codec";

describe("simulator payload codec", () => {
  it("keeps valid zero separate from missing and invalid numbers", () => {
    expect(finiteNumberOrNull(0)).toBe(0);
    expect(finiteNumberOrNull(null)).toBeNull();
    expect(finiteNumberOrNull("not-a-number")).toBeNull();
    expect(nullableNumberArray([0, undefined, "2"])).toEqual([0, null, 2]);
  });

  it("keeps only object records at JSON boundaries", () => {
    expect(jsonRecordsOf([{ id: 1 }, null, "invalid", { id: 2 }])).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
  });
});