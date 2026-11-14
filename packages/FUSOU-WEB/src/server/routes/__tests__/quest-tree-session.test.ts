import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
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

  function createIngestDatabase(
    bootstrapCompletedAtMs: number | null,
    previousSnapshots: Array<{ page_no: number; visible_quest_ids_json: string }> = [],
    existingMasters: Array<{ quest_id: number; master_hash: string }> = [],
    options?: {
      latestEndedAtMs?: number | null;
      hasExistingSession?: boolean;
    },
  ) {
    const statements: Array<{ sql: string; args: unknown[] }> = [];
    const queries: Array<{ sql: string; args: unknown[] }> = [];
    const hasExistingSession = options?.hasExistingSession ?? true;
    const database = {
      prepare(sql: string) {
        return {
          bind(...args: unknown[]) {
            return {
              all: async () => {
                queries.push({ sql, args });
                return {
                  results: sql.includes("FROM questlist_snapshots")
                    ? previousSnapshots
                    : sql.includes("FROM quest_master_entries")
                      ? existingMasters
                      : [],
                };
              },
              first: async () => {
                queries.push({ sql, args });
                return hasExistingSession &&
                  sql.includes("FROM quest_collection_sessions") &&
                  sql.includes("ORDER BY started_at_ms")
                  ? {
                      collection_session_id: "qsess-existing",
                      ended_at_ms:
                        options?.latestEndedAtMs !== undefined
                          ? options.latestEndedAtMs
                          : 9000,
                      bootstrap_completed_at_ms: bootstrapCompletedAtMs,
                    }
                  : null;
              },
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
    return { database, statements, queries };
  }

  const ingestDatasetId = "550e8400-e29b-41d4-a716-446655440000";

  describe("quest-tree ingest inference scheduling", () => {
    it("uses page zero as the bootstrap baseline with upsert snapshot and single idempotency check", async () => {
      const { database, statements, queries } = createIngestDatabase(null);

      const result = await ingestQuestBody(database, {
        dataset_id: ingestDatasetId,
        request_id: "request-baseline",
        payload_hash: "hash-baseline",
        event_type: "snapshot",
        timestamp_ms: 10000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [{ quest_id: 101, title: "Test quest", detail: "Detail" }],
      });

      expect(result).toMatchObject({
        status: 200,
        body: { task_enqueued: false, task_id: null },
      });
      expect(
        queries.filter((query) =>
          query.sql.includes("FROM quest_ingest_events"),
        ),
      ).toHaveLength(1);
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_inference_tasks"),
        ),
      ).toBe(false);
      const snapshotInsert = statements.find((statement) =>
        statement.sql.includes("INSERT INTO questlist_snapshots"),
      );
      expect(snapshotInsert?.args[2]).toBe("[101]");
      expect(snapshotInsert?.sql).toContain("ON CONFLICT(dataset_id, page_no)");
      const masterInsert = statements.find((statement) =>
        statement.sql.includes("INSERT INTO quest_master_entries"),
      );
      expect(masterInsert?.sql).toContain("ON CONFLICT(quest_id)");
    });

    it("skips D1 reads and writes completely for non-All partial-tab snapshots", async () => {
      const { database, statements, queries } = createIngestDatabase(null);

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
        body: { task_enqueued: false, task_id: null, skipped: true },
      });
      expect(queries).toHaveLength(0);
      expect(statements).toHaveLength(0);
    });

    it("writes state event without quest_state_latest or frequent session heartbeat updates", async () => {
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
          statement.sql.includes("INSERT INTO quest_state_events"),
        ),
      ).toBe(true);
      expect(
        statements.some((statement) =>
          statement.sql.includes("quest_state_latest"),
        ),
      ).toBe(false);
      expect(
        statements.some((statement) =>
          statement.sql.includes("UPDATE quest_collection_sessions"),
        ),
      ).toBe(false);
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_inference_tasks"),
        ),
      ).toBe(false);
    });

    it("skips snapshot and unchanged master writes when visible quest IDs and master hashes match", async () => {
      const firstRun = createIngestDatabase(9500, [
        { page_no: 0, visible_quest_ids_json: "[220]" },
      ]);

      await ingestQuestBody(firstRun.database, {
        dataset_id: ingestDatasetId,
        request_id: "request-master-prime",
        payload_hash: "hash-master-prime",
        event_type: "snapshot",
        timestamp_ms: 12000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [
          {
            quest_id: 220,
            type: 2,
            category: 2,
            label_type: 2,
            title: "Daily Sortie",
            detail: "Sortie once",
          },
        ],
      });

      const masterInsert = firstRun.statements.find((statement) =>
        statement.sql.includes("INSERT INTO quest_master_entries"),
      );
      expect(masterInsert).toBeDefined();
      const recordedMasterHash = String(masterInsert!.args[6]);

      const secondRun = createIngestDatabase(
        9500,
        [{ page_no: 0, visible_quest_ids_json: "[220]" }],
        [{ quest_id: 220, master_hash: recordedMasterHash }],
      );

      const secondResult = await ingestQuestBody(secondRun.database, {
        dataset_id: ingestDatasetId,
        request_id: "request-same-visible",
        payload_hash: "hash-same-visible",
        event_type: "snapshot",
        timestamp_ms: 15000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [
          {
            quest_id: 220,
            type: 2,
            category: 2,
            label_type: 2,
            title: "Daily Sortie",
            detail: "Sortie once",
          },
        ],
      });

      expect(secondResult).toMatchObject({ status: 200 });
      expect(
        secondRun.statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_master_entries"),
        ),
      ).toBe(false);
      expect(
        secondRun.statements.some((statement) =>
          statement.sql.includes("INSERT INTO questlist_snapshots"),
        ),
      ).toBe(false);
      expect(
        secondRun.statements.some((statement) =>
          statement.sql.includes("quest_appearance_events"),
        ),
      ).toBe(false);
      expect(
        secondRun.statements.filter((statement) =>
          statement.sql.includes("INSERT INTO quest_ingest_events"),
        ),
      ).toHaveLength(1);
    });

    it("records new appearances after bootstrap without enqueuing quest_inference_tasks", async () => {
      const { database, statements } = createIngestDatabase(9500, [
        { page_no: 0, visible_quest_ids_json: "[220]" },
      ]);

      const result = await ingestQuestBody(database, {
        dataset_id: ingestDatasetId,
        request_id: "request-post-bootstrap-appear",
        payload_hash: "hash-post-bootstrap-appear",
        event_type: "snapshot",
        timestamp_ms: 12000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [
          { quest_id: 220, title: "Prereq quest" },
          { quest_id: 228, title: "Appeared quest" },
        ],
      });

      expect(result).toMatchObject({
        status: 200,
        body: { task_enqueued: false, task_id: null },
      });
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT OR IGNORE INTO quest_appearance_events"),
        ),
      ).toBe(true);
      expect(
        statements.some((statement) =>
          statement.sql.includes("INSERT INTO quest_inference_tasks"),
        ),
      ).toBe(false);
    });

    it("prunes expired quest_ingest_events only when a new session starts", async () => {
      const { database, statements } = createIngestDatabase(null, [], [], {
        hasExistingSession: false,
      });

      const result = await ingestQuestBody(database, {
        dataset_id: ingestDatasetId,
        request_id: "request-new-session",
        payload_hash: "hash-new-session",
        event_type: "start",
        timestamp_ms: 50_000_000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        quest_id: 101,
      });

      expect(result).toMatchObject({ status: 200 });
      expect(
        statements.some((statement) =>
          statement.sql.includes("DELETE FROM quest_ingest_events"),
        ),
      ).toBe(true);
    });
  });

  describe("lightweight schema migration 0010 and SQLite integration", () => {
    function createSqliteD1(): { db: D1Database; sqlite: DatabaseSync } {
      const sqlite = new DatabaseSync(":memory:");
      sqlite.exec("PRAGMA foreign_keys = ON;");
      type Stmt = ReturnType<D1Database["prepare"]>;
      const makeStmt = (sql: string, args: unknown[] = []): Stmt =>
        ({
          bind: (...values: unknown[]) => makeStmt(sql, values),
          all: async () => {
            const prepared = sqlite.prepare(sql);
            const values = args.map((v) =>
              v === undefined ? null : (v as SQLInputValue),
            );
            const hasColumns = prepared.columns().length > 0;
            const results = hasColumns
              ? (prepared.all(...values) as Record<string, unknown>[])
              : [];
            if (!hasColumns) {
              prepared.run(...values);
            }
            const meta = sqlite
              .prepare(
                "SELECT changes() AS changes, last_insert_rowid() AS last_row_id",
              )
              .get() as { changes: number; last_row_id: number };
            const changes = Number(meta.changes ?? 0);
            return {
              success: true,
              results,
              meta: {
                changes,
                last_row_id: Number(meta.last_row_id ?? 0),
                duration: 0,
                size_after: 0,
                rows_read: results.length,
                rows_written: changes,
                changed_db: changes > 0,
              },
            };
          },
          run: async () => makeStmt(sql, args).all(),
          first: async (column?: string) => {
            const res = await makeStmt(sql, args).all();
            const row = (res.results?.[0] ?? null) as Record<string, unknown> | null;
            if (!row) return null;
            return column ? (row[column] ?? null) : row;
          },
          raw: async () => {
            throw new Error("Unused raw");
          },
        }) as unknown as Stmt;

      const db = {
        prepare: (sql: string) => makeStmt(sql),
        batch: async (stmts: Stmt[]) => {
          sqlite.exec("BEGIN");
          try {
            const results = [];
            for (const stmt of stmts) {
              results.push(await stmt.run());
            }
            sqlite.exec("COMMIT");
            return results;
          } catch (error) {
            sqlite.exec("ROLLBACK");
            throw error;
          }
        },
      } as unknown as D1Database;

      return { db, sqlite };
    }

    function readQuestMigrationsUpTo(maxPrefix: string): string[] {
      const migrationsDir = new URL(
        "../../../../migrations/quest-index/",
        import.meta.url,
      );
      return readdirSync(migrationsDir)
        .filter((name) => name.endsWith(".sql") && name <= maxPrefix)
        .sort()
        .map((name) => readFileSync(new URL(name, migrationsDir), "utf8"));
    }

    it("compacts legacy tables in 0010 while preserving core events and lightweight ingest", async () => {
      const { db, sqlite } = createSqliteD1();
      for (const sql of readQuestMigrationsUpTo("0009_")) {
        sqlite.exec(sql);
      }

      const now = Date.now();
      const expiredMs = now - 20 * 24 * 60 * 60 * 1000;
      const recentMs = now - 60 * 1000;

      sqlite.exec(`
        INSERT INTO quest_collection_sessions
          (collection_session_id, dataset_id, started_at_ms, ended_at_ms, start_reason, has_data_gap, bootstrap_completed_at_ms, created_at)
        VALUES
          ('sess-legacy', '${ingestDatasetId}', ${recentMs - 10000}, ${recentMs}, 'bootstrap', 0, ${recentMs - 9000}, ${recentMs - 10000});

        INSERT INTO questlist_snapshots
          (dataset_id, collection_session_id, page_no, snapshot_hash, snapshot_json, visible_quest_ids_json, captured_at_ms, period_tag, table_version, created_at)
        VALUES
          ('${ingestDatasetId}', 'sess-legacy', 0, 'h1', '[{"quest_id":101}]', '[101]', ${recentMs - 9000}, '2026-10', '0.5.0', ${recentMs - 9000}),
          ('${ingestDatasetId}', 'sess-legacy', 0, 'h2', '[{"quest_id":101},{"quest_id":102}]', '[101,102]', ${recentMs - 2000}, '2026-11', '0.6.0', ${recentMs - 2000}),
          ('${ingestDatasetId}', 'sess-legacy', 9, 'h3', '[{"quest_id":102}]', '[102]', ${recentMs - 1000}, '2026-11', '0.6.0', ${recentMs - 1000});

        INSERT INTO quest_master_entries
          (quest_id, period_tag, table_version, title, detail, quest_type, category, label_type, master_hash, created_at, updated_at)
        VALUES
          (101, '2026-10', '0.5.0', 'Old Title', 'Old Detail', 1, 2, 1, 'oldhash', ${expiredMs}, ${expiredMs}),
          (101, '2026-11', '0.6.0', 'New Title', 'New Detail', 1, 2, 1, 'newhash', ${recentMs}, ${recentMs});

        INSERT INTO quest_ingest_events
          (request_id, payload_hash, dataset_id, collection_session_id, event_type, quest_id, page_no, timestamp_ms, period_tag, table_version, status, created_at)
        VALUES
          ('req-expired', 'ph-exp', '${ingestDatasetId}', 'sess-legacy', 'snapshot', NULL, 0, ${expiredMs}, '2026-10', '0.5.0', 'ingested', ${expiredMs}),
          ('req-recent', 'ph-rec', '${ingestDatasetId}', 'sess-legacy', 'snapshot', NULL, 0, ${recentMs}, '2026-11', '0.6.0', 'ingested', ${recentMs});

        INSERT INTO quest_state_events
          (dataset_id, collection_session_id, quest_id, event_type, state_after, timestamp_ms, period_tag, table_version, payload_hash, created_at)
        VALUES
          ('${ingestDatasetId}', 'sess-legacy', 101, 'complete', 'claimed', ${recentMs - 5000}, '2026-11', '0.6.0', 'ph-s1', ${recentMs - 5000});

        INSERT INTO quest_state_latest
          (dataset_id, quest_id, collection_session_id, state, updated_at_ms, last_event_type, period_tag, table_version, is_claimed)
        VALUES
          ('${ingestDatasetId}', 101, 'sess-legacy', 'claimed', ${recentMs - 5000}, 'complete', '2026-11', '0.6.0', 1);

        INSERT INTO quest_appearance_events
          (dataset_id, collection_session_id, target_quest_id, appeared_at_ms, source_event_type, period_tag, table_version, is_bootstrap_unknown, created_at)
        VALUES
          ('${ingestDatasetId}', 'sess-legacy', 102, ${recentMs - 2000}, 'snapshot', '2026-11', '0.6.0', 0, ${recentMs - 2000});

        INSERT INTO quest_inference_tasks
          (task_id, dataset_id, collection_session_id, from_ts, to_ts, status, retry_count, created_at, updated_at)
        VALUES
          ('t1', '${ingestDatasetId}', 'sess-legacy', ${recentMs - 5000}, ${recentMs}, 'completed', 0, ${recentMs}, ${recentMs});

        INSERT INTO quest_occurrence_contexts
          (occurrence_id, dataset_id, collection_session_id, target_quest_id, occurred_at_ms, period_tag, table_version, is_bootstrap_unknown, has_cross_session_inference, created_at)
        VALUES
          ('occ-1', '${ingestDatasetId}', 'sess-legacy', 102, ${recentMs - 2000}, '2026-11', '0.6.0', 0, 0, ${recentMs - 2000});

        INSERT INTO quest_occurrence_prerequisites
          (occurrence_id, quest_id, is_recent, is_completed, created_at)
        VALUES
          ('occ-1', 101, 1, 1, ${recentMs - 2000});

        INSERT INTO quest_rule_candidates
          (target_quest_id, prereq_set_hash, prereq_set_json, set_size, support, exposure, confidence, lift, score, period_tag, table_version, quality_tier, updated_at_ms)
        VALUES
          (102, '101', '[101]', 1, 1, 1, 1.0, 1.0, 0.5, '2026-11', '0.6.0', 'high', ${recentMs});

        INSERT INTO quest_rule_edges
          (rule_id, target_quest_id, prereq_set_json, set_size, class, support, confidence, lift, score, period_tag, table_version, is_primary, quality_tier, updated_at_ms)
        VALUES
          ('r-legacy', 102, '[101]', 1, 'single', 1, 1.0, 1.0, 0.5, '2026-11', '0.6.0', 1, 'high', ${recentMs}),
          ('r-all', 102, '[101]', 1, 'single', 5, 1.0, 2.0, 1.5, 'all', 'all', 1, 'high', ${recentMs});
      `);

      const migration0010 = readQuestMigrationsUpTo("0011_").pop()!;
      sqlite.exec(migration0010);

      const tables = (
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'quest%' ORDER BY name",
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(tables).toEqual([
        "quest_appearance_events",
        "quest_collection_sessions",
        "quest_ingest_events",
        "quest_master_entries",
        "quest_rule_edges",
        "quest_state_events",
        "questlist_snapshots",
      ]);

      expect(
        (sqlite.prepare("SELECT COUNT(*) AS n FROM questlist_snapshots").get() as { n: number }).n,
      ).toBe(1);
      expect(
        (sqlite.prepare("SELECT visible_quest_ids_json FROM questlist_snapshots").get() as {
          visible_quest_ids_json: string;
        }).visible_quest_ids_json,
      ).toBe("[101,102]");

      const masterRows = sqlite
        .prepare("SELECT quest_id, title FROM quest_master_entries")
        .all() as Array<{ quest_id: number; title: string }>;
      expect(masterRows).toEqual([{ quest_id: 101, title: "New Title" }]);

      const ingestRows = sqlite
        .prepare("SELECT request_id FROM quest_ingest_events")
        .all() as Array<{ request_id: string }>;
      expect(ingestRows).toEqual([{ request_id: "req-recent" }]);

      expect(
        (sqlite.prepare("SELECT rule_id FROM quest_rule_edges").all() as Array<{ rule_id: string }>).map(
          (r) => r.rule_id,
        ),
      ).toEqual(["r-all"]);
      expect(
        (sqlite.prepare("SELECT COUNT(*) AS n FROM quest_state_events").get() as { n: number }).n,
      ).toBe(1);
      expect(
        (sqlite.prepare("SELECT COUNT(*) AS n FROM quest_appearance_events").get() as { n: number }).n,
      ).toBe(1);

      // Subsequent snapshot in the same session detects quest 103 appearing, ignores replay & conflict.
      const appearRes = await ingestQuestBody(db, {
        dataset_id: ingestDatasetId,
        request_id: "req-appear-103",
        payload_hash: "ph-appear-103",
        event_type: "snapshot",
        timestamp_ms: recentMs + 1000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [
          { quest_id: 101, title: "New Title", detail: "New Detail", type: 1, category: 2, label_type: 1 },
          { quest_id: 102, title: "Sortie 102", detail: "Sink ships", type: 2, category: 2, label_type: 2 },
          { quest_id: 103, title: "Exercise 103", detail: "Win exercises", type: 3, category: 3, label_type: 3 },
        ],
      });
      expect(appearRes.status).toBe(200);
      expect(
        (sqlite.prepare("SELECT COUNT(*) AS n FROM quest_appearance_events").get() as { n: number }).n,
      ).toBe(2);
      expect(
        (sqlite.prepare("SELECT COUNT(*) AS n FROM quest_master_entries").get() as { n: number }).n,
      ).toBe(3);

      const replay = await ingestQuestBody(db, {
        dataset_id: ingestDatasetId,
        request_id: "req-appear-103",
        payload_hash: "ph-appear-103",
        event_type: "snapshot",
        timestamp_ms: recentMs + 1000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [],
      });
      expect(replay).toMatchObject({ status: 200, body: { idempotent: true } });

      const conflict = await ingestQuestBody(db, {
        dataset_id: ingestDatasetId,
        request_id: "req-appear-103",
        payload_hash: "ph-different",
        event_type: "snapshot",
        timestamp_ms: recentMs + 1000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [],
      });
      expect(conflict.status).toBe(409);

      // New session after 30+ minute gap overwrites the single snapshot row & prunes expired ingest logs.
      sqlite.exec(`
        INSERT INTO quest_ingest_events
          (request_id, payload_hash, dataset_id, collection_session_id, event_type, quest_id, page_no, timestamp_ms, period_tag, table_version, status, created_at)
        VALUES
          ('req-old-after', 'ph-old-after', '${ingestDatasetId}', 'sess-legacy', 'start', 101, 0, ${expiredMs}, '2026-10', '0.5.0', 'ingested', ${expiredMs});
      `);
      const nextSessRes = await ingestQuestBody(db, {
        dataset_id: ingestDatasetId,
        request_id: "req-next-session-snap",
        payload_hash: "ph-next-sess",
        event_type: "snapshot",
        timestamp_ms: now + 60 * 60 * 1000,
        period_tag: "2026-11",
        table_version: "0.6.0",
        page_no: 0,
        quests: [
          { quest_id: 101, title: "New Title", detail: "New Detail", type: 1, category: 2, label_type: 1 },
        ],
      });
      expect(nextSessRes.status).toBe(200);
      expect(
        (sqlite.prepare("SELECT COUNT(*) AS n FROM questlist_snapshots").get() as { n: number }).n,
      ).toBe(1);
      expect(
        sqlite.prepare("SELECT request_id FROM quest_ingest_events WHERE request_id = 'req-old-after'").get(),
      ).toBeUndefined();

      // Migration 0011 drops quest_rule_edges while keeping the lightweight collection tables.
      const migration0011 = readQuestMigrationsUpTo("0012_").pop()!;
      sqlite.exec(migration0011);

      const post0011Tables = (
        sqlite
          .prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'quest%' ORDER BY name",
          )
          .all() as Array<{ name: string }>
      ).map((r) => r.name);
      expect(post0011Tables).toEqual([
        "quest_appearance_events",
        "quest_collection_sessions",
        "quest_ingest_events",
        "quest_master_entries",
        "quest_state_events",
        "questlist_snapshots",
      ]);
    });
  });
});