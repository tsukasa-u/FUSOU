import { describe, expect, it } from "vitest";
import {
  SokuSpeedIngestBodySchema,
  ValidatedSokuSpeedIngestBodySchema,
} from "../soku-speed";

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

  it("accepts a valid snapshot with equipment", () => {
    const result = ValidatedSokuSpeedIngestBodySchema.safeParse({
      dataset_id: "a".repeat(64),
      request_id: "request-1",
      payload_hash: "b".repeat(64),
      event_type: "snapshot",
      period_tag: "2026-01-01",
      table_version: "1.0",
      ships: [
        {
          master_id: 1,
          lv: 10,
          soku_observed: 5,
          slots: [{ slotitem_id: 2, locked: true, level: 0, alv: 0 }],
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("preserves indexed ship validation messages", () => {
    const result = ValidatedSokuSpeedIngestBodySchema.safeParse({
      dataset_id: "a".repeat(64),
      request_id: "request-1",
      payload_hash: "b".repeat(64),
      event_type: "snapshot",
      period_tag: "2026-01-01",
      table_version: "1.0",
      ships: [{ master_id: "1" }],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "ships[0] has invalid numeric fields",
      );
    }
  });
});
