import { describe, expect, it } from "vitest";
import {
  AssetUploadTokenPayloadSchema,
  BattleDataTokenPayloadSchema,
  FleetSnapshotTokenPayloadSchema,
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
        dataset_id: "00000000-0000-4000-8000-000000000001",
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
        dataset_id: "00000000-0000-4000-8000-000000000001",
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
      dataset_id: "00000000-0000-4000-8000-000000000001",
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
    expect(
      QuestTreeUploadTokenPayloadSchema.safeParse({
        ...basePayload,
        declared_size: 5 * 1024 * 1024 + 1,
      }).success,
    ).toBe(false);
  });
});

describe("battle data token schema", () => {
  it("parses the battle upload token payload", () => {
    expect(
      BattleDataTokenPayloadSchema.parse({
        user_id: "user",
        dataset_id: "00000000-0000-4000-8000-000000000002",
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
        dataset_id: "00000000-0000-4000-8000-000000000002",
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

describe("shared two-stage upload token schemas", () => {
  it("accepts asset and fleet claims emitted by stage 1", () => {
    expect(
      AssetUploadTokenPayloadSchema.safeParse({
        user_id: "user",
        key: "assets/ship/banner/0001.png",
        relative_path: "ship/banner/0001.png",
        declared_size: 128,
        file_name: "0001.png",
        content_hash: "hash",
        caches_to_clear: "[]",
      }).success,
    ).toBe(true);
    expect(
      FleetSnapshotTokenPayloadSchema.safeParse({
        user_id: "user",
        tag: "latest",
        dataset_id: "00000000-0000-4000-8000-000000000002",
        content_hash: "hash",
      }).success,
    ).toBe(true);
  });

  it("rejects asset and fleet claims missing integrity fields", () => {
    expect(
      AssetUploadTokenPayloadSchema.safeParse({
        user_id: "user",
        key: "assets/ship/banner/0001.png",
        relative_path: "ship/banner/0001.png",
        declared_size: 128,
        file_name: null,
        caches_to_clear: "[]",
      }).success,
    ).toBe(false);
    expect(
      FleetSnapshotTokenPayloadSchema.safeParse({
        user_id: "user",
        tag: "latest",
        dataset_id: "00000000-0000-4000-8000-000000000002",
      }).success,
    ).toBe(false);
  });
});