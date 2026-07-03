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

vi.mock("../../validators/offsets", () => ({
  validateOffsetMetadata: () => ({ valid: true }),
}));

vi.mock("../../utils/avro-validator", () => ({
  validateAvroHeader: () => ({ valid: true }),
  extractSchemaFromOCF: () => ({ type: "record", name: "Dummy" }),
  validateAvroOCFSmart: async () => ({
    valid: true,
    recordCount: 1,
    tableVersion: "0.5",
  }),
}));

vi.mock("../../utils/upload", () => ({
  handleTwoStageUpload: async (c: any, options: any) => {
    const data = new TextEncoder().encode("trusted-upload-payload");
    const digest = await crypto.subtle.digest("SHA-256", data);
    const contentHash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const result = await options.executionProcessor(
      {
        dataset_id: "a".repeat(64),
        table: "battle",
        period_tag: "2026-06-26",
        declared_size: data.byteLength,
        table_offsets: null,
        content_hash: contentHash,
        path_tag: "dummy",
        table_version: "0.5",
        trust_tag: "suspicious",
        token_trust_tag_audit: "hw_verified",
      },
      data,
      { id: "test-user" },
    );

    if (result instanceof Response) {
      return result;
    }
    return c.json(result.response);
  },
}));

import battleDataApp from "../battle_data";

describe("battle_data upload trust tag derivation", () => {
  it("uses per-upload trust_tag and keeps dataset token trust only for audit", async () => {
    const send = vi.fn(async () => undefined);

    const response = await battleDataApp.request(
      "http://localhost/upload",
      {
        method: "POST",
      },
      {
        BATTLE_DATA_BUCKET: {},
        BATTLE_DATA_SIGNING_SECRET: "test-signing-secret",
        COMPACTION_QUEUE: { send },
      } as any,
    );

    const body = (await response.json()) as { ok?: boolean };
    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);

    const queuedBody = send.mock.calls[0]?.[0] as {
      trust_tag?: string;
      token_trust_tag_audit?: string | null;
    };

    expect(queuedBody.trust_tag).toBe("suspicious");
    expect(queuedBody.token_trust_tag_audit).toBe("hw_verified");
  });
});
