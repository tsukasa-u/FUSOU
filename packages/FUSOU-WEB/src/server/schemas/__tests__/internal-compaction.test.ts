import { describe, expect, it } from "vitest";
import {
  ListSourceGroupsRequestSchema,
  ListSourceTablesRequestSchema,
  FetchBlockOcfRequestSchema,
  ResolveSourceWindowRangeRequestSchema,
} from "../internal-compaction";

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

describe("ListSourceTablesRequestSchema", () => {
  it("keeps finite window values and ignores invalid ones", () => {
    const result = ListSourceTablesRequestSchema.safeParse({
      tier: "period",
      window_start_ms: "1000",
      window_end_ms: "invalid",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.window_start_ms).toBe(1000);
      expect(result.data.window_end_ms).toBeUndefined();
    }
  });

  it("rejects an invalid tier", () => {
    expect(
      ListSourceTablesRequestSchema.safeParse({ tier: "monthly" }).success,
    ).toBe(false);
  });
});

describe("ResolveSourceWindowRangeRequestSchema", () => {
  it("accepts a tier and table name array", () => {
    const result = ResolveSourceWindowRangeRequestSchema.safeParse({
      tier: "weekly",
      table_names: ["battle", 123],
    });

    expect(result.success).toBe(true);
  });

  it("rejects a non-array table_names value", () => {
    expect(
      ResolveSourceWindowRangeRequestSchema.safeParse({
        tier: "weekly",
        table_names: "battle",
      }).success,
    ).toBe(false);
  });
});

describe("FetchBlockOcfRequestSchema", () => {
  it("coerces numeric values and trims the file path", () => {
    const result = FetchBlockOcfRequestSchema.safeParse({
      file_path: "  archives/source.avro  ",
      start_byte: "10",
      length: 25,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file_path).toBe("archives/source.avro");
      expect(result.data.start_byte).toBe(10);
      expect(result.data.length).toBe(25);
    }
  });

  it("rejects non-finite numeric values", () => {
    expect(
      FetchBlockOcfRequestSchema.safeParse({
        file_path: "source.avro",
        start_byte: "invalid",
      }).success,
    ).toBe(false);
  });
});