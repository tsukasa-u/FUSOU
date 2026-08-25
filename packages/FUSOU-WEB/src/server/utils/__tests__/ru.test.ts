import { describe, expect, it } from "vitest";
import { parseRUBucketState } from "../ru";

describe("parseRUBucketState", () => {
  it("preserves valid zero tokens and timestamps", () => {
    expect(
      parseRUBucketState({ tokens: 0, lastRefill: 1_754_000_000_000 }),
    ).toEqual({ tokens: 0, lastRefill: 1_754_000_000_000 });
  });

  it("rejects malformed or out-of-range persisted state", () => {
    expect(parseRUBucketState(null)).toBeNull();
    expect(parseRUBucketState({ tokens: "10", lastRefill: 1 })).toBeNull();
    expect(parseRUBucketState({ tokens: Number.NaN, lastRefill: 1 })).toBeNull();
    expect(parseRUBucketState({ tokens: 1001, lastRefill: 1 })).toBeNull();
    expect(parseRUBucketState({ tokens: 10, lastRefill: -1 })).toBeNull();
  });
});