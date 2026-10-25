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

  it("sorts battles by timestamp correctly using compareNullableTimestamps", () => {
    const list = [
      { timestamp: 1000, name: "old" },
      { timestamp: 3000, name: "latest" },
      { timestamp: 2000, name: "middle" },
      { timestamp: null, name: "unknown" },
    ];

    // Descending (newest first)
    const desc = [...list].sort((a, b) => {
      const aMs = a.timestamp;
      const bMs = b.timestamp;
      if (aMs === null) return 1;
      if (bMs === null) return -1;
      return bMs - aMs;
    });
    expect(desc[0]!.name).toBe("latest");
    expect(desc[1]!.name).toBe("middle");
    expect(desc[2]!.name).toBe("old");
    expect(desc[3]!.name).toBe("unknown");

    // Ascending (oldest first)
    const asc = [...list].sort((a, b) => {
      const aMs = a.timestamp;
      const bMs = b.timestamp;
      if (aMs === null) return 1;
      if (bMs === null) return -1;
      return aMs - bMs;
    });
    expect(asc[0]!.name).toBe("old");
    expect(asc[1]!.name).toBe("middle");
    expect(asc[2]!.name).toBe("latest");
    expect(asc[3]!.name).toBe("unknown");
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
