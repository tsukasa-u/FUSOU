import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cleanupOrphanedMasterData, handleCleanupRequest } from "../src/master_data_cleanup";
import { runQuestInferenceTasks } from "../src/quest_tree_inference";
import { d1Fixture } from "./sqlite-fixture";
import { memoryBucket } from "./r2-fixture";

const MASTER_SCHEMA = `
CREATE TABLE master_data_index (
 id INTEGER PRIMARY KEY, period_tag TEXT, content_hash TEXT, r2_keys TEXT, table_offsets TEXT,
 upload_status TEXT, created_at INTEGER, table_count INTEGER
);
CREATE TABLE master_data_tables (master_data_id INTEGER, r2_key TEXT);`;

describe("master cleanup safety", () => {
  it("never deletes fresh/pending uploads or referenced objects", async () => {
    const { db, database } = d1Fixture(MASTER_SCHEMA);
    const { bucket } = memoryBucket();
    const old = Date.now() - 2 * 60 * 60 * 1000;
    database.prepare("INSERT INTO master_data_index VALUES (?, 'period', '', ?, NULL, ?, ?, 1)")
      .run(1, '["pending.avro"]', "pending", old);
    database.prepare("INSERT INTO master_data_index VALUES (?, 'period', '', ?, NULL, ?, ?, 1)")
      .run(2, '["referenced.avro"]', "failed", old);
    database.prepare("INSERT INTO master_data_index VALUES (?, 'period', '', ?, NULL, ?, ?, 1)")
      .run(3, '["fresh.avro"]', "failed", Date.now());
    database.prepare("INSERT INTO master_data_tables VALUES (?, ?)").run(4, "referenced.avro");
    const result = await cleanupOrphanedMasterData({ MASTER_DATA_BUCKET: bucket, MASTER_DATA_INDEX_DB: db });
    expect(bucket.delete).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
  });

  it("deletes old failed unreferenced objects, but preserves retry state on failure", async () => {
    const { db, database } = d1Fixture(MASTER_SCHEMA);
    const { bucket } = memoryBucket();
    database.prepare("INSERT INTO master_data_index VALUES (1, 'period', '', ?, NULL, 'failed', ?, 1)")
      .run('["orphan.avro"]', Date.now() - 7200000);
    vi.mocked(bucket.delete).mockRejectedValueOnce(Object.assign(
      new Error("R2 request 404abc failed"), { status: 500 },
    ));
    const env = { MASTER_DATA_BUCKET: bucket, MASTER_DATA_INDEX_DB: db, MASTER_DATA_CLEANUP_TOKEN: "token" };
    const failed = await handleCleanupRequest(new Request("https://example.test/cleanup", {
      method: "POST", headers: { Authorization: "Bearer token" },
    }), env);
    expect(failed.status).toBe(503);
    expect(database.prepare("SELECT r2_keys FROM master_data_index").get()?.["r2_keys"]).not.toBeNull();
    expect((await cleanupOrphanedMasterData(env)).deleted).toBe(1);
    expect(database.prepare("SELECT r2_keys FROM master_data_index").get()?.["r2_keys"]).toBeNull();
  });
});

function questFixture() {
  const sql = readFileSync(new URL("../../FUSOU-WEB/migrations/quest-index/0004_add_quest_tree_inference_tables.sql", import.meta.url), "utf8");
  const fixture = d1Fixture(sql);
  const now = Date.now();
  fixture.database.prepare(`INSERT INTO quest_collection_sessions
    (collection_session_id, dataset_id, started_at_ms, created_at) VALUES ('session', 'dataset', ?, ?)`).run(now, now);
  fixture.database.prepare(`INSERT INTO quest_state_events
    (dataset_id, collection_session_id, quest_id, event_type, state_after, timestamp_ms, period_tag, table_version, payload_hash, created_at)
    VALUES ('dataset', 'session', 1, 'complete', 'complete', ?, 'period', '0.5.0', '', ?)`).run(now - 100, now);
  fixture.database.prepare(`INSERT INTO quest_appearance_events
    (dataset_id, collection_session_id, target_quest_id, appeared_at_ms, source_event_type, period_tag, table_version, created_at)
    VALUES ('dataset', 'session', 2, ?, 'appear', 'period', '0.5.0', ?)`).run(now, now);
  fixture.database.prepare(`INSERT INTO quest_inference_tasks
    (task_id, dataset_id, collection_session_id, from_ts, to_ts, status, created_at, updated_at)
    VALUES ('task', 'dataset', 'session', ?, ?, 'pending', ?, ?)`).run(now - 1000, now + 1000, now, now);
  return fixture;
}

describe("quest inference atomicity and recovery", () => {
  it("rolls back partial occurrences and recovers all prerequisites on retry", async () => {
    const { db, database, injectFailure } = questFixture();
    injectFailure((sql) => sql.includes("INSERT OR IGNORE INTO quest_occurrence_prerequisites"));
    expect(await runQuestInferenceTasks(db)).toMatchObject({ failed: 1 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM quest_occurrence_contexts").get()?.["n"]).toBe(0);
    injectFailure();
    expect(await runQuestInferenceTasks(db)).toMatchObject({ completed: 1 });
    expect(database.prepare("SELECT COUNT(*) AS n FROM quest_occurrence_prerequisites").get()?.["n"]).toBe(1);
  });

  it("keeps the previous complete rule generation when edge publication fails", async () => {
    const { db, database, injectFailure } = questFixture();
    expect(await runQuestInferenceTasks(db)).toMatchObject({ completed: 1 });
    const before = database.prepare("SELECT * FROM quest_rule_edges").all();
    expect(before).toHaveLength(1);
    database.exec("UPDATE quest_inference_tasks SET status = 'pending'");
    injectFailure((sql) => sql.includes("INSERT INTO quest_rule_edges"));
    expect(await runQuestInferenceTasks(db)).toMatchObject({ failed: 1 });
    expect(database.prepare("SELECT * FROM quest_rule_edges").all()).toEqual(before);
    expect(database.prepare("SELECT COUNT(*) AS n FROM quest_rule_candidates").get()?.["n"]).toBe(1);
  });

  it("recovers tasks abandoned by a terminated scheduled invocation", async () => {
    const { db, database } = questFixture();
    database.exec("UPDATE quest_inference_tasks SET status = 'running', updated_at = 0");
    expect(await runQuestInferenceTasks(db)).toMatchObject({ completed: 1 });
    expect(database.prepare("SELECT status, retry_count FROM quest_inference_tasks").get())
      .toMatchObject({ status: "completed", retry_count: 1 });
  });
});

describe("CI regression gates", () => {
  it("disables the incompatible legacy daily trigger rather than reporting curl errors as success", () => {
    const source = readFileSync(new URL("../../../.github/workflows/trigger_daily_compaction.yml", import.meta.url), "utf8");
    expect(source).not.toMatch(/^\s+schedule:/m);
    expect(source).not.toContain("curl ");
    expect(source).toContain("exit 1");
    expect(source).toContain("workflow_dispatch:");
  });

  it("fails schema regeneration immediately and runs workflow tests on PRs", () => {
    const schema = readFileSync(new URL("../../../.github/workflows/validate_schema_chain.yml", import.meta.url), "utf8");
    const build = readFileSync(new URL("../../../.github/workflows/check_build.yml", import.meta.url), "utf8");
    expect(schema).not.toContain('> "$OUTPUT_FILE" 2>/dev/null');
    expect(schema).toContain('if [ ! -f "$GENERATED" ]; then');
    expect(schema).toContain("throw new Error('Missing schema: '");
    expect(build).toContain("pull_request:");
    expect(build).toContain("pnpm --filter fusou-workflow test");
    expect(build).toContain("pnpm --filter fusou-workflow typecheck");
  });

  it("detects patch-version schema features, including the current default", () => {
    const cargo = readFileSync(new URL("../../kc_api/crates/kc-api-database/Cargo.toml", import.meta.url), "utf8");
    const workflow = readFileSync(new URL("../../../.github/workflows/validate_schema_chain.yml", import.meta.url), "utf8");
    expect(workflow.match(/\^schema_\(v\[0-9\]\+_\[0-9\]\+\(_\[0-9\]\+\)\?\)/g)).toHaveLength(2);
    const versions = [...cargo.matchAll(/^schema_(v[0-9]+_[0-9]+(_[0-9]+)?)\s*=/gm)].map((match) => match[1]);
    expect(versions).toContain("v0_5_1");
    expect(versions).toContain("v0_6_0");
    const defaultFeature = cargo.match(/^default\s*=.*"schema_(v[0-9_]+)"/m)?.[1];
    expect(versions).toContain(defaultFeature);
  });
});
