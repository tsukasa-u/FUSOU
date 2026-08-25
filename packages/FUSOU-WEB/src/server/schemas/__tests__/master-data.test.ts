import { describe, expect, it } from "vitest";
import {
  MasterDataDedupeRowSchema,
  MasterDataInsertedRevisionRowSchema,
  MasterDataJsonLookupRowSchema,
  MasterDataMetadataRowSchema,
  parseMasterDataJsonRecords,
  parseMasterDataJsonRecordsText,
  parseMasterDataTableOffsets,
  MasterDataNextRevisionRowSchema,
} from "../master-data";
import { MasterDataTokenPayloadSchema } from "../tokens";

describe("Master data revision row schemas", () => {
  it("accepts dedupe and inserted revision rows", () => {
    expect(
      MasterDataDedupeRowSchema.safeParse({
        id: 1,
        period_revision: 2,
        upload_status: "completed",
      }).success,
    ).toBe(true);
    expect(
      MasterDataInsertedRevisionRowSchema.safeParse({
        id: 1,
        period_revision: 2,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed revision rows", () => {
    expect(
      MasterDataDedupeRowSchema.safeParse({
        id: 1,
        period_revision: "2",
        upload_status: "completed",
      }).success,
    ).toBe(false);
    expect(
      MasterDataInsertedRevisionRowSchema.safeParse({ id: 0, period_revision: 1 })
        .success,
    ).toBe(false);
    expect(MasterDataDedupeRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("MasterDataNextRevisionRowSchema", () => {
  it("accepts numeric, null, and omitted aggregate values", () => {
    expect(
      MasterDataNextRevisionRowSchema.safeParse({ next_revision: 2 }).success,
    ).toBe(true);
    expect(
      MasterDataNextRevisionRowSchema.safeParse({ next_revision: null }).success,
    ).toBe(true);
    expect(MasterDataNextRevisionRowSchema.safeParse({}).success).toBe(true);
  });

  it("rejects malformed aggregate values", () => {
    expect(
      MasterDataNextRevisionRowSchema.safeParse({ next_revision: "2" })
        .success,
    ).toBe(false);
    expect(MasterDataNextRevisionRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("MasterDataJsonLookupRowSchema", () => {
  it("accepts a completed table lookup row and extra fields", () => {
    const result = MasterDataJsonLookupRowSchema.safeParse({
      period_tag: "2026-08-14",
      table_version: "1.0",
      period_revision: 2,
      r2_key: "master-data/mst_ship.avro",
      completed_at: 123,
    });

    expect(result.success).toBe(true);
  });

  it("rejects incomplete or malformed lookup rows", () => {
    expect(
      MasterDataJsonLookupRowSchema.safeParse({
        period_tag: "2026-08-14",
        table_version: "1.0",
        period_revision: "2",
        r2_key: "master-data/mst_ship.avro",
      }).success,
    ).toBe(false);
    expect(
      MasterDataJsonLookupRowSchema.safeParse({
        period_tag: "2026-08-14",
        table_version: "1.0",
        period_revision: 2,
      }).success,
    ).toBe(false);
    expect(MasterDataJsonLookupRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("parseMasterDataJsonRecords", () => {
  it("accepts record arrays and preserves extra fields", () => {
    expect(
      parseMasterDataJsonRecords([
        { id: 1, name: "ship", extra: true },
        { api_id: 2 },
      ]),
    ).toEqual([
      { id: 1, name: "ship", extra: true },
      { api_id: 2 },
    ]);
  });

  it("rejects non-arrays and malformed rows", () => {
    expect(parseMasterDataJsonRecords({ id: 1 })).toBeNull();
    expect(parseMasterDataJsonRecords([{ id: 1 }, null])).toBeNull();
  });
});

describe("MasterDataMetadataRowSchema", () => {
  it("accepts the exists/latest projection", () => {
    expect(
      MasterDataMetadataRowSchema.safeParse({
        id: 1,
        period_tag: "2026-08-14",
        table_version: "1.0",
        period_revision: 2,
        table_count: 3,
        table_offsets: "[]",
        upload_status: "completed",
        created_at: 1,
        completed_at: 2,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed projection columns and malformed offsets", () => {
    expect(
      MasterDataMetadataRowSchema.safeParse({
        id: 1,
        period_tag: "2026-08-14",
        table_version: "1.0",
        period_revision: "2",
        table_count: 3,
        table_offsets: "[]",
        upload_status: "completed",
        created_at: 1,
        completed_at: null,
      }).success,
    ).toBe(false);
    expect(parseMasterDataTableOffsets("not-json")).toEqual([]);
    expect(parseMasterDataTableOffsets("[{\"table_name\":\"mst_ship\"}]")).toEqual([]);
    expect(
      parseMasterDataTableOffsets(
        "[{\"table_name\":\"mst_ship\",\"start\":0,\"end\":10}]",
      ),
    ).toEqual([{ table_name: "mst_ship", start: 0, end: 10 }]);
    expect(
      parseMasterDataTableOffsets(
        "[{\"table_name\":\"mst_ship\",\"start\":0,\"end\":0}]",
      ),
    ).toEqual([{ table_name: "mst_ship", start: 0, end: 0 }]);
    expect(parseMasterDataJsonRecordsText("not-json")).toBeNull();
    expect(parseMasterDataJsonRecordsText("[{\"id\":1}]")).toEqual([
      { id: 1 },
    ]);
  });
});

describe("MasterDataTokenPayloadSchema", () => {
  const validPayload = {
    user_id: "user-1",
    record_id: 1,
    period_tag: "2026-08-14",
    table_version: "1.0",
    period_revision: 1,
    content_hash: "a".repeat(64),
    table_offsets: "[]",
    table_count: 1,
  };

  it("requires a positive declared size", () => {
    expect(
      MasterDataTokenPayloadSchema.safeParse({
        ...validPayload,
        declared_size: 1,
      }).success,
    ).toBe(true);
    expect(
      MasterDataTokenPayloadSchema.safeParse({
        ...validPayload,
        declared_size: 0,
      }).success,
    ).toBe(false);
  });
});
