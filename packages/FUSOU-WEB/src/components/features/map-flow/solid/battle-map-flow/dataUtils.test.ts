import { describe, expect, it } from "vitest";
import {
  compareNullableTimestamps,
  formatTimestamp,
  mapKeyOf,
  normalizeEpochMs,
  alphaCellLabel,
  resolveRouteCellsWithPort,
  cellLabel,
  cellOverlayLabel,
  resolveCellType,
  parseMapRoutesPayload,
  isPortCell,
  isWithinDateRange,
  parseMapLabelsPayload,
  buildAliasCellMap,
  findBattleForCell,
} from "./dataUtils";

describe("map-flow data utilities", () => {
  it("preserves epoch zero as a timestamp", () => {
    expect(formatTimestamp(0)).not.toBe("-");
    expect(formatTimestamp("0")).not.toBe("-");
  });

  it("normalizes and formats ISO 8601 timestamp strings correctly", () => {
    const iso = "2024-05-15T12:30:00Z";
    expect(normalizeEpochMs(iso)).toBe(Date.parse(iso));
    expect(formatTimestamp(iso)).not.toBe("-");
    expect(isWithinDateRange(iso, "2024-05-01", "2024-05-31")).toBe(true);
    expect(isWithinDateRange(iso, "2024-06-01", "2024-06-30")).toBe(false);
  });

  it("mapKeyOf parses explicit mapKey / map_key / map strings", () => {
    expect(mapKeyOf({ mapKey: "1-5" })).toBe("1-5");
    expect(mapKeyOf({ map_key: "2-3" })).toBe("2-3");
    expect(mapKeyOf({ map: "7-4" })).toBe("7-4");
  });

  it("isPortCell identifies pure numeric labels as ports", () => {
    expect(isPortCell("1")).toBe(true);
    expect(isPortCell("2")).toBe(true);
    expect(isPortCell("A")).toBe(false);
  });

  it("resolveCellType guarantees fought cells are battle red even if passCount is zero", () => {
    expect(resolveCellType("A", "1-1", true, undefined, 0, 1)).toBe("battle");
    expect(resolveCellType("C(ボス)", "1-1", true, undefined, 0, 1)).toBe("battle");
    expect(resolveCellType("A", "1-1", false, undefined, 5, 0)).toBe("empty");
  });

  it("handles undefined or invalid timestamps safely without returning Invalid Date", () => {
    expect(formatTimestamp(undefined)).toBe("-");
    expect(formatTimestamp(null)).toBe("-");
    expect(formatTimestamp(Number.NaN)).toBe("-");
    expect(formatTimestamp(-1)).toBe("-");
    expect(formatTimestamp("invalid")).toBe("-");
  });

  it("safely coerces string map coordinates or rejects invalid ones", () => {
    expect(mapKeyOf({ maparea_id: 1, mapinfo_no: 1 })).toBe("1-1");
    // String numbers from query params or database are properly coerced!
    expect(mapKeyOf({ maparea_id: "2" as unknown as number, mapinfo_no: "3" as unknown as number })).toBe("2-3");
    expect(mapKeyOf({ maparea_id: 0, mapinfo_no: 0 })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: -1, mapinfo_no: 1 })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: 1, mapinfo_no: 0 })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: null, mapinfo_no: null })).toBe("unknown");
    expect(mapKeyOf({ maparea_id: 0, mapinfo_no: null })).toBe("unknown");
    expect(mapKeyOf(null)).toBe("unknown");
    expect(mapKeyOf(undefined)).toBe("unknown");
  });

  it("normalizes epoch ms from either numbers or string numbers", () => {
    expect(normalizeEpochMs(1700000000000)).toBe(1700000000000);
    expect(normalizeEpochMs("1700000000000")).toBe(1700000000000);
    expect(normalizeEpochMs(1700000000)).toBe(1700000000000); // second conversion
    expect(normalizeEpochMs("invalid")).toBeNull();
    expect(normalizeEpochMs(null)).toBeNull();
  });

  it("converts cell ID to alpha label even when passed as string", () => {
    expect(alphaCellLabel(1)).toBe("A");
    expect(alphaCellLabel("1")).toBe("A");
    expect(alphaCellLabel(26)).toBe("Z");
    expect(alphaCellLabel("27")).toBe("AA");
    expect(alphaCellLabel(0)).toBe("-");
    expect(alphaCellLabel(-1)).toBe("-");
  });

  it("does not mistake null, undefined, empty string or boolean as port 0", () => {
    const ports = [0];
    expect(cellLabel(null, undefined, ports)).toBe("-");
    expect(cellLabel(undefined, undefined, ports)).toBe("-");
    expect(cellLabel("", undefined, ports)).toBe("-");
    expect(normalizeEpochMs(true as any)).toBeNull();
    expect(normalizeEpochMs(false as any)).toBeNull();
    expect(normalizeEpochMs([] as any)).toBeNull();
    expect(isWithinDateRange(1700000000000, undefined as any, undefined as any)).toBe(true);
    expect(resolveRouteCellsWithPort([1, 2], [10], undefined as any)).toEqual([10, 1, 2]);
    expect(buildAliasCellMap(undefined as any).size).toBe(0);
  });

  it("sorts missing or NaN timestamps after valid epoch zero in either direction", () => {
    expect(compareNullableTimestamps(0, null)).toBeLessThan(0);
    expect(compareNullableTimestamps(null, 0)).toBeGreaterThan(0);
    expect(compareNullableTimestamps(0, Number.NaN)).toBeLessThan(0);
    expect(compareNullableTimestamps(Number.NaN, 0)).toBeGreaterThan(0);
    expect(compareNullableTimestamps(0, null, "desc")).toBeLessThan(0);
    expect(compareNullableTimestamps(null, 0, "desc")).toBeGreaterThan(0);
    // string numbers
    expect(compareNullableTimestamps("100", "200")).toBeLessThan(0);
    expect(Number.isNaN(compareNullableTimestamps(Number.NaN, 0))).toBe(false);
  });

  it("does not duplicate port when route already starts at port 0", () => {
    const cells = [0, 1, 2];
    const ports = [10];
    const spots = [{ cellId: 0, x: 100, y: 100 }, { cellId: 10, x: 110, y: 110 }];
    const resolved = resolveRouteCellsWithPort(cells, ports, spots);
    expect(resolved).toEqual([0, 1, 2]);
  });

  it("resolves port number strictly from cell IDs and ports array without depending on Japanese text", () => {
    const ports = [0, 19];
    const labels: Record<number, string> = {
      0: "1",
      19: "2",
      1: "A",
    };
    expect(cellLabel(0, labels, ports)).toBe("1");
    expect(cellLabel(19, labels, ports)).toBe("2");
    expect(cellLabel(1, labels, ports)).toBe("A");
    expect(cellOverlayLabel(0, labels, ports)).toBe("1");
    expect(cellOverlayLabel(19, labels, ports)).toBe("2");
  });

  it("safely handles null and undefined inputs for isPortCell and date checks", () => {
    expect(isPortCell(undefined)).toBe(false);
    expect(isPortCell("1")).toBe(true);
    expect(isPortCell("2")).toBe(true);
    expect(isPortCell("A")).toBe(false);
    expect(isPortCell("X", [0])).toBe(true);
    expect(isPortCell("X", [19], [0, 19])).toBe(true);
    expect(isPortCell("X", [1], [0, 19])).toBe(false);
    expect(isPortCell("X", undefined, undefined, true)).toBe(true);

    // Date range with whitespaces, slashes, or string timestamps
    expect(isWithinDateRange(1700000000000, " 2020-01-01 ", " 2030-01-01 ")).toBe(true);
    expect(isWithinDateRange("1700000000000", " 2020/01/01 ", " 2030/01/01 ")).toBe(true);
    expect(isWithinDateRange(undefined, "2020-01-01", "2030-01-01")).toBe(false);
  });

  it("parses map labels payload whether wrapped or direct", () => {
    expect(parseMapLabelsPayload({ "1": "A" })).toEqual({ "1": "A" });
    expect(parseMapLabelsPayload({ labels: { "1": "A" } })).toEqual({ "1": "A" });
    expect(parseMapLabelsPayload(null)).toBeNull();
  });



  it("resolveRouteCellsWithPort finds nearest port when spot.cellId is a string number", () => {
    const cells = [2];
    const ports = [10, 20];
    const spots = [
      { cellId: "2" as unknown as number, x: 100, y: 100 },
      { cellId: "10" as unknown as number, x: 300, y: 300 },
      { cellId: "20" as unknown as number, x: 105, y: 105 },
    ];
    const resolved = resolveRouteCellsWithPort(cells, ports, spots);
    expect(resolved).toEqual([20, 2]);
  });
  it("resolveRouteCellsWithPort normalizes string cell and port inputs and preserves number type", () => {
    const cells = ["10", "20"] as unknown as number[];
    const ports = ["1"] as unknown as number[];
    const spots = [{ cellId: 10, x: 100, y: 100 }, { cellId: 1, x: 100, y: 90 }];
    const resolved = resolveRouteCellsWithPort(cells, ports, spots);
    expect(resolved).toEqual([1, 10, 20]);
    expect(typeof resolved[0]).toBe("number");
    expect(typeof resolved[1]).toBe("number");
  });
  it("resolveCellType accurately implements FUSOU specification: ports are yellow, fought cells are red, and non-combat/unpassed cells are empty gray", () => {
    // Port (yellow) by numeric ID / ports array / isPort flag
    expect(resolveCellType("1", "1-1")).toBe("port");
    expect(resolveCellType("A", "1-1", false, [0])).toBe("port");
    expect(resolveCellType("A", "1-1", false, [19], undefined, undefined, [0, 19])).toBe("port");
    expect(resolveCellType("A", "1-1", false, [1], undefined, undefined, undefined, true)).toBe("port");

    // Fought cells (red) - both normal battles and boss battles are red
    expect(resolveCellType("A", "1-1", true)).toBe("battle");
    expect(resolveCellType("C(ボス)", "1-1", true, undefined, 1, 1)).toBe("battle");
    expect(resolveCellType("E(航空戦)", "1-1", true, undefined, 1, 1)).toBe("battle");

    // Non-combat cells or unpassed cells (empty gray)
    expect(resolveCellType("B(資源)", "1-1", false, undefined, 1, 0)).toBe("empty");
    expect(resolveCellType("D(気のせい)", "1-1", false, undefined, 1, 0)).toBe("empty");
    expect(resolveCellType("G(能動分岐)", "1-1", false, undefined, 1, 0)).toBe("empty");
    expect(resolveCellType("A", "1-1", false, undefined, 0, 0)).toBe("empty");
  });

  it("isWithinDateRange handles unpadded date inputs like 2024-5-1 and 2024/5/1", () => {
    const ts = new Date("2024-05-15T00:00:00Z").getTime();
    expect(isWithinDateRange(ts, "2024-5-1", "2024-5-31")).toBe(true);
    expect(isWithinDateRange(ts, "2024/5/1", "2024/5/31")).toBe(true);
    expect(isWithinDateRange(ts, "2024-5-20", "2024-5-31")).toBe(false);
  });

  it("parseMapRoutesPayload safely coerces string numbers in route coordinates", () => {
    const raw = [
      {
        routeId: 1,
        from: "1",
        to: "2",
        startX: "100.5",
        startY: "200.5",
        ctrlX: "150",
        ctrlY: "250",
        endX: "300",
        endY: "400",
        curvature: "0.2",
        isArrow: true,
      },
    ];
    const parsed = parseMapRoutesPayload(raw);
    expect(parsed.length).toBe(1);
    expect(parsed[0]!.from).toBe(1);
    expect(parsed[0]!.startX).toBe(100.5);
    expect(parsed[0]!.isArrow).toBe(true);
  });

  it("compareNullableTimestamps aligns seconds and milliseconds correctly", () => {
    // 1700000000 s === 1700000000000 ms
    expect(compareNullableTimestamps(1700000000, 1700000000000)).toBe(0);
    expect(compareNullableTimestamps(1700000001, 1700000000000)).toBeGreaterThan(0);
  });

  it("formatTimestamp and normalizeEpochMs reject empty or whitespace strings without treating as epoch zero", () => {
    expect(formatTimestamp("")).toBe("-");
    expect(formatTimestamp("   ")).toBe("-");
    expect(normalizeEpochMs("")).toBeNull();
    expect(normalizeEpochMs("   ")).toBeNull();
  });

  it("mapKeyOf supports camelCase (mapAreaId/mapInfoNo) and snake_case (map_area_id/map_info_no)", () => {
    expect(mapKeyOf({ mapAreaId: 2, mapInfoNo: 3 } as any)).toBe("2-3");
    expect(mapKeyOf({ map_area_id: 3, map_info_no: 4 } as any)).toBe("3-4");
  });

  it("cellLabel handles multi-port numeric assignment correctly", () => {
    const ports = [10, 20];
    const labels = {
      10: "1",
      20: "2",
    };
    expect(cellLabel(10, labels, ports)).toBe("1");
    expect(cellLabel(20, labels, ports)).toBe("2");
    expect(cellOverlayLabel(10, labels, ports)).toBe("1");
    expect(cellOverlayLabel(20, labels, ports)).toBe("2");
  });

  it("isPortCell matches even with string arrays for cellIds and ports", () => {
    expect(isPortCell("A", ["10"] as any, [10])).toBe(true);
    expect(isPortCell("A", [10], ["10"] as any)).toBe(true);
  });

  it("isWithinDateRange handles timestamps with times or T separators in range bounds", () => {
    // 2026-10-24 15:00 JST (2026-10-24 06:00 UTC)
    const ts = new Date("2026-10-24T06:00:00Z").getTime();
    expect(isWithinDateRange(ts, "2026-10-24T00:00:00Z", "2026-10-24T23:59:59Z")).toBe(true);
    expect(isWithinDateRange(ts, "2026-10-24 00:00:00", "2026-10-24 23:59:59")).toBe(true);
    expect(isWithinDateRange(ts, "2026-10-24", "2026-10-24")).toBe(true);
    expect(isWithinDateRange(ts, "2026-10-25", "2026-10-26")).toBe(false);
  });

  it("buildAliasCellMap groups cells sharing identical coordinates", () => {
    const spots = [
      { cellId: 1, x: 100, y: 200 },
      { cellId: 2, x: 300, y: 400 },
      { cellId: 10, x: 798, y: 501 },
      { cellId: 11, x: 798, y: 501 },
      { cellId: 12, x: 798, y: 501 },
    ];
    const aliasMap = buildAliasCellMap(spots);
    expect(aliasMap.has(1)).toBe(false);
    expect(aliasMap.has(2)).toBe(false);
    expect(aliasMap.get(10)).toEqual([10, 11, 12]);
    expect(aliasMap.get(11)).toEqual([10, 11, 12]);
    expect(aliasMap.get(12)).toEqual([10, 11, 12]);
  });

  it("findBattleForCell resolves battles for alias cells when direct match is absent", () => {
    const spots = [
      { cellId: 10, x: 798, y: 501 },
      { cellId: 11, x: 798, y: 501 },
      { cellId: 12, x: 798, y: 501 },
    ];
    const aliasMap = buildAliasCellMap(spots);

    // Battle recorded with cellId 10
    const battlesByCell = new Map<number, string[]>([
      [10, ["Boss Fleet Victory"]],
    ]);

    // Direct lookup for 10
    expect(findBattleForCell(10, battlesByCell, aliasMap)).toBe("Boss Fleet Victory");

    // Reset map: battle recorded with cellId 10, but route contains cellId 11
    const battlesByCell2 = new Map<number, string[]>([
      [10, ["Boss Fleet Victory"]],
    ]);
    expect(findBattleForCell(11, battlesByCell2, aliasMap)).toBe("Boss Fleet Victory");
    // After consumption, subsequent lookup returns undefined
    expect(findBattleForCell(12, battlesByCell2, aliasMap)).toBeUndefined();
  });

  it("handles string mapKey and invalid map inputs gracefully in mapKeyOf", () => {
    expect(mapKeyOf("1-1")).toBe("1-1");
    expect(mapKeyOf("62-1")).toBe("62-1");
    expect(mapKeyOf("  7-2  ")).toBe("7-2");
    expect(mapKeyOf("invalid")).toBe("unknown");
    expect(mapKeyOf("")).toBe("unknown");
    expect(mapKeyOf(null)).toBe("unknown");
  });

  it("deduplicates port list and handles multiple identical ports gracefully in cellLabel", () => {
    expect(cellLabel(10, {}, [10, 10, 15])).toBe("1");
    expect(cellLabel(15, {}, [10, 10, 15])).toBe("2");
    expect(cellLabel(0, {}, [10, 10, 15])).toBe("1");
  });

  it("safely falls back routeId and curvature to 0 when NaN or invalid in parseMapRoutesPayload", () => {
    const raw = [
      {
        routeId: "not-a-number",
        from: 1,
        to: 2,
        startX: 10,
        startY: 20,
        ctrlX: 15,
        ctrlY: 25,
        endX: 30,
        endY: 40,
        curvature: NaN,
        isArrow: true,
      },
    ];
    const parsed = parseMapRoutesPayload(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]!.routeId).toBe(0);
    expect(parsed[0]!.curvature).toBe(0);
    expect(parsed[0]!.isArrow).toBe(true);
  });

  it("correctly distinguishes unique route patterns from raw sortie occurrences", () => {
    // 3 sorties with identical cell paths [0, 1, 2]
    const rawSorties = [
      { sortieId: "s1", mapKey: "1-1", cells: [0, 1, 2], sortTimestamp: 1000 },
      { sortieId: "s2", mapKey: "1-1", cells: [0, 1, 2], sortTimestamp: 2000 },
      { sortieId: "s3", mapKey: "1-1", cells: [0, 1, 2], sortTimestamp: 3000 },
    ];

    // Unique route aggregation (as done by allSortieRoutes)
    const routeMap = rawSorties.reduce((map, route) => {
      const normalizedCells =
        route.cells.at(-1) === 0 ? route.cells.slice(0, -1) : route.cells;
      const key = `${route.mapKey}:${normalizedCells.join("-")}`;
      const existing = map.get(key);
      if (!existing || route.sortTimestamp > existing.sortTimestamp) {
        map.set(key, route);
      }
      return map;
    }, new Map<string, typeof rawSorties[0]>());

    expect(routeMap.size).toBe(1);
    expect(routeMap.get("1-1:0-1-2")?.sortieId).toBe("s3");

    // Real sortie count for cell 2 in selectedCellDetails
    const matchingSorties = rawSorties.filter((r) => r.cells.includes(2));
    expect(matchingSorties.length).toBe(3);
  });

});
