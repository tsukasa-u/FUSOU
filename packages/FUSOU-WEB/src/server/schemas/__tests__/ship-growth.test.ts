import { describe, expect, it } from "vitest";
import { ShipGrowthIngestBodySchema } from "../ship-growth";

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
