import { describe, expect, it } from "vitest";
import { RemodelDataIngestBodySchema } from "../remodel-data";

describe("RemodelDataIngestBodySchema", () => {
  it("accepts an object payload and preserves arbitrary fields", () => {
    const result = RemodelDataIngestBodySchema.safeParse({
      dataset_id: "dataset-1",
      event_type: "slotlist",
      entries: [],
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.extra_field).toBe(true);
  });

  it("rejects null and array JSON roots", () => {
    expect(RemodelDataIngestBodySchema.safeParse(null).success).toBe(false);
    expect(RemodelDataIngestBodySchema.safeParse([]).success).toBe(false);
  });
});
