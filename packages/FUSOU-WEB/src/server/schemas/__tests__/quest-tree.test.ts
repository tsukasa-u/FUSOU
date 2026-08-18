import { describe, expect, it } from "vitest";
import {
  QuestCollectionSessionRowSchema,
  QuestIngestConflictRowSchema,
  QuestIngestEventIdRowSchema,
  QuestSnapshotPageRowSchema,
  QuestStateEventRowSchema,
  parseQuestRuleRows,
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

describe("QuestCollectionSessionRowSchema", () => {
  it("accepts nullable session timestamps and an empty lookup", () => {
    expect(
      QuestCollectionSessionRowSchema.safeParse({
        collection_session_id: "session-1",
        ended_at_ms: null,
        bootstrap_completed_at_ms: 1000,
      }).success,
    ).toBe(true);
    expect(QuestCollectionSessionRowSchema.safeParse(null).success).toBe(true);
  });

  it("rejects malformed session rows", () => {
    expect(
      QuestCollectionSessionRowSchema.safeParse({
        collection_session_id: "session-1",
        ended_at_ms: "1000",
        bootstrap_completed_at_ms: null,
      }).success,
    ).toBe(false);
    expect(QuestCollectionSessionRowSchema.safeParse({}).success).toBe(false);
  });
});

describe("QuestSnapshotPageRowSchema", () => {
  it("accepts a snapshot page with a nullable JSON column", () => {
    expect(
      QuestSnapshotPageRowSchema.safeParse({
        page_no: 2,
        visible_quest_ids_json: "[100,101]",
      }).success,
    ).toBe(true);
    expect(
      QuestSnapshotPageRowSchema.safeParse({ page_no: 1, visible_quest_ids_json: null })
        .success,
    ).toBe(true);
  });

  it("rejects malformed page numbers and JSON column types", () => {
    expect(QuestSnapshotPageRowSchema.safeParse({ page_no: "2" }).success).toBe(
      false,
    );
    expect(
      QuestSnapshotPageRowSchema.safeParse({ page_no: 1, visible_quest_ids_json: [] })
        .success,
    ).toBe(false);
  });
});

describe("QuestStateEventRowSchema", () => {
  it("accepts the persisted quest state vocabulary", () => {
    expect(
      QuestStateEventRowSchema.safeParse({
        quest_id: 100,
        event_type: "start",
        state_after: "active",
        timestamp_ms: 1000,
        collection_session_id: "session-1",
      }).success,
    ).toBe(true);
  });

  it("rejects unknown state values", () => {
    expect(
      QuestStateEventRowSchema.safeParse({
        quest_id: 100,
        event_type: "start",
        state_after: "unknown",
        timestamp_ms: 1000,
        collection_session_id: "session-1",
      }).success,
    ).toBe(false);
  });
});

describe("parseQuestRuleRows", () => {
  it("keeps valid rule rows and skips malformed external rows", () => {
    const validRow = {
      rule_id: "rule-1",
      target_quest_id: 100,
      prereq_set_json: "[1,2]",
      set_size: 2,
      class: "same_series",
      support: 0.5,
      confidence: 0.8,
      lift: 1.2,
      score: 0.9,
      period_tag: "2026-01-01",
      table_version: "0.5",
      is_primary: 1,
      quality_tier: "high",
      updated_at_ms: 1000,
      extra_column: "preserved",
    };

    expect(
      parseQuestRuleRows([
        validRow,
        { ...validRow, score: "bad" },
        null,
      ]),
    ).toEqual([validRow]);
  });

  it("returns an empty list for non-array values", () => {
    expect(parseQuestRuleRows({ rule_id: "rule-1" })).toEqual([]);
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
      dataset_token: " dataset-token ",
      content_hash: " content-hash ",
      file_size: "100",
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
      expect(result.data.dataset_token).toBe("dataset-token");
      expect(result.data.content_hash).toBe("content-hash");
      expect(result.data.file_size).toBe(100);
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

  it("rejects non-string tokens and invalid file sizes at the schema boundary", () => {
    expect(
      QuestTreeIngestBodySchema.safeParse({ dataset_token: 123 }).success,
    ).toBe(false);
    expect(
      QuestTreeIngestBodySchema.safeParse({ content_hash: 123 }).success,
    ).toBe(false);
    expect(
      QuestTreeIngestBodySchema.safeParse({ file_size: "not-a-number" })
        .success,
    ).toBe(false);
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
