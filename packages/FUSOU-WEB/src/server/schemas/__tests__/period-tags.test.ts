import { describe, expect, it } from "vitest";
import {
  LatestMasterPeriodRowSchema,
  PeriodTagRowsSchema,
} from "../period-tags";

describe("PeriodTagRowsSchema", () => {
  it("accepts nullable tags and preserves extra fields", () => {
    const result = PeriodTagRowsSchema.safeParse([
      { tag: "2026-08-14T00:00:00Z", id: 1 },
      { tag: null },
    ]);

    expect(result.success).toBe(true);
    if (result.success) expect(result.data[0]?.id).toBe(1);
  });

  it("rejects rows with a non-string tag", () => {
    expect(PeriodTagRowsSchema.safeParse([{ tag: 20260814 }]).success).toBe(
      false,
    );
  });
});

describe("LatestMasterPeriodRowSchema", () => {
  it("accepts master period rows and extra fields", () => {
    expect(
      LatestMasterPeriodRowSchema.safeParse({
        period_tag: "2026-08-14",
        table_version: "1.0",
        extra: true,
      }).success,
    ).toBe(true);
  });

  it("rejects incomplete or null rows", () => {
    expect(
      LatestMasterPeriodRowSchema.safeParse({ period_tag: "2026-08-14" })
        .success,
    ).toBe(false);
    expect(LatestMasterPeriodRowSchema.safeParse(null).success).toBe(false);
  });
});