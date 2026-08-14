import { describe, expect, it } from "vitest";
import {
  CompletedSynergyManifestRowSchema,
  LatestSynergyPeriodRowSchema,
  SynergyPayloadSchema,
  SynergyNextRevisionRowSchema,
} from "../synergy";

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
      expect(result.data.upload_status).toBe("completed");
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
      expect(result.data.completed_at).toBe(1);
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
      expect(result.data.generated_at).toBe("2026-07-08");
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
