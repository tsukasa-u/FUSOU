import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { execSync } from "node:child_process";
import { decodeAvroOcfToJson } from "@fusou/compaction-core";
import { buildOverviewSnapshot, buildDropsSnapshot } from "@fusou/compaction-core";
import { resolveBattleDetail, type BattleDetailTables } from "@/features/battles/resolvers/detail";

export async function rebuildAllSnapshots(options?: { periodTag?: string; tableVersion?: string }) {
  const periodTag = options?.periodTag || "2026-10-14";
  const tableVersion = options?.tableVersion || "0.6.0";
  const bucketName = "dev-kc-battle-data";

  console.log(`[rebuild-snapshots] Rebuilding all snapshots for period: ${periodTag}, tableVersion: ${tableVersion}`);

  // 1. Fetch master data from API
  console.log("[rebuild-snapshots] Fetching master data...");
  const base = "https://fusou.ogu-hide-u-425.workers.dev";
  const [shipRes, slotRes] = await Promise.all([
    fetch(`${base}/api/master-data/json?table_name=mst_ship`),
    fetch(`${base}/api/master-data/json?table_name=mst_slotitem`),
  ]);
  const shipJson = (await shipRes.json()) as any;
  const slotJson = (await slotRes.json()) as any;
  const masterShips: any[] = shipJson.records || [];
  const masterSlotItems: any[] = slotJson.records || [];
  console.log(`[rebuild-snapshots] Loaded ${masterShips.length} master ships and ${masterSlotItems.length} master slot items.`);

  if (masterShips.length === 0 || masterSlotItems.length === 0) {
    throw new Error("Master data could not be fetched or is empty!");
  }

  // 2. Discover period Avro files from D1
  console.log("[rebuild-snapshots] Finding period Avro files in D1...");
  const d1Output = execSync(
    `pnpm --filter fusou-web exec wrangler d1 execute dev-kc-battle-index --remote --json --command "SELECT file_path FROM archived_files WHERE file_path LIKE '%/${periodTag}/period/%' AND file_path NOT LIKE 'compacted/%'"`,
    { encoding: "utf-8" }
  );
  const d1Parsed = JSON.parse(d1Output);
  const filePaths: string[] = (d1Parsed[0]?.results || []).map((r: any) => r.file_path);
  console.log(`[rebuild-snapshots] Found ${filePaths.length} period files for ${periodTag}.`);

  const tempDir = path.resolve("./temp_rebuild_snapshots");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

  // 3. Download and decode each table
  const tableRecords: Record<string, any[]> = {};
  for (const fp of filePaths) {
    const match = fp.match(/\/([^/]+)-001\.avro$/) || fp.match(/\/([^/]+)\.avro$/);
    if (!match) continue;
    const tableName = match[1];
    const localFile = path.join(tempDir, `${tableName}.avro`);
    execSync(
      `pnpm --filter fusou-web exec wrangler r2 object get ${bucketName}/${fp} --file ${localFile} --remote`,
      { stdio: "ignore" }
    );
    const buf = fs.readFileSync(localFile);
    tableRecords[tableName] = decodeAvroOcfToJson(buf);
    fs.unlinkSync(localFile);
  }

  const detailTables: BattleDetailTables = {
    battle: tableRecords["battle"] || [],
    cells: tableRecords["cells"] || [],
    battleResult: tableRecords["battle_result"] || [],
    ownDeck: tableRecords["own_deck"] || [],
    ownShip: tableRecords["own_ship"] || [],
    ownSlotItem: tableRecords["own_slotitem"] || [],
    enemyDeck: tableRecords["enemy_deck"] || [],
    enemyShip: tableRecords["enemy_ship"] || [],
    enemySlotItem: tableRecords["enemy_slotitem"] || [],
    midnightHougekiLists: tableRecords["midnight_hougeki_list"] || [],
    midnightHougekis: tableRecords["midnight_hougeki"] || [],
    openingTaisenLists: tableRecords["opening_taisen_list"] || [],
    openingTaisens: tableRecords["opening_taisen"] || [],
    hougekiLists: tableRecords["hougeki_list"] || [],
    hougekis: tableRecords["hougeki"] || [],
    openingAirattackLists: tableRecords["opening_airattack_list"] || [],
    openingAirattacks: tableRecords["opening_airattack"] || [],
    openingRaigeki: tableRecords["opening_raigeki"] || [],
    closingRaigeki: tableRecords["closing_raigeki"] || [],
    airbaseAssault: tableRecords["airbase_assault"] || [],
    airbaseAirattackLists: tableRecords["airbase_airattack_list"] || [],
    airbaseAirattacks: tableRecords["airbase_airattack"] || [],
    carrierbaseAssault: tableRecords["carrierbase_assault"] || [],
    supportHourai: tableRecords["support_hourai"] || [],
    supportAirattack: tableRecords["support_airattack"] || [],
    nightSupportHourai: tableRecords["night_support_hourai"] || [],
    nightSupportAirattack: tableRecords["night_support_airattack"] || [],
    friendlySupportHouraiLists: tableRecords["friendly_support_hourai_list"] || [],
    friendlySupportHourai: tableRecords["friendly_support_hourai"] || [],
    destructionBattle: tableRecords["destruction_battle"] || [],
  };

  const battles = detailTables.battle;
  const uniqueEnvUuids = Array.from(new Set(battles.map((b) => String(b.env_uuid || "")).filter(Boolean)));
  console.log(`[rebuild-snapshots] Processing ${uniqueEnvUuids.length} unique sorties...`);

  const uploadTasks: Array<{ key: string; localFile: string }> = [];

  // 4. Build Sortie-level & Battle-level snapshots with master data
  for (const envUuid of uniqueEnvUuids) {
    const envBattles = battles
      .filter((b) => b.env_uuid === envUuid)
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));

    const envBattlePayloads: Record<string, any> = {};

    for (const b of envBattles) {
      const battleIndex = Number(b.index ?? 0);
      const resolution = resolveBattleDetail({
        periodTag,
        tableVersion,
        envUuid,
        battleIndex,
        masterShips,
        masterSlotItems,
        tables: detailTables,
      });

      if (resolution) {
        envBattlePayloads[String(battleIndex)] = resolution.payload;

        const battleJson = JSON.stringify(resolution.payload);
        const battleBr = zlib.brotliCompressSync(Buffer.from(battleJson, "utf-8"), {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
        });
        const battleFile = path.join(tempDir, `${envUuid}_${battleIndex}.json.br`);
        fs.writeFileSync(battleFile, battleBr);

        uploadTasks.push(
          { key: `snapshots/detail/${periodTag}/${envUuid}_${battleIndex}.json.br`, localFile: battleFile },
          { key: `snapshots/detail/latest/${envUuid}_${battleIndex}.json.br`, localFile: battleFile }
        );
      }
    }

    const bundle = {
      success: true,
      env_uuid: envUuid,
      period_tag: periodTag,
      table_version: tableVersion,
      snapshot_timestamp: Date.now(),
      battles: envBattlePayloads,
    };
    const bundleJson = JSON.stringify(bundle);
    const bundleBr = zlib.brotliCompressSync(Buffer.from(bundleJson, "utf-8"), {
      params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
    });
    const bundleFile = path.join(tempDir, `${envUuid}_bundle.json.br`);
    fs.writeFileSync(bundleFile, bundleBr);

    uploadTasks.push(
      { key: `snapshots/env_detail/${periodTag}/${envUuid}.json.br`, localFile: bundleFile },
      { key: `snapshots/env_detail/latest/${envUuid}.json.br`, localFile: bundleFile }
    );
  }

  // 5. Build Overview and Drops snapshots
  console.log("[rebuild-snapshots] Building Overview and Drops snapshots...");
  const sortiesForOverview = uniqueEnvUuids.map((envUuid) => {
    const sBattles = battles.filter((b) => b.env_uuid === envUuid);
    const sCells = detailTables.cells.filter((c) => c.env_uuid === envUuid);
    const sResults = detailTables.battleResult.filter((r) => r.env_uuid === envUuid);
    const sEnemyDecks = detailTables.enemyDeck.filter((d) => d.env_uuid === envUuid);
    const sEnemyShips = detailTables.enemyShip.filter((s) => s.env_uuid === envUuid);
    const firstTs = Number(sBattles[0]?.timestamp || Date.now());
    return {
      env_uuid: envUuid,
      period_tag: periodTag,
      table_version: tableVersion,
      timestamp: firstTs,
      cells: sCells,
      battles: sBattles,
      battleResults: sResults,
      enemyDecks: sEnemyDecks,
      enemyShips: sEnemyShips,
    };
  });

  const overviewPayload = buildOverviewSnapshot(sortiesForOverview, { periodTag });
  const overviewJson = JSON.stringify(overviewPayload);
  const overviewBr = zlib.brotliCompressSync(Buffer.from(overviewJson, "utf-8"), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
  });
  const overviewFile = path.join(tempDir, "overview.json.br");
  fs.writeFileSync(overviewFile, overviewBr);

  const dropsPayload = buildDropsSnapshot(sortiesForOverview, { periodTag });
  dropsPayload.mst_ships = masterShips;
  const dropsJson = JSON.stringify(dropsPayload);
  const dropsBr = zlib.brotliCompressSync(Buffer.from(dropsJson, "utf-8"), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
  });
  const dropsFile = path.join(tempDir, "drops.json.br");
  fs.writeFileSync(dropsFile, dropsBr);

  uploadTasks.push(
    { key: `snapshots/overview/${periodTag}/latest.json.br`, localFile: overviewFile },
    { key: `snapshots/overview/latest/latest.json.br`, localFile: overviewFile },
    { key: `snapshots/drops/${periodTag}/latest.json.br`, localFile: dropsFile },
    { key: `snapshots/drops/latest/latest.json.br`, localFile: dropsFile }
  );

  // 6. Upload all snapshot objects to R2
  console.log(`[rebuild-snapshots] Uploading ${uploadTasks.length} snapshot files to R2 bucket ${bucketName}...`);
  for (let i = 0; i < uploadTasks.length; i++) {
    const task = uploadTasks[i];
    execSync(
      `pnpm --filter fusou-web exec wrangler r2 object put ${bucketName}/${task.key} --file ${task.localFile} --remote`,
      { stdio: "ignore" }
    );
    if ((i + 1) % 20 === 0 || i === uploadTasks.length - 1) {
      console.log(`[rebuild-snapshots] Uploaded ${i + 1}/${uploadTasks.length} files...`);
    }
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
  console.log("[rebuild-snapshots] All snapshots rebuilt and uploaded successfully!");
}

if (process.argv[1]?.includes("rebuild-all-snapshots")) {
  rebuildAllSnapshots().catch((err) => {
    console.error("[rebuild-snapshots] Failed:", err);
    process.exit(1);
  });
}
