import { describe, expect, it } from "vitest";
import {
  FleetMemberMapRowSchema,
  FleetRotationRowsSchema,
  FleetSnapshotPayloadSchema,
  parseFleetSnapshotPayload,
} from "../fleet";

describe("fleet external row schemas", () => {
  it("accepts canonical member rows with nullable values", () => {
    expect(
      FleetMemberMapRowSchema.safeParse({
        member_id_hash: null,
        extra: true,
      }).success,
    ).toBe(true);
  });

  it("accepts rotation rows with nullable endpoints", () => {
    expect(
      FleetRotationRowsSchema.safeParse([
        { pid_from: "a", pid_to: "b" },
        { pid_from: null, pid_to: "c" },
      ]).success,
    ).toBe(true);
  });

  it("rejects malformed external rows", () => {
    expect(FleetMemberMapRowSchema.safeParse({ member_id_hash: 1 }).success).toBe(
      false,
    );
    expect(
      FleetRotationRowsSchema.safeParse([{ pid_from: 1 }]).success,
    ).toBe(false);
  });

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