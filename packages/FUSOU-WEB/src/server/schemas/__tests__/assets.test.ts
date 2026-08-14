import { describe, expect, it } from "vitest";
import {
  AssetContentHashRowSchema,
  AssetKeyRowSchema,
  CacheClearKeysSchema,
  SpriteAtlasSchema,
} from "../assets";

describe("SpriteAtlasSchema", () => {
  it("accepts a texture atlas shape and preserves metadata", () => {
    const result = SpriteAtlasSchema.safeParse({
      frames: { icon: { frame: { x: 0, y: 0, w: 32, h: 32 } } },
      meta: { size: { w: 256, h: 256 }, app: "texture-packer" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.meta).toMatchObject({ app: "texture-packer" });
    }
  });

  it("rejects JSON values without atlas frames and metadata", () => {
    expect(SpriteAtlasSchema.safeParse([]).success).toBe(false);
    expect(
      SpriteAtlasSchema.safeParse({ frames: [], meta: {} }).success,
    ).toBe(false);
    expect(
      SpriteAtlasSchema.safeParse({ frames: {}, meta: "invalid" }).success,
    ).toBe(false);
  });
});

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

describe("CacheClearKeysSchema", () => {
  it("accepts non-empty cache keys", () => {
    expect(CacheClearKeysSchema.safeParse(["cache:ship-banner-map"]).success).toBe(
      true,
    );
  });

  it("rejects non-string and empty cache keys", () => {
    expect(CacheClearKeysSchema.safeParse(["", "cache:key"]).success).toBe(
      false,
    );
    expect(CacheClearKeysSchema.safeParse([1]).success).toBe(false);
    expect(CacheClearKeysSchema.safeParse(null).success).toBe(false);
  });
});
