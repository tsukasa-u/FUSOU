import { beforeEach, describe, expect, it, vi } from "vitest";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  decodeAvroOcfToJson,
  encodeZigzagLong,
  getAvroRecordPrimaryKey,
  mergeAvroOCF,
  mergeAvroOCFWithBoundaries,
  parseOcfHeader,
} from "@fusou/compaction-core";
import { runCompactionJob } from "../../../../../fusou-compaction-trigger/src/index";
import type { CompactionJobInput, SourceBlock } from "../../../../../fusou-compaction-trigger/src/types";
import { handleShareBattleRequest } from "../share-battle-page";
import { handleShareGrowthRequest } from "../share-growth-page";

const state = vi.hoisted(() => ({
  source: vi.fn(),
  fetchOcf: vi.fn(),
  upload: vi.fn(),
  register: vi.fn(),
  cleanup: vi.fn(),
  release: vi.fn(),
}));
vi.mock("../../../../../fusou-compaction-trigger/src/internal-api", () => ({
  InternalCompactionClient: class {
    acquireOutputLock = async () => ({ acquired: true });
    releaseOutputLock = state.release;
    verifyOutputVisible = async () => true;
    listSourceBlocks = state.source;
    fetchBlockOcf = state.fetchOcf;
    registerOutput = state.register;
    cleanupConsumedSources = state.cleanup;
  },
}));
vi.mock("@aws-sdk/client-s3", () => {
  class Command {}
  return {
    PutObjectCommand: Command,
    CopyObjectCommand: Command,
    DeleteObjectCommand: Command,
    HeadObjectCommand: Command,
    S3Client: class { send = state.upload; },
  };
});
vi.mock("node:zlib", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:zlib")>();
  return { ...actual, inflateRawSync: vi.fn(actual.inflateRawSync) };
});

const schema = {
  type: "record",
  name: "SecondaryRecord",
  fields: [{ name: "uuid", type: "string" }, { name: "index", type: "int" }],
};
type Schema = { type: string; name: string; fields: { name: string; type: unknown; doc?: string }[]; doc?: string };
const text = (value: string) => {
  const bytes = Buffer.from(value);
  return Buffer.concat([encodeZigzagLong(bytes.length), bytes]);
};
function ocf(recordSchema: Schema = schema, codec = "null", indexes: number[] = [1]) {
  const sync = new Uint8Array(16).fill(17);
  const header = Buffer.concat([
    Uint8Array.of(0x4f, 0x62, 0x6a, 1), encodeZigzagLong(2),
    text("avro.schema"), text(JSON.stringify(recordSchema)),
    text("avro.codec"), text(codec), encodeZigzagLong(0), sync,
  ]);
  if (!indexes.length) return header;
  const raw = Buffer.concat(indexes.flatMap((index) =>
    recordSchema.fields.map((field) => field.name === "uuid" ? text("sortie") : encodeZigzagLong(index))));
  const payload = codec === "deflate" ? deflateRawSync(raw) : raw;
  return Buffer.concat([header, encodeZigzagLong(indexes.length), encodeZigzagLong(payload.length), payload, sync]);
}
const job: CompactionJobInput = {
  run_key: "secondary", tier: "daily", source_tier: "hourly",
  table_name: "battle", period_tag: "2026-10-28", table_version: "0.6.0",
  window_start_ms: 0, window_end_ms: 86_400_000,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(inflateRawSync).mockReset();
  state.source.mockResolvedValue([]);
  state.release.mockResolvedValue(true);
  vi.stubEnv("INTERNAL_COMPACTION_BASE_URL", "https://example.invalid");
  vi.stubEnv("INTERNAL_COMPACTION_TOKEN", "test-token");
});

describe("schema merge compatibility", () => {
  it("accepts reordered JSON object keys without changing record field order", () => {
    const reordered = {
      fields: schema.fields.map((field) => ({ type: field.type, name: field.name })),
      name: schema.name, type: schema.type,
    };
    const merged = mergeAvroOCF([ocf(), ocf(reordered, "null", [2])]);
    expect(decodeAvroOcfToJson(merged).map((row) => row["index"])).toEqual([1, 2]);
  });
  it("ignores root and field documentation, retaining the first output header", () => {
    const annotated = {
      ...schema, doc: "different documentation",
      fields: schema.fields.map((field) => ({ ...field, doc: "not a binary field" })),
    };
    const merged = mergeAvroOCF([ocf(), ocf(annotated, "null", [2])]);
    expect(decodeAvroOcfToJson(merged)).toHaveLength(2);
    expect(parseOcfHeader(merged).schema).toEqual(schema);
  });
  it("still rejects reordered record fields because their byte order is significant", () => {
    expect(() => mergeAvroOCF([ocf(), ocf({ ...schema, fields: [...schema.fields].reverse() })])).toThrow(/schemas/);
  });
  it("still rejects changed logical types", () => {
    const withLogicalType = (logicalType: string) => ({
      ...schema, fields: [schema.fields[0]!, { name: "index", type: { type: "int", logicalType } }],
    });
    expect(() => mergeAvroOCF([ocf(withLogicalType("date")), ocf(withLogicalType("time-millis"))])).toThrow(/schemas/);
  });
  it("still rejects mixed codecs", () => {
    expect(() => mergeAvroOCF([ocf(), ocf(schema, "deflate")])).toThrow(/codecs/);
  });
});

describe("empty and guard boundaries", () => {
  it("keeps header-only OCF valid with finite zero-length boundaries", () => {
    const result = mergeAvroOCFWithBoundaries([ocf(schema, "null", []), ocf(schema, "null", [])]);
    expect(decodeAvroOcfToJson(result.merged)).toEqual([]);
    expect(result.boundaries).toHaveLength(2);
    for (const boundary of result.boundaries) {
      expect(boundary.length).toBe(0);
      expect(Number.isFinite(boundary.startByte)).toBe(true);
      expect(boundary.startByte).toBeLessThanOrEqual(result.merged.length);
    }
  });
  it("skips an empty source group and releases ownership without uploading", async () => {
    await runCompactionJob(job);
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
    expect(state.cleanup).not.toHaveBeenCalled();
    expect(state.release).toHaveBeenCalledOnce();
  });
  it("propagates inflate failure before any publication and releases ownership", async () => {
    const bytes = ocf(schema, "deflate");
    const block: SourceBlock = {
      id: 1, dataset_id: "dataset", file_id: 1, file_path: "source.avro", file_size: bytes.length,
      table_name: job.table_name, table_version: job.table_version, period_tag: job.period_tag,
      start_byte: parseOcfHeader(bytes).bodyOffset, length: bytes.length - parseOcfHeader(bytes).bodyOffset,
      record_count: 1, start_timestamp: 1, end_timestamp: 2, compaction_tier: "hourly",
      window_start_ms: 0, window_end_ms: 86_400_000,
    };
    state.source.mockResolvedValue([block]);
    state.fetchOcf.mockResolvedValue(bytes);
    vi.mocked(inflateRawSync).mockImplementationOnce(() => { throw new RangeError("injected expansion limit"); });
    await expect(runCompactionJob(job)).rejects.toThrow("injected expansion limit");
    expect(state.upload).not.toHaveBeenCalled();
    expect(state.register).not.toHaveBeenCalled();
    expect(state.cleanup).not.toHaveBeenCalled();
    expect(state.release).toHaveBeenCalledOnce();
  });
});

describe("native key and URL contracts", () => {
  it.each([
    "battle", "destruction_battle", "own_ship", "enemy_ship", "friend_ship",
    "own_slotitem", "enemy_slotitem", "friend_slotitem", "plane_info",
    "airbase_airattack", "opening_airattack", "opening_taisen", "midnight_hougeki", "friendly_support_hourai",
  ])("retains the native composite index for %s", (table) => {
    expect(getAvroRecordPrimaryKey(table, { uuid: "sortie", index: 0 }))
      .not.toBe(getAvroRecordPrimaryKey(table, { uuid: "sortie", index: 1 }));
  });
  it.each(["support_airattack", "support_hourai", "night_support_hourai"])(
    "uses the single-record UUID identity for %s", (table) => {
      expect(getAvroRecordPrimaryKey(table, { uuid: "sortie" })).toBe("sortie");
    },
  );
  it("retains battle index zero in the actual redirect", async () => {
    const response = await handleShareBattleRequest(new Request("https://example.com/share/battle?id=env-123456&battle_index=0"));
    expect(new URL(response.headers.get("location")!).searchParams.get("battle_index")).toBe("0");
  });
  it.each(["2024-02-29", "2023-08-08"])("retains a valid historical date %s and patch-version alias", async (period) => {
    const response = await handleShareGrowthRequest(new Request(
      `https://example.com/share/growth?period_tag=${period}&table_version=0.5&master_id=1`,
    ));
    expect(response.status).toBe(302);
    expect(new URL(response.headers.get("location")!).searchParams.get("period_tag")).toBe(period);
  });
});
