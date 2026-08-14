import { describe, expect, it } from "vitest";
import { QuestTreeIngestBodySchema } from "../quest-tree";

describe("QuestTreeIngestBodySchema", () => {
  it("trims metadata and coerces integer-like fields", () => {
    const result = QuestTreeIngestBodySchema.safeParse({
      dataset_id: " dataset-id ",
      request_id: " request-1 ",
      payload_hash: " hash ",
      event_type: " snapshot ",
      timestamp_ms: "1000.9",
      period_tag: " 2026-01-01 ",
      table_version: " 1.0 ",
      page_no: "2.9",
      quest_id: "123",
      quests: [
        {
          quest_id: "456",
          title: "Quest title",
          detail: "Quest detail",
        },
      ],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.dataset_id).toBe("dataset-id");
      expect(result.data.event_type).toBe("snapshot");
      expect(result.data.timestamp_ms).toBe(1000);
      expect(result.data.page_no).toBe(2);
      expect(result.data.quest_id).toBe(123);
      expect(result.data.quests?.[0]?.quest_id).toBe(456);
    }
  });

  it("defaults a non-array quest list to an empty array", () => {
    const result = QuestTreeIngestBodySchema.parse({
      quests: "not-an-array",
      timestamp_ms: "invalid",
    });

    expect(result.quests).toEqual([]);
    expect(result.timestamp_ms).toBeUndefined();
  });

  it("accepts omitted fields for validator-level required errors", () => {
    const result = QuestTreeIngestBodySchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.quests).toBeUndefined();
  });
});
