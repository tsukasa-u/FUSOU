import { describe, expect, it } from "vitest";
import { selectLatestShipGrowthPeriod } from "../ship-growth-utils";

describe("ship-growth-utils", () => {
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
