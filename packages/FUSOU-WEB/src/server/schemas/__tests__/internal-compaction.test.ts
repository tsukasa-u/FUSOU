import { describe, expect, it } from "vitest";
import {
  ListSourceGroupsRequestSchema,
  ListSourceTablesRequestSchema,
  FetchBlockOcfRequestSchema,
  ResolveSourceWindowRangeRequestSchema,
  VerifyOutputVisibleRequestSchema,
  ReleaseOutputLockRequestSchema,
  AcquireOutputLockRequestSchema,
  PeriodRolloverCheckRequestSchema,
  ResolveTableVersionRequestSchema,
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

describe("VerifyOutputVisibleRequestSchema", () => {
  it("trims a file path", () => {
    const result = VerifyOutputVisibleRequestSchema.safeParse({
      file_path: "  output.avro  ",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.file_path).toBe("output.avro");
  });

  it("preserves the route's string coercion", () => {
    const result = VerifyOutputVisibleRequestSchema.safeParse({ file_path: 123 });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.file_path).toBe("123");
  });
});

describe("ReleaseOutputLockRequestSchema", () => {
  it("trims both lock fields", () => {
    const result = ReleaseOutputLockRequestSchema.safeParse({
      file_path: " output.avro ",
      lock_token: " token ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file_path).toBe("output.avro");
      expect(result.data.lock_token).toBe("token");
    }
  });

  it("accepts omitted fields for route-level required-field handling", () => {
    expect(ReleaseOutputLockRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe("AcquireOutputLockRequestSchema", () => {
  it("coerces strings and numeric lock settings", () => {
    const result = AcquireOutputLockRequestSchema.safeParse({
      file_path: " output.avro ",
      lock_token: " token ",
      table_version: " 1.0 ",
      compaction_tier: "daily",
      source_tier: " hourly ",
      window_start_ms: "100",
      window_end_ms: 200,
      lock_ttl_ms: "30000",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file_path).toBe("output.avro");
      expect(result.data.window_start_ms).toBe(100);
      expect(result.data.lock_ttl_ms).toBe(30000);
    }
  });

  it("rejects an invalid compaction tier", () => {
    expect(
      AcquireOutputLockRequestSchema.safeParse({
        compaction_tier: "monthly",
      }).success,
    ).toBe(false);
  });

  it("accepts omitted required fields for route-level errors", () => {
    expect(AcquireOutputLockRequestSchema.safeParse({}).success).toBe(true);
  });
});

describe("PeriodRolloverCheckRequestSchema", () => {
  it("defaults source_tier to weekly", () => {
    const result = PeriodRolloverCheckRequestSchema.safeParse({
      table_name: " battle ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.table_name).toBe("battle");
      expect(result.data.source_tier).toBe("weekly");
    }
  });

  it("preserves a supplied source tier", () => {
    const result = PeriodRolloverCheckRequestSchema.safeParse({
      table_name: "battle",
      source_tier: " daily ",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source_tier).toBe("daily");
  });
});

describe("ResolveTableVersionRequestSchema", () => {
  it("defaults source_tier to hourly", () => {
    const result = ResolveTableVersionRequestSchema.safeParse({
      table_name: " battle ",
      period_tag: " 2026-01-01 ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.table_name).toBe("battle");
      expect(result.data.period_tag).toBe("2026-01-01");
      expect(result.data.source_tier).toBe("hourly");
    }
  });

  it("preserves a supplied source tier", () => {
    const result = ResolveTableVersionRequestSchema.safeParse({
      table_name: "battle",
      period_tag: "2026-01-01",
      source_tier: " period ",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.source_tier).toBe("period");
  });
});