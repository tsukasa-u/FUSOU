import { describe, expect, it, vi } from "vitest";

vi.mock("@fusou/avro-wasm", () => ({
  initWasm: async () => undefined,
  validateAvroOCF: async () => ({ valid: true }),
  validateAvroOCFSmart: async () => ({ valid: true }),
  validateAvroOCFByTable: async () => ({ valid: true }),
  matchClientSchema: async () => ({ matched: true }),
  validate_avro_ocf: async () => ({ valid: true }),
  validate_avro_ocf_smart: async () => ({ valid: true }),
  validate_avro_ocf_by_table: async () => ({ valid: true }),
  match_client_schema: async () => ({ matched: true }),
  get_available_schemas: () => [],
  get_available_versions: () => [],
  get_schema_json: () => null,
}));

vi.mock("../../utils/period-tags", () => ({
  getAllowedPeriodTagSet: async () => new Set(["2026-06-26"]),
  validateCachedPeriodTag: async () => ({ ok: true }),
}));

vi.mock("../../utils/avro-decoder", () => ({
  decodeAvroOcfToJson: vi.fn(async () => [{ uuid: "battle-1" }]),
}));

import battleDataApp from "../battle_data";

describe("battle_data global records trust tag", () => {
  it("propagates trust_tag from block_indexes rows to returned records", async () => {
    const all = vi.fn(async () => ({
      results: [
        {
          id: 1,
          dataset_id: "a".repeat(64),
          start_byte: 10,
          length: 20,
          start_timestamp: Date.now(),
          end_timestamp: Date.now(),
          period_tag: "2026-06-26",
          trust_tag: "sw_verified",
          file_path: "v0.5/2026-06-26/test.avro",
        },
      ],
    }));

    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn(() => ({ bind }));

    const source = new Uint8Array(64);
    const bucket = {
      get: vi.fn(async () => ({
        body: new Response(source).body,
      })),
    };

    const response = await battleDataApp.request(
      "http://localhost/global/records?table=battle&period_tag=2026-06-26&limit_blocks=1&limit_records=1",
      {
        method: "GET",
      },
      {
        BATTLE_INDEX_DB: { prepare },
        BATTLE_DATA_BUCKET: bucket,
        DATA_LOADER_CACHE_KV: undefined,
      } as any,
    );

    const body = (await response.json()) as {
      success?: boolean;
      records?: Array<{ trust_tag?: string; uuid?: string }>;
    };

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.records?.[0]?.uuid).toBe("battle-1");
    expect(body.records?.[0]?.trust_tag).toBe("sw_verified");
  });
});
