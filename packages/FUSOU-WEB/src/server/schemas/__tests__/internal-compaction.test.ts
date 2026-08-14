import { describe, expect, it } from "vitest";
import { ListSourceGroupsRequestSchema } from "../internal-compaction";

describe("ListSourceGroupsRequestSchema", () => {
  it("coerces numeric window values and trims the table name", () => {
    const result = ListSourceGroupsRequestSchema.safeParse({
      tier: "daily",
      table_name: "  battle  ",
      window_start_ms: "1000",
      window_end_ms: 2000,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.table_name).toBe("battle");
      expect(result.data.window_start_ms).toBe(1000);
      expect(result.data.window_end_ms).toBe(2000);
    }
  });

  it("accepts omitted fields for route-level required-field errors", () => {
    expect(
      ListSourceGroupsRequestSchema.safeParse({ tier: "hourly" }).success,
    ).toBe(true);
  });

  it("rejects invalid tiers and non-finite windows", () => {
    expect(
      ListSourceGroupsRequestSchema.safeParse({ tier: "monthly" }).success,
    ).toBe(false);
    expect(
      ListSourceGroupsRequestSchema.safeParse({ window_start_ms: "nope" })
        .success,
    ).toBe(false);
  });
});