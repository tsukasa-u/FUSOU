import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deflateRawSync } from "node:zlib";
import {
  decodeAvroOcfToJson,
  decodeAvroOcfToJsonAsync,
  deduplicateNullAvroOcf,
  encodeZigzagLong,
  mergeAvroOCF,
  parseOcfHeader,
} from "@fusou/compaction-core";
import { handleShareBattleRequest } from "../share-battle-page";
import { handleShareGrowthRequest } from "../share-growth-page";
import { runCompactionJob } from "../../../../../fusou-compaction-trigger/src/index";
import type {
  CompactionJobInput,
  RegisterOutputPayload,
  SourceBlock,
} from "../../../../../fusou-compaction-trigger/src/types";

const state = vi.hoisted(() => ({
  source: vi.fn(),
  fetchOcf: vi.fn(),
  register: vi.fn(),
  cleanup: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../../../../../fusou-compaction-trigger/src/internal-api", () => ({
  InternalCompactionClient: class {
    acquireOutputLock = async () => ({ acquired: true });
    releaseOutputLock = async () => true;
    verifyOutputVisible = async () => true;
    listSourceBlocks = state.source;
    fetchBlockOcf = state.fetchOcf;
    registerOutput = state.register;
    cleanupConsumedSources = state.cleanup;
  },
}));

vi.mock("@aws-sdk/client-s3", () => {
  class Command {
    constructor(readonly input: Record<string, unknown>) {}
  }
  class PutObjectCommand extends Command {}
  return {
    PutObjectCommand,
    CopyObjectCommand: class extends Command {},
    DeleteObjectCommand: class extends Command {},
    HeadObjectCommand: class extends Command {},
    S3Client: class {
      async send(command: Command) {
        if (command instanceof PutObjectCommand) {
          const bytes = command.input["Body"];
          if (!(bytes instanceof Uint8Array)) throw new Error("Nonbinary upload");
          state.upload(bytes);
        }
        return {};
      }
    },
  };
});

const schema = {
  type: "record",
  name: "AuditRecord",
  fields: [{ name: "uuid", type: "string" }, { name: "index", type: "int" }],
};
type Row = { uuid: string; index: number };
const bytesOf = (value: string) => {
  const bytes = new TextEncoder().encode(value);
  return Buffer.concat([encodeZigzagLong(bytes.length), bytes]);
};
function ocf(rows: Row[], codec = "null", recordSchema = schema): Uint8Array {
  const sync = crypto.getRandomValues(new Uint8Array(16));
  const header = Buffer.concat([
    Uint8Array.of(0x4f, 0x62, 0x6a, 1), encodeZigzagLong(2),
    bytesOf("avro.schema"), bytesOf(JSON.stringify(recordSchema)),
    bytesOf("avro.codec"), bytesOf(codec), encodeZigzagLong(0), sync,
  ]);
  if (!rows.length) return header;
  const raw = Buffer.concat(rows.flatMap((row) => [bytesOf(row.uuid), encodeZigzagLong(row.index)]));
  const payload = codec === "deflate" ? deflateRawSync(raw) : raw;
  return Buffer.concat([header, encodeZigzagLong(rows.length), encodeZigzagLong(payload.length), payload, sync]);
}
const job: CompactionJobInput = {
  run_key: "audit", tier: "daily", source_tier: "hourly",
  table_name: "battle", period_tag: "2026-10-28", table_version: "0.6.0",
  window_start_ms: 0, window_end_ms: 86_400_000,
};
function source(id: number, dataset_id: string, data: Uint8Array, record_count: number): SourceBlock {
  return {
    id, dataset_id, file_id: id, file_path: `${id}.avro`, file_size: data.length,
    table_name: job.table_name, period_tag: job.period_tag, table_version: job.table_version,
    start_byte: parseOcfHeader(data).bodyOffset, length: data.length - parseOcfHeader(data).bodyOffset,
    record_count, start_timestamp: 1, end_timestamp: 2, compaction_tier: "hourly",
    window_start_ms: 0, window_end_ms: 86_400_000,
  };
}
function uploaded(): Uint8Array {
  const bytes: unknown = state.upload.mock.calls[0]?.[0];
  if (!(bytes instanceof Uint8Array)) throw new Error("No uploaded output");
  return bytes;
}
function registered(): RegisterOutputPayload {
  const payload: unknown = state.register.mock.calls[0]?.[0];
  if (!payload || typeof payload !== "object" || !("blocks" in payload)) throw new Error("No registration");
  return payload as RegisterOutputPayload;
}

beforeEach(() => {
  for (const key of ["INTERNAL_COMPACTION_BASE_URL", "INTERNAL_COMPACTION_TOKEN",
    "R2_BUCKET", "R2_S3_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"]) {
    vi.stubEnv(key, "audit-only");
  }
  state.register.mockResolvedValue(undefined);
  state.cleanup.mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("share restoration", () => {
  it.each([0, 3])("preserves battle_index=%s through the share redirect", async (index) => {
    const response = await handleShareBattleRequest(new Request(
      `https://example.com/share/battle?id=env-123456&battle_index=${index}&period_tag=2026-10-28`,
    ));
    expect(new URL(response.headers.get("location")!).searchParams.get("battle_index")).toBe(String(index));
  });
  it.each(["-1", "1.5", "NaN", "9007199254740992"])("rejects invalid battle_index=%s", async (index) => {
    const response = await handleShareBattleRequest(new Request(
      `https://example.com/share/battle?id=env-123456&battle_index=${index}`,
    ));
    expect(response.status).toBe(400);
  });
  it.each([
    ["2026-02-30", "1"],
    ["not-a-period", "1"],
    ["2026-10-28", "9007199254740992"],
  ])("rejects invalid growth scope %s/%s", async (period, master) => {
    const response = await handleShareGrowthRequest(new Request(
      `https://example.com/share/growth?period_tag=${period}&table_version=0.6.0&master_id=${master}`,
    ));
    expect(response.status).toBe(400);
  });
});

describe("OCF merge and primary keys", () => {
  it.each(["opening_airattack", "airbase_airattack"])("retains distinct %s indexes", (table) => {
    const bytes = ocf([{ uuid: "phase", index: 0 }, { uuid: "phase", index: 1 }, { uuid: "phase", index: 1 }]);
    expect(deduplicateNullAvroOcf(bytes, table).uniqueCount).toBe(2);
  });
  it("rejects mixed codecs rather than interpreting compressed payload as null data", () => {
    expect(() => mergeAvroOCF([
      ocf([{ uuid: "a", index: 0 }]), ocf([{ uuid: "b", index: 0 }], "deflate"),
    ])).toThrow(/codec/i);
  });
  it("rejects different schemas before publishing under the first schema", () => {
    const changed = { ...schema, fields: [{ name: "uuid", type: "string" }, { name: "value", type: "int" }] };
    expect(() => mergeAvroOCF([
      ocf([{ uuid: "a", index: 0 }]), ocf([{ uuid: "b", index: 0 }], "null", changed),
    ])).toThrow(/schema/i);
  });
});

describe("tier compaction publication", () => {
  it("registers final ranges, counts, size, and codec after dataset-local deduplication", async () => {
    const a = ocf([{ uuid: "a", index: 0 }, { uuid: "a", index: 0 }]);
    const b = ocf([{ uuid: "b", index: 0 }]);
    state.source.mockResolvedValue([source(1, "dataset-a", a, 2), source(2, "dataset-b", b, 1)]);
    state.fetchOcf.mockImplementation(async (path: string) => path === "1.avro" ? a : b);
    await runCompactionJob(job);
    const payload = registered();
    const bytes = uploaded();
    expect(payload.file_size).toBe(bytes.length);
    expect(payload.compression_codec).toBe(parseOcfHeader(bytes).codec);
    expect(payload.blocks.map((block) => block.record_count)).toEqual([1, 1]);
    for (const [index, block] of payload.blocks.entries()) {
      const standalone = Buffer.concat([
        bytes.subarray(0, parseOcfHeader(bytes).bodyOffset),
        bytes.subarray(block.start_byte, block.start_byte + block.length),
      ]);
      expect(decodeAvroOcfToJson(standalone)).toEqual([{ uuid: index === 0 ? "a" : "b", index: 0 }]);
    }
  });
  it("does not deduplicate a primary key across two dataset scopes", async () => {
    const a = ocf([{ uuid: "shared", index: 0 }]);
    const b = ocf([{ uuid: "shared", index: 0 }]);
    state.source.mockResolvedValue([source(1, "dataset-a", a, 1), source(2, "dataset-b", b, 1)]);
    state.fetchOcf.mockImplementation(async (path: string) => path === "1.avro" ? a : b);
    await runCompactionJob(job);
    expect(decodeAvroOcfToJson(uploaded())).toHaveLength(2);
  });
  it("accepts supported deflate input and preserves valid published ranges", async () => {
    const a = ocf([{ uuid: "a", index: 0 }, { uuid: "a", index: 0 }], "deflate");
    state.source.mockResolvedValue([source(1, "dataset-a", a, 2)]);
    state.fetchOcf.mockResolvedValue(a);
    await runCompactionJob(job);
    expect(await decodeAvroOcfToJsonAsync(uploaded())).toEqual([{ uuid: "a", index: 0 }]);
    expect(registered().blocks[0]?.record_count).toBe(1);
    expect(registered().compression_codec).toBe("deflate");
  });
});

describe("source pagination", () => {
  it("rejects has_more without a cursor instead of silently publishing a partial source", async () => {
    const { InternalCompactionClient } = await vi.importActual<
      typeof import("../../../../../fusou-compaction-trigger/src/internal-api")
    >("../../../../../fusou-compaction-trigger/src/internal-api");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ blocks: [], has_more: true }), { status: 200 }),
    ));
    const client = new InternalCompactionClient({ baseUrl: "https://example.com", token: "audit" });
    await expect(client.listSourceBlocks(job)).rejects.toThrow(/cursor/i);
  });
  it("rejects a repeated cursor without looping or appending the same page", async () => {
    const { InternalCompactionClient } = await vi.importActual<
      typeof import("../../../../../fusou-compaction-trigger/src/internal-api")
    >("../../../../../fusou-compaction-trigger/src/internal-api");
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ blocks: [], has_more: true, next_cursor_id: 1 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ blocks: [], has_more: true, next_cursor_id: 1 })))
      .mockRejectedValue(new Error("Unexpected third request"));
    vi.stubGlobal("fetch", fetch);
    const client = new InternalCompactionClient({ baseUrl: "https://example.com", token: "audit" });
    await expect(client.listSourceBlocks(job)).rejects.toThrow(/cursor/i);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
