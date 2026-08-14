import { describe, expect, it } from "vitest";
import {
  QuestIngestConflictRowSchema,
  QuestIngestEventIdRowSchema,
  QuestTreeIngestBodySchema,
  ValidatedQuestTreeIngestBodySchema,
} from "../quest-tree";

describe("QuestIngestEventIdRowSchema", () => {
  it("accepts an id row and an empty lookup", () => {
    expect(QuestIngestEventIdRowSchema.safeParse({ id: 1 }).success).toBe(
      true,
    );
    expect(QuestIngestEventIdRowSchema.safeParse(null).success).toBe(true);
  });

  it("rejects malformed id rows", () => {
    expect(QuestIngestEventIdRowSchema.safeParse({ id: "1" }).success).toBe(
      false,
    );
    expect(QuestIngestEventIdRowSchema.safeParse({}).success).toBe(false);
  });
});

describe("QuestIngestConflictRowSchema", () => {
  it("accepts conflict rows and an empty lookup", () => {
    expect(
      QuestIngestConflictRowSchema.safeParse({
        id: 1,
        payload_hash: "hash-1",
      }).success,
    ).toBe(true);
    expect(QuestIngestConflictRowSchema.safeParse(null).success).toBe(true);
  });

  it("rejects rows missing the conflict payload hash", () => {
    expect(QuestIngestConflictRowSchema.safeParse({ id: 1 }).success).toBe(
      false,
    );
    expect(
      QuestIngestConflictRowSchema.safeParse({ id: 1, payload_hash: 42 })
        .success,
    ).toBe(false);
  });
});

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

  it("preserves validator error order and messages", () => {
    const result = ValidatedQuestTreeIngestBodySchema.safeParse({});

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("dataset_id is required");
    }
  });

  it("validates the dataset id format used by the ingest route", () => {
    const result = ValidatedQuestTreeIngestBodySchema.safeParse({
      dataset_id: "dataset-1",
      request_id: "request-1",
      payload_hash: "hash",
      event_type: "snapshot",
      period_tag: "2026-01-01",
      table_version: "1.0",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "dataset_id must be a 64-character SHA-256 hex string",
      );
    }
  });
});
