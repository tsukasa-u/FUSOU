import { describe, expect, it } from "vitest";
import { decodeAvroOcfToJson } from "@/features/avro/ocf-decoder";
import {
  battleFixtureRecords,
  buildAvroOcfFixture,
} from "@/features/avro/test-fixtures";
import {
  createLocalAvroFileEntry,
  parseLocalAvroPath,
} from "../../local-directory/manifest";
import type { LocalManifestEntry } from "../protocol";
import { LocalWorkerSession } from "../session";
import {
  resolveBattleDetail,
  type BattleDetailTables,
} from "../../resolvers/detail";
import { buildBattleDropsPayload } from "../../resolvers/drops";
import { buildBattleOverviewPayload } from "../../resolvers/overview";

const periodTag = "2026-07-08";
const cellsFixtureRecords = [
  {
    env_uuid: "fixture-env",
    battle_index: [0, 1],
    cell_index: [101, 102],
    battles: "fixture-battle-0",
    maparea_id: 5,
    mapinfo_no: 4,
  },
];

function fileFromBytes(bytes: Uint8Array, name: string, lastModified: number): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { lastModified });
}

function fixtureTables(): BattleDetailTables {
  return {
    battle: battleFixtureRecords,
    cells: cellsFixtureRecords,
    battleResult: [],
    ownDeck: [],
    ownShip: [],
    ownSlotItem: [],
    enemyDeck: [],
    enemyShip: [],
    enemySlotItem: [],
    midnightHougekiLists: [],
    midnightHougekis: [],
    openingTaisenLists: [],
    openingTaisens: [],
    hougekiLists: [],
    hougekis: [],
    openingAirattackLists: [],
    openingAirattacks: [],
    openingRaigeki: [],
    closingRaigeki: [],
    airbaseAssault: [],
    airbaseAirattackLists: [],
    airbaseAirattacks: [],
    carrierbaseAssault: [],
    supportHourai: [],
    supportAirattack: [],
    nightSupportHourai: [],
    nightSupportAirattack: [],
    friendlySupportHouraiLists: [],
    friendlySupportHourai: [],
    destructionBattle: [],
  };
}

function loadFixtureData(): {
  entries: LocalManifestEntry[];
  tables: BattleDetailTables;
} {
  const entries: LocalManifestEntry[] = [];
  const decodedTables = new Map<string, ReturnType<typeof decodeAvroOcfToJson>>();
  const fileName =
    "1785499200_4c78c801-1d64-4e66-bcac-82025884b215.avro";
  for (const [table, schemaName, records] of [
    ["battle", "Battle", battleFixtureRecords],
    ["cells", "Cells", cellsFixtureRecords],
  ] as const) {
    const relativePath = `fusou/${periodTag}/transaction_data/5-4/${table}/${fileName}`;
    const bytes = buildAvroOcfFixture(schemaName, records);
    decodedTables.set(table, decodeAvroOcfToJson(bytes));
    const parsed = parseLocalAvroPath(relativePath);
    entries.push({
      ...createLocalAvroFileEntry(parsed, {
        size: bytes.byteLength,
        lastModified: 1,
      }),
      file: fileFromBytes(bytes, fileName, 1),
    });
  }
  return {
    entries,
    tables: {
      ...fixtureTables(),
      battle: decodedTables.get("battle") ?? [],
      cells: decodedTables.get("cells") ?? [],
    },
  };
}

describe("local AVRO detail contract", () => {
  it("matches the shared resolver payload for a real local detail", async () => {
    const { entries, tables } = loadFixtureData();
    const sourceBattle = tables.battle.find(
      (row) =>
        typeof row["env_uuid"] === "string" &&
        Number.isSafeInteger(row["index"]),
    );
    expect(sourceBattle).toBeDefined();

    const envUuid = String(sourceBattle?.["env_uuid"]);
    const battleIndex = Number(sourceBattle?.["index"]);
    const expected = resolveBattleDetail({
      periodTag,
      envUuid,
      battleIndex,
      tables,
    });
    expect(expected).not.toBeNull();

    const session = new LocalWorkerSession();
    session.initialize({ fingerprint: "real-app-avro", entries });
    const actual = await session.detail(
      "real-detail-contract",
      { envUuid, battleIndex, periodTag },
      () => undefined,
    );

    expect(actual).toEqual(expected?.payload);
    expect(actual.source_meta).toEqual({
      env_uuid: envUuid,
      battle_index: battleIndex,
    });
  });

  it("matches the shared overview and drops resolvers for local fixture data", async () => {
    const { entries, tables } = loadFixtureData();
    const session = new LocalWorkerSession();
    session.initialize({ fingerprint: "real-app-avro", entries });

    const expectedOverview = buildBattleOverviewPayload({
      periodTag,
      battles: tables.battle,
      cells: tables.cells,
      battleResults: tables.battleResult,
      enemyDecks: tables.enemyDeck,
      enemyShips: tables.enemyShip,
      mstShips: [],
    });
    const expectedDrops = buildBattleDropsPayload({
      periodTag,
      battles: tables.battle,
      cells: tables.cells,
      battleResults: tables.battleResult,
      mstShips: [],
    });

    await expect(
      session.overview(
        "real-overview-contract",
        { periodTag, masterShips: [] },
        () => undefined,
      ),
    ).resolves.toEqual(expectedOverview);
    await expect(
      session.drops(
        "real-drops-contract",
        { periodTag, masterShips: [] },
        () => undefined,
      ),
    ).resolves.toEqual(expectedDrops);
  });
});
