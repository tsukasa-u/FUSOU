import { describe, expect, it } from "vitest";
import {
  BattleDataTokenPayloadSchema,
  QuestTreeUploadTokenPayloadSchema,
  UploadTokenPayloadSchema,
} from "../tokens";

describe("quest tree upload token schema", () => {
  it("accepts the claims emitted by quest-tree stage 1", () => {
    expect(
      QuestTreeUploadTokenPayloadSchema.safeParse({
        user_id: "user-1",
        content_hash: "hash-1",
        declared_size: 128,
        dataset_id: "dataset-1",
        request_id: "request-1",
        event_type: "snapshot",
      }).success,
    ).toBe(true);
  });

  it("keeps schema_version required for the other upload routes", () => {
    expect(
      UploadTokenPayloadSchema.safeParse({
        user_id: "user-1",
        content_hash: "hash-1",
        declared_size: 128,
        dataset_id: "dataset-1",
        request_id: "request-1",
        event_type: "snapshot",
      }).success,
    ).toBe(false);
  });

  it("rejects non-numeric and unsafe numeric claims", () => {
    const basePayload = {
      user_id: "user-1",
      content_hash: "hash-1",
      declared_size: 128,
      dataset_id: "dataset-1",
      request_id: "request-1",
      event_type: "snapshot",
      schema_version: 1,
    };

    expect(
      UploadTokenPayloadSchema.safeParse({
        ...basePayload,
        declared_size: true,
      }).success,
    ).toBe(false);
    expect(
      UploadTokenPayloadSchema.safeParse({
        ...basePayload,
        schema_version: Number.MAX_SAFE_INTEGER + 1,
      }).success,
    ).toBe(false);
  });
});

describe("battle data token schema", () => {
  it("parses the battle upload token payload", () => {
    expect(
      BattleDataTokenPayloadSchema.parse({
        user_id: "user",
        dataset_id: "dataset",
        table: "battle",
        period_tag: "2026-06-26",
        declared_size: 128,
        table_offsets: null,
        content_hash: "hash",
        path_tag: "battle.avro",
        table_version: "v1",
      }),
    ).toMatchObject({ table: "battle", declared_size: 128 });
  });

  it("rejects a token without the required table version", () => {
    expect(
      BattleDataTokenPayloadSchema.safeParse({
        user_id: "user",
        dataset_id: "dataset",
        table: "battle",
        period_tag: "2026-06-26",
        declared_size: 128,
        table_offsets: null,
        content_hash: "hash",
        path_tag: "battle.avro",
      }).success,
    ).toBe(false);
  });
});