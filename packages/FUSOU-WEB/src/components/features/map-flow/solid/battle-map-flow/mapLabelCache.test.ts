import { describe, expect, it } from "vitest";
import {
  parseMapLabelEntry,
  resolveMapCellLabel,
  setMapLabelsForTest,
} from "./mapLabelCache";

describe("mapLabelCache", () => {
  it("resolves alias cell ids (1-5 boss J = 10/11/12) to the official label", () => {
    setMapLabelsForTest(
      "1-5",
      parseMapLabelEntry({
        ports: [0],
        labels: { "0": "港", "9": "I", "10": "J", "11": "J", "12": "J" },
      }),
    );
    expect(resolveMapCellLabel("1-5", 10)).toBe("J");
    expect(resolveMapCellLabel("1-5", 11)).toBe("J");
    expect(resolveMapCellLabel("1-5", "12")).toBe("J");
    expect(resolveMapCellLabel("1-5", 9)).toBe("I");
  });

  it("falls back to alphabet labels when the map labels are not loaded", () => {
    expect(resolveMapCellLabel("9-9", 3)).toBe("C");
    expect(resolveMapCellLabel(null, 1)).toBe("A");
  });

  it("ignores malformed payloads", () => {
    expect(parseMapLabelEntry(null)).toEqual({ labels: {}, ports: [] });
    expect(parseMapLabelEntry({ labels: { x: "A", "2": "" }, ports: ["1", "a"] })).toEqual({
      labels: {},
      ports: [1],
    });
  });
});
