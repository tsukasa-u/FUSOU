import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decodeAvroOcfToJson,
  type AvroJsonRecord,
} from "@/features/avro/ocf-decoder";
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

const databaseRoot = resolve(process.cwd(), "../FUSOU-DATABASE");
const periodTag = "2026-07-08";
const mapPath = resolve(
  databaseRoot,
  "fusou",
  periodTag,
  "transaction_data",
  "5-4",
);

function fileFromBytes(bytes: Uint8Array, name: string, lastModified: number): File {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new File([buffer], name, { lastModified });
}

function loadRealMapData(): {
  entries: LocalManifestEntry[];
  tables: BattleDetailTables;
} {
  const entries: LocalManifestEntry[] = [];
  const records = new Map<string, AvroJsonRecord[]>();

  for (const tableEntry of readdirSync(mapPath, { withFileTypes: true })) {
    if (!tableEntry.isDirectory()) continue;
    const table = tableEntry.name;
    const tableRecords: AvroJsonRecord[] = [];
    for (const fileEntry of readdirSync(resolve(mapPath, table), {
      withFileTypes: true,
    })) {
      if (!fileEntry.isFile() || !fileEntry.name.endsWith(".avro")) continue;
      const absolutePath = resolve(mapPath, table, fileEntry.name);
      const bytes = new Uint8Array(readFileSync(absolutePath));
      const relativePath = `fusou/${periodTag}/transaction_data/5-4/${table}/${fileEntry.name}`;
      const parsed = parseLocalAvroPath(relativePath);
      const stat = statSync(absolutePath);
      entries.push({
        ...createLocalAvroFileEntry(parsed, {
          size: bytes.byteLength,
          lastModified: stat.mtimeMs,
        }),
        file: fileFromBytes(bytes, fileEntry.name, stat.mtimeMs),
      });
      tableRecords.push(...decodeAvroOcfToJson(bytes));
    }
    records.set(table, tableRecords);
  }

  const rows = (table: string): AvroJsonRecord[] => records.get(table) ?? [];
  return {
    entries,
    tables: {
      battle: rows("battle"),
      cells: rows("cells"),
      battleResult: rows("battle_result"),
      ownDeck: rows("own_deck"),
      ownShip: rows("own_ship"),
      ownSlotItem: rows("own_slotitem"),
      enemyDeck: rows("enemy_deck"),
      enemyShip: rows("enemy_ship"),
      enemySlotItem: rows("enemy_slotitem"),
      midnightHougekiLists: rows("midnight_hougeki_list"),
      midnightHougekis: rows("midnight_hougeki"),
      openingTaisenLists: rows("opening_taisen_list"),
      openingTaisens: rows("opening_taisen"),
      hougekiLists: rows("hougeki_list"),
      hougekis: rows("hougeki"),
      openingAirattackLists: rows("opening_airattack_list"),
      openingAirattacks: rows("opening_airattack"),
      openingRaigeki: rows("opening_raigeki"),
      closingRaigeki: rows("closing_raigeki"),
      airbaseAssault: rows("airbase_assult"),
      airbaseAirattackLists: rows("airbase_airattack_list"),
      airbaseAirattacks: rows("airbase_airattack"),
      carrierbaseAssault: rows("carrierbase_assault"),
      supportHourai: rows("support_hourai"),
      supportAirattack: rows("support_airattack"),
      nightSupportHourai: rows("night_support_hourai"),
      nightSupportAirattack: rows("night_support_airattack"),
      friendlySupportHouraiLists: rows("friendly_support_hourai_list"),
      friendlySupportHourai: rows("friendly_support_hourai"),
      destructionBattle: rows("destruction_battle"),
    },
  };
}

describe("real APP AVRO detail contract", () => {
  it("matches the shared resolver payload for a real local detail", async () => {
    const { entries, tables } = loadRealMapData();
    const sourceBattle = tables.battle.find(
      (row) => typeof row.env_uuid === "string" && Number.isSafeInteger(row.index),
    );
    expect(sourceBattle).toBeDefined();

    const envUuid = String(sourceBattle?.env_uuid);
    const battleIndex = Number(sourceBattle?.index);
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

  it("matches the shared overview and drops resolvers for real local data", async () => {
    const { entries, tables } = loadRealMapData();
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
