import { describe, expect, it } from "vitest";
import type { Bindings, D1Database } from "../../types";
import questTreeApp from "../quest_tree";

const datasetId = "550e8400-e29b-41d4-a716-446655440000";

function createDatabaseMock(): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind: (..._args: unknown[]) => ({
          all: async () => ({
            results: sql.includes("target_quest_id")
              ? [
                  {
                    target_quest_id: 101,
                    appeared_at_ms: 1700000000000,
                    collection_session_id: "qsess-1",
                    is_bootstrap_unknown: 0,
                  },
                ]
              : [
                  {
                    quest_id: 101,
                    event_type: "complete",
                    state_after: "claimed",
                    timestamp_ms: 1700000001000,
                    collection_session_id: "qsess-1",
                  },
                ],
          }),
        }),
      };
    },
  } as unknown as D1Database;
}

describe("quest-tree /changes", () => {
  it("returns public quest history without authorization", async () => {
    const response = await questTreeApp.request(
      `http://localhost/changes?dataset_id=${datasetId}`,
      { method: "GET" },
      { QUEST_INDEX_DB: createDatabaseMock() } as unknown as Bindings,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(
      "public, max-age=60, stale-while-revalidate=300",
    );
    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      dataset_id: datasetId,
      appearances: [
        {
          target_quest_id: 101,
        },
      ],
      states: [
        {
          quest_id: 101,
          event_type: "complete",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("api_member_id");
    expect(JSON.stringify(body)).not.toContain("collection_session_id");
  });

  it("rejects a non-public dataset id", async () => {
    const response = await questTreeApp.request(
      "http://localhost/changes?dataset_id=member-123",
      { method: "GET" },
      { QUEST_INDEX_DB: createDatabaseMock() } as unknown as Bindings,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "dataset_id must be a UUID v4 public_id",
    });
  });
});