import { describe, expect, it } from "vitest";
import {
  CompletedSynergyManifestRowSchema,
  LatestSynergyPeriodRowSchema,
  SynergyManifestRequestSchema,
  SynergyPayloadSchema,
  SynergyNextRevisionRowSchema,
  parseSynergyShipIds,
  parseSynergyStatBonus,
} from "../synergy";

describe("SynergyManifestRequestSchema", () => {
  const validRequest = {
    period_tag: "2026-07-08",
    sp_effect_sha256: "a".repeat(64),
    api_start2_batch_hash: "b".repeat(64),
    generator_version: "v1.2.3",
    generated_at: "2026-07-08T00:00:00.000Z",
  };

  it("accepts a valid manifest allocation request", () => {
    expect(SynergyManifestRequestSchema.safeParse(validRequest).success).toBe(
      true,
    );
  });

  it("rejects malformed hashes, versions, dates, and option types", () => {
    expect(
      SynergyManifestRequestSchema.safeParse({
        ...validRequest,
        sp_effect_sha256: "invalid",
      }).success,
    ).toBe(false);
    expect(
      SynergyManifestRequestSchema.safeParse({
        ...validRequest,
        generator_version: "1.2.3",
      }).success,
    ).toBe(false);
    expect(
      SynergyManifestRequestSchema.safeParse({
        ...validRequest,
        generated_at: "not-a-date",
      }).success,
    ).toBe(false);
    expect(
      SynergyManifestRequestSchema.safeParse({
        ...validRequest,
        allow_duplicate_content: "true",
      }).success,
    ).toBe(false);
  });
});

describe("CompletedSynergyManifestRowSchema", () => {
  it("accepts completed manifest metadata and extra columns", () => {
    const result = CompletedSynergyManifestRowSchema.safeParse({
      period_tag: "2026-07-08",
      period_revision: 2,
      content_hash: "content-hash",
      sp_effect_sha256: "sha256",
      completed_at: 1_752_000_000_000,
      upload_status: "completed",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["upload_status"]).toBe("completed");
    }
  });

  it("rejects malformed completed manifest metadata", () => {
    expect(
      CompletedSynergyManifestRowSchema.safeParse({
        period_tag: "2026-07-08",
        period_revision: "2",
        content_hash: "content-hash",
        sp_effect_sha256: "sha256",
      }).success,
    ).toBe(false);
    expect(CompletedSynergyManifestRowSchema.safeParse(null).success).toBe(
      false,
    );
  });
});

describe("LatestSynergyPeriodRowSchema", () => {
  it("accepts a period tag and preserves extra columns", () => {
    const result = LatestSynergyPeriodRowSchema.safeParse({
      period_tag: "2026-07-08",
      completed_at: 1,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.period_tag).toBe("2026-07-08");
      expect(result.data["completed_at"]).toBe(1);
    }
  });

  it("rejects missing, empty, and non-string period tags", () => {
    expect(LatestSynergyPeriodRowSchema.safeParse({}).success).toBe(false);
    expect(
      LatestSynergyPeriodRowSchema.safeParse({ period_tag: "" }).success,
    ).toBe(false);
    expect(
      LatestSynergyPeriodRowSchema.safeParse({ period_tag: 20260708 }).success,
    ).toBe(false);
    expect(LatestSynergyPeriodRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("SynergyNextRevisionRowSchema", () => {
  it("accepts a positive integer revision", () => {
    expect(
      SynergyNextRevisionRowSchema.safeParse({ next_revision: 2 }).success,
    ).toBe(true);
  });

  it("rejects null, fractional, and non-positive revisions", () => {
    expect(SynergyNextRevisionRowSchema.safeParse(null).success).toBe(false);
    expect(
      SynergyNextRevisionRowSchema.safeParse({ next_revision: 1.5 }).success,
    ).toBe(false);
    expect(
      SynergyNextRevisionRowSchema.safeParse({ next_revision: 0 }).success,
    ).toBe(false);
  });
});

describe("SynergyPayloadSchema", () => {
  it("accepts legacy and current rule formats", () => {
    const result = SynergyPayloadSchema.safeParse({
      effects: { "100": [{ b: { kaihi: 1 } }] },
      cross_effects: { "1:2": [] },
      effect_rules: [{ items: [100], b: { kaihi: 1 } }],
      cross_rules: [
        {
          pairs: [[1, 2]],
          synergy: { kaihi: 1 },
          item_pool: [100],
        },
      ],
      generated_at: "2026-07-08",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data["generated_at"]).toBe("2026-07-08");
    }
  });

  it("rejects malformed numeric cross-rule pairs", () => {
    expect(
      SynergyPayloadSchema.safeParse({
        cross_rules: [{ pairs: [[1, "2"]] }],
      }).success,
    ).toBe(false);
  });
});

describe("synergy consumer parsers", () => {
  it("keeps known numeric stat aliases and strips unknown keys", () => {
    expect(
      parseSynergyStatBonus({ kaih: 1, tais: 2, extra: 3 }),
    ).toEqual({ kaih: 1, tais: 2 });
    expect(parseSynergyShipIds([1, 2])).toEqual([1, 2]);
  });

  it("rejects malformed stat and ship-id values", () => {
    expect(parseSynergyStatBonus({ kaih: "1" })).toBeUndefined();
    expect(parseSynergyStatBonus(null)).toBeUndefined();
    expect(parseSynergyShipIds([1, "2"])).toEqual([]);
  });
});
