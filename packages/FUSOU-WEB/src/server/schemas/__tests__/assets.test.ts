import { describe, expect, it } from "vitest";
import { AssetContentHashRowSchema, AssetKeyRowSchema } from "../assets";

describe("AssetKeyRowSchema", () => {
  it("accepts a non-empty asset key and preserves extra columns", () => {
    const result = AssetKeyRowSchema.safeParse({
      key: "assets/kcs2/resources/ship/banner/0001_v1.png",
      content_hash: "hash",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.key).toBe(
        "assets/kcs2/resources/ship/banner/0001_v1.png",
      );
      expect(result.data.content_hash).toBe("hash");
    }
  });

  it("rejects missing, empty, and non-string keys", () => {
    expect(AssetKeyRowSchema.safeParse({}).success).toBe(false);
    expect(AssetKeyRowSchema.safeParse({ key: "" }).success).toBe(false);
    expect(AssetKeyRowSchema.safeParse({ key: 42 }).success).toBe(false);
    expect(AssetKeyRowSchema.safeParse(null).success).toBe(false);
  });
});

describe("AssetContentHashRowSchema", () => {
  it("accepts hash, null, and missing legacy values", () => {
    expect(
      AssetContentHashRowSchema.safeParse({ content_hash: "hash" }).success,
    ).toBe(true);
    expect(AssetContentHashRowSchema.safeParse({ content_hash: null }).success).toBe(
      true,
    );
    expect(AssetContentHashRowSchema.safeParse({}).success).toBe(true);
  });

  it("rejects non-string hashes", () => {
    expect(
      AssetContentHashRowSchema.safeParse({ content_hash: 42 }).success,
    ).toBe(false);
    expect(AssetContentHashRowSchema.safeParse(null).success).toBe(false);
  });
});
