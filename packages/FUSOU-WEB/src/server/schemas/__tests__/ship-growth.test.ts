import { describe, expect, it } from "vitest";
import {
  MasterDataR2KeyRowSchema,
  ShipGrowthBoundsRowSchema,
  ShipGrowthCountRowSchema,
  ShipGrowthExpUpdatedRowSchema,
  SpEffectItemSchema,
  ShipGrowthIngestBodySchema,
} from "../ship-growth";

describe("MasterDataR2KeyRowSchema", () => {
  it("accepts a non-empty key and the nullable empty state", () => {
    expect(
      MasterDataR2KeyRowSchema.safeParse({ r2_key: "master-data/file.avro" })
        .success,
    ).toBe(true);
    expect(MasterDataR2KeyRowSchema.safeParse({ r2_key: null }).success).toBe(
      true,
    );
    expect(MasterDataR2KeyRowSchema.safeParse({}).success).toBe(true);
  });

  it("rejects non-string and empty keys", () => {
    expect(
      MasterDataR2KeyRowSchema.safeParse({ r2_key: 42 }).success,
    ).toBe(false);
    expect(
      MasterDataR2KeyRowSchema.safeParse({ r2_key: "" }).success,
    ).toBe(false);
    expect(MasterDataR2KeyRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("ship-growth D1 projection schemas", () => {
  it("accepts count, bounds, and updated exp rows", () => {
    expect(ShipGrowthCountRowSchema.safeParse({ c: 10 }).success).toBe(true);
    expect(
      ShipGrowthBoundsRowSchema.safeParse({
        master_id: 1,
        lv: 10,
        kaihi_naked: 12,
        taisen_naked: 8,
        sakuteki_naked: 5,
        lucky_naked: 3,
      }).success,
    ).toBe(true);
    expect(
      ShipGrowthExpUpdatedRowSchema.safeParse({
        lv: 10,
        exp_current: 100,
        updated_at: 1_752_000_000_000,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed D1 projection values", () => {
    expect(ShipGrowthCountRowSchema.safeParse({ c: "10" }).success).toBe(false);
    expect(
      ShipGrowthBoundsRowSchema.safeParse({
        master_id: 1,
        lv: 10,
        kaihi_naked: "12",
        taisen_naked: 8,
        sakuteki_naked: 5,
        lucky_naked: 3,
      }).success,
    ).toBe(false);
  });
});

describe("ShipGrowthIngestBodySchema", () => {
  it("accepts a producer-shaped snapshot payload", () => {
    const result = ShipGrowthIngestBodySchema.safeParse({
      dataset_id: "11111111-1111-4111-8111-111111111111",
      request_id: "request-1",
      payload_hash: "b".repeat(64),
      event_type: "snapshot",
      schema_version: 1,
      timestamp_ms: 1_752_000_000_000,
      period_tag: "2026-07-08",
      table_version: "1.0.0",
      ships: [
        {
          master_id: 1,
          lv: 1,
          exp_current: 0,
          exp_to_next: 100,
          kyouka: [0, 0, 0, 0],
          sp_effect_items_json: null,
          kaihi_observed: 1,
          taisen_observed: 1,
          sakuteki_observed: 1,
          lucky_observed: 1,
          kaihi_naked: 1,
          taisen_naked: 1,
          sakuteki_naked: 1,
          lucky_naked: 1,
          kaihi_max: 10,
          taisen_max: 10,
          sakuteki_max: 10,
          slots: [],
          exslot: null,
        },
      ],
      content_hash: "c".repeat(64),
      file_size: "100",
      extra_field: true,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.schema_version).toBe(1);
      expect(result.data.file_size).toBe(100);
      expect(result.data["extra_field"]).toBe(true);
    }
  });

  it("rejects incomplete or incorrectly typed snapshot fields", () => {
    expect(
      ShipGrowthIngestBodySchema.safeParse({
        dataset_id: "dataset-1",
        event_type: "snapshot",
        schema_version: 1,
        ships: [],
      }).success,
    ).toBe(false);
  });

  it("rejects null and array JSON roots", () => {
    expect(ShipGrowthIngestBodySchema.safeParse(null).success).toBe(false);
    expect(ShipGrowthIngestBodySchema.safeParse([]).success).toBe(false);
  });
});

describe("SpEffectItemSchema", () => {
  it("accepts numeric nullable stats and extra fields", () => {
    const result = SpEffectItemSchema.safeParse({
      api_kind: 1,
      api_houg: null,
      extra: true,
    });

    expect(result.success).toBe(true);
  });

  it("rejects malformed present stats", () => {
    expect(
      SpEffectItemSchema.safeParse({ api_kaih: "5" }).success,
    ).toBe(false);
  });
});
