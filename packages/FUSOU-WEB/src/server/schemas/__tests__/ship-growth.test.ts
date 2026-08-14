import { describe, expect, it } from "vitest";
import {
  MasterDataR2KeyRowSchema,
  ShipGrowthIngestBodySchema,
} from "../ship-growth";

describe("MasterDataR2KeyRowSchema", () => {
  it("accepts a non-empty key and the nullable empty state", () => {
    expect(
      MasterDataR2KeyRowSchema.safeParse({ r2_key: "master-data/file.avro" })
        .success,
    ).toBe(true);
    expect(MasterDataR2KeyRowSchema.safeParse({ r2_key: null }).success).toBe(
      true,
    );
    expect(MasterDataR2KeyRowSchema.safeParse({}).success).toBe(true);
  });

  it("rejects non-string and empty keys", () => {
    expect(
      MasterDataR2KeyRowSchema.safeParse({ r2_key: 42 }).success,
    ).toBe(false);
    expect(
      MasterDataR2KeyRowSchema.safeParse({ r2_key: "" }).success,
    ).toBe(false);
    expect(MasterDataR2KeyRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("ShipGrowthIngestBodySchema", () => {
  it("accepts an object payload and preserves upload fields", () => {
    const result = ShipGrowthIngestBodySchema.safeParse({
      dataset_id: "dataset-1",
      request_id: "request-1",
      schema_version: 1,
      ships: [],
      content_hash: "hash",
      file_size: "100",
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe(1);
      expect(result.data.file_size).toBe("100");
      expect(result.data.extra_field).toBe(true);
    }
  });

  it("rejects null and array JSON roots", () => {
    expect(ShipGrowthIngestBodySchema.safeParse(null).success).toBe(false);
    expect(ShipGrowthIngestBodySchema.safeParse([]).success).toBe(false);
  });
});
