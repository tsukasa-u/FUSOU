import { describe, expect, it, vi } from "vitest";
import { R2BattleRepository } from "../r2-battle-repository";
import { BattleRepositoryHttpError } from "../types";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("R2BattleRepository", () => {
  it("maps period summary and overview requests to the existing API", async () => {
    const fetcher = vi.fn(async (url: string) => {
      if (url.startsWith("/api/battle-data/global/summary")) {
        return jsonResponse({
          periods: [
            { period_tag: "2026-02-13", table_version: "0.7.0" },
            { period_tag: "", table_version: "0.7.1" },
          ],
        });
      }
      return jsonResponse({ battles: [{ index: 3 }] });
    });
    const repository = new R2BattleRepository(fetcher);

    await expect(repository.listPeriods("battle")).resolves.toEqual([
      { periodTag: "2026-02-13", tableVersion: "0.7.0" },
    ]);
    await expect(
      repository.getOverview({
        periodTag: "2026-02-13",
        tableVersion: "0.7.0",
        limitBlocks: 120,
        limitRecords: 20000,
      }),
    ).resolves.toEqual({ battles: [{ index: 3 }] });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "/api/battle-data/global/summary?table=battle",
      undefined,
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      "/api/battle-data/global/overview?period_tag=2026-02-13&table_version=0.7.0&limit_blocks=120&limit_records=20000",
      undefined,
    );
  });

  it("serializes record filters and preserves abort/refresh options", async () => {
    const fetcher = vi.fn(async () => jsonResponse({ records: [] }));
    const repository = new R2BattleRepository(fetcher);
    const controller = new AbortController();

    await repository.getRecords({
      table: "battle_result",
      periodTag: "all",
      tableVersion: "0.7.0",
      filter: { uuid: "env-1" },
      limitBlocks: 120,
      limitRecords: 50,
      signal: controller.signal,
      forceRefresh: true,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/battle-data/global/records?table=battle_result&period_tag=all&table_version=0.7.0&limit_blocks=120&limit_records=50&filter_json=%7B%22uuid%22%3A%22env-1%22%7D",
      expect.objectContaining({
        signal: controller.signal,
        cache: "reload",
        headers: { "Cache-Control": "no-cache" },
      }),
    );
  });

  it("exposes HTTP status without silently converting errors to empty data", async () => {
    const repository = new R2BattleRepository(async () => jsonResponse({}, 404));

    await expect(
      repository.getDetail({
        envUuid: "env-1",
        battleIndex: 0,
        periodTag: "latest",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<BattleRepositoryHttpError>>({
        name: "BattleRepositoryHttpError",
        status: 404,
      }),
    );
  });
});