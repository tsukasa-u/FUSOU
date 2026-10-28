import { beforeEach, describe, expect, it, vi } from "vitest";
import { bufferDatabase, d1Fixture } from "./sqlite-fixture";
import { memoryBucket } from "./r2-fixture";
import { buildOCFWithSchema } from "../src/avro-builders";
import { bulkInsertActive, type TursoClient } from "../src/db/turso-client";

const state = vi.hoisted(() => ({ client: null as TursoClient | null }));
vi.mock("@tursodatabase/serverless/compat", () => ({
  createClient: () => { if (!state.client) throw new Error("Missing test client"); return state.client; },
}));
import { handleCron } from "../src/cron";
import { handleBufferConsumer } from "../src/buffer-consumer";
import worker from "../src/index";
import type { QueueMessage } from "../src/schemas";

const INDEX_SCHEMA = `
CREATE TABLE archived_files (
  id INTEGER PRIMARY KEY, file_path TEXT UNIQUE, table_version TEXT, file_size INTEGER,
  compression_codec TEXT, compaction_tier TEXT, window_start_ms INTEGER, window_end_ms INTEGER,
  created_at INTEGER, last_modified_at INTEGER
);
CREATE TABLE block_indexes (
  dataset_id TEXT, table_name TEXT, table_version TEXT, period_tag TEXT, compaction_tier TEXT,
  file_id INTEGER, start_byte INTEGER, length INTEGER, record_count INTEGER,
  start_timestamp INTEGER, end_timestamp INTEGER, window_start_ms INTEGER, window_end_ms INTEGER,
  source_file_count INTEGER, trust_tag TEXT
);`;
const schema = { type: "record", name: "Battle", fields: [
  { name: "env_uuid", type: "string" }, { name: "uuid", type: "string" },
  { name: "index", type: "int" }, { name: "cell_id", type: "int" },
] };
const ctx: ExecutionContext = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} };
const message = (id: string, body: unknown) => ({
  id, body, timestamp: new Date(), attempts: 1, ack: vi.fn(), retry: vi.fn(),
});
const batch = (messages: ReturnType<typeof message>[], queue = "main") => ({
  queue, messages, ackAll: vi.fn(), retryAll: vi.fn(),
});

async function setup(count = 1, codec: "null" | "deflate" = "null") {
  const buffer = bufferDatabase();
  state.client = buffer.client;
  const indexes = d1Fixture(INDEX_SCHEMA);
  const r2 = memoryBucket();
  const bytes = await buildOCFWithSchema(schema, Array.from({ length: count }, (_, index) => ({
    env_uuid: "env", uuid: `battle-${index}`, index, cell_id: 1,
  })), codec);
  const row = {
    dataset_id: "dataset", table_name: "battle", period_tag: "2026-10-28",
    table_version: "0.5", timestamp: 1793180000000, data: bytes,
  };
  const env = {
    TURSO_DATABASE_URL: "https://example.invalid", TURSO_AUTH_TOKEN: "test",
    BATTLE_DATA_BUCKET: r2.bucket, BATTLE_INDEX_DB: indexes.db,
  };
  return { ...buffer, ...r2, indexes, row, env };
}

describe("pipeline failure recovery", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("preserves processing rows on D1 failure and retries the same R2 path", async () => {
    const fixture = await setup(3);
    await bulkInsertActive(fixture.client, [fixture.row], "m");
    fixture.indexes.injectFailure((sql) => sql.includes("INSERT INTO block_indexes"));
    await expect(handleCron(fixture.env)).rejects.toThrow("Injected");
    const paths = [...fixture.objects.keys()].filter((key) => key.endsWith(".avro"));
    expect(paths).toHaveLength(1);
    expect(fixture.database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_processing").get()?.["n"]).toBe(1);
    expect(fixture.database.prepare("SELECT owner FROM workflow_compaction_state").get()?.["owner"]).toBeNull();
    fixture.indexes.injectFailure();
    await handleCron(fixture.env);
    expect([...fixture.objects.keys()].filter((key) => key.endsWith(".avro"))).toEqual(paths);
    expect(fixture.indexes.database.prepare("SELECT record_count, source_file_count FROM block_indexes").get())
      .toMatchObject({ record_count: 3, source_file_count: 1 });
    expect(fixture.database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_processing").get()?.["n"]).toBe(0);
  });

  it("does not clean up if any required snapshot write fails", async () => {
    const fixture = await setup();
    await bulkInsertActive(fixture.client, [fixture.row], "m");
    const originalPut = fixture.put.getMockImplementation()!;
    fixture.put.mockImplementation(async (key, value, options) => {
      if (key.startsWith("snapshots/drops/")) throw new Error("R2 drops unavailable");
      return originalPut(key, value, options);
    });

    await expect(handleCron(fixture.env)).rejects.toThrow("drops unavailable");
    expect(fixture.database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_processing").get()?.["n"]).toBe(1);
    fixture.put.mockImplementation(originalPut);
    await handleCron(fixture.env);
    expect(fixture.indexes.database.prepare("SELECT COUNT(*) AS n FROM block_indexes").get()?.["n"]).toBe(1);
  });

  it("resumes published cleanup without rewriting archives or snapshots", async () => {
    const fixture = await setup();
    await bulkInsertActive(fixture.client, [fixture.row], "m");
    fixture.database.exec(`CREATE TRIGGER reject_cleanup BEFORE DELETE ON buffer_logs_processing
      BEGIN SELECT RAISE(ABORT, 'cleanup unavailable'); END`);
    await expect(handleCron(fixture.env)).rejects.toThrow("cleanup unavailable");
    expect(fixture.database.prepare("SELECT published, owner FROM workflow_compaction_state").get())
      .toMatchObject({ published: 1, owner: null });
    const writes = fixture.put.mock.calls.length;
    fixture.database.exec("DROP TRIGGER reject_cleanup");
    await handleCron(fixture.env);
    expect(fixture.put.mock.calls).toHaveLength(writes);
    expect(fixture.database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_processing").get()?.["n"]).toBe(0);
  });

  it("records the actual deflate codec and supports more than six dataset indexes", async () => {
    const fixture = await setup(2, "deflate");
    await bulkInsertActive(fixture.client, Array.from({ length: 10 }, (_, index) => ({
      ...fixture.row, dataset_id: `dataset-${index}`,
    })), "many");
    const originalPrepare = fixture.env.BATTLE_INDEX_DB.prepare.bind(fixture.env.BATTLE_INDEX_DB);
    vi.spyOn(fixture.env.BATTLE_INDEX_DB, "prepare").mockImplementation((sql) => {
      if ((sql.match(/\?/g)?.length ?? 0) > 100) throw new Error("D1 bind parameter limit");
      return originalPrepare(sql);
    });
    await handleCron(fixture.env);
    expect(fixture.indexes.database.prepare("SELECT compression_codec FROM archived_files").get()?.["compression_codec"]).toBe("deflate");
    expect(fixture.indexes.database.prepare("SELECT COUNT(*) AS n FROM block_indexes").get()?.["n"]).toBe(10);
  });

  it("does not merge incompatible schemas/codecs or delete their source rows", async () => {
    const fixture = await setup();
    const otherBytes = await buildOCFWithSchema(schema, [{ env_uuid: "env", uuid: "b", index: 0, cell_id: 1 }], "deflate");
    await bulkInsertActive(fixture.client, [fixture.row, { ...fixture.row, data: otherBytes }], "mixed");
    await expect(handleCron(fixture.env)).rejects.toThrow("Incompatible");
    expect(fixture.database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_processing").get()?.["n"]).toBe(2);
  });
});

describe("message-level acknowledgement and HTTP errors", () => {
  it("acknowledges successes independently and deduplicates redelivery", async () => {
    const fixture = await setup();
    const body = {
      datasetId: "dataset", table: "battle", periodTag: "2026-10-28", tableVersion: "0.5",
      avro_base64: Buffer.from(fixture.row.data).toString("base64"),
    };
    const good = message("good", body);
    const invalid = message("bad", {});
    await handleBufferConsumer(batch([good, invalid]), fixture.env);
    expect(good.ack).toHaveBeenCalledOnce();
    expect(invalid.retry).toHaveBeenCalledOnce();
    await handleBufferConsumer(batch([good]), fixture.env);
    expect(fixture.database.prepare("SELECT COUNT(*) AS n FROM buffer_logs_active").get()?.["n"]).toBe(1);
  });

  it("rejects out-of-range and overlapping batched offsets", async () => {
    const fixture = await setup();
    const bytes = fixture.row.data;
    const bad = message("offset", {
      batched: true, datasetId: "dataset", periodTag: "2026-10-28", tableVersion: "0.5",
      payload_base64: Buffer.from(bytes).toString("base64"),
      table_offsets: [{ table_name: "battle", start_byte: 0, byte_length: bytes.length + 1 }],
    });
    await handleBufferConsumer(batch([bad]), fixture.env);
    expect(bad.retry).toHaveBeenCalledOnce();
    expect(bad.ack).not.toHaveBeenCalled();
  });

  it("persists DLQ messages before ack and retries a persistence failure", async () => {
    const fixture = await setup();
    const first = message("first", { broken: true });
    const second = message("second", { broken: true });
    const original = fixture.put.getMockImplementation()!;
    fixture.put.mockImplementation(async (key, value, options) => {
      if (key.includes("second")) throw new Error("Storage unavailable");
      return original(key, value, options);
    });
    await worker.queue(batch([first, second], "dev-kc-compaction-dlq"), fixture.env, ctx);
    expect(first.ack).toHaveBeenCalledOnce();
    expect(second.retry).toHaveBeenCalledOnce();
    expect(second.ack).not.toHaveBeenCalled();
    expect(fixture.objects.has("dead-letter/dev-kc-compaction-dlq/first.json")).toBe(true);
  });

  it("surfaces compaction failures as 500, not a successful admin response", async () => {
    const fixture = await setup();
    await bulkInsertActive(fixture.client, [fixture.row], "m");
    fixture.indexes.injectFailure(() => true);
    const response = await worker.fetch(new Request("https://example.test/admin/compact", {
      method: "POST", headers: { Authorization: "Bearer token" },
    }), { ...fixture.env, UPLOAD_INGEST_TOKEN: "token" }, ctx);
    expect(response.status).toBe(500);
  });

  it("distinguishes malformed upload JSON, Queue failures, and oversized batches", async () => {
    const fixture = await setup();
    const queue: Queue<QueueMessage> = { send: vi.fn(), sendBatch: vi.fn().mockRejectedValue(new Error("Queue unavailable")) };
    const env = { ...fixture.env, COMPACTION_QUEUE: queue, UPLOAD_INGEST_TOKEN: "token" };
    const request = (body: string) => new Request("https://example.test/battle-data/upload", {
      method: "POST", headers: { Authorization: "Bearer token", "Content-Type": "application/json" }, body,
    });
    expect((await worker.fetch(request("{"), env, ctx)).status).toBe(400);
    const payload = {
      dataset_id: "a".repeat(64), table: "battle", period_tag: "period", table_version: "0.5",
      slices: ["T2JqAQ=="],
    };
    expect((await worker.fetch(request(JSON.stringify(payload)), env, ctx)).status).toBe(503);
    expect((await worker.fetch(request(JSON.stringify({ ...payload, slices: Array(101).fill("T2JqAQ==") })), env, ctx)).status).toBe(413);
  });

  it("forwards the cleanup credential and rejects unauthenticated destructive requests", async () => {
    const fixture = await setup();
    const master = d1Fixture(`CREATE TABLE master_data_index
      (id INTEGER, period_tag TEXT, content_hash TEXT, r2_keys TEXT, table_offsets TEXT,
       upload_status TEXT, created_at INTEGER, table_count INTEGER);`);
    const env = {
      ...fixture.env, MASTER_DATA_INDEX_DB: master.db,
      MASTER_DATA_BUCKET: fixture.bucket, MASTER_DATA_CLEANUP_TOKEN: "cleanup",
    };
    const request = (token: string) => new Request("https://example.test/master-data/cleanup", {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
    });
    expect((await worker.fetch(request("wrong"), env, ctx)).status).toBe(401);
    expect((await worker.fetch(request("cleanup"), env, ctx)).status).toBe(200);
    expect(fixture.bucket.delete).not.toHaveBeenCalled();
  });
});
