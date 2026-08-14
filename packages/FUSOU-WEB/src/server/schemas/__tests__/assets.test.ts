import { describe, expect, it } from "vitest";
import { AssetKeyRowSchema } from "../assets";

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
