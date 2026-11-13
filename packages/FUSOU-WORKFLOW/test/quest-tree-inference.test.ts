import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  recomputeAllRuleTargets,
  runQuestInferenceTasks,
} from "../src/quest_tree_inference";
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

const QUEST_OCCURRENCE_DEDUP_MIGRATION = readFileSync(
  new URL(
    "../../FUSOU-WEB/migrations/quest-index/0009_deduplicate_quest_occurrence_contexts.sql",
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

  it("deduplicates quest_occurrence_contexts via 0009 without FK errors and skips conflicting prerequisite writes", async () => {
    const { db, database } = d1Fixture(QUEST_SCHEMA);
    const baseTs = 1_700_000_000_000;

    database
      .prepare(
        `INSERT INTO quest_collection_sessions
         (collection_session_id, dataset_id, started_at_ms, created_at)
         VALUES
           ('sess-1', 'dataset-1', ?, ?),
           ('sess-2', 'dataset-1', ?, ?)`,
      )
      .run(baseTs, baseTs, baseTs + 1000, baseTs + 1000);

    // Pre-0008 duplicate non-bootstrap occurrences for the same dataset+target+period+version,
    // plus bootstrap unknown rows (which must remain untouched).
    database
      .prepare(
        `INSERT INTO quest_occurrence_contexts
         (occurrence_id, dataset_id, collection_session_id, target_quest_id,
          occurred_at_ms, period_tag, table_version, is_bootstrap_unknown,
          has_cross_session_inference, created_at)
         VALUES
           ('occ-early', 'dataset-1', 'sess-1', 200, ?, '2026-11', '0.6.0', 0, 0, ?),
           ('occ-dup',   'dataset-1', 'sess-2', 200, ?, '2026-11', '0.6.0', 0, 0, ?),
           ('occ-boot-1','dataset-1', 'sess-1', 200, ?, '2026-11', '0.6.0', 1, 0, ?),
           ('occ-boot-2','dataset-1', 'sess-2', 200, ?, '2026-11', '0.6.0', 1, 0, ?)`,
      )
      .run(
        baseTs + 100,
        baseTs + 100,
        baseTs + 5000,
        baseTs + 5000,
        baseTs + 200,
        baseTs + 200,
        baseTs + 6000,
        baseTs + 6000,
      );

    database
      .prepare(
        `INSERT INTO quest_occurrence_prerequisites
         (occurrence_id, quest_id, is_recent, is_completed, created_at)
         VALUES
           ('occ-early', 10, 1, 1, ?),
           ('occ-dup',   10, 0, 1, ?),
           ('occ-dup',   11, 1, 1, ?),
           ('occ-boot-1', 10, 0, 1, ?)`,
      )
      .run(baseTs, baseTs, baseTs, baseTs);

    // Inflated pre-0008 rules should be recomputed cleanly after dedup.
    await recomputeAllRuleTargets(db);

    // Apply 0009 cleanup (which also remains idempotent even after updated 0008).
    database.exec(QUEST_OCCURRENCE_DEDUP_MIGRATION);
    database.exec(QUEST_INDEX_OPT_MIGRATION);
    database.exec(QUEST_OCCURRENCE_DEDUP_MIGRATION);

    const remainingOccs = database
      .prepare(
        `SELECT occurrence_id, is_bootstrap_unknown
         FROM quest_occurrence_contexts
         ORDER BY occurred_at_ms ASC`,
      )
      .all() as Array<{ occurrence_id: string; is_bootstrap_unknown: number }>;
    expect(remainingOccs.map((row) => row.occurrence_id)).toEqual([
      "occ-early",
      "occ-boot-1",
      "occ-boot-2",
    ]);

    const remainingPrereqs = database
      .prepare(
        `SELECT occurrence_id, quest_id
         FROM quest_occurrence_prerequisites
         ORDER BY occurrence_id ASC, quest_id ASC`,
      )
      .all() as Array<{ occurrence_id: string; quest_id: number }>;
    expect(remainingPrereqs).toEqual([
      { occurrence_id: "occ-boot-1", quest_id: 10 },
      { occurrence_id: "occ-early", quest_id: 10 },
    ]);

    // Simulate a legacy appearance + task for sess-2 (same dataset/target/period/version as occ-early).
    // Note: bypass quest_appearance_events index by seeding before 0008 or testing a task whose
    // appearance event is bootstrap=1 OR test inserting duplicate session task directly after removing
    // unique appearance index; here we create a second dataset where occ-early already exists directly
    // and enqueue a task with a matching appearance event so ON CONFLICT hits idx_qocc_dataset_target_period_unique.
    database
      .prepare(
        `INSERT INTO quest_collection_sessions
         (collection_session_id, dataset_id, started_at_ms, created_at)
         VALUES ('sess-d2', 'dataset-2', ?, ?)`,
      )
      .run(baseTs, baseTs);
    database
      .prepare(
        `INSERT INTO quest_occurrence_contexts
         (occurrence_id, dataset_id, collection_session_id, target_quest_id,
          occurred_at_ms, period_tag, table_version, is_bootstrap_unknown,
          has_cross_session_inference, created_at)
         VALUES ('occ-existing-d2', 'dataset-2', 'sess-d2', 300, ?, '2026-11', '0.6.0', 0, 0, ?)`,
      )
      .run(baseTs, baseTs);
    database
      .prepare(
        `INSERT INTO quest_state_events
         (dataset_id, collection_session_id, quest_id, event_type, state_after,
          timestamp_ms, period_tag, table_version, payload_hash, created_at)
         VALUES ('dataset-2', 'sess-d2', 12, 'complete', 'claimed', ?, '2026-11', '0.6.0', '', ?)`,
      )
      .run(baseTs + 100, baseTs + 100);
    database
      .prepare(
        `INSERT INTO quest_appearance_events
         (dataset_id, collection_session_id, target_quest_id, appeared_at_ms,
          source_event_type, period_tag, table_version, is_bootstrap_unknown, created_at)
         VALUES ('dataset-2', 'sess-d2', 300, ?, 'snapshot', '2026-11', '0.6.0', 0, ?)`,
      )
      .run(baseTs + 200, baseTs + 200);
    database
      .prepare(
        `INSERT INTO quest_inference_tasks
         (task_id, dataset_id, collection_session_id, from_ts, to_ts, status, created_at, updated_at)
         VALUES ('task-dup-occ', 'dataset-2', 'sess-d2', ?, ?, 'pending', ?, ?)`,
      )
      .run(baseTs + 200, baseTs + 201, baseTs + 200, baseTs + 200);

    await expect(runQuestInferenceTasks(db)).resolves.toEqual({
      picked: 1,
      completed: 1,
      failed: 0,
    });

    const d2Occs = database
      .prepare(
        `SELECT occurrence_id FROM quest_occurrence_contexts WHERE dataset_id = 'dataset-2' AND target_quest_id = 300`,
      )
      .all() as Array<{ occurrence_id: string }>;
    expect(d2Occs).toEqual([{ occurrence_id: "occ-existing-d2" }]);

    const recomputed = await recomputeAllRuleTargets(db);
    expect(recomputed.totalTargets).toBeGreaterThanOrEqual(2);
    expect(recomputed.recomputed).toBe(recomputed.totalTargets);
  });
});
