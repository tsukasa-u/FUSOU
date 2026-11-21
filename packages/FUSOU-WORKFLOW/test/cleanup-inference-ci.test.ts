import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { cleanupOrphanedMasterData, handleCleanupRequest } from "../src/master_data_cleanup";
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

describe("CI regression gates", () => {
  it("removes the incompatible legacy daily trigger workflow", () => {
    const legacyWorkflowPath = new URL(
      "../../../.github/workflows/trigger_daily_compaction.yml",
      import.meta.url,
    );
    expect(existsSync(legacyWorkflowPath)).toBe(false);
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
    expect(workflow.match(/\^schema_\(v\[0-9\]\+_\[0-9\]\+\(_\[0-9\]\+\)\?\)/g)).toHaveLength(1);
    expect(workflow).toContain("avro-schema-registry.json");
    expect(workflow).toContain("sync-rust-artifacts.mjs --check");
    const versions = [...cargo.matchAll(/^schema_(v[0-9]+_[0-9]+(_[0-9]+)?)\s*=/gm)].map((match) => match[1]);
    expect(versions).toContain("v0_5_1");
    expect(versions).toContain("v0_6_0");
    expect(versions).toContain("v0_6_1");
    const defaultFeature = cargo.match(/^default\s*=.*"schema_(v[0-9_]+)"/m)?.[1];
    expect(versions).toContain(defaultFeature);
  });
});
