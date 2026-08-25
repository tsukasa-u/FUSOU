import { describe, expect, it } from "vitest";
import {
  FleetSnapshotPayloadSchema,
  parseFleetSnapshotPayload,
} from "../fleet";

describe("fleet snapshot schema", () => {
  it("accepts snapshot arrays and preserves a valid zero combined flag", () => {
    const result = FleetSnapshotPayloadSchema.safeParse({
      s3s: [],
      s8s: [],
      d8k: [],
      c11g: 0,
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.c11g).toBe(0);
  });

  it("rejects arbitrary JSON without fleet snapshot arrays", () => {
    expect(parseFleetSnapshotPayload({ source: "invalid" })).toBeNull();
    expect(parseFleetSnapshotPayload([])).toBeNull();
    expect(parseFleetSnapshotPayload({ s3s: "invalid" })).toBeNull();
  });
});