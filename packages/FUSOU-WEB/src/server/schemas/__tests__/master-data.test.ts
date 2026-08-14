import { describe, expect, it } from "vitest";
import { MasterDataNextRevisionRowSchema } from "../master-data";

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
