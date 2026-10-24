import { describe, expect, it } from "vitest";
import { resolveMapCellLabel, setMapLabelsForTest } from "../../map-flow/solid/battle-map-flow/mapLabelCache";

describe("BattlesListPanel helpers and logic", () => {
  it("resolves cell 0 to port number and alias cells correctly", () => {
    setMapLabelsForTest("1-5", {
      labels: { 0: "1", 1: "A", 10: "J", 11: "J", 12: "J" },
      ports: [0],
    });

    // cell_id 0 represents port/start cell
    expect(resolveMapCellLabel("1-5", 0)).toBe("1");
    // alias cells for 1-5 boss
    expect(resolveMapCellLabel("1-5", 10)).toBe("J");
    expect(resolveMapCellLabel("1-5", 11)).toBe("J");
    expect(resolveMapCellLabel("1-5", 12)).toBe("J");
    // regular cell
    expect(resolveMapCellLabel("1-5", 1)).toBe("A");
  });

  it("handles pagination calculations correctly", () => {
    const PAGE_SIZE = 20;
    const calcPages = (total: number) => Math.ceil(total / PAGE_SIZE);

    expect(calcPages(0)).toBe(0);
    expect(calcPages(1)).toBe(1);
    expect(calcPages(20)).toBe(1);
    expect(calcPages(21)).toBe(2);
    expect(calcPages(40)).toBe(2);
    expect(calcPages(41)).toBe(3);
  });
});
