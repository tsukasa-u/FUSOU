import { describe, expect, it } from "vitest";
import { brotliCompressSync, brotliDecompressSync } from "node:zlib";
import { buildOCFWithSchema, buildNullBlock, encodeRecordWithSchema } from "../src/avro-builders";
import { decodeAvroOcfToJsonAsync, parseOcfHeader } from "@fusou/compaction-core";
import { inspectAvroFrames } from "../src/avro-integrity";
import { generateAndSaveSnapshots, MAX_SNAPSHOT_JSON_BYTES } from "../src/snapshot_generator";
import { memoryBucket } from "./r2-fixture";

const schema = {
  type: "record", name: "Battle", fields: [
    { name: "env_uuid", type: "string" }, { name: "uuid", type: "string" },
    { name: "index", type: "int" }, { name: "cell_id", type: "int" },
  ],
};
const battle = (env_uuid = "env", index = 0) => ({ env_uuid, uuid: `${env_uuid}-${index}`, index, cell_id: 1 });
async function row(records = [battle()], period_tag = "2026-10-28", table_name = "battle", table_version = "0.5") {
  const bytes = await buildOCFWithSchema(schema, records);
  return {
    id: 1, dataset_id: "dataset", table_name, period_tag, table_version,
    timestamp: 1793180000000, data: Uint8Array.from(bytes).buffer,
    uploaded_by: null, trust_tag: null,
  };
}
const json = (bytes: Uint8Array) => JSON.parse(brotliDecompressSync(bytes).toString("utf8"));

describe("Avro binary invariants", () => {
  it("encodes an empty array with one terminator, preserving the next field", async () => {
    const arraySchema = { type: "record", name: "ArrayRow", fields: [
      { name: "items", type: { type: "array", items: "int" } }, { name: "next", type: "int" },
    ] };
    const bytes = await buildOCFWithSchema(arraySchema, [{ items: [], next: 7 }, { items: [1, 2], next: -5 }]);
    expect(await decodeAvroOcfToJsonAsync(bytes)).toEqual([{ items: [], next: 7 }, { items: [1, 2], next: -5 }]);
  });

  it("chooses a matching union branch and rejects null without a null branch", async () => {
    const union = { type: "record", name: "UnionRow", fields: [{ name: "value", type: ["string", "int"] }] };
    const bytes = await buildOCFWithSchema(union, [{ value: 42 }, { value: "text" }]);
    expect(await decodeAvroOcfToJsonAsync(bytes)).toEqual([{ value: 42 }, { value: "text" }]);
    expect(() => encodeRecordWithSchema(union, { value: null })).toThrow("no matching");
    expect(() => encodeRecordWithSchema({ fields: [{ name: "x", type: "int" }] }, { x: 2 ** 32 })).toThrow("32-bit");
    expect(() => encodeRecordWithSchema({ fields: [{ name: "x", type: "unknown" }] }, { x: "x" })).toThrow("Unsupported");
    expect(() => buildNullBlock(schema, [battle()], new Uint8Array(15))).toThrow("16 bytes");
  });

  it.each(["null", "deflate"] as const)("writes header-only empty %s OCFs", async (codec) => {
    const bytes = await buildOCFWithSchema(schema, [], codec);
    expect(inspectAvroFrames(bytes)).toEqual({ recordCount: 0, codec });
    expect(bytes.byteLength).toBe(parseOcfHeader(bytes).bodyOffset);
    expect(await decodeAvroOcfToJsonAsync(bytes)).toEqual([]);
  });

  it("round-trips signed safe long boundaries and rejects unsafe values", async () => {
    const longs = { type: "record", name: "LongRow", fields: [{ name: "value", type: "long" }] };
    const records = [-Number.MAX_SAFE_INTEGER, -1, 0, Number.MAX_SAFE_INTEGER].map((value) => ({ value }));
    expect(await decodeAvroOcfToJsonAsync(await buildOCFWithSchema(longs, records))).toEqual(records);
    expect(() => encodeRecordWithSchema(longs, { value: Number.MAX_SAFE_INTEGER + 1 })).toThrow("safe integer");
  });

  it("drains deflate concurrently and enforces an expanded byte bound", async () => {
    const large = { type: "record", name: "Large", fields: [{ name: "value", type: "string" }] };
    const value = "x".repeat(1024 * 1024);
    const bytes = await buildOCFWithSchema(large, [{ value }], "deflate");
    expect(await decodeAvroOcfToJsonAsync(bytes, { maxDecodedBytes: value.length + 10 })).toEqual([{ value }]);
    await expect(decodeAvroOcfToJsonAsync(bytes, { maxDecodedBytes: 1024 })).rejects.toThrow("expanded bytes");
    const corrupted = Uint8Array.from(bytes);
    corrupted[corrupted.length - 1] = corrupted[corrupted.length - 1]! ^ 1;
    expect(() => inspectAvroFrames(corrupted)).toThrow("sync");
  }, 5000);
});

describe("snapshot publication and incremental completeness", () => {
  it("merges partial sortie tables, normalizes aliases, and is replay-idempotent", async () => {
    const { bucket, objects } = memoryBucket();
    const env = { BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database };
    await generateAndSaveSnapshots(env, [await row()]);
    await generateAndSaveSnapshots(env, [await row([battle()], "2026-10-28", "own_deck", "0.5.0")]);
    await generateAndSaveSnapshots(env, [await row()]);
    const detail = json(objects.get("snapshots/env_detail/2026-10-28/env.json.br")!.bytes);
    expect(detail.table_version).toBe("0.5.0");
    expect(detail.tables.battle).toHaveLength(1);
    expect(detail.tables.own_deck).toHaveLength(1);
  });

  it("does not collapse equal environment IDs across periods", async () => {
    const { bucket, objects } = memoryBucket();
    await generateAndSaveSnapshots({ BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database },
      [await row(), await row([battle()], "2026-09-01")]);
    expect(objects.has("snapshots/env_detail/2026-10-28/env.json.br")).toBe(true);
    expect(objects.has("snapshots/env_detail/2026-09-01/env.json.br")).toBe(true);
  });

  it("retains env_info records whose environment identity is their uuid", async () => {
    const { bucket, objects } = memoryBucket();
    const envSchema = { type: "record", name: "EnvInfo", fields: [{ name: "uuid", type: "string" }] };
    const input = await row();
    input.table_name = "env_info";
    input.data = Uint8Array.from(await buildOCFWithSchema(envSchema, [{ uuid: "env" }])).buffer;
    await generateAndSaveSnapshots({ BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database }, [input]);
    expect(json(objects.get("snapshots/env_detail/2026-10-28/env.json.br")!.bytes).tables.env_info).toHaveLength(1);
  });

  it("preserves drops history not present in the shorter overview", async () => {
    const { bucket, objects } = memoryBucket();
    const old = { ...battle("old"), timestamp: 1793000000000, env_uuid: "old" };
    await bucket.put("snapshots/overview/2026-10-28.json.br",
      brotliCompressSync(JSON.stringify({ success: true, battles: [], cells: [] })));
    await bucket.put("snapshots/drops/2026-10-28.json.br",
      brotliCompressSync(JSON.stringify({ success: true, battles: [old] })));
    await generateAndSaveSnapshots({ BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database }, [await row()]);
    const drops = json(objects.get("snapshots/drops/2026-10-28.json.br")!.bytes);
    expect(drops.battles.map((b: Record<string, unknown>) => b["env_uuid"])).toContain("old");
  });

  it("fails closed on corrupt prior snapshots without replacing them", async () => {
    const { bucket, objects } = memoryBucket();
    await bucket.put("snapshots/overview/2026-10-28.json.br", "corrupt");
    const previous = objects.get("snapshots/overview/2026-10-28.json.br");
    await expect(generateAndSaveSnapshots({ BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database },
      [await row()])).rejects.toThrow();
    expect(objects.get("snapshots/overview/2026-10-28.json.br")).toBe(previous);
  });

  it("rejects malformed OCF instead of reporting zero parsed records as success", async () => {
    const { bucket, put } = memoryBucket();
    const invalid = await row();
    invalid.data = new Uint8Array([0x4f, 0x62, 0x6a, 1]).buffer;
    await expect(generateAndSaveSnapshots({ BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database },
      [invalid])).rejects.toThrow();
    expect(put).not.toHaveBeenCalled();
  });

  it("rejects oversized Brotli output while preserving prior snapshots", async () => {
    const { bucket, objects } = memoryBucket();
    await bucket.put("snapshots/overview/2026-10-28.json.br",
      brotliCompressSync(Buffer.from(`"${"x".repeat(MAX_SNAPSHOT_JSON_BYTES)}"`)));
    const previous = objects.get("snapshots/overview/2026-10-28.json.br");
    await expect(generateAndSaveSnapshots({ BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database },
      [await row()])).rejects.toThrow();
    expect(objects.get("snapshots/overview/2026-10-28.json.br")).toBe(previous);
  });

  it("rejects one of two concurrent writes instead of silently losing an update", async () => {
    const { bucket } = memoryBucket();
    const env = { BATTLE_DATA_BUCKET: bucket, BATTLE_INDEX_DB: {} as D1Database };
    const input = await row();
    const results = await Promise.allSettled([
      generateAndSaveSnapshots(env, [input]), generateAndSaveSnapshots(env, [input]),
    ]);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });
});
