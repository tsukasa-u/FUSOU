import { describe, expect, it } from "vitest";
import { SokuSpeedIngestBodySchema } from "../soku-speed";

describe("SokuSpeedIngestBodySchema", () => {
  it("accepts an object payload and preserves upload fields", () => {
    const result = SokuSpeedIngestBodySchema.safeParse({
      dataset_id: "dataset-1",
      request_id: "request-1",
      event_type: "snapshot",
      ships: [],
      content_hash: "hash",
      file_size: "100",
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.file_size).toBe("100");
      expect(result.data.extra_field).toBe(true);
    }
  });

  it("rejects null and array JSON roots", () => {
    expect(SokuSpeedIngestBodySchema.safeParse(null).success).toBe(false);
    expect(SokuSpeedIngestBodySchema.safeParse([]).success).toBe(false);
  });
});
