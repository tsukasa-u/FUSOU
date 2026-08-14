import { describe, expect, it } from "vitest";
import {
  MasterDataDedupeRowSchema,
  MasterDataInsertedRevisionRowSchema,
  MasterDataNextRevisionRowSchema,
} from "../master-data";

describe("Master data revision row schemas", () => {
  it("accepts dedupe and inserted revision rows", () => {
    expect(
      MasterDataDedupeRowSchema.safeParse({
        id: 1,
        period_revision: 2,
        upload_status: "completed",
      }).success,
    ).toBe(true);
    expect(
      MasterDataInsertedRevisionRowSchema.safeParse({
        id: 1,
        period_revision: 2,
      }).success,
    ).toBe(true);
  });

  it("rejects malformed revision rows", () => {
    expect(
      MasterDataDedupeRowSchema.safeParse({
        id: 1,
        period_revision: "2",
        upload_status: "completed",
      }).success,
    ).toBe(false);
    expect(
      MasterDataInsertedRevisionRowSchema.safeParse({ id: 0, period_revision: 1 })
        .success,
    ).toBe(false);
    expect(MasterDataDedupeRowSchema.safeParse(null).success).toBe(false);
  });
});

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
