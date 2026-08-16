import { describe, expect, it } from "vitest";
import type { D1Database } from "../../types";
import { getOrCreateSession } from "../quest_tree";

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
});