import { describe, expect, it } from "vitest";
import { MemberLookupRequestSchema } from "../member-lookup";

describe("MemberLookupRequestSchema", () => {
  it("accepts a string hash", () => {
    expect(
      MemberLookupRequestSchema.safeParse({ member_id_hash: "a".repeat(64) })
        .success,
    ).toBe(true);
  });

  it("accepts an omitted hash for route-level required-field handling", () => {
    expect(MemberLookupRequestSchema.safeParse({}).success).toBe(true);
  });

  it("rejects non-string hashes", () => {
    expect(
      MemberLookupRequestSchema.safeParse({ member_id_hash: 123 }).success,
    ).toBe(false);
  });
});