import { describe, expect, it } from "vitest";
import { buildShareBattleUrl, buildShareGrowthUrl } from "./share-url";

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

  it("excludes 'latest' and 'all' pseudo-tags from share battle url", () => {
    const urlLatest = buildShareBattleUrl("https://example.com", {
      battleId: "env-123456",
      battleIndex: 0,
      periodTag: "latest",
      tableVersion: "0.7.0",
    });
    expect(urlLatest).toBe("https://example.com/share/battle?id=env-123456&battle_index=0&table_version=0.7.0");

    const urlAll = buildShareBattleUrl("https://example.com", {
      battleId: "env-123456",
      battleIndex: 0,
      periodTag: "all",
      tableVersion: "0.7.0",
    });
    expect(urlAll).toBe("https://example.com/share/battle?id=env-123456&battle_index=0&table_version=0.7.0");
  });
});

describe("buildShareGrowthUrl", () => {
  it("builds valid share growth url with concrete period tag", () => {
    const url = buildShareGrowthUrl("https://example.com", {
      periodTag: "2026-08-14",
      tableVersion: "0.7.0",
      masterId: 461,
    });
    expect(url).toBe("https://example.com/share/growth?period_tag=2026-08-14&table_version=0.7.0&master_id=461");
  });

  it("throws when passed 'latest' or 'all' pseudo-tag", () => {
    expect(() =>
      buildShareGrowthUrl("https://example.com", {
        periodTag: "latest",
        tableVersion: "0.7.0",
        masterId: 461,
      })
    ).toThrow("Cannot build share growth URL with invalid period tag: latest");

    expect(() =>
      buildShareGrowthUrl("https://example.com", {
        periodTag: "all",
        tableVersion: "0.7.0",
        masterId: 461,
      })
    ).toThrow("Cannot build share growth URL with invalid period tag: all");
  });
});
