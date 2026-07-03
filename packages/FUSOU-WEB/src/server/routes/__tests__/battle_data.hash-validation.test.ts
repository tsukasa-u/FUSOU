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

vi.mock("../../utils/upload", () => ({
  handleTwoStageUpload: async (_c: any, options: any) => {
    const data = new TextEncoder().encode("abc");
    return options.executionProcessor(
      {
        dataset_id: "a".repeat(64),
        table: "battle",
        period_tag: "2026-06-26",
        declared_size: data.byteLength,
        table_offsets: null,
        content_hash: "0".repeat(64),
        path_tag: "dummy",
        table_version: "0.5",
        trust_tag: "sw_verified",
      },
      data,
      { id: "test-user" },
    );
  },
}));

import battleDataApp from "../battle_data";

describe("battle_data upload hash validation", () => {
  it("rejects stage-2 payload when content_hash does not match", async () => {
    const response = await battleDataApp.request(
      "http://localhost/upload",
      {
        method: "POST",
      },
      {
        BATTLE_DATA_BUCKET: {},
        BATTLE_DATA_SIGNING_SECRET: "test-signing-secret",
      } as any,
    );

    const body = (await response.json()) as { error?: string };
    expect(response.status).toBe(400);
    expect(body.error).toBe("Content hash mismatch - data may be corrupted");
  });
});
