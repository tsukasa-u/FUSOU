import { describe, expect, it } from "vitest";
import {
  normalizeShipGrowthCaps,
  selectLatestShipGrowthPeriod,
  ShipGrowthAllPeriodsResponseSchema,
  ShipGrowthBoundsResponseSchema,
  ShipGrowthExpResponseSchema,
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
});
