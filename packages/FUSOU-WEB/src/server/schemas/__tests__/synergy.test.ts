import { describe, expect, it } from "vitest";
import { LatestSynergyPeriodRowSchema } from "../synergy";

describe("LatestSynergyPeriodRowSchema", () => {
  it("accepts a period tag and preserves extra columns", () => {
    const result = LatestSynergyPeriodRowSchema.safeParse({
      period_tag: "2026-07-08",
      completed_at: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period_tag).toBe("2026-07-08");
      expect(result.data.completed_at).toBe(1);
    }
  });

  it("rejects missing, empty, and non-string period tags", () => {
    expect(LatestSynergyPeriodRowSchema.safeParse({}).success).toBe(false);
    expect(
      LatestSynergyPeriodRowSchema.safeParse({ period_tag: "" }).success,
    ).toBe(false);
    expect(
      LatestSynergyPeriodRowSchema.safeParse({ period_tag: 20260708 }).success,
    ).toBe(false);
    expect(LatestSynergyPeriodRowSchema.safeParse(null).success).toBe(false);
  });
});
