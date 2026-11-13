import { describe, expect, it } from "vitest";
import type { D1Database } from "../../types";
import { getOrCreateSession, ingestQuestBody } from "../quest_tree";

describe("getOrCreateSession", () => {
  it("uses the canonical session when the insert loses a same-timestamp race", async () => {
    const database = {
      prepare(sql: string) {
        return {
          bind: (..._args: unknown[]) => ({
            first: async () =>
              sql.includes("ORDER BY started_at_ms")
                ? null
                : {
                    collection_session_id: "qsess-canonical",
                    ended_at_ms: 1000,
                    bootstrap_completed_at_ms: 2000,
                  },
            run: async () => ({ meta: { rows_written: 0, changes: 0 } }),
          }),
        };
      },
    } as unknown as D1Database;

    const result = await getOrCreateSession(database, "dataset-1", 3000);

    expect(result).toEqual({
      sessionId: "qsess-canonical",
      isNew: false,
      bootstrapCompleted: true,
    });
  });

  function createIngestDatabase(bootstrapCompletedAtMs: number | null) {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const database = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              all: async () => ({ results: [] }),
              first: async () =>
                sql.includes("FROM quest_collection_sessions") &&
                sql.includes("ORDER BY started_at_ms")
                  ? {
                      collection_session_id: "qsess-existing",
                      ended_at_ms: 9000,
                      bootstrap_completed_at_ms: bootstrapCompletedAtMs,
                    }
                  : null,
              run: async () => {
                statements.push({ sql, args });
                return { meta: { changes: 1, rows_written: 1 } };
              },
            };
          },
        };
      },
      batch: async (prepared: Array<{ run: () => Promise<unknown> }>) =>
        Promise.all(prepared.map((statement) => statement.run())),
    } as unknown as D1Database;
    return { database, statements };
  }

  const ingestDatasetId = "550e8400-e29b-41d4-a716-446655440000";

  describe("quest-tree ingest inference scheduling", () => {
    it("uses page zero as the bootstrap baseline without enqueuing inference", async () => {
      const { database, statements } = createIngestDatabase(null);

      const result = await ingestQuestBody(database, {
        dataset_id: ingestDatasetId,
        request_id: "request-baseline",
        payload_hash: "hash-baseline",
        event_type: "snapshot",
        timestamp_ms: 10000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [{ quest_id: 101, title: "Test quest" }],
      });

      expect(result).toMatchObject({
        status: 200,
        body: { task_enqueued: false, task_id: null },
      });
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_inference_tasks"),
        ),
      ).toBe(false);
      expect(
        statements.find((statement) =>
          statement.sql.includes("INSERT INTO questlist_snapshots"),
        )?.args[4],
      ).toBe("[]");
    });

    it("does not complete bootstrap or enqueue work for a partial-tab snapshot", async () => {
      const { database, statements } = createIngestDatabase(null);

      const result = await ingestQuestBody(database, {
        dataset_id: ingestDatasetId,
        request_id: "request-partial",
        payload_hash: "hash-partial",
        event_type: "snapshot",
        timestamp_ms: 10000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 9,
        quests: [{ quest_id: 101, title: "Test quest" }],
      });

      expect(result).toMatchObject({
        status: 200,
        body: { task_enqueued: false, task_id: null },
      });
      expect(
        statements.some((statement) =>
          statement.sql.includes("bootstrap_completed_at_ms = ?"),
        ),
      ).toBe(false);
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_appearance_events"),
        ),
      ).toBe(false);
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_inference_tasks"),
        ),
      ).toBe(false);
    });

    it("does not enqueue inference for a state event with no new appearance", async () => {
      const { database, statements } = createIngestDatabase(9500);

      const result = await ingestQuestBody(database, {
        dataset_id: ingestDatasetId,
        request_id: "request-state",
        payload_hash: "hash-state",
        event_type: "start",
        timestamp_ms: 10000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        quest_id: 101,
      });

      expect(result).toMatchObject({
        status: 200,
        body: { task_enqueued: false, task_id: null },
      });
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_inference_tasks"),
        ),
      ).toBe(false);
    });
  });
});