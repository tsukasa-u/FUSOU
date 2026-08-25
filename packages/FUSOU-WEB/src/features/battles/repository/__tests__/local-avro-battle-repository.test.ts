import { describe, expect, it, vi } from "vitest";
import { LocalAvroBattleRepository } from "../local-avro-battle-repository";
import type { SerializableManifest } from "../../local-worker/protocol";

function fakeClient() {
  return {
    initialize: vi.fn(async () => ({ initialized: true })),
    listPeriods: vi.fn(async () => [{ periodTag: "2026-07-08", tableVersion: null }]),
    records: vi.fn(async () => ({ records: [{ uuid: "record-1" }] })),
    overview: vi.fn(async () => ({ battles: [{ index: 0 }] })),
    drops: vi.fn(async () => ({ battles: [], mst_ships: [] })),
    detail: vi.fn(async () => ({ battle: null })),
    dispose: vi.fn(async () => undefined),
  };
}

const manifest: SerializableManifest = { fingerprint: "fixture", entries: [] };

describe("LocalAvroBattleRepository", () => {
  it("routes repository queries to the worker without HTTP", async () => {
    const client = fakeClient();
    const repository = new LocalAvroBattleRepository(manifest, undefined, client);

    await expect(repository.listPeriods("battle")).resolves.toEqual([
      { periodTag: "2026-07-08", tableVersion: null },
    ]);
    await expect(
      repository.getRecords({ table: "battle", periodTag: "all", limitRecords: 10 }),
    ).resolves.toEqual({ records: [{ uuid: "record-1" }] });
    await expect(
      repository.getOverview({
        periodTag: "latest",
        limitRecords: 10,
        masterShips: [{ id: 123, name: "Ship" }],
      }),
    ).resolves.toEqual({ battles: [{ index: 0 }] });

    expect(client.initialize).toHaveBeenCalledWith(manifest);
    expect(client.records).toHaveBeenCalledWith(
      { table: "battle", periodTag: "all", limitRecords: 10 },
      { signal: undefined },
    );
    expect(client.overview).toHaveBeenCalledWith(
      {
        periodTag: "latest",
        limitRecords: 10,
        masterShips: [{ id: 123, name: "Ship" }],
      },
      { signal: undefined },
    );
  });

  it("disposes the worker and rejects later queries", async () => {
    const client = fakeClient();
    const repository = new LocalAvroBattleRepository(manifest, undefined, client);
    await repository.dispose();

    expect(client.dispose).toHaveBeenCalledOnce();
    await expect(repository.listPeriods("battle")).rejects.toMatchObject({
      name: "LocalBattleError",
      code: "PERMISSION_REQUIRED",
    });
  });
});