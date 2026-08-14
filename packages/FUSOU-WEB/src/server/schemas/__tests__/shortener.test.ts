import { describe, expect, it } from "vitest";
import {
  ShareRecordResponseSchema,
  SnapshotPayloadSchema,
  ShortenerRequestSchema,
} from "../shortener";

describe("ShortenerRequestSchema", () => {
  it("accepts a URL without a snapshot payload", () => {
    expect(ShortenerRequestSchema.safeParse({ url: "https://example.com" }).success).toBe(
      true,
    );
  });

  it("accepts an object snapshot payload", () => {
    const result = ShortenerRequestSchema.safeParse({
      url: "https://example.com",
      snapshotPayload: { snapshotShips: { "1": { level: 1 } } },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing URL", () => {
    expect(ShortenerRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("SnapshotPayloadSchema", () => {
  it("rejects non-object payloads", () => {
    expect(SnapshotPayloadSchema.safeParse("invalid").success).toBe(false);
    expect(SnapshotPayloadSchema.safeParse([]).success).toBe(false);
  });
});

describe("ShareRecordResponseSchema", () => {
  it("accepts a stored share record and extra fields", () => {
    expect(
      ShareRecordResponseSchema.safeParse({
        originalUrl: "https://example.com/simulator?data=abc",
        snapshotPayload: { snapshotShips: {} },
        extra: true,
      }).success,
    ).toBe(true);
  });

  it("accepts a legacy response without snapshot data", () => {
    expect(
      ShareRecordResponseSchema.safeParse({
        originalUrl: "https://example.com/simulator?data=abc",
        snapshotPayload: null,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed response fields", () => {
    expect(
      ShareRecordResponseSchema.safeParse({ originalUrl: 42 }).success,
    ).toBe(false);
    expect(
      ShareRecordResponseSchema.safeParse({ snapshotPayload: "invalid" })
        .success,
    ).toBe(false);
  });
});