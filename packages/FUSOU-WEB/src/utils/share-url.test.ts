import { describe, expect, it } from "vitest";
import { buildShareBattleUrl } from "./share-url";

describe("buildShareBattleUrl", () => {
  it("preserves dataset scope for shared battle details", () => {
    const url = buildShareBattleUrl("https://example.com", {
      battleId: "env-123456",
      battleIndex: 2,
      periodTag: "2026-02-13",
      tableVersion: "0.7.0",
      datasetId: "dataset/one",
    });

    expect(url).toBe(
      "https://example.com/share/battle?id=env-123456&battle_index=2&period_tag=2026-02-13&table_version=0.7.0&dataset_id=dataset%2Fone",
    );
  });
});
