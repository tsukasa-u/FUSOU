import zlib from "node:zlib";
import { execSync } from "node:child_process";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { decodeAvroOcfToJson } from "@fusou/compaction-core";
import { buildOverviewSnapshot, buildDropsSnapshot } from "@fusou/compaction-core";
import { resolveBattleDetail, type BattleDetailTables } from "@/features/battles/resolvers/detail";

function getS3Client(): S3Client {
  const endpoint = process.env["R2_S3_ENDPOINT"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"] || "";
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"] || "";
  return new S3Client({
    region: "auto",
    ...(endpoint ? { endpoint } : {}),
    credentials: { accessKeyId, secretAccessKey },
  });
}

async function streamToBuffer(stream: any): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function pMap<T, R>(items: T[], fn: (item: T, idx: number) => Promise<R>, concurrency = 15): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx]!, idx);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function rebuildSnapshotsForPeriod(options: {
  periodTag: string;
  tableVersion?: string;
  masterShips: any[];
  masterSlotItems: any[];
  s3: S3Client;
  bucketName: string;
}) {
  const { periodTag, masterShips, masterSlotItems, s3, bucketName } = options;
  const tableVersion = options.tableVersion || "0.6.0";

  console.log("\n========================================================");
  console.log("[rebuild-snapshots] Processing period: " + periodTag + " (version: " + tableVersion + ")");
  console.log("========================================================");

  // 1. Discover period Avro files from D1
  const d1Output = execSync(
    "pnpm --filter fusou-web exec wrangler d1 execute dev-kc-battle-index --remote --json --command \"SELECT file_path FROM archived_files WHERE file_path LIKE '%/" + periodTag + "/period/%' AND file_path NOT LIKE 'compacted/%'\"",
    { encoding: "utf-8" }
  );
  const d1Parsed = JSON.parse(d1Output);
  const filePaths: string[] = (d1Parsed[0]?.results || []).map((r: any) => r.file_path);
  console.log("[rebuild-snapshots] Found " + filePaths.length + " active period files for " + periodTag + ".");

  if (filePaths.length === 0) {
    console.warn("[rebuild-snapshots] No period files found for " + periodTag + ", skipping.");
    return;
  }

  // 2. Download and decode each table using S3 parallel gets
  console.log("[rebuild-snapshots] Downloading and decoding " + filePaths.length + " tables via S3 API...");
  const tableRecords: Record<string, any[]> = {};
  await pMap(filePaths, async (fp) => {
    const match = fp.match(/\/([^/]+)-001\.avro$/) || fp.match(/\/([^/]+)\.avro$/);
    if (!match) return;
    const tableName = match[1];
    if (!tableName) return;
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: fp }));
      const buf = await streamToBuffer(obj.Body);
      tableRecords[tableName] = decodeAvroOcfToJson(new Uint8Array(buf));
    } catch (err: any) {
      console.warn("[rebuild-snapshots] Warning: could not download/decode " + fp + ": " + err.message);
    }
  }, 10);

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
  console.log("[rebuild-snapshots] Period " + periodTag + " has " + battles.length + " battles.");
  if (battles.length === 0) {
    console.log("[rebuild-snapshots] No battles found for " + periodTag + ", skipping snapshot generation.");
    return;
  }

  const uniqueEnvUuids = Array.from(new Set(battles.map((b) => String(b["env_uuid"] || "")).filter(Boolean)));
  console.log("[rebuild-snapshots] Processing " + uniqueEnvUuids.length + " unique sorties...");

  const uploadTasks: Array<{ key: string; buffer: Buffer; contentType: string }> = [];

  // 3. Build Sortie-level & Battle-level snapshots with master data
  for (const envUuid of uniqueEnvUuids) {
    const envBattles = battles
      .filter((b) => b["env_uuid"] === envUuid)
      .sort((a, b) => Number(a["index"] ?? 0) - Number(b["index"] ?? 0));

    const envBattlePayloads: Record<string, any> = {};

    for (const b of envBattles) {
      const battleIndex = Number(b["index"] ?? 0);
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

        uploadTasks.push({
          key: "snapshots/detail/" + periodTag + "/" + envUuid + "_" + battleIndex + ".json.br",
          buffer: battleBr,
          contentType: "application/json",
        });
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

    uploadTasks.push({
      key: "snapshots/env_detail/" + periodTag + "/" + envUuid + ".json.br",
      buffer: bundleBr,
      contentType: "application/json",
    });
  }

  // 4. Build Overview and Drops snapshots
  console.log("[rebuild-snapshots] Building Overview and Drops snapshots for " + periodTag + "...");
  const sortiesForOverview = uniqueEnvUuids.map((envUuid) => {
    const sBattles = battles.filter((b) => b["env_uuid"] === envUuid);
    const sCells = detailTables.cells.filter((c) => c["env_uuid"] === envUuid);
    const sResults = detailTables.battleResult.filter((r) => r["env_uuid"] === envUuid);
    const sEnemyDecks = detailTables.enemyDeck.filter((d) => d["env_uuid"] === envUuid);
    const sEnemyShips = detailTables.enemyShip.filter((s) => s["env_uuid"] === envUuid);
    const firstTs = Number(sBattles[0]?.["timestamp"] || Date.now());
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

  const dropsPayload = buildDropsSnapshot(sortiesForOverview, { periodTag });
  dropsPayload.mst_ships = masterShips;
  const dropsJson = JSON.stringify(dropsPayload);
  const dropsBr = zlib.brotliCompressSync(Buffer.from(dropsJson, "utf-8"), {
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 6 },
  });

  uploadTasks.push(
    { key: "snapshots/overview/" + periodTag + ".json.br", buffer: overviewBr, contentType: "application/json" },
    { key: "snapshots/drops/" + periodTag + ".json.br", buffer: dropsBr, contentType: "application/json" }
  );

  // 5. Upload all snapshot objects to R2 in parallel
  console.log("[rebuild-snapshots] Uploading " + uploadTasks.length + " snapshot objects via S3 API (concurrency: 20)...");
  let uploadedCount = 0;
  await pMap(uploadTasks, async (task) => {
    await s3.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: task.key,
      Body: task.buffer,
      ContentType: task.contentType,
      ContentEncoding: "br",
    }));
    uploadedCount++;
    if (uploadedCount % 50 === 0 || uploadedCount === uploadTasks.length) {
      console.log("[rebuild-snapshots] " + periodTag + ": uploaded " + uploadedCount + "/" + uploadTasks.length + " objects...");
    }
  }, 20);

  console.log("[rebuild-snapshots] Period " + periodTag + " complete! (" + uploadTasks.length + " objects created, 0 latest aliases)");
}

export async function rebuildAllPeriods() {
  const bucketName = process.env["R2_BUCKET"] || "dev-kc-battle-data";
  const s3 = getS3Client();

  console.log("[rebuild-all] Fetching master data...");
  const base = process.env["API_BASE_URL"] || "https://fusou.dev";
  const [shipRes, slotRes] = await Promise.all([
    fetch(base + "/api/master-data/json?table_name=mst_ship"),
    fetch(base + "/api/master-data/json?table_name=mst_slotitem"),
  ]);
  const shipJson = (await shipRes.json()) as any;
  const slotJson = (await slotRes.json()) as any;
  const masterShips = shipJson.records || [];
  const masterSlotItems = slotJson.records || [];
  console.log("[rebuild-all] Loaded " + masterShips.length + " master ships, " + masterSlotItems.length + " master slot items.");

  console.log("[rebuild-all] Querying D1 for all periods with battle records...");
  const d1Raw = execSync(
    "pnpm --filter fusou-web exec wrangler d1 execute dev-kc-battle-index --remote --json --command \"SELECT period_tag, table_version, SUM(record_count) as count FROM block_indexes WHERE table_name = 'battle' GROUP BY period_tag, table_version HAVING SUM(record_count) > 0 ORDER BY period_tag DESC\"",
    { encoding: "utf-8" }
  );
  const parsed = JSON.parse(d1Raw);
  const periods = (parsed[0]?.results || []) as Array<{ period_tag: string; table_version: string; count: number }>;
  console.log("[rebuild-all] Found " + periods.length + " periods with battle data:", periods.map(p => p.period_tag + " (" + p.count + " battles)"));

  for (const p of periods) {
    try {
      await rebuildSnapshotsForPeriod({
        periodTag: p.period_tag,
        tableVersion: p.table_version,
        masterShips,
        masterSlotItems,
        s3,
        bucketName,
      });
    } catch (err: any) {
      console.error("[rebuild-all] Error processing period " + p.period_tag + ":", err);
    }
  }

  console.log("\n========================================================");
  console.log("[rebuild-all] All periods processed successfully!");
  console.log("========================================================\n");
}

if (process.argv[1]?.includes("rebuild-all-snapshots")) {
  rebuildAllPeriods().catch((err) => {
    console.error("[rebuild-all] Fatal error:", err);
    process.exit(1);
  });
}