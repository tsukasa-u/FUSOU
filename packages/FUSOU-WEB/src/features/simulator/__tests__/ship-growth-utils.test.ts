import { describe, expect, it } from "vitest";
import {
  normalizeShipGrowthCaps,
  selectLatestShipGrowthPeriod,
  ShipGrowthAllPeriodsResponseSchema,
  ShipGrowthBoundsResponseSchema,
  ShipGrowthExpResponseSchema,
  normalizeBoundRows,
  mergeBoundsByMax,
  buildBoundsChartData,
  buildAllPeriodsBoundsChartData,
  type BoundRow,
  type AllPeriodsEntry,
} from "../ship-growth-utils";

describe("ship-growth-utils", () => {
  it("normalizes legacy response aliases without accepting a missing successful result", () => {
    expect(ShipGrowthExpResponseSchema.parse({
      ok: true, rows: [{ lv: 1, exp_current: 0 }],
    }).exp).toEqual([{ lv: 1, exp_current: 0 }]);
    expect(ShipGrowthAllPeriodsResponseSchema.parse({
      ok: true, periods: [],
    }).entries).toEqual([]);
    expect(ShipGrowthExpResponseSchema.safeParse({ ok: true }).success).toBe(false);
    expect(ShipGrowthAllPeriodsResponseSchema.safeParse({ ok: true }).success).toBe(false);
    expect(ShipGrowthBoundsResponseSchema.safeParse({ ok: true }).success).toBe(false);
  });
  it("preserves short cap aliases and explicit zero values after schema parsing", () => {
    const response = ShipGrowthBoundsResponseSchema.parse({
      ok: true, bounds: [],
      caps: [{ master_id: 1, kaih_max: 20, tais_max: 0, saku_max: 10 }],
    });
    expect(normalizeShipGrowthCaps(response.caps![0]!)).toEqual({
      master_id: 1, kaihi_max: 20, taisen_max: 0, sakuteki_max: 10,
    });
    expect(normalizeShipGrowthCaps({
      master_id: 1, taisen_max: 0, tais_max: 20,
    })?.taisen_max).toBe(0);
  });

  it("accepts empty collections and rejects invalid identities without coercing strings", () => {
    expect(ShipGrowthExpResponseSchema.safeParse({ ok: true, exp: [] }).success).toBe(true);
    expect(ShipGrowthAllPeriodsResponseSchema.safeParse({ ok: true, entries: [] }).success).toBe(true);
    for (const master_id of [-1, 0, 1.5, "1"]) {
      expect(ShipGrowthBoundsResponseSchema.safeParse({
        ok: true, bounds: [], caps: [{ master_id }],
      }).success).toBe(false);
    }
    expect(ShipGrowthBoundsResponseSchema.safeParse({
      ok: true, caps: [], bounds: [{
        master_id: 1, lv: 1, kaihi_naked: 0, taisen_naked: 0, sakuteki_naked: 0,
      }],
    }).success).toBe(true);
  });

  describe("selectLatestShipGrowthPeriod", () => {
    it("returns null for empty or non-array inputs", () => {
      expect(selectLatestShipGrowthPeriod(null)).toBeNull();
      expect(selectLatestShipGrowthPeriod(undefined)).toBeNull();
      expect(selectLatestShipGrowthPeriod([])).toBeNull();
    });

    it("selects the period with the newest period_tag", () => {
      const periods = [
        { period_tag: "2026-08-01", table_version: "0.5.0" },
        { period_tag: "2026-09-01", table_version: "0.5.0" },
        { period_tag: "2026-07-01", table_version: "0.5.0" },
      ];
      const result = selectLatestShipGrowthPeriod(periods);
      expect(result).toEqual({ period_tag: "2026-09-01", table_version: "0.5.0" });
    });

    it("selects the highest table_version when period_tags are identical", () => {
      const periods = [
        { period_tag: "2026-09-01", table_version: "0.5.2" },
        { period_tag: "2026-09-01", table_version: "0.6.0" },
        { period_tag: "2026-09-01", table_version: "0.5.9" },
      ];
      const result = selectLatestShipGrowthPeriod(periods);
      expect(result).toEqual({ period_tag: "2026-09-01", table_version: "0.6.0" });
    });
  });

  describe("normalizeBoundRows and mergeBoundsByMax", () => {
    it("normalizes lucky_naked and source period properties", () => {
      const rows = normalizeBoundRows([
        {
          master_id: 10,
          lv: 1,
          kaihi_naked: 40,
          taisen_naked: 20,
          sakuteki_naked: 5,
          lucky_naked: 10,
          lucky_source_period: "2026-10-14/0.6.0",
        },
      ]);
      expect(rows).toEqual([
        {
          master_id: 10,
          lv: 1,
          kaihi_naked: 40,
          taisen_naked: 20,
          sakuteki_naked: 5,
          lucky_naked: 10,
          lucky_source_period: "2026-10-14/0.6.0",
        },
      ]);
    });

    it("merges bounds preserving the minimum positive naked observation across all stats including lucky", () => {
      const archiveRows: BoundRow[] = [
        {
          master_id: 10,
          lv: 1,
          kaihi_naked: 42,
          taisen_naked: 0,
          sakuteki_naked: 6,
          lucky_naked: 0,
          kaihi_source_period: "archive",
          sakuteki_source_period: "archive",
        },
      ];
      const liveRows: BoundRow[] = [
        {
          master_id: 10,
          lv: 1,
          kaihi_naked: 40,
          taisen_naked: 20,
          sakuteki_naked: 7,
          lucky_naked: 10,
        },
      ];
      const merged = mergeBoundsByMax(archiveRows, liveRows, "live");
      expect(merged[0]).toEqual({
        master_id: 10,
        lv: 1,
        kaihi_naked: 40,
        kaihi_source_period: "live",
        taisen_naked: 20,
        taisen_source_period: "live",
        sakuteki_naked: 6,
        sakuteki_source_period: "archive",
        lucky_naked: 10,
        lucky_source_period: "live",
      });
    });
  });

  describe("buildBoundsChartData and buildAllPeriodsBoundsChartData (unobserved 0 filtering)", () => {
    it("filters out 0 values and does not generate empty lines for unobserved stats", () => {
      const rows: BoundRow[] = [
        { master_id: 1, lv: 1, kaihi_naked: 30, taisen_naked: 0, sakuteki_naked: 10, lucky_naked: 0 },
        { master_id: 1, lv: 2, kaihi_naked: 31, taisen_naked: 0, sakuteki_naked: 11, lucky_naked: 0 },
      ];
      const chartData = buildBoundsChartData(rows, null);
      const labels = chartData.datasets.map((d) => d.label);
      expect(labels).toContain("回避(naked)");
      expect(labels).toContain("索敵(naked)");
      expect(labels).not.toContain("対潜(naked)");
      expect(labels).not.toContain("運(naked)");
    });

    it("skips only unobserved levels for sparse data points", () => {
      const rows: BoundRow[] = [
        { master_id: 1, lv: 1, kaihi_naked: 10, taisen_naked: 10, sakuteki_naked: 5, lucky_naked: 12 },
        { master_id: 1, lv: 2, kaihi_naked: 11, taisen_naked: 11, sakuteki_naked: 5, lucky_naked: 0 },
        { master_id: 1, lv: 3, kaihi_naked: 12, taisen_naked: 12, sakuteki_naked: 6, lucky_naked: 12 },
      ];
      const chartData = buildBoundsChartData(rows, null);
      const luckyDs = chartData.datasets.find((d) => d.label === "運(naked)");
      expect(luckyDs).toBeDefined();
      expect(luckyDs?.data).toEqual([
        { x: 1, y: 12 },
        { x: 3, y: 12 },
      ]);
    });

    it("omits zero-stat datasets in all-periods mode for legacy periods lacking lucky", () => {
      const entries: AllPeriodsEntry[] = [
        {
          period_tag: "2026-04-07",
          table_version: "0.5.0",
          bounds: [
            { master_id: 10, lv: 1, kaihi_naked: 40, taisen_naked: 20, sakuteki_naked: 5, lucky_naked: 0 },
          ],
          caps: [],
        },
        {
          period_tag: "2026-10-14",
          table_version: "0.6.0",
          bounds: [
            { master_id: 10, lv: 1, kaihi_naked: 40, taisen_naked: 20, sakuteki_naked: 5, lucky_naked: 10 },
          ],
          caps: [],
        },
      ];
      const chartData = buildAllPeriodsBoundsChartData(entries, 10);
      const labels = chartData.datasets.map((d) => d.label);
      expect(labels).toContain("回避(naked) - 2026-04-07(v0.5.0)");
      expect(labels).not.toContain("運(naked) - 2026-04-07(v0.5.0)");
      expect(labels).toContain("運(naked) - 2026-10-14(v0.6.0)");
    });
  });
});
