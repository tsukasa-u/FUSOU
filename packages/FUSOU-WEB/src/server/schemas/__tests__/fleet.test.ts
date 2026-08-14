import { describe, expect, it } from "vitest";
import {
  FleetMemberMapRowSchema,
  FleetRotationRowsSchema,
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
});