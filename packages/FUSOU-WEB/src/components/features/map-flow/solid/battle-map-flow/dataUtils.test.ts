import { describe, expect, it } from "vitest";
import {
  compareNullableTimestamps,
  formatTimestamp,
  mapKeyOf,
} from "./dataUtils";

describe("map-flow data utilities", () => {
  it("preserves epoch zero as a timestamp", () => {
    expect(formatTimestamp(0)).not.toBe("-");
  });

  it("treats non-positive map coordinates as missing", () => {
    expect(mapKeyOf({ maparea_id: 1, mapinfo_no: 1 })).toBe("1-1");
    expect(mapKeyOf({ maparea_id: 0, mapinfo_no: 0 })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: -1, mapinfo_no: 1 })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: 1, mapinfo_no: 0 })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: null, mapinfo_no: null })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: 0, mapinfo_no: null })).toBe("unknown");
  });

  it("sorts missing timestamps after valid epoch zero in either direction", () => {
    expect(compareNullableTimestamps(0, null)).toBeLessThan(0);
    expect(compareNullableTimestamps(null, 0)).toBeGreaterThan(0);
    expect(compareNullableTimestamps(0, null, "desc")).toBeLessThan(0);
    expect(compareNullableTimestamps(null, 0, "desc")).toBeGreaterThan(0);
  });
});