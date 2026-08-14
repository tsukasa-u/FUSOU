import { describe, expect, it } from "vitest";
import { PeriodTagRowsSchema } from "../period-tags";

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