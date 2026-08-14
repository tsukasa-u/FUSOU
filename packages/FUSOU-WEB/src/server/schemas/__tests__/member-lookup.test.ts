import { describe, expect, it } from "vitest";
import {
  MemberIdHashRowsSchema,
  MemberLookupRequestSchema,
} from "../member-lookup";

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

describe("MemberIdHashRowsSchema", () => {
  it("accepts member hash rows and extra fields", () => {
    const result = MemberIdHashRowsSchema.safeParse([
      { member_id_hash: "hash-1", extra: true },
      {},
    ]);

    expect(result.success).toBe(true);
  });

  it("rejects non-string member hashes", () => {
    expect(
      MemberIdHashRowsSchema.safeParse([{ member_id_hash: 123 }]).success,
    ).toBe(false);
  });
});