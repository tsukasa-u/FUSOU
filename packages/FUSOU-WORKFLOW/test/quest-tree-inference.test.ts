import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runQuestInferenceTasks } from "../src/quest_tree_inference";
import { d1Fixture } from "./sqlite-fixture";

const QUEST_SCHEMA = readFileSync(
  new URL(
    "../../FUSOU-WEB/migrations/quest-index/0004_add_quest_tree_inference_tables.sql",
    import.meta.url,
  ),
  "utf8",
);

const QUEST_INDEX_OPT_MIGRATION = readFileSync(
  new URL(
    "../../FUSOU-WEB/migrations/quest-index/0008_optimize_quest_inference_indexes.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("quest inference query batching", () => {
  it("keeps per-target reads below ten and recomputes a shared target once", async () => {
    const { db, database } = d1Fixture(QUEST_SCHEMA);
    const appearedAt = Date.now();

    database
      .prepare(
        `INSERT INTO quest_collection_sessions
         (collection_session_id, dataset_id, started_at_ms, created_at)
         VALUES ('session', 'dataset', ?, ?)`,
      )
      .run(appearedAt, appearedAt);

    for (let questId = 1; questId <= 10; questId += 1) {
      database
        .prepare(
          `INSERT INTO quest_state_events
           (dataset_id, collection_session_id, quest_id, event_type, state_after,
            timestamp_ms, period_tag, table_version, payload_hash, created_at)
           VALUES ('dataset', 'session', ?, 'complete', 'claimed', ?,
                   'period', '0.6.0', '', ?)`,
        )
        .run(questId, appearedAt - 100 + questId, appearedAt);
    }

    for (let index = 0; index < 2; index += 1) {
      const timestamp = appearedAt + index;
      database
        .prepare(
          `INSERT INTO quest_appearance_events
           (dataset_id, collection_session_id, target_quest_id, appeared_at_ms,
            source_event_type, period_tag, table_version, created_at)
           VALUES ('dataset', 'session', 100, ?, 'snapshot', 'period', '0.6.0', ?)`,
        )
        .run(timestamp, appearedAt);
      database
        .prepare(
          `INSERT INTO quest_inference_tasks
           (task_id, dataset_id, collection_session_id, from_ts, to_ts, status, created_at, updated_at)
           VALUES (?, 'dataset', 'session', ?, ?, 'pending', ?, ?)`,
        )
        .run(
          `task-${index}`,
          timestamp,
          timestamp + 1,
          appearedAt,
          appearedAt,
        );
    }

    const targetReads: string[] = [];
    let maxBoundParamsPerStatement = 0;
    const originalPrepare = db.prepare.bind(db);
    Object.defineProperty(db, "prepare", {
      configurable: true,
      value: (sql: string) => {
        if (
          /^\s*SELECT\b/i.test(sql) &&
          /quest_(appearance_events|occurrence_contexts|occurrence_prerequisites)/i.test(
            sql,
          )
        ) {
          targetReads.push(sql);
        }
        const stmt = originalPrepare(sql);
        const originalBind = stmt.bind.bind(stmt);
        stmt.bind = (...args: unknown[]) => {
          maxBoundParamsPerStatement = Math.max(
            maxBoundParamsPerStatement,
            args.length,
          );
          if (args.length > 100) {
            throw new Error(
              `D1_ERROR: too many SQL variables (${args.length} > 100)`,
            );
          }
          return originalBind(...args);
        };
        return stmt;
      },
    });

    await expect(runQuestInferenceTasks(db)).resolves.toMatchObject({
      picked: 2,
      completed: 2,
      failed: 0,
    });

    expect(maxBoundParamsPerStatement).toBeLessThanOrEqual(100);
    expect(targetReads.length).toBeLessThan(10);
    expect(
      targetReads.filter((sql) =>
        sql.includes("SELECT o.occurrence_id, p.quest_id, p.is_recent"),
      ),
    ).toHaveLength(1);
    const savedCount = Number(
      database
        .prepare("SELECT COUNT(*) AS count FROM quest_rule_candidates")
        .get()?.["count"] ?? 0,
    );
    expect(savedCount).toBeGreaterThanOrEqual(10);
    expect(savedCount).toBeLessThanOrEqual(30);
  });

  it("applies 0008 migration cleanly even with duplicate appearance rows and blocks re-inserts", () => {
    const { database } = d1Fixture(QUEST_SCHEMA);
    const now = Date.now();
    database
      .prepare(
        `INSERT INTO quest_collection_sessions
         (collection_session_id, dataset_id, started_at_ms, created_at)
         VALUES ('sess-1', 'dataset-1', ?, ?), ('sess-2', 'dataset-1', ?, ?)`,
      )
      .run(now, now, now + 1000, now + 1000);

    database
      .prepare(
        `INSERT INTO quest_appearance_events
         (dataset_id, collection_session_id, target_quest_id, appeared_at_ms,
          source_event_type, period_tag, table_version, is_bootstrap_unknown, created_at)
         VALUES
          ('dataset-1', 'sess-1', 100, ?, 'snapshot', '2026-11', '0.6.0', 0, ?),
          ('dataset-1', 'sess-2', 100, ?, 'snapshot', '2026-11', '0.6.0', 0, ?)`,
      )
      .run(now, now, now + 1000, now + 1000);

    database.exec(QUEST_INDEX_OPT_MIGRATION);

    const remaining = database
      .prepare(
        `SELECT COUNT(*) AS c FROM quest_appearance_events WHERE dataset_id = 'dataset-1' AND target_quest_id = 100`,
      )
      .get()?.["c"];
    expect(remaining).toBe(1);

    const dupResult = database
      .prepare(
        `INSERT OR IGNORE INTO quest_appearance_events
         (dataset_id, collection_session_id, target_quest_id, appeared_at_ms,
          source_event_type, period_tag, table_version, is_bootstrap_unknown, created_at)
         VALUES ('dataset-1', 'sess-2', 100, ?, 'snapshot', '2026-11', '0.6.0', 0, ?)`,
      )
      .run(now + 2000, now + 2000);
    expect(dupResult.changes).toBe(0);
  });
});
