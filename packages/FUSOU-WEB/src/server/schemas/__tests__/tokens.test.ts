import { describe, expect, it } from "vitest";
import { BattleDataTokenPayloadSchema } from "../tokens";

describe("battle data token schema", () => {
  it("parses the battle upload token payload", () => {
    expect(
      BattleDataTokenPayloadSchema.parse({
        user_id: "user",
        dataset_id: "dataset",
        table: "battle",
        period_tag: "2026-06-26",
        declared_size: 128,
        table_offsets: null,
        content_hash: "hash",
        path_tag: "battle.avro",
        table_version: "v1",
      }),
    ).toMatchObject({ table: "battle", declared_size: 128 });
  });

  it("rejects a token without the required table version", () => {
    expect(
      BattleDataTokenPayloadSchema.safeParse({
        user_id: "user",
        dataset_id: "dataset",
        table: "battle",
        period_tag: "2026-06-26",
        declared_size: 128,
        table_offsets: null,
        content_hash: "hash",
        path_tag: "battle.avro",
      }).success,
    ).toBe(false);
  });
});