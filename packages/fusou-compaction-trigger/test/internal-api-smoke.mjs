import assert from "node:assert/strict";
import { InternalCompactionClient } from "../dist/internal-api.js";
import { CompactionJobInputSchema } from "../dist/types.js";

const input = {
  run_key: "run-1",
  tier: "daily",
  source_tier: "hourly",
  table_name: "battle",
  period_tag: "2026-08",
  table_version: "0.4.0",
  window_start_ms: 1,
  window_end_ms: 2,
};

assert.equal(CompactionJobInputSchema.safeParse(input).success, true);
assert.equal(
  CompactionJobInputSchema.safeParse({ ...input, tier: "invalid" }).success,
  false,
);

const originalFetch = globalThis.fetch;
const client = new InternalCompactionClient({
  baseUrl: "https://fusou.test",
  token: "token",
});

try {
  globalThis.fetch = async (url) => {
    assert.match(String(url), /list-source-blocks$/);
    return new Response(JSON.stringify({
      blocks: [{
        id: 1,
        dataset_id: "dataset-1",
        table_name: "battle",
        table_version: "0.4.0",
        period_tag: "2026-08",
        start_byte: 224,
        length: 32,
        record_count: 1,
        start_timestamp: 1,
        end_timestamp: 2,
        compaction_tier: "hourly",
        window_start_ms: 1,
        window_end_ms: 2,
        file_id: 10,
        file_path: "0.4.0/2026-08/hourly/battle.avro",
        file_size: 256,
      }],
      has_more: false,
      next_cursor_id: 0,
    }), { status: 200 });
  };

  const blocks = await client.listSourceBlocks(input);
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0].file_id, 10);

  globalThis.fetch = async () => new Response(JSON.stringify({ blocks: [{ id: 1 }] }), { status: 200 });
  await assert.rejects(
    client.listSourceBlocks(input),
    /returned invalid JSON/,
  );

  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    acquired: false,
    lock_expires_ms: 123,
  }), { status: 409 });
  const lock = await client.acquireOutputLock({
    file_path: "output.avro",
    lock_token: "lock",
    table_version: "0.4.0",
    compaction_tier: "daily",
    source_tier: "hourly",
    window_start_ms: 1,
    window_end_ms: 2,
  });
  assert.deepEqual(lock, { acquired: false, lock_expires_ms: 123 });
} finally {
  globalThis.fetch = originalFetch;
}

console.log("[internal-api-smoke] Trigger API response boundaries OK");