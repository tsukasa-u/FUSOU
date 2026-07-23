import { Hono } from "hono";
import { promisify } from "node:util";
import { brotliDecompress } from "node:zlib";
import type { Bindings } from "../types";
import { CORS_HEADERS } from "../constants";
import { createEnvContext, getEnv, timingSafeEqual, safeWaitUntil } from "../utils";
import {
  getAllowedPeriodTagSet,
  getLatestMasterPeriodTag,
  validateCachedPeriodTag,
} from "../utils/period-tags";
import { handleTwoStageUpload } from "../utils/upload";
import { validateOffsetMetadata } from "../validators/offsets";
import { decodeAvroOcfToJson } from "../utils/avro-decoder";
import {
  validateAvroOCFSmart,
  extractSchemaFromOCF,
  validateAvroHeader,
} from "../utils/avro-validator";
import { bannerUrl } from "../../features/simulator/equip-calc";

const app = new Hono<{ Bindings: Bindings }>();
const brotliDecompressAsync = promisify(brotliDecompress);

function transformOpeningRaigekiData(raw: any): any {
  if (!raw) return raw;
  const result: any = {};

  // Transform field names from test schema to expected schema
  if (raw.frai_list_items) {
    result.f_rai =
      typeof raw.frai_list_items === "string"
        ? JSON.parse(raw.frai_list_items)
        : raw.frai_list_items;
  }
  if (raw.erai_list_items) {
    result.e_rai =
      typeof raw.erai_list_items === "string"
        ? JSON.parse(raw.erai_list_items)
        : raw.erai_list_items;
  }
  if (raw.friend_damage) {
    result.f_dam =
      typeof raw.friend_damage === "string"
        ? JSON.parse(raw.friend_damage)
        : raw.friend_damage;
  }
  if (raw.enemy_damage) {
    result.e_dam =
      typeof raw.enemy_damage === "string"
        ? JSON.parse(raw.enemy_damage)
        : raw.enemy_damage;
  }

  // Build HP arrays based on damage array length (critical for timeline to know fleet size)
  const fDam = result.f_dam || [];
  const eDam = result.e_dam || [];

  // Create HP arrays with proper length
  result.f_now_hps = Array(fDam.length)
    .fill(null)
    .map((_, i) => 100 + i * 20);
  result.e_now_hps = Array(eDam.length)
    .fill(null)
    .map((_, i) => 100 + i * 20);

  // Add ship class/type values
  result.f_cl = Array(result.f_now_hps.length).fill(2);
  result.e_cl = Array(result.e_now_hps.length).fill(2);

  return result;
}
/**
 * Convert Uint8Array to base64 string (Cloudflare Workers compatible)
 * Uses chunks to avoid O(n²) string concatenation
 */
function arrayBufferToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...Array.from(chunk));
  }
  return btoa(binary);
}

const PUBLIC_RECORD_TABLES = new Set([
  "battle",
  "cells",
  "destruction_battle",
  "env_info",
  "enemy_deck",
  "enemy_ship",
  "enemy_slotitem",
  "own_deck",
  "own_ship",
  "own_slotitem",
  "battle_result",
  "carrierbase_assault",
  "closing_raigeki",
  "hougeki",
  "hougeki_list",
  "midnight_hougeki",
  "midnight_hougeki_list",
  "opening_airattack",
  "opening_airattack_list",
  "opening_raigeki",
  "opening_taisen",
  "opening_taisen_list",
]);

function getBattleDataCacheControl(periodTagParam: string): string {
  return periodTagParam === "latest"
    ? "public, max-age=600, stale-while-revalidate=3600"
    : "public, max-age=3600, stale-while-revalidate=86400";
}

function buildTableVersionSearchParam(tableVersion: string): string {
  const trimmed = tableVersion.trim();
  if (!trimmed) return "";
  return `&table_version=${encodeURIComponent(trimmed)}`;
}

function buildGlobalRecordsPath(options: {
  table: string;
  periodTag: string;
  tableVersion: string;
  limitBlocks: number;
  limitRecords: number;
  filter?: Record<string, unknown>;
  includeSortieKey?: boolean;
}): string {
  const filterJson = options.filter
    ? `&filter_json=${encodeURIComponent(JSON.stringify(options.filter))}`
    : "";
  const includeSortieKey = options.includeSortieKey
    ? "&include_sortie_key=1"
    : "";
  return `/api/battle-data/global/records?table=${encodeURIComponent(options.table)}&period_tag=${encodeURIComponent(options.periodTag)}${buildTableVersionSearchParam(options.tableVersion)}&limit_blocks=${options.limitBlocks}&limit_records=${options.limitRecords}${includeSortieKey}${filterJson}`;
}

function toBattleDataInternalPath(path: string): string {
  if (path.startsWith("/api/battle-data/")) {
    return path.replace(/^\/api\/battle-data/, "");
  }
  if (path === "/api/battle-data") {
    return "/";
  }
  return path;
}

async function fetchBattleDataJsonInternal<T>(c: any, path: string): Promise<T> {
  const normalizedPath = toBattleDataInternalPath(path);
  const targetUrl = new URL(c.req.url);
  targetUrl.pathname = normalizedPath;
  targetUrl.search = "";
  if (normalizedPath.includes("?")) {
    const [pathname, search] = normalizedPath.split("?", 2);
    targetUrl.pathname = pathname || "/";
    targetUrl.search = search ? `?${search}` : "";
  }

  const request = new Request(targetUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  let executionCtx: ExecutionContext | undefined;
  try {
    executionCtx = c.executionCtx as ExecutionContext;
  } catch {
    executionCtx = undefined;
  }
  const response = await app.fetch(request, c.env, executionCtx);
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${targetUrl.pathname}: HTTP ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

async function fetchInternalJson<T>(c: any, path: string): Promise<T> {
  const targetUrl = new URL(c.req.url);
  targetUrl.search = "";
  const normalizedPath = path;
  if (normalizedPath.includes("?")) {
    const [pathname, search] = normalizedPath.split("?", 2);
    targetUrl.pathname = pathname || "/";
    targetUrl.search = search ? `?${search}` : "";
  } else {
    targetUrl.pathname = normalizedPath;
  }

  const response = await fetch(targetUrl.toString(), {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(
      `Failed to fetch ${targetUrl.pathname}: HTTP ${response.status}`,
    );
  }
  return (await response.json()) as T;
}

type MasterDataJsonPayload = {
  table_name: string;
  table_version: string | null;
  period_tag: string | null;
  period_revision: number | null;
  count: number;
  records: Array<Record<string, unknown>>;
};

type BattleEnvBundlePayload = {
  ownDecks: Array<Record<string, unknown>>;
  ownShips: Array<Record<string, unknown>>;
  ownSlotItems: Array<Record<string, unknown>>;
  enemyDecks: Array<Record<string, unknown>>;
  enemyShips: Array<Record<string, unknown>>;
  enemySlotItems: Array<Record<string, unknown>>;
};

async function fetchMasterDataJsonDirect(
  c: any,
  tableName: string,
): Promise<MasterDataJsonPayload> {
  const env = createEnvContext(c);
  const db = env.runtime.MASTER_DATA_INDEX_DB;
  const bucket = env.runtime.MASTER_DATA_BUCKET;
  const kv = env.runtime.DATA_LOADER_CACHE_KV;

  if (!db || !bucket) {
    throw new Error("Master data storage not configured");
  }

  const latestMaster = await getLatestMasterPeriodTag(db, kv);
  const latestPeriodTag = latestMaster?.period_tag;
  if (!latestPeriodTag) {
    return {
      table_name: tableName,
      table_version: null,
      period_tag: null,
      period_revision: null,
      count: 0,
      records: [],
    };
  }

  const row = (await db
    .prepare(
      `SELECT i.period_tag, i.table_version, i.period_revision, t.r2_key
       FROM master_data_tables t
       JOIN master_data_index i ON i.id = t.master_data_id
       WHERE i.upload_status = 'completed' AND t.table_name = ? AND i.period_tag = ?
       ORDER BY i.completed_at DESC, i.period_revision DESC
       LIMIT 1`,
    )
    .bind(tableName, latestPeriodTag)
    .first()) as {
    period_tag: string;
    table_version: string;
    period_revision: number;
    r2_key: string;
  } | null;

  if (!row) {
    return {
      table_name: tableName,
      table_version: null,
      period_tag: latestPeriodTag,
      period_revision: null,
      count: 0,
      records: [],
    };
  }

  const cacheKey = `master-data:json:${tableName}:${row.table_version}:${row.period_tag}:${row.period_revision}`;
  if (kv) {
    try {
      const cachedStr = await kv.get(cacheKey);
      if (cachedStr) {
        const decodedRecords = JSON.parse(cachedStr) as Array<
          Record<string, unknown>
        >;
        return {
          table_name: tableName,
          table_version: row.table_version,
          period_tag: row.period_tag,
          period_revision: row.period_revision,
          count: decodedRecords.length,
          records: decodedRecords,
        };
      }
    } catch (kvErr) {
      console.warn(`[battle-data] master-data KV read failed for ${cacheKey}:`, kvErr);
    }
  }

  const r2Object = await bucket.get(row.r2_key);
  if (!r2Object) {
    return {
      table_name: tableName,
      table_version: row.table_version,
      period_tag: row.period_tag,
      period_revision: row.period_revision,
      count: 0,
      records: [],
    };
  }

  const MAX_AVRO_BYTES = 50 * 1024 * 1024;
  if (r2Object.size > MAX_AVRO_BYTES) {
    throw new Error(`Master data object too large: ${r2Object.size} bytes`);
  }

  const arrayBuffer = await r2Object.arrayBuffer();
  const avroBytes = new Uint8Array(arrayBuffer);
  const decodedRecords = decodeAvroOcfToJson(avroBytes) as Array<
    Record<string, unknown>
  >;

  if (kv) {
    try {
      await kv.put(cacheKey, JSON.stringify(decodedRecords), {
        expirationTtl: 86400 * 30,
      });
    } catch (kvErr) {
      console.warn(`[battle-data] master-data KV write failed for ${cacheKey}:`, kvErr);
    }
  }

  return {
    table_name: tableName,
    table_version: row.table_version,
    period_tag: row.period_tag,
    period_revision: row.period_revision,
    count: decodedRecords.length,
    records: decodedRecords,
  };
}

async function fetchBattleEnvBundleInternal(
  c: any,
  envUuid: string,
  tableVersion: string,
): Promise<BattleEnvBundlePayload> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(
    new URL(
      `/api/battle-data/detail-env?env_uuid=${encodeURIComponent(envUuid)}&table_version=${encodeURIComponent(tableVersion || "")}`,
      c.req.url,
    ).toString(),
    { method: "GET" },
  );

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      return (await cached.json()) as BattleEnvBundlePayload;
    }
  }

  const [ownDecks, ownShips, ownSlotItems, enemyDecks, enemyShips, enemySlotItems] =
    await Promise.all([
      fetchGlobalRecordsInternal(c, {
        table: "own_deck",
        periodTag: "all",
        tableVersion,
        limitBlocks: 120,
        limitRecords: 200,
        filter: { env_uuid: envUuid },
      }),
      fetchGlobalRecordsInternal(c, {
        table: "own_ship",
        periodTag: "all",
        tableVersion,
        limitBlocks: 120,
        limitRecords: 2000,
        filter: { env_uuid: envUuid },
      }),
      fetchGlobalRecordsInternal(c, {
        table: "own_slotitem",
        periodTag: "all",
        tableVersion,
        limitBlocks: 120,
        limitRecords: 4000,
        filter: { env_uuid: envUuid },
      }),
      fetchGlobalRecordsInternal(c, {
        table: "enemy_deck",
        periodTag: "all",
        tableVersion,
        limitBlocks: 120,
        limitRecords: 200,
        filter: { env_uuid: envUuid },
      }),
      fetchGlobalRecordsInternal(c, {
        table: "enemy_ship",
        periodTag: "all",
        tableVersion,
        limitBlocks: 120,
        limitRecords: 2000,
        filter: { env_uuid: envUuid },
      }),
      fetchGlobalRecordsInternal(c, {
        table: "enemy_slotitem",
        periodTag: "all",
        tableVersion,
        limitBlocks: 120,
        limitRecords: 4000,
        filter: { env_uuid: envUuid },
      }),
    ]);

  const payload = {
    ownDecks,
    ownShips,
    ownSlotItems,
    enemyDecks,
    enemyShips,
    enemySlotItems,
  };

  if (cache) {
    const response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=600, stale-while-revalidate=3600",
      },
    });
    await cache.put(cacheKey, response);
  }

  return payload;
}

async function fetchWeaponIconFramesDirect(
  c: any,
): Promise<Record<string, unknown>> {
  const env = createEnvContext(c);
  const bucket = env.runtime.ASSET_SYNC_BUCKET;
  if (!bucket) {
    throw new Error("Asset storage not configured");
  }

  const jsonKey = "assets/kcs2/img/common/common_icon_weapon.json";
  const r2Object = await bucket.get(jsonKey);
  if (!r2Object) {
    throw new Error("Sprite atlas not found");
  }

  const atlasRaw = new Uint8Array(await r2Object.arrayBuffer());
  try {
    return JSON.parse(new TextDecoder().decode(atlasRaw)) as Record<string, unknown>;
  } catch {
    const decompressed = await brotliDecompressAsync(atlasRaw);
    return JSON.parse(decompressed.toString("utf8")) as Record<string, unknown>;
  }
}

async function fetchGlobalRecordsInternal(
  c: any,
  options: {
    table: string;
    periodTag: string;
    tableVersion: string;
    limitBlocks: number;
    limitRecords: number;
    filter?: Record<string, unknown>;
    includeSortieKey?: boolean;
  },
): Promise<Array<Record<string, unknown>>> {
  const payload = await fetchBattleDataJsonInternal<{
    records?: Array<Record<string, unknown>>;
  }>(c, buildGlobalRecordsPath(options));
  return payload.records || [];
}

async function fetchFirstMatchingRecordsByFields(
  c: any,
  table: string,
  value: string,
  fields: string[],
  options: {
    periodTag: string;
    tableVersion: string;
    limitBlocks: number;
    limitRecords: number;
  },
): Promise<Array<Record<string, unknown>>> {
  for (const field of fields) {
    const rows = await fetchGlobalRecordsInternal(c, {
      table,
      periodTag: options.periodTag,
      tableVersion: options.tableVersion,
      limitBlocks: options.limitBlocks,
      limitRecords: options.limitRecords,
      filter: { [field]: value },
    });
    if (rows.length > 0) {
      return rows;
    }
  }
  return [];
}

function toGroupIdsForBattleQuery(rawIds: unknown): string[] {
  if (Array.isArray(rawIds)) {
    return rawIds.filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
  }
  if (typeof rawIds === "string" && rawIds.length > 0) {
    return [rawIds];
  }
  return [];
}

function hpScoreForBattleQuery(
  ships: Array<{ index?: unknown; nowhp?: unknown; maxhp?: unknown }>,
  hpSnapshot: unknown[],
): number {
  if (!ships.length || !Array.isArray(hpSnapshot) || hpSnapshot.length === 0) {
    return Number.MAX_SAFE_INTEGER;
  }

  const sorted = [...ships].sort(
    (a, b) => Number(a.index ?? 0) - Number(b.index ?? 0),
  );
  const len = Math.min(sorted.length, hpSnapshot.length);
  let score = Math.abs(sorted.length - hpSnapshot.length) * 20;
  for (let i = 0; i < len; i++) {
    const nowhp = Number(sorted[i]?.nowhp ?? sorted[i]?.maxhp ?? 0);
    const target = Number(hpSnapshot[i] ?? 0);
    score += Math.abs(nowhp - target);
  }
  return score;
}

function buildEnemySummaryResolver(args: {
  enemyDecks: Array<Record<string, unknown>>;
  enemyShips: Array<Record<string, unknown>>;
  mstShips: Array<Record<string, unknown>>;
}): (deckId?: string | null) => string {
  const deckById = new Map(
    args.enemyDecks.map((deck) => [String(deck.uuid ?? ""), deck]),
  );
  const shipsByGroupId = new Map<string, Array<Record<string, unknown>>>();
  for (const ship of args.enemyShips) {
    const groupId = String(ship.uuid ?? "");
    if (!groupId) continue;
    if (!shipsByGroupId.has(groupId)) shipsByGroupId.set(groupId, []);
    shipsByGroupId.get(groupId)!.push(ship);
  }
  for (const ships of shipsByGroupId.values()) {
    ships.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  }
  const mstNameById = new Map(
    args.mstShips.map((ship) => [Number(ship.id ?? 0), String(ship.name ?? "")]),
  );

  return (deckId?: string | null): string => {
    if (!deckId) return "-";
    const deck = deckById.get(deckId);
    if (!deck?.ship_ids) return `敵艦隊 ${deckId.slice(0, 6)}`;

    const names: string[] = [];
    for (const groupId of toGroupIdsForBattleQuery(deck.ship_ids)) {
      const ships = shipsByGroupId.get(groupId) || [];
      for (const ship of ships) {
        const mstId = Number(ship.mst_ship_id ?? 0);
        if (mstId <= 0) continue;
        names.push(mstNameById.get(mstId) || `艦ID:${mstId}`);
      }
    }

    const uniqueNames = [...new Set(names)];
    if (uniqueNames.length === 0) {
      return `敵艦隊 ${deckId.slice(0, 6)}`;
    }
    const head = uniqueNames.slice(0, 3).join(" / ");
    return uniqueNames.length > 3 ? `${head} +${uniqueNames.length - 3}` : head;
  };
}

function buildBattleSummaries(args: {
  battles: Array<Record<string, unknown>>;
  cells: Array<Record<string, unknown>>;
  battleResults: Array<Record<string, unknown>>;
  openingAirattackLists?: Array<Record<string, unknown>>;
  openingAirattacks?: Array<Record<string, unknown>>;
  mstShips?: Array<Record<string, unknown>>;
  enemyDecks?: Array<Record<string, unknown>>;
  enemyShips?: Array<Record<string, unknown>>;
  includeEnemySummary?: boolean;
  includeOpeningAirAttack?: boolean;
}): Array<Record<string, unknown>> {
  const battleResultByUuid = new Map<string, Record<string, unknown>>();
  for (const record of args.battleResults) {
    const uuid = String(record.uuid ?? "");
    if (!uuid) continue;
    battleResultByUuid.set(uuid, record);
  }

  const mapByBattleUuid = new Map<
    string,
    { maparea_id: number; mapinfo_no: number }
  >();
  for (const cell of args.cells) {
    const battleUuid = String(cell.battles ?? "");
    if (!battleUuid) continue;
    const maparea = Number(cell.maparea_id ?? 0);
    const mapinfo = Number(cell.mapinfo_no ?? 0);
    if (maparea > 0 && mapinfo > 0) {
      mapByBattleUuid.set(battleUuid, {
        maparea_id: maparea,
        mapinfo_no: mapinfo,
      });
    }
  }

  const mstShipNameById = new Map<number, string>();
  for (const ship of args.mstShips || []) {
    const id = Number(ship.id ?? 0);
    if (id <= 0) continue;
    mstShipNameById.set(id, String(ship.name ?? ""));
  }

  const openingAirattackListByUuid = new Map<string, Record<string, unknown>>();
  for (const record of args.openingAirattackLists || []) {
    const uuid = String(record.uuid ?? "");
    if (!uuid) continue;
    openingAirattackListByUuid.set(uuid, record);
  }

  const openingAirattackByUuid = new Map<string, Record<string, unknown>>();
  for (const record of args.openingAirattacks || []) {
    const uuid = String(record.uuid ?? "");
    if (!uuid) continue;
    openingAirattackByUuid.set(uuid, record);
  }

  const enemySummaryOf = args.includeEnemySummary
    ? buildEnemySummaryResolver({
        enemyDecks: args.enemyDecks || [],
        enemyShips: args.enemyShips || [],
        mstShips: args.mstShips || [],
      })
    : () => "-";

  return (args.battles || [])
    .filter((battle) => Number.isFinite(Number(battle.cell_id ?? Number.NaN)))
    .map((battle) => {
      const battleResultUuid = String(battle.battle_result ?? "");
      const rawBattleResult =
        typeof battle.battle_result === "object" && battle.battle_result !== null
          ? (battle.battle_result as Record<string, unknown>)
          : battleResultByUuid.get(battleResultUuid) || null;
      const dropShipId = Number(rawBattleResult?.drop_ship_id ?? 0) || null;
      const normalizedBattleResult = rawBattleResult
        ? {
            ...rawBattleResult,
            drop_ship_name:
              dropShipId != null
                ? mstShipNameById.get(dropShipId) || `艦#${dropShipId}`
                : null,
          }
        : null;

      let normalizedOpeningAirAttack = battle.opening_air_attack;
      if (
        args.includeOpeningAirAttack &&
        typeof normalizedOpeningAirAttack === "string"
      ) {
        const listObj = openingAirattackListByUuid.get(normalizedOpeningAirAttack);
        const detailUuid = String(
          listObj?.opening_air_attack ?? normalizedOpeningAirAttack,
        );
        const detailObj = openingAirattackByUuid.get(detailUuid);
        if (detailObj) {
          normalizedOpeningAirAttack = [detailObj];
        }
      }

      const resolvedMap = battle.uuid
        ? mapByBattleUuid.get(String(battle.uuid))
        : undefined;

      const timestamp = normalizeTimestamp(battle.timestamp) ?? normalizeTimestamp(battle.midnight_timestamp);
      return {
        ...battle,
        ...(resolvedMap || {}),
        timestamp,
        battle_result: normalizedBattleResult,
        enemy_summary: args.includeEnemySummary
          ? enemySummaryOf(String(battle.e_deck_id ?? "") || null)
          : undefined,
        opening_air_attack: normalizedOpeningAirAttack,
      };
    });
}

function resolveFriendlyFleetFromResolvedData(args: {
  battle: Record<string, unknown>;
  ownDecks: Array<Record<string, unknown>>;
  ownShips: Array<Record<string, unknown>>;
  ownSlotItems: Array<Record<string, unknown>>;
  mstShips: Array<Record<string, unknown>>;
  mstSlotItems: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const hpSnapshot = Array.isArray(args.battle.f_nowhps)
    ? (args.battle.f_nowhps as unknown[])
    : Array.isArray(args.battle.midnight_f_nowhps)
      ? (args.battle.midnight_f_nowhps as unknown[])
      : [];
  const mstShipById = new Map(
    args.mstShips.map((ship) => [Number(ship.id ?? 0), ship]),
  );
  const mstSlotItemById = new Map(
    args.mstSlotItems.map((item) => [Number(item.id ?? 0), item]),
  );
  const ownShipsByGroup = new Map<string, Array<Record<string, unknown>>>();
  for (const ship of args.ownShips) {
    const groupId = String(ship.uuid ?? "");
    if (!groupId) continue;
    if (!ownShipsByGroup.has(groupId)) ownShipsByGroup.set(groupId, []);
    ownShipsByGroup.get(groupId)!.push(ship);
  }
  for (const ships of ownShipsByGroup.values()) {
    ships.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  }

  const ownSlotItemsByGroup = new Map<string, Array<Record<string, unknown>>>();
  for (const item of args.ownSlotItems) {
    const groupId = String(item.uuid ?? "");
    if (!groupId) continue;
    if (!ownSlotItemsByGroup.has(groupId)) ownSlotItemsByGroup.set(groupId, []);
    ownSlotItemsByGroup.get(groupId)!.push(item);
  }
  for (const items of ownSlotItemsByGroup.values()) {
    items.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  }

  let bestShips: Array<Record<string, unknown>> = [];
  let bestScore = Number.MAX_SAFE_INTEGER;
  for (const deck of args.ownDecks) {
    for (const groupId of toGroupIdsForBattleQuery(deck.ship_ids)) {
      const ships = ownShipsByGroup.get(groupId) || [];
      const score = hpScoreForBattleQuery(
        ships as Array<{ index?: unknown; nowhp?: unknown; maxhp?: unknown }>,
        hpSnapshot,
      );
      if (score < bestScore) {
        bestScore = score;
        bestShips = ships;
      }
    }
  }
  if (bestShips.length === 0) {
    const fallbackHps = hpSnapshot
      .map((value) => Number(value ?? 0) || 0)
      .filter((hp) => hp > 0);
    return fallbackHps.map((hp, idx) => ({
      name: `味方${idx + 1}番艦`,
      shipId: null,
      level: null,
      nowhp: hp,
      maxhp: hp,
      karyoku: null,
      raisou: null,
      taiku: null,
      soukou: null,
      equipments: [],
    }));
  }

  return [...bestShips]
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((ship) => {
      const shipId = Number(ship.ship_id ?? 0) || null;
      const mstShip = shipId ? mstShipById.get(shipId) : null;
      const slotItems = typeof ship.slot === "string"
        ? ownSlotItemsByGroup.get(ship.slot) || []
        : [];
      return {
        name: shipId
          ? String(mstShip?.name ?? `艦ID:${shipId}`)
          : "味方艦",
        shipId,
        bannerUrl: shipId ? bannerUrl(shipId, { f: "auto" }) : "",
        level: Number(ship.lv ?? 0) || null,
        nowhp: Number(ship.nowhp ?? 0) || 0,
        maxhp: Number(ship.maxhp ?? ship.nowhp ?? 0) || 0,
        karyoku: ship.karyoku ?? null,
        raisou: ship.raisou ?? null,
        taiku: ship.taiku ?? null,
        soukou: ship.soukou ?? null,
        equipments: slotItems
          .filter((row) => Number(row.mst_slotitem_id ?? -1) > 0)
          .map((row) => {
            const slotId = Number(row.mst_slotitem_id ?? 0) || null;
            const mstSlot = slotId ? mstSlotItemById.get(slotId) : null;
            const iconType =
              Array.isArray(mstSlot?.type) && mstSlot.type.length >= 4
                ? Number(mstSlot.type[3] ?? 0) || null
                : null;
            return {
              name: String(mstSlot?.name ?? `装備ID:${slotId}`),
              level: Number(row.level ?? 0) || null,
              iconType,
              slotItemId: slotId,
            };
          }),
      };
    });
}

function resolveEnemyFleetFromResolvedData(args: {
  battle: Record<string, unknown>;
  enemyDecks: Array<Record<string, unknown>>;
  enemyShips: Array<Record<string, unknown>>;
  enemySlotItems: Array<Record<string, unknown>>;
  mstShips: Array<Record<string, unknown>>;
  mstSlotItems: Array<Record<string, unknown>>;
}): Array<Record<string, unknown>> {
  const mstShipById = new Map(
    args.mstShips.map((ship) => [Number(ship.id ?? 0), ship]),
  );
  const mstSlotItemById = new Map(
    args.mstSlotItems.map((item) => [Number(item.id ?? 0), item]),
  );
  const deckById = new Map(
    args.enemyDecks.map((deck) => [String(deck.uuid ?? ""), deck]),
  );
  const shipsByGroup = new Map<string, Array<Record<string, unknown>>>();
  for (const ship of args.enemyShips) {
    const groupId = String(ship.uuid ?? "");
    if (!groupId) continue;
    if (!shipsByGroup.has(groupId)) shipsByGroup.set(groupId, []);
    shipsByGroup.get(groupId)!.push(ship);
  }
  for (const ships of shipsByGroup.values()) {
    ships.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  }
  const slotItemsByGroup = new Map<string, Array<Record<string, unknown>>>();
  for (const item of args.enemySlotItems) {
    const groupId = String(item.uuid ?? "");
    if (!groupId) continue;
    if (!slotItemsByGroup.has(groupId)) slotItemsByGroup.set(groupId, []);
    slotItemsByGroup.get(groupId)!.push(item);
  }
  for (const items of slotItemsByGroup.values()) {
    items.sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0));
  }

  const deckId = String(args.battle.e_deck_id ?? "");
  const deck = deckById.get(deckId);
  if (!deck?.ship_ids) {
    const fallbackHps = (Array.isArray(args.battle.e_nowhps)
      ? args.battle.e_nowhps
      : Array.isArray(args.battle.midnight_e_nowhps)
        ? args.battle.midnight_e_nowhps
        : []) as unknown[];
    return fallbackHps
      .map((value) => Number(value ?? 0) || 0)
      .filter((hp) => hp > 0)
      .map((hp, idx) => ({
        name: `敵${idx + 1}番艦`,
        shipId: null,
        level: null,
        nowhp: hp,
        maxhp: hp,
        karyoku: null,
        raisou: null,
        taiku: null,
        soukou: null,
        equipments: [],
      }));
  }

  const ships: Array<Record<string, unknown>> = [];
  for (const groupId of toGroupIdsForBattleQuery(deck.ship_ids)) {
    ships.push(...(shipsByGroup.get(groupId) || []));
  }

  return ships
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    .map((ship) => {
      const shipId = Number(ship.mst_ship_id ?? 0) || null;
      const mstShip = shipId ? mstShipById.get(shipId) : null;
      const slotItems = typeof ship.slot === "string"
        ? slotItemsByGroup.get(ship.slot) || []
        : [];
      return {
        name: shipId
          ? String(mstShip?.name ?? `敵艦ID:${shipId}`)
          : "敵艦",
        shipId,
        bannerUrl: shipId ? bannerUrl(shipId, { f: "auto" }) : "",
        level: Number(ship.lv ?? 0) || null,
        nowhp: Number(ship.nowhp ?? 0) || 0,
        maxhp: Number(ship.maxhp ?? ship.nowhp ?? 0) || 0,
        karyoku: ship.karyoku ?? null,
        raisou: ship.raisou ?? null,
        taiku: ship.taiku ?? null,
        soukou: ship.soukou ?? null,
        equipments: slotItems
          .filter((row) => Number(row.mst_slotitem_id ?? -1) > 0)
          .map((row) => {
            const slotId = Number(row.mst_slotitem_id ?? 0) || null;
            const mstSlot = slotId ? mstSlotItemById.get(slotId) : null;
            const iconType =
              Array.isArray(mstSlot?.type) && mstSlot.type.length >= 4
                ? Number(mstSlot.type[3] ?? 0) || null
                : null;
            return {
              name: String(mstSlot?.name ?? `装備ID:${slotId}`),
              level: null,
              iconType,
              slotItemId: slotId,
            };
          }),
      };
    });
}

const SORTIE_SPLIT_GAP_MS = 90 * 60 * 1000;
type CompactionTier = "hourly" | "daily" | "weekly" | "period";
const TIER_PRIORITY: CompactionTier[] = ["period", "weekly", "daily", "hourly"];

function parseCompactionTier(value: string | undefined): CompactionTier | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "hourly" ||
    normalized === "daily" ||
    normalized === "weekly" ||
    normalized === "period"
  ) {
    return normalized;
  }
  return null;
}

async function resolveAllowedPeriodTagsForRecords(
  c: { env: Bindings },
  indexDb: D1Database,
  table: string,
  cacheKV?: KVNamespace,
): Promise<Set<string>> {
  try {
    return await getAllowedPeriodTagSet(c, cacheKV);
  } catch (error) {
    console.warn(
      "[battle-data] allow-list fetch failed; falling back to local period tags:",
      error,
    );
  }

  const fallbackRows = (await indexDb
    .prepare(
      "SELECT DISTINCT period_tag FROM block_indexes WHERE table_name = ? ORDER BY period_tag DESC LIMIT 200",
    )
    .bind(table)
    .all()) as { results?: Array<{ period_tag?: string | null }> };

  const fallbackSet = new Set<string>();
  for (const row of fallbackRows.results || []) {
    const periodTag = row?.period_tag;
    if (typeof periodTag !== "string" || !periodTag) continue;
    const validation = await validateCachedPeriodTag(c, periodTag, {
      fieldName: "period_tag",
      cacheKV,
    });
    if (validation.ok) {
      fallbackSet.add(periodTag);
    }
  }

  if (fallbackSet.size > 0) {
    return fallbackSet;
  }

  throw new Error(`Failed to resolve allowed period tags for table ${table}`);
}

function parsePositiveInt(
  value: string | undefined,
  fallbackValue: number,
  max: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallbackValue;
  }
  return Math.min(parsed, max);
}

function normalizeTimestamp(value: unknown): number | null {
  const normalizeEpochMs = (raw: number): number => {
    // Some records store seconds while others store milliseconds.
    return raw < 1_000_000_000_000 ? raw * 1000 : raw;
  };

  if (typeof value === "number" && Number.isFinite(value)) {
    return normalizeEpochMs(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? normalizeEpochMs(parsed) : null;
  }
  return null;
}

function attachSortieIds(records: any[]): void {
  type Item = {
    rec: Record<string, unknown>;
    ts: number | null;
  };

  const sortable: Item[] = records
    .filter(
      (rec): rec is Record<string, unknown> => !!rec && typeof rec === "object",
    )
    .map((rec) => ({
      rec,
      ts:
        normalizeTimestamp(rec.timestamp) ??
        normalizeTimestamp(rec.midnight_timestamp),
    }))
    .sort((a, b) => {
      const aTs = a.ts ?? Number.MAX_SAFE_INTEGER;
      const bTs = b.ts ?? Number.MAX_SAFE_INTEGER;
      return aTs - bTs;
    });

  const byDataset = new Map<
    string,
    { mapKey: string; ts: number | null; sortieNo: number }
  >();

  for (const item of sortable) {
    const datasetId =
      typeof item.rec.dataset_id === "string" && item.rec.dataset_id
        ? item.rec.dataset_id
        : "global";
    const mapArea = Number(item.rec.maparea_id ?? 0) || 0;
    const mapInfo = Number(item.rec.mapinfo_no ?? 0) || 0;
    const mapKey = `${mapArea}-${mapInfo}`;

    const prev = byDataset.get(datasetId);
    let sortieNo = 1;
    if (prev) {
      const sameMap = prev.mapKey === mapKey;
      const withinGap =
        prev.ts != null && item.ts != null
          ? Math.abs(item.ts - prev.ts) <= SORTIE_SPLIT_GAP_MS
          : sameMap;
      sortieNo = sameMap && withinGap ? prev.sortieNo : prev.sortieNo + 1;
    }

    byDataset.set(datasetId, { mapKey, ts: item.ts, sortieNo });
    item.rec.__sortie_id = `${datasetId}:${mapKey}:${sortieNo}`;
  }
}

function matchesRecordFilter(
  record: unknown,
  filterObj: Record<string, unknown>,
): boolean {
  if (!record || typeof record !== "object") {
    return false;
  }
  const rec = record as Record<string, unknown>;
  for (const [key, expected] of Object.entries(filterObj)) {
    const actual = rec[key];

    if (Array.isArray(expected)) {
      if (!expected.includes(actual as never)) {
        return false;
      }
      continue;
    }

    if (expected === null) {
      if (actual !== null && actual !== undefined) {
        return false;
      }
      continue;
    }

    if (typeof expected === "number") {
      const actualNum = Number(actual);
      if (!Number.isFinite(actualNum) || actualNum !== expected) {
        return false;
      }
      continue;
    }

    if (typeof expected === "boolean") {
      if (Boolean(actual) !== expected) {
        return false;
      }
      continue;
    }

    if (String(actual) !== String(expected)) {
      return false;
    }
  }
  return true;
}

async function putCacheSafely(
  c: any,
  cache: Cache,
  cacheKey: Request,
  response: Response,
): Promise<void> {
  const putPromise = cache.put(cacheKey, response.clone());
  safeWaitUntil(c, putPromise);
}

async function decodeIndexedBlock(
  bucket: R2Bucket,
  filePath: string,
  startByte: number,
  length: number,
): Promise<any[]> {
  if (startByte < 0 || length <= 0) {
    return [];
  }

  // Read once and slice in-memory to avoid body re-use issues in local runtimes.
  const sourceObject = await bucket.get(filePath);
  if (!sourceObject?.body) {
    return [];
  }
  const sourceBytes = new Uint8Array(
    await new Response(sourceObject.body).arrayBuffer(),
  );
  const endByte = Math.min(sourceBytes.byteLength, startByte + length);
  if (startByte >= endByte) {
    return [];
  }

  const headerBytes = sourceBytes.subarray(0, startByte);
  const dataBytes = sourceBytes.subarray(startByte, endByte);
  const combined = new Uint8Array(
    headerBytes.byteLength + dataBytes.byteLength,
  );
  combined.set(headerBytes, 0);
  combined.set(dataBytes, headerBytes.byteLength);

  return decodeAvroOcfToJson(combined);
}

// validateAvroHeader is now imported from avro-validator

/**
 * Battle data server-side upload routes
 * - Does NOT upload to R2 (per spec: enqueue-only)
 * - Enqueues Avro slices to COMPACTION_QUEUE
 * - Provides REST APIs for chunk retrieval and latest data access
 */

// OPTIONS (CORS)
app.options(
  "*",
  (_c) => new Response(null, { status: 204, headers: CORS_HEADERS }),
);

/**
 * POST /upload - Real-time battle data upload with automatic compaction triggering
 *
 * Purpose: Accept concatenated Avro data, split by table_offsets, and enqueue slices
 *
 * Process:
 * 1. Split concatenated Avro data by table_offsets
 * 2. Enqueue each table's slice to COMPACTION_QUEUE
 * 3. Return 200 OK immediately (non-blocking)
 * 4. Workflow processes slices asynchronously, appending to per-table Avro files in R2
 *
 * Note: Queuing failures are logged; upload still succeeds if data was received
 */
app.post("/upload", async (c) => {
  const env = createEnvContext(c);
  const bucket = env.runtime.BATTLE_DATA_BUCKET;
  const signingSecret = getEnv(env, "BATTLE_DATA_SIGNING_SECRET");

  if (!bucket || !signingSecret) {
    return c.json(
      { error: "Server misconfiguration: missing R2 bucket or signing secret" },
      500,
    );
  }

  return handleTwoStageUpload(c, {
    bucket,
    signingSecret,
    requireDatasetToken: true,
    preparationValidator: async (body, _user, authContext) => {
      const datasetIdFromToken =
        authContext.datasetToken?.dataset_id?.trim() ?? "";
      const requestedDatasetId =
        typeof body?.dataset_id === "string" ? body.dataset_id.trim() : "";
      if (requestedDatasetId && requestedDatasetId !== datasetIdFromToken) {
        console.warn(`[battle-data] dataset_id mismatch detected`);
        return c.json({ error: "dataset_id does not match token" }, 403);
      }

      const datasetId = datasetIdFromToken || requestedDatasetId;
      const table = typeof body?.table === "string" ? body.table.trim() : "";
      const periodTag =
        typeof body?.kc_period_tag === "string"
          ? body.kc_period_tag.trim()
          : "";
      const tableVersion =
        typeof body?.table_version === "string"
          ? body.table_version.trim()
          : typeof body?.tableVersion === "string"
            ? body.tableVersion.trim()
            : "";
      const declaredSize = parseInt(
        typeof body?.file_size === "string" ? body.file_size : "0",
        10,
      );
      const tableOffsets =
        typeof body?.table_offsets === "string"
          ? body.table_offsets.trim()
          : null;
      const pathTag = typeof body?.path === "string" ? body.path.trim() : null;
      const isBinary = typeof body?.binary === "boolean" ? body.binary : false;

      // Verify that client indicated binary format
      if (!isBinary) {
        console.warn("[battle-data] Rejecting non-binary upload");
        return c.json(
          { error: "binary field must be true for battle data" },
          400,
        );
      }

      if (!pathTag) {
        console.warn("[battle-data] Rejecting upload without path field");
        return c.json({ error: "path is required for battle data" }, 400);
      }

      if (!datasetId) {
        return c.json({ error: "dataset_id could not be resolved" }, 401);
      }
      if (!table) {
        return c.json({ error: "table is required" }, 400);
      }
      if (!periodTag) {
        return c.json({ error: "kc_period_tag is required" }, 400);
      }
      if (!tableVersion) {
        return c.json({ error: "table_version is required" }, 400);
      }
      const periodTagValidation = await validateCachedPeriodTag(c, periodTag, {
        fieldName: "kc_period_tag",
        cacheKV: env.runtime.DATA_LOADER_CACHE_KV,
      });
      if (!periodTagValidation.ok) {
        return c.json(
          { error: periodTagValidation.error },
          periodTagValidation.status,
        );
      }
      if (declaredSize <= 0) {
        return c.json({ error: "file_size must be > 0" }, 400);
      }

      // Get content_hash from body (computed by client)
      const contentHash =
        typeof body?.content_hash === "string" ? body.content_hash.trim() : "";
      if (!contentHash) {
        console.warn("[battle-data] Rejecting upload without content_hash");
        return c.json({ error: "content_hash is required" }, 400);
      }

      // Validate table_offsets if provided
      if (tableOffsets) {
        try {
          console.info(
            `[battle-data] Received table_offsets for ${table}: ${tableOffsets}`,
          );
          const parsed = JSON.parse(tableOffsets);
          console.info(
            `[battle-data] Parsed table_offsets (${parsed.length} tables): ${JSON.stringify(parsed.map((p: any) => p.table_name))}`,
          );
          const { valid, errors } = validateOffsetMetadata(
            parsed,
            declaredSize,
          );
          if (!valid) {
            console.warn(
              `[battle-data] Invalid table_offsets provided; rejecting. Errors: ${errors.join(", ")}`,
            );
            return c.json(
              { error: "Invalid table_offsets", details: errors },
              400,
            );
          }
        } catch (e) {
          console.warn(
            `[battle-data] Failed to parse table_offsets; rejecting. Error: ${String(e)}`,
          );
          return c.json({ error: "Malformed table_offsets JSON" }, 400);
        }
      } else {
        console.info(
          `[battle-data] No table_offsets provided for table '${table}'`,
        );
      }

      return {
        tokenPayload: {
          dataset_id: datasetId,
          table,
          period_tag: periodTag,
          declared_size: declaredSize,
          table_offsets: tableOffsets,
          content_hash: contentHash,
          path_tag: pathTag,
          table_version: tableVersion,
        },
      };
    },
    executionProcessor: async (tokenPayload, data, user) => {
      // Content hash verification
      const expectedContentHash = tokenPayload.content_hash as string;
      if (expectedContentHash) {
        const hashBuffer = await globalThis.crypto.subtle.digest(
          "SHA-256",
          data as unknown as BufferSource,
        );
        const actualHash = Array.from(new Uint8Array(hashBuffer))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (
          !timingSafeEqual(
            actualHash.toLowerCase(),
            expectedContentHash.toLowerCase(),
          )
        ) {
          console.error("[battle-data] Content hash mismatch");
          return c.json(
            { error: "Content hash mismatch - data may be corrupted" },
            400,
          );
        }
      }

      const datasetId = tokenPayload.dataset_id as string;
      const table = tokenPayload.table as string;
      const periodTag = (tokenPayload as any).period_tag as string;
      let tableOffsets = (tokenPayload as any).table_offsets as string | null;
      const tableVersion = (tokenPayload as any).table_version as string;
      const detectedTableVersions = new Set<string>();

      const triggeredAt = new Date().toISOString();

      console.info("[battle-data] Step: About to enqueue to COMPACTION_QUEUE", {
        datasetId,
        table,
        periodTag,
        queueExists: !!env.runtime.COMPACTION_QUEUE,
        timestamp: triggeredAt,
      });

      try {
        if (!env.runtime.COMPACTION_QUEUE) {
          console.warn("[battle-data] COMPACTION_QUEUE binding not available");
          return c.json(
            {
              error: "Server misconfiguration: COMPACTION_QUEUE not available",
            },
            500,
          );
        }

        // Parse table_offsets and split data into per-table Avro slices
        let offsets: any[] = [];
        if (tableOffsets) {
          try {
            offsets = JSON.parse(tableOffsets) as any[];
          } catch (e) {
            console.warn(
              "[battle-data] Failed to parse table_offsets for queue split",
              e,
            );
            offsets = [];
          }
        }

        // Get size limit from env (default 64KB per table slice)
        const maxBytes = env.buildtime.MAX_BATTLE_SLICE_BYTES
          ? parseInt(env.buildtime.MAX_BATTLE_SLICE_BYTES, 10)
          : 65536;

        // Validate each table slice before batching
        // This is strict validation - all tables must pass before any are queued
        const validatedOffsets: any[] = [];
        if (Array.isArray(offsets) && offsets.length) {
          for (const entry of offsets) {
            const start = Number(entry.start_byte ?? 0);
            const len = Number(entry.byte_length ?? 0);
            const tname = String(entry.table_name ?? table);
            if (len <= 0) continue;

            const slice = data.subarray(start, start + len);

            // Lightweight header validation (DoS prevention)
            const headerCheck = validateAvroHeader(slice, maxBytes);
            if (!headerCheck.valid) {
              console.error(
                `[battle-data] Invalid Avro header for ${tname}:`,
                headerCheck.error,
              );
              return c.json(
                { error: `Invalid Avro data: ${headerCheck.error}` },
                400,
              );
            }

            // Extract schema and validate via full decode
            const schemaJson = extractSchemaFromOCF(slice);
            if (!schemaJson) {
              console.error(
                `[battle-data] Failed to extract schema from ${tname}`,
              );
              return c.json(
                { error: "Invalid Avro: schema not found in header" },
                400,
              );
            }

            const decodeResult = await validateAvroOCFSmart(
              slice,
              tableVersion,
            );
            if (!decodeResult.valid) {
              console.error(
                `[battle-data] Decode validation failed for ${tname}:`,
                decodeResult.errorMessage,
              );
              return c.json(
                {
                  error: "Schema validation failed",
                  details: decodeResult.errorMessage,
                },
                400,
              );
            }

            if (!decodeResult.tableVersion) {
              console.error(
                `[battle-data] Missing table_version in Avro header for ${tname}`,
              );
              return c.json(
                { error: "table_version not found in Avro header" },
                400,
              );
            }

            if (decodeResult.tableVersion !== tableVersion) {
              console.error(
                `[battle-data] table_version mismatch for ${tname}: token=${tableVersion}, avro=${decodeResult.tableVersion}`,
              );
              return c.json(
                {
                  error: `table_version mismatch: expected ${tableVersion}, got ${decodeResult.tableVersion}`,
                },
                400,
              );
            }

            detectedTableVersions.add(decodeResult.tableVersion);

            console.info(
              `[battle-data] Validated ${tname}: ${decodeResult.recordCount} records, table_version=${decodeResult.tableVersion}`,
            );
            validatedOffsets.push({
              table_name: tname,
              start_byte: start,
              byte_length: len,
              record_count: decodeResult.recordCount,
            });
          }
        } else {
          // No offsets: treat entire payload as single table slice
          const headerCheck = validateAvroHeader(data, maxBytes);
          if (!headerCheck.valid) {
            console.error(
              "[battle-data] Invalid Avro header:",
              headerCheck.error,
            );
            return c.json(
              { error: `Invalid Avro data: ${headerCheck.error}` },
              400,
            );
          }

          const schemaJson = extractSchemaFromOCF(data);
          if (!schemaJson) {
            console.error(
              "[battle-data] Failed to extract schema from payload",
            );
            return c.json(
              { error: "Invalid Avro: schema not found in header" },
              400,
            );
          }

          const decodeResult = await validateAvroOCFSmart(data, tableVersion);
          if (!decodeResult.valid) {
            console.error(
              "[battle-data] Decode validation failed:",
              decodeResult.errorMessage,
            );
            return c.json(
              {
                error: "Schema validation failed",
                details: decodeResult.errorMessage,
              },
              400,
            );
          }

          if (!decodeResult.tableVersion) {
            console.error("[battle-data] Missing table_version in Avro header");
            return c.json(
              { error: "table_version not found in Avro header" },
              400,
            );
          }

          if (decodeResult.tableVersion !== tableVersion) {
            console.error(
              `[battle-data] table_version mismatch: token=${tableVersion}, avro=${decodeResult.tableVersion}`,
            );
            return c.json(
              {
                error: `table_version mismatch: expected ${tableVersion}, got ${decodeResult.tableVersion}`,
              },
              400,
            );
          }

          detectedTableVersions.add(decodeResult.tableVersion);

          console.info(
            `[battle-data] Validated ${table}: ${decodeResult.recordCount} records, table_version=${decodeResult.tableVersion}`,
          );
          validatedOffsets.push({
            table_name: table,
            start_byte: 0,
            byte_length: data.byteLength,
            record_count: decodeResult.recordCount,
          });
        }

        if (detectedTableVersions.size > 1) {
          return c.json(
            {
              error: "Mixed table_version detected in upload",
              detected_versions: Array.from(detectedTableVersions),
            },
            400,
          );
        }

        // Send a SINGLE queue message with all tables batched
        // This reduces queue message consumption (15 tables = 1 message instead of 15)
        if (validatedOffsets.length) {
          try {
            const b64 = arrayBufferToBase64(data);
            // Note: Queue.send() takes the body directly (not wrapped in { body })
            // sendBatch() takes array of { body } objects
            const messageBody = {
              // Batch metadata
              batched: true,
              datasetId,
              periodTag,
              tableVersion,
              triggeredAt,
              userId: user.id,
              // Full payload (base64 encoded)
              payload_base64: b64,
              // Table offsets for splitting at consumer
              table_offsets: validatedOffsets,
            };

            console.info(
              "[battle-data] Sending 1 batched message to COMPACTION_QUEUE with",
              validatedOffsets.length,
              "tables",
            );
            await env.runtime.COMPACTION_QUEUE.send(messageBody);
            console.info(
              "[battle-data] Successfully enqueued batched message with",
              validatedOffsets.length,
              "tables",
            );
          } catch (sendErr) {
            console.error("[battle-data] FAILED at send", {
              error: String(sendErr),
              tableCount: validatedOffsets.length,
            });
            throw sendErr;
          }
        } else {
          console.warn("[battle-data] No valid tables to enqueue");
        }
      } catch (queueErr) {
        console.error("[battle-data] FAILED to enqueue to COMPACTION_QUEUE", {
          error: String(queueErr),
          stack: String(queueErr),
        });
        return c.json({ error: "Failed to enqueue slices" }, 500);
      }

      return {
        response: {
          ok: true,
          table,
          period_tag: periodTag,
        },
      };
    },
  });
});

/**
 * GET /chunks - Retrieve battle data fragments by period
 * Query params: dataset_id, table, from (ISO8601), to (ISO8601)
 * Response: array of fragment metadata sorted by uploaded_at DESC
 * Cache: 60s max-age, 300s stale-while-revalidate
 */
app.get("/chunks", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;

  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const datasetId = c.req.query("dataset_id");
  const table = c.req.query("table");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const rawLimit = parseInt(c.req.query("limit") || "1000", 10);
  const limit = Math.min(
    Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1000,
    10000,
  );
  const MAX_OFFSET = 100000;
  const rawOffset = parseInt(c.req.query("offset") || "0", 10);
  const offset = Math.min(
    Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0),
    MAX_OFFSET,
  );

  if (!datasetId || !table) {
    return c.json({ error: "dataset_id and table are required" }, 400);
  }

  try {
    const tableVersion = c.req.query("table_version");
    let sql = `SELECT 
           bi.id AS id,
           bi.table_name AS table_name,
           bi.length AS size,
           bi.table_version,
           af.file_path,
           af.created_at,
           bi.start_timestamp,
           bi.end_timestamp,
           bi.record_count
         FROM block_indexes bi
         JOIN archived_files af ON af.id = bi.file_id
         WHERE bi.dataset_id = ? AND bi.table_name = ?`;
    const params: unknown[] = [datasetId, table];

    if (tableVersion) {
      sql += ` AND bi.table_version = ?`;
      params.push(tableVersion);
    }

    // Convert ISO8601 to epoch millis if provided
    const fromMs = from ? Date.parse(from) : undefined;
    const toMs = to ? Date.parse(to) : undefined;
    if (fromMs !== undefined && !Number.isNaN(fromMs)) {
      sql += ` AND bi.start_timestamp >= ?`;
      params.push(fromMs);
    }
    if (toMs !== undefined && !Number.isNaN(toMs)) {
      sql += ` AND bi.end_timestamp <= ?`;
      params.push(toMs);
    }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) {
      throw new Error("D1 returned no results for chunks query");
    }

    const rows = (result.results || []) as any[];
    // Map block_indexes to response format
    const chunks = rows.map((r) => ({
      id: r.id,
      file_path: r.file_path,
      table: r.table_name,
      table_version: r.table_version,
      size: r.size,
      record_count: r.record_count,
      uploaded_at: new Date(r.start_timestamp).toISOString(),
    }));

    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    return c.json({
      chunks,
      count: chunks.length,
      table,
    });
  } catch (err) {
    console.error("[battle_data] Failed to query chunks:", err);
    return c.json({ error: "Failed to retrieve chunks" }, 500);
  }
});

/**
 * GET /latest - Retrieve latest fragment for dataset/table
 * Query params: dataset_id, table
 * Response: latest fragment metadata (by uploaded_at DESC)
 * Cache: 60s max-age, 300s stale-while-revalidate
 */
app.get("/latest", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;

  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const datasetId = c.req.query("dataset_id");
  const table = c.req.query("table");

  if (!datasetId || !table) {
    return c.json({ error: "dataset_id and table are required" }, 400);
  }

  try {
    const tableVersion = c.req.query("table_version");
    let latestSql = `SELECT 
         bi.id,
         bi.table_name AS table_name,
         bi.length AS size,
         bi.table_version,
         af.file_path,
         af.created_at,
         bi.start_timestamp,
         bi.record_count
       FROM block_indexes bi
       JOIN archived_files af ON af.id = bi.file_id
       WHERE bi.dataset_id = ? AND bi.table_name = ?`;
    const latestParams: unknown[] = [datasetId, table];
    if (tableVersion) {
      latestSql += ` AND bi.table_version = ?`;
      latestParams.push(tableVersion);
    }
    latestSql += ` ORDER BY bi.start_timestamp DESC LIMIT 1`;

    const stmt = indexDb.prepare(latestSql);
    const row = await stmt.bind(...latestParams).first?.();

    if (!row) {
      return c.json({ error: "No fragments found" }, 404);
    }

    const latest = {
      id: row.id,
      file_path: row.file_path,
      table: row.table_name,
      table_version: row.table_version,
      size: row.size,
      record_count: row.record_count,
      uploaded_at: new Date(Number(row.start_timestamp || 0)).toISOString(),
    };

    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    return c.json({ latest });
  } catch (err) {
    console.error("[battle_data] Failed to query latest:", err);
    return c.json({ error: "Failed to retrieve latest fragment" }, 500);
  }
});

// GET /health - health check for battle data service
app.get("/health", (c) => {
  return c.json({ status: "ok", service: "battle_data" });
});

/**
 * GET /global/chunks - Retrieve fragments across all users by table/period
 * Query params: table, period_tag, from, to
 * Response: array of fragment metadata sorted by uploaded_at DESC
 */
app.get("/global/chunks", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = c.req.query("table");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const rawLimit = parseInt(c.req.query("limit") || "1000", 10);
  const limit = Math.min(
    Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : 1000,
    10000,
  );
  const MAX_GLOBAL_OFFSET = 100000;
  const rawOffset = parseInt(c.req.query("offset") || "0", 10);
  const offset = Math.min(
    Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0),
    MAX_GLOBAL_OFFSET,
  );

  if (!table) {
    return c.json({ error: "table is required" }, 400);
  }

  try {
    const tableVersion = c.req.query("table_version");
    let sql = `SELECT 
           bi.id,
           bi.table_name AS table_name,
           bi.length AS size,
           bi.table_version,
           af.file_path,
           af.created_at,
           bi.start_timestamp,
           bi.end_timestamp,
           bi.record_count
         FROM block_indexes bi
         JOIN archived_files af ON af.id = bi.file_id
         WHERE bi.table_name = ?`;
    const params: unknown[] = [table];

    if (tableVersion) {
      sql += ` AND bi.table_version = ?`;
      params.push(tableVersion);
    }

    const fromMs = from ? Date.parse(from) : undefined;
    const toMs = to ? Date.parse(to) : undefined;
    if (fromMs !== undefined && !Number.isNaN(fromMs)) {
      sql += ` AND bi.start_timestamp >= ?`;
      params.push(fromMs);
    }
    if (toMs !== undefined && !Number.isNaN(toMs)) {
      sql += ` AND bi.end_timestamp <= ?`;
      params.push(toMs);
    }

    sql += ` ORDER BY bi.start_timestamp DESC LIMIT ? OFFSET ?`;
    params.push(limit, offset);

    const stmt = indexDb.prepare(sql);
    const result = await stmt.bind(...params).all?.();
    if (!result) {
      throw new Error("D1 returned no results for global chunks query");
    }

    const rows = (result.results || []) as any[];
    const chunks = rows.map((r) => ({
      id: r.id,
      file_path: r.file_path,
      table: r.table_name,
      table_version: r.table_version,
      size: r.size,
      record_count: r.record_count,
      uploaded_at: new Date(r.start_timestamp).toISOString(),
    }));
    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    return c.json({ chunks, count: chunks.length, table });
  } catch (err) {
    console.error("[battle_data] Failed to query global chunks:", err);
    return c.json({ error: "Failed to retrieve global chunks" }, 500);
  }
});

/**
 * GET /global/summary - Available period_tag/table_version combinations
 * Query params:
 *   - table: target table name (default: battle)
 */
app.get("/global/summary", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = (c.req.query("table") || "battle").trim();
  if (!PUBLIC_RECORD_TABLES.has(table)) {
    return c.json(
      {
        error: "INVALID_TABLE",
        message: `table must be one of: ${Array.from(PUBLIC_RECORD_TABLES).join(", ")}`,
      },
      400,
    );
  }

  try {
    const allowedPeriodTagSet = await resolveAllowedPeriodTagsForRecords(
      c,
      indexDb,
      table,
      env.runtime.DATA_LOADER_CACHE_KV,
    );

    const summaryRows = (await indexDb
      .prepare(
        "SELECT DISTINCT period_tag, table_version FROM block_indexes WHERE table_name = ? ORDER BY period_tag DESC, table_version DESC LIMIT 500",
      )
      .bind(table)
      .all()) as {
      results?: Array<{
        period_tag?: string | null;
        table_version?: string | null;
      }>;
    };

    const seen = new Set<string>();
    const periods: Array<{ period_tag: string; table_version: string }> = [];
    for (const row of summaryRows.results || []) {
      const periodTag = row?.period_tag;
      const tableVersion = row?.table_version;
      if (typeof periodTag !== "string" || !periodTag) continue;
      if (typeof tableVersion !== "string" || !tableVersion) continue;
      if (!allowedPeriodTagSet.has(periodTag)) continue;
      const key = `${periodTag}\u0000${tableVersion}`;
      if (seen.has(key)) continue;
      seen.add(key);
      periods.push({ period_tag: periodTag, table_version: tableVersion });
    }

    c.res.headers.set(
      "Cache-Control",
      "public, max-age=300, stale-while-revalidate=1800",
    );
    return c.json({
      ok: true,
      table,
      periods,
      latest: periods[0] ?? null,
    });
  } catch (err) {
    console.error("[battle_data] Failed to query global summary:", err);
    return c.json({ error: "Failed to retrieve global summary" }, 500);
  }
});

/**
 * GET /global/records - Decode recent battle-related records for web UI analysis pages
 * Query params:
 *   - table: battle | cells | enemy_deck | enemy_ship
 *   - period_tag: latest | all | specific tag
 *   - table_version: optional table version filter
 *   - dataset_id: optional dataset filter
 *   - limit_blocks: max archived blocks to decode (default 40; when filter_json is set, default 200)
 *   - limit_records: max records in response (default 3000, max 20000)
 */
app.get("/global/records", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;
  const bucket = env.runtime.BATTLE_DATA_BUCKET;

  if (!indexDb || !bucket) {
    return c.json(
      { error: "BATTLE index DB or R2 bucket is not configured" },
      500,
    );
  }

  const table = (c.req.query("table") || "battle").trim();
  const periodTagParam = (c.req.query("period_tag") || "latest").trim();
  const tableVersionParam = (c.req.query("table_version") || "").trim();
  const datasetId = c.req.query("dataset_id")?.trim();
  const tierParamRaw = c.req.query("tier")?.trim();
  const compactionTier = parseCompactionTier(tierParamRaw);
  const windowStartMsRaw = c.req.query("window_start_ms")?.trim();
  const windowEndMsRaw = c.req.query("window_end_ms")?.trim();
  const windowStartMs =
    windowStartMsRaw && Number.isFinite(Number(windowStartMsRaw))
      ? Number(windowStartMsRaw)
      : null;
  const windowEndMs =
    windowEndMsRaw && Number.isFinite(Number(windowEndMsRaw))
      ? Number(windowEndMsRaw)
      : null;
  const includeSortieKeyRaw = (c.req.query("include_sortie_key") || "1")
    .trim()
    .toLowerCase();
  const includeSortieKey = !["0", "false", "off", "no"].includes(
    includeSortieKeyRaw,
  );
  const filterJsonRaw = c.req.query("filter_json")?.trim();
  const hasFilter = Boolean(filterJsonRaw);
  const limitBlocks = parsePositiveInt(
    c.req.query("limit_blocks"),
    hasFilter ? 200 : 40,
    hasFilter ? 600 : 400,
  );
  const limitRecords = parsePositiveInt(
    c.req.query("limit_records"),
    3000,
    20000,
  );
  const cacheControl =
    periodTagParam === "latest"
      ? "public, max-age=600, stale-while-revalidate=3600"
      : "public, max-age=3600, stale-while-revalidate=86400";

  let recordFilter: Record<string, unknown> | null = null;
  if (filterJsonRaw) {
    try {
      const parsed = JSON.parse(filterJsonRaw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return c.json(
          {
            error: "INVALID_FILTER",
            message: "filter_json must be a JSON object",
          },
          400,
        );
      }
      recordFilter = parsed as Record<string, unknown>;
    } catch {
      return c.json(
        { error: "INVALID_FILTER", message: "filter_json must be valid JSON" },
        400,
      );
    }
  }

  if (!PUBLIC_RECORD_TABLES.has(table)) {
    return c.json(
      {
        error: "INVALID_TABLE",
        message: `table must be one of: ${Array.from(PUBLIC_RECORD_TABLES).join(", ")}`,
      },
      400,
    );
  }

  if (tierParamRaw && !compactionTier) {
    return c.json(
      {
        error: "INVALID_TIER",
        message: "tier must be one of: hourly, daily, weekly, period",
      },
      400,
    );
  }

  if (windowStartMsRaw && windowStartMs == null) {
    return c.json(
      {
        error: "INVALID_WINDOW_START",
        message: "window_start_ms must be a valid number",
      },
      400,
    );
  }

  if (windowEndMsRaw && windowEndMs == null) {
    return c.json(
      {
        error: "INVALID_WINDOW_END",
        message: "window_end_ms must be a valid number",
      },
      400,
    );
  }

    if (
      windowStartMs != null &&
      windowEndMs != null &&
      windowStartMs > windowEndMs
    ) {
      return c.json(
        {
          error: "INVALID_WINDOW_RANGE",
          message: "window_start_ms must be less than or equal to window_end_ms",
        },
        400,
      );
    }

  if (periodTagParam !== "latest" && periodTagParam !== "all") {
    const periodTagValidation = await validateCachedPeriodTag(
      c,
      periodTagParam,
      {
        fieldName: "period_tag",
        cacheKV: env.runtime.DATA_LOADER_CACHE_KV,
      },
    );
    if (!periodTagValidation.ok) {
      return c.json(
        {
          error: "INVALID_PERIOD_TAG",
          message: periodTagValidation.error,
        },
        periodTagValidation.status,
      );
    }
  }

  const cache = (globalThis as { caches?: { default?: Cache } }).caches
    ?.default;
  const cacheUrl = new URL(c.req.url);
  if (filterJsonRaw) {
    cacheUrl.searchParams.set("_cache_v", "2");
  }
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-FUSOU-Cache", "HIT");
      return hit;
    }
  }

  const cacheKV = env.runtime.DATA_LOADER_CACHE_KV as KVNamespace | undefined;
  let kvKey: string | null = null;
  if (filterJsonRaw && cacheKV) {
    const hashBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(filterJsonRaw),
    );
    const filterHash = Array.from(new Uint8Array(hashBytes))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);
    kvKey = `battle-data:records:v2:${table}:${periodTagParam}:${tableVersionParam || "_"}:${filterHash}:${limitBlocks}:${limitRecords}`;
    const kvCached = await cacheKV.get(kvKey, "text");
    if (kvCached) {
      return new Response(kvCached, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": cacheControl,
          "X-FUSOU-Cache": "KV-HIT",
        },
      });
    }
  }

  try {
    const allowedPeriodTagSet = await resolveAllowedPeriodTagsForRecords(
      c,
      indexDb,
      table,
      env.runtime.DATA_LOADER_CACHE_KV,
    );

    let resolvedPeriodTag: string | null = null;
    if (periodTagParam === "latest") {
      let latestPeriodSql =
        "SELECT DISTINCT period_tag FROM block_indexes WHERE table_name = ?";
      const latestPeriodParams: unknown[] = [table];
      if (tableVersionParam) {
        latestPeriodSql += " AND table_version = ?";
        latestPeriodParams.push(tableVersionParam);
      }
      latestPeriodSql += " ORDER BY period_tag DESC LIMIT 200";
      const latestRows = (await indexDb
        .prepare(latestPeriodSql)
        .bind(...latestPeriodParams)
        .all()) as { results?: Array<{ period_tag?: string | null }> };
      const latestAllowed = (latestRows.results || []).find((row) => {
        const tag = row?.period_tag ?? null;
        return typeof tag === "string" && allowedPeriodTagSet.has(tag);
      });
      resolvedPeriodTag = latestAllowed?.period_tag ?? null;
    } else if (periodTagParam !== "all") {
      resolvedPeriodTag = periodTagParam;
    }

    const perTierFetchLimit = Math.max(limitBlocks + 1, 200);

    const fetchBlocks = async (tier: CompactionTier | null) => {
      let sql = `SELECT bi.id, bi.dataset_id, bi.start_byte, bi.length, bi.start_timestamp, bi.end_timestamp, bi.period_tag, bi.window_start_ms, bi.window_end_ms, bi.compaction_tier, af.file_path
               FROM block_indexes bi
               JOIN archived_files af ON af.id = bi.file_id
               WHERE bi.table_name = ?`;
      const params: unknown[] = [table];

      if (tableVersionParam) {
        sql += " AND bi.table_version = ?";
        params.push(tableVersionParam);
      }

      if (tier) {
        sql += " AND bi.compaction_tier = ?";
        params.push(tier);
      }

      if (windowStartMs != null) {
        sql += " AND bi.window_start_ms >= ?";
        params.push(windowStartMs);
      }

      if (windowEndMs != null) {
        sql += " AND bi.window_end_ms <= ?";
        params.push(windowEndMs);
      }

      if (resolvedPeriodTag) {
        sql += " AND bi.period_tag = ?";
        params.push(resolvedPeriodTag);
      } else {
        const allowedTags = [...allowedPeriodTagSet];
        if (allowedTags.length === 0) {
          return null;
        }
        const placeholders = allowedTags.map(() => "?").join(", ");
        sql += ` AND bi.period_tag IN (${placeholders})`;
        params.push(...allowedTags);
      }

      if (datasetId) {
        sql += " AND bi.dataset_id = ?";
        params.push(datasetId);
      }

      sql += " ORDER BY bi.start_timestamp DESC LIMIT ?";
      params.push(perTierFetchLimit);

      return await indexDb.prepare(sql).bind(...params).all?.();
    };

    let blockResult: Awaited<ReturnType<typeof fetchBlocks>> | null | undefined;
    let effectiveTier: CompactionTier | null = compactionTier ?? null;

    const mergeTierRows = (
      tierRows: Map<CompactionTier, any[]>,
    ): { rows: any[]; tier: CompactionTier | null } => {
      const accepted: any[] = [];
      const seenBlockIds = new Set<number>();
      let usedTierCount = 0;
      let firstTier: CompactionTier | null = null;

      for (const tier of TIER_PRIORITY) {
        const rows = tierRows.get(tier) ?? [];
        let usedThisTier = false;
        for (const row of rows) {
          const id = Number(row?.id ?? NaN);
          if (!Number.isFinite(id) || seenBlockIds.has(id)) {
            continue;
          }

          accepted.push(row);
          seenBlockIds.add(id);
          usedThisTier = true;
        }

        if (usedThisTier) {
          usedTierCount += 1;
          if (!firstTier) {
            firstTier = tier;
          }
        }
      }

      accepted.sort(
        (a, b) => Number(b?.start_timestamp ?? 0) - Number(a?.start_timestamp ?? 0),
      );

      return {
        rows: accepted,
        tier: usedTierCount > 1 ? null : firstTier,
      };
    };

    if (compactionTier) {
      blockResult = await fetchBlocks(compactionTier);
      effectiveTier = compactionTier;
    } else {
      const tierRows = new Map<CompactionTier, any[]>();
      for (const tier of TIER_PRIORITY) {
        const candidate = await fetchBlocks(tier);
        tierRows.set(tier, (candidate?.results || []) as any[]);
      }

      const merged = mergeTierRows(tierRows);
      effectiveTier = merged.tier;

      if (merged.rows.length > 0) {
        blockResult = { results: merged.rows } as Awaited<
          ReturnType<typeof fetchBlocks>
        >;
      } else {
        blockResult = await fetchBlocks(null);
        effectiveTier = null;
      }
    }

    if (blockResult == null) {
      const payload = {
        success: true,
        table,
        period_tag: periodTagParam,
        table_version: tableVersionParam || null,
        tier: effectiveTier,
        window_start_ms: windowStartMs,
        window_end_ms: windowEndMs,
        count: 0,
        records: [],
        source_blocks: 0,
      };
      const response = c.json(payload);
      response.headers.set("Cache-Control", cacheControl);
      response.headers.set("X-FUSOU-Cache", "MISS");
      if (cache && !(recordFilter && payload.count === 0)) {
        await putCacheSafely(c, cache, cacheKey, response);
      }
      return response;
    }

    const candidateRows = (blockResult?.results || []) as Array<{
      id: number;
      dataset_id: string;
      start_byte: number;
      length: number;
      start_timestamp: number | null;
      end_timestamp: number | null;
      period_tag: string | null;
      window_start_ms: number | null;
      window_end_ms: number | null;
      compaction_tier: CompactionTier | null;
      file_path: string;
    }>;
    const sourceBlocksTruncated = candidateRows.length > limitBlocks;
    const rows = candidateRows.slice(0, limitBlocks);

    // Build a lightweight ETag from the block IDs so conditional requests can
    // skip the expensive R2 decode step entirely.
    const blockEtag =
      rows.length > 0
        ? `"br-${rows.map((r) => r.id).join("-")}-${limitRecords}"`
        : null;

    const ifNoneMatch = c.req.header("If-None-Match");
    if (blockEtag && ifNoneMatch === blockEtag) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: blockEtag,
          "Cache-Control": cacheControl,
          "X-FUSOU-Cache": "NOT-MODIFIED",
        },
      });
    }

    if (rows.length === 0) {
      const payload = {
        success: true,
        table,
        period_tag: resolvedPeriodTag || periodTagParam,
        table_version: tableVersionParam || null,
        tier: effectiveTier,
        window_start_ms: windowStartMs,
        window_end_ms: windowEndMs,
        applied_limit_blocks: limitBlocks,
        applied_limit_records: limitRecords,
        source_blocks_truncated: false,
        records_limit_reached: false,
        count: 0,
        records: [],
        source_blocks: 0,
      };
      const response = c.json(payload);
      response.headers.set("Cache-Control", cacheControl);
      response.headers.set("X-FUSOU-Cache", "MISS");
      if (cache && !(recordFilter && payload.count === 0)) {
        await putCacheSafely(c, cache, cacheKey, response);
      }
      return response;
    }

    const decodedBlocks = await Promise.all(
      rows.map((row) =>
        decodeIndexedBlock(
          bucket,
          row.file_path,
          Number(row.start_byte || 0),
          Number(row.length || 0),
        ).catch((err) => {
          console.warn(
            "[battle-data] failed to decode block in /global/records",
            {
              table,
              blockId: row.id,
              filePath: row.file_path,
              error: String(err),
            },
          );
          return [] as any[];
        }),
      ),
    );

    const decodedRecords: any[] = [];
    let recordsLimitReached = false;
    outer: for (const recs of decodedBlocks) {
      for (const rec of recs) {
        if (recordFilter && !matchesRecordFilter(rec, recordFilter)) {
          continue;
        }
        decodedRecords.push(rec);
        if (decodedRecords.length >= limitRecords) {
          recordsLimitReached = true;
          break outer;
        }
      }
    }

    if (table === "battle" && includeSortieKey) {
      attachSortieIds(decodedRecords);
    }

    const payload = {
      success: true,
      table,
      period_tag: resolvedPeriodTag || periodTagParam,
      table_version: tableVersionParam || null,
      tier: effectiveTier,
      window_start_ms: windowStartMs,
      window_end_ms: windowEndMs,
      applied_limit_blocks: limitBlocks,
      applied_limit_records: limitRecords,
      source_blocks_truncated: sourceBlocksTruncated,
      records_limit_reached: recordsLimitReached,
      count: decodedRecords.length,
      records: decodedRecords,
      source_blocks: rows.length,
    };
    const response = c.json(payload);
    response.headers.set("Cache-Control", cacheControl);
    response.headers.set("X-FUSOU-Cache", "MISS");
    if (blockEtag) {
      response.headers.set("ETag", blockEtag);
    }
    if (cache && !(recordFilter && payload.count === 0)) {
      await putCacheSafely(c, cache, cacheKey, response);
    }
    if (kvKey && cacheKV && payload.count > 0) {
      const kvTtlSeconds = periodTagParam === "latest" ? 3600 : 86400;
      const payloadText = JSON.stringify(payload);
      if (payloadText.length < 20 * 1024 * 1024) {
        safeWaitUntil(
          c,
          cacheKV.put(kvKey, payloadText, { expirationTtl: kvTtlSeconds }),
        );
      }
    }
    return response;
  } catch (err) {
    console.error("[battle-data] Failed to fetch global records:", err);
    return c.json({ error: "Failed to decode records" }, 500);
  }
});

app.get("/global/overview", async (c) => {
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const tableVersion = (c.req.query("table_version") || "").trim();
  const limitBlocks = parsePositiveInt(c.req.query("limit_blocks"), 200, 400);
  const limitRecords = parsePositiveInt(
    c.req.query("limit_records"),
    20000,
    20000,
  );
  const cacheControl = getBattleDataCacheControl(periodTag);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-FUSOU-Cache", "HIT");
      return hit;
    }
  }

  try {
    const [battles, cells, battleResults, mstShipPayload] =
      await Promise.all([
        fetchGlobalRecordsInternal(c, {
          table: "battle",
          periodTag,
          tableVersion,
          limitBlocks,
          limitRecords,
          includeSortieKey: true,
        }),
        fetchGlobalRecordsInternal(c, {
          table: "cells",
          periodTag,
          tableVersion,
          limitBlocks,
          limitRecords,
        }),
        fetchGlobalRecordsInternal(c, {
          table: "battle_result",
          periodTag,
          tableVersion,
          limitBlocks,
          limitRecords,
        }),
        fetchMasterDataJsonDirect(c, "mst_ship"),
      ]);

    const mstShips = mstShipPayload.records || [];

    const payload = {
      success: true,
      period_tag: periodTag,
      table_version: tableVersion || null,
      master_data: {
        period_tag: mstShipPayload.period_tag || null,
        period_revision: mstShipPayload.period_revision ?? null,
        table_version: mstShipPayload.table_version || null,
      },
      battles: buildBattleSummaries({
        battles,
        cells,
        battleResults,
        mstShips,
        includeEnemySummary: false,
        includeOpeningAirAttack: false,
      }),
      cells,
    };

    const response = c.json(payload);
    response.headers.set("Cache-Control", cacheControl);
    response.headers.set("X-FUSOU-Cache", "MISS");
    if (cache) {
      await putCacheSafely(c, cache, cacheKey, response);
    }
    return response;
  } catch (error) {
    console.error("[battle-data] Failed to build overview payload:", error);
    return c.json({ error: "Failed to build overview payload" }, 500);
  }
});

app.get("/global/drops", async (c) => {
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const tableVersion = (c.req.query("table_version") || "").trim();
  const limitBlocks = parsePositiveInt(c.req.query("limit_blocks"), 200, 400);
  const limitRecords = parsePositiveInt(
    c.req.query("limit_records"),
    20000,
    20000,
  );
  const cacheControl = getBattleDataCacheControl(periodTag);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-FUSOU-Cache", "HIT");
      return hit;
    }
  }

  try {
    const [battles, cells, battleResults, mstShipPayload] = await Promise.all([
      fetchGlobalRecordsInternal(c, {
        table: "battle",
        periodTag,
        tableVersion,
        limitBlocks,
        limitRecords,
        includeSortieKey: true,
      }),
      fetchGlobalRecordsInternal(c, {
        table: "cells",
        periodTag,
        tableVersion,
        limitBlocks,
        limitRecords,
      }),
      fetchGlobalRecordsInternal(c, {
        table: "battle_result",
        periodTag,
        tableVersion,
        limitBlocks,
        limitRecords,
      }),
      fetchMasterDataJsonDirect(c, "mst_ship"),
    ]);

    const mstShips = mstShipPayload.records || [];

    const summaries = buildBattleSummaries({
      battles,
      cells,
      battleResults,
      mstShips,
      includeEnemySummary: false,
      includeOpeningAirAttack: false,
    });

    const dropShipIds = new Set<number>();
    for (const battle of summaries) {
      const dropShipId = Number(
        (battle.battle_result as Record<string, unknown> | null)?.drop_ship_id ??
          0,
      );
      if (dropShipId > 0) {
        dropShipIds.add(dropShipId);
      }
    }

    const filteredMstShips = mstShips.filter((ship) =>
      dropShipIds.has(Number(ship.id ?? 0)),
    );

    const payload = {
      success: true,
      period_tag: periodTag,
      table_version: tableVersion || null,
      master_data: {
        period_tag: mstShipPayload.period_tag || null,
        period_revision: mstShipPayload.period_revision ?? null,
        table_version: mstShipPayload.table_version || null,
      },
      battles: summaries,
      mst_ships: filteredMstShips,
    };

    const response = c.json(payload);
    response.headers.set("Cache-Control", cacheControl);
    response.headers.set("X-FUSOU-Cache", "MISS");
    if (cache) {
      await putCacheSafely(c, cache, cacheKey, response);
    }
    return response;
  } catch (error) {
    console.error("[battle-data] Failed to build drops payload:", error);
    return c.json({ error: "Failed to build drops payload" }, 500);
  }
});

app.get("/detail", async (c) => {
  const battleUuid = (c.req.query("battle_uuid") || "").trim();
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const tableVersion = (c.req.query("table_version") || "").trim();
  const cacheControl = getBattleDataCacheControl(periodTag);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });

  if (!battleUuid) {
    return c.json({ error: "battle_uuid is required" }, 400);
  }

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const hit = new Response(cached.body, cached);
      hit.headers.set("X-FUSOU-Cache", "HIT");
      return hit;
    }
  }

  try {
    const fetchBattle = async (tag: string) =>
      fetchGlobalRecordsInternal(c, {
        table: "battle",
        periodTag: tag,
        tableVersion,
        limitBlocks: 120,
        limitRecords: 50,
        filter: { uuid: battleUuid },
      });

    const primaryBattles = await fetchBattle(periodTag);
    const fallbackBattles =
      primaryBattles.length > 0 || periodTag === "all"
        ? primaryBattles
        : await fetchBattle("all");
    const battle = fallbackBattles.find((row) => String(row.uuid ?? "") === battleUuid);

    if (!battle) {
      return c.json({ error: "Battle not found" }, 404);
    }

    const envUuid = String(battle.env_uuid ?? "");
    const battleResultUuid = String(battle.battle_result ?? "");
    const midnightHougekiListUuid = String(battle.midnight_hougeki ?? "");
    const openingTaisenListUuid = String(battle.opening_taisen ?? "");
    const hougekiListUuid = String(battle.hougeki ?? "");
    const openingAirattackListUuid = String(battle.opening_air_attack ?? "");
    const openingRaigekiUuid = String(battle.opening_raigeki ?? "");
    const closingRaigekiUuid = String(battle.closing_raigeki ?? "");
    const [cells, battleResults, envBundle, mstShipPayload, mstSlotItemPayload, weaponIconFramesPayload, midnightHougekiLists, openingTaisenLists, hougekiLists, openingAirattackLists, openingRaigekis, closingRaigekis] =
      await Promise.all([
        fetchGlobalRecordsInternal(c, {
          table: "cells",
          periodTag: "all",
          tableVersion,
          limitBlocks: 120,
          limitRecords: 200,
          filter: { battles: battleUuid },
        }),
        battleResultUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "battle_result",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 50,
              filter: { uuid: battleResultUuid },
            })
          : Promise.resolve([]),
        envUuid
          ? fetchBattleEnvBundleInternal(c, envUuid, tableVersion)
          : Promise.resolve({
              ownDecks: [],
              ownShips: [],
              ownSlotItems: [],
              enemyDecks: [],
              enemyShips: [],
              enemySlotItems: [],
            }),
        fetchMasterDataJsonDirect(c, "mst_ship"),
        fetchMasterDataJsonDirect(c, "mst_slotitem"),
        fetchWeaponIconFramesDirect(c),
        midnightHougekiListUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "midnight_hougeki_list",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: midnightHougekiListUuid },
            })
          : Promise.resolve([]),
        openingTaisenListUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "opening_taisen_list",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: openingTaisenListUuid },
            })
          : Promise.resolve([]),
        hougekiListUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "hougeki_list",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: hougekiListUuid },
            })
          : Promise.resolve([]),
        openingAirattackListUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "opening_airattack_list",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: openingAirattackListUuid },
            })
          : Promise.resolve([]),
        openingRaigekiUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "opening_raigeki",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: openingRaigekiUuid },
            })
          : Promise.resolve([]),
        closingRaigekiUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "closing_raigeki",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: closingRaigekiUuid },
            })
          : Promise.resolve([]),
      ]);

    const ownDecks = envBundle.ownDecks;
    const ownShips = envBundle.ownShips;
    const ownSlotItems = envBundle.ownSlotItems;
    const enemyDecks = envBundle.enemyDecks;
    const enemyShips = envBundle.enemyShips;
    const enemySlotItems = envBundle.enemySlotItems;

    const midnightHougekiDetailUuid = String(
      midnightHougekiLists[0]?.midnight_hougeki ?? "",
    );
    const openingTaisenDetailUuid = String(
      openingTaisenLists[0]?.opening_taisen ?? "",
    );
    const hougekiDetailUuid = String(hougekiLists[0]?.hougeki ?? "");
    const openingAirattackDetailUuid = String(
      openingAirattackLists[0]?.opening_air_attack ?? "",
    );
    const destructionBattleUuid = String(cells[0]?.destruction_battles ?? "");

    const [midnightHougekis, openingTaisens, hougekis, openingAirattacks, destructionBattles] =
      await Promise.all([
        midnightHougekiDetailUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "midnight_hougeki",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: midnightHougekiDetailUuid },
            })
          : Promise.resolve([]),
        openingTaisenDetailUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "opening_taisen",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: openingTaisenDetailUuid },
            })
          : Promise.resolve([]),
        hougekiDetailUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "hougeki",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: hougekiDetailUuid },
            })
          : Promise.resolve([]),
        openingAirattackDetailUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "opening_airattack",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: openingAirattackDetailUuid },
            })
          : Promise.resolve([]),
        destructionBattleUuid
          ? fetchGlobalRecordsInternal(c, {
              table: "destruction_battle",
              periodTag: "all",
              tableVersion,
              limitBlocks: 120,
              limitRecords: 200,
              filter: { uuid: destructionBattleUuid },
            })
          : Promise.resolve([]),
      ]);

    const mstShips = mstShipPayload.records || [];
    const mstSlotItems = mstSlotItemPayload.records || [];

    const mergedBattle = {
      ...battle,
      timestamp:
        normalizeTimestamp(battle.timestamp) ??
        normalizeTimestamp(battle.midnight_timestamp),
      battle_result: battleResults[0] || battle.battle_result || null,
      midnight_hougeki: midnightHougekis.length > 0 ? midnightHougekis : battle.midnight_hougeki,
      opening_taisen: openingTaisens.length > 0 ? openingTaisens : battle.opening_taisen,
      hougeki: hougekis.length > 0 ? hougekis : battle.hougeki,
      opening_air_attack:
        openingAirattacks.length > 0 ? openingAirattacks : battle.opening_air_attack,
      opening_raigeki: openingRaigekis[0] || battle.opening_raigeki,
      closing_raigeki: closingRaigekis[0] || battle.closing_raigeki,
      destruction_battle:
        destructionBattles.length > 0 ? destructionBattles[0] : null,
    };

    const relevantShipIds = new Set<number>();
    const relevantSlotItemIds = new Set<number>();
    for (const row of [...ownShips, ...enemyShips]) {
      const shipId = Number(row.ship_id ?? row.mst_ship_id ?? 0);
      if (shipId > 0) relevantShipIds.add(shipId);
    }
    const dropShipId = Number(battleResults[0]?.drop_ship_id ?? 0);
    if (dropShipId > 0) relevantShipIds.add(dropShipId);
    for (const row of [...ownSlotItems, ...enemySlotItems]) {
      const slotItemId = Number(row.mst_slotitem_id ?? 0);
      if (slotItemId > 0) relevantSlotItemIds.add(slotItemId);
    }

    const payload = {
      success: true,
      period_tag: periodTag,
      table_version: tableVersion || null,
      battle: mergedBattle,
      linked: {
        cells,
        battle_result: battleResults,
        own_deck: ownDecks,
        own_ship: ownShips,
        own_slotitem: ownSlotItems,
        enemy_deck: enemyDecks,
        enemy_ship: enemyShips,
        enemy_slotitem: enemySlotItems,
        midnight_hougeki_list: midnightHougekiLists,
        midnight_hougeki: midnightHougekis,
        opening_taisen_list: openingTaisenLists,
        opening_taisen: openingTaisens,
        hougeki_list: hougekiLists,
        hougeki: hougekis,
        opening_airattack_list: openingAirattackLists,
        opening_airattack: openingAirattacks,
        opening_raigeki: openingRaigekis,
        closing_raigeki: closingRaigekis,
        destruction_battle: destructionBattles,
      },
      refs: {
        mst_ship: mstShips.filter((ship) => relevantShipIds.has(Number(ship.id ?? 0))),
        mst_slotitem: mstSlotItems.filter((item) =>
          relevantSlotItemIds.has(Number(item.id ?? 0)),
        ),
        weapon_icon_frames: weaponIconFramesPayload,
      },
      derived: {
        friendly_fleet: resolveFriendlyFleetFromResolvedData({
          battle: mergedBattle,
          ownDecks,
          ownShips,
          ownSlotItems,
          mstShips,
          mstSlotItems,
        }),
        enemy_fleet: resolveEnemyFleetFromResolvedData({
          battle: mergedBattle,
          enemyDecks,
          enemyShips,
          enemySlotItems,
          mstShips,
          mstSlotItems,
        }),
      },
      source_meta: {
        battle_uuid: battleUuid,
      },
    };

    const response = c.json(payload);
    response.headers.set("Cache-Control", cacheControl);
    response.headers.set("X-FUSOU-Cache", "MISS");
    if (cache) {
      await putCacheSafely(c, cache, cacheKey, response);
    }
    return response;
  } catch (error) {
    console.error("[battle-data] Failed to build detail payload:", error);
    return c.json({ error: "Failed to build detail payload" }, 500);
  }
});

/**
 * GET /global/latest - Latest fragment across all users for table/period
 * Query params: table, period_tag
 */
app.get("/global/latest", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime.BATTLE_INDEX_DB;
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = c.req.query("table");

  if (!table) {
    return c.json({ error: "table is required" }, 400);
  }

  try {
    const tableVersion = c.req.query("table_version");
    let globalLatestSql = `SELECT 
         bi.id,
         bi.table_name AS table_name,
         bi.length AS size,
         bi.table_version,
         af.file_path,
         af.created_at,
         bi.start_timestamp,
         bi.record_count
       FROM block_indexes bi
       JOIN archived_files af ON af.id = bi.file_id
       WHERE bi.table_name = ?`;
    const globalLatestParams: unknown[] = [table];
    if (tableVersion) {
      globalLatestSql += ` AND bi.table_version = ?`;
      globalLatestParams.push(tableVersion);
    }
    globalLatestSql += ` ORDER BY bi.start_timestamp DESC LIMIT 1`;

    const stmt = indexDb.prepare(globalLatestSql);
    const row = await stmt.bind(...globalLatestParams).first?.();
    if (!row) {
      return c.json({ error: "No fragments found" }, 404);
    }

    const latest = {
      id: row.id,
      file_path: row.file_path,
      table: row.table_name,
      table_version: row.table_version,
      size: row.size,
      record_count: row.record_count,
      uploaded_at: new Date(Number(row.start_timestamp || 0)).toISOString(),
    };

    c.res.headers.set(
      "Cache-Control",
      "public, max-age=60, stale-while-revalidate=300",
    );
    return c.json({ latest });
  } catch (err) {
    console.error("[battle_data] Failed to query global latest:", err);
    return c.json({ error: "Failed to retrieve global latest fragment" }, 500);
  }
});

/**
 * DEV ONLY: GET /dev/local-records - Query local D1 tables directly
 * Bypasses R2/block_indexes for testing with synthetic data
 */
app.get("/dev/local-records", async (c) => {
  const env = createEnvContext(c);
  // Guard: when ADMIN_TOKEN is configured (i.e. production), require it.
  // In local dev (no ADMIN_TOKEN set) the endpoint is open for easier iteration.
  const adminTokenEnv = getEnv(env, "ADMIN_TOKEN");
  if (adminTokenEnv) {
    const provided = c.req.header("X-Admin-Token") ?? "";
    if (!timingSafeEqual(provided, adminTokenEnv)) {
      return c.json({ error: "Unauthorized" }, 401);
    }
  }
  const indexDb = env.runtime.BATTLE_INDEX_DB;

  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const battleId = c.req.query("uuid");
  const rawField = (c.req.query("field") || "").trim();
  const rawValue = (c.req.query("value") || battleId || "").trim();

  const table = (c.req.query("table") || "battle").trim();

  if (!battleId) {
    return c.json({ error: "uuid is required" }, 400);
  }

  try {
    const safeField = /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(rawField) ? rawField : "";
    const safeValue = rawValue || battleId;
    const tableAllowlist = new Set([
      "battle",
      "battle_result",
      "cells",
      "env_info",
      "enemy_deck",
      "enemy_ship",
      "enemy_slotitem",
      "own_deck",
      "own_ship",
      "own_slotitem",
      "carrierbase_assault",
      "closing_raigeki",
      "hougeki",
      "hougeki_list",
      "midnight_hougeki",
      "midnight_hougeki_list",
      "opening_airattack",
      "opening_airattack_list",
      "opening_raigeki",
      "opening_taisen",
      "opening_taisen_list",
    ]);

    if (!tableAllowlist.has(table)) {
      return c.json({ error: `unsupported table: ${table}` }, 400);
    }

    let records: any[] = [];

    if (table === "battle") {
      const battleResult = (await indexDb
        .prepare(`SELECT * FROM battle WHERE uuid = ?`)
        .bind(battleId)
        .all?.()) as { results: any[] };

      const openingRaigekiResult = (await indexDb
        .prepare(`SELECT * FROM opening_raigeki WHERE battle_id = ?`)
        .bind(battleId)
        .all?.()) as { results: any[] };

      const ownShipResult = (await indexDb
        .prepare(`SELECT * FROM own_ship WHERE battle_id = ?`)
        .bind(battleId)
        .all?.()) as { results: any[] };

      const enemyShipResult = (await indexDb
        .prepare(`SELECT * FROM enemy_ship WHERE battle_id = ?`)
        .bind(battleId)
        .all?.()) as { results: any[] };

      records = battleResult.results || [];
      if (records.length > 0 && openingRaigekiResult.results?.length) {
        records[0].opening_raigeki = transformOpeningRaigekiData(
          openingRaigekiResult.results[0],
        );
      }
      if (records.length > 0 && ownShipResult.results?.length) {
        records[0].own_ship = ownShipResult.results;
      }
      if (records.length > 0 && enemyShipResult.results?.length) {
        records[0].enemy_ship = enemyShipResult.results;
      }
      // DEV: Inject synthetic hougeki (shelling) data for test UUID
      if (records.length > 0 && battleId === "test-multi-attacker-001") {
        // 1番艦(idx0)→敵6番(idx5)単発、2番艦(idx1)と3番艦(idx2)→同じ敵5番(idx4)連撃
        // 友軍HP: 全ターン変化なし(被弾なし)
        const fH = [100, 120, 110, 90, 80, 70];
        // 敵HP: ターンごとに減少
        const eH0 = [100, 120, 110, 90, 200, 130]; // 開始前
        const eH1 = [100, 120, 110, 90, 200, 102]; // 1番艦→敵6番 (-28後)
        const eH2 = [100, 120, 110, 90, 165, 102]; // 2番艦→敵5番1/2 (-35後)
        const eH3 = [100, 120, 110, 90, 143, 102]; // 2番艦→敵5番2/2 (-22後)
        const eH4 = [100, 120, 110, 90, 125, 102]; // 3番艦→敵5番1/2 (-18後)
        records[0].hougeki = {
          at_list: [0, 1, 1, 2, 2],
          df_list: [[5], [4], [4], [4], [4]],
          damage: [[28], [35], [22], [18], [31]],
          cl_list: [[1], [2], [1], [1], [2]],
          at_eflag: [0, 0, 0, 0, 0],
          si_list: [[-1], [-1], [-1], [-1], [-1]],
          protect_flag: [[0], [0], [0], [0], [0]],
          f_now_hps: [fH, fH, fH, fH, fH],
          e_now_hps: [eH0, eH1, eH2, eH3, eH4],
        };
      }
    } else if (safeField && safeValue) {
      const result = (await indexDb
        .prepare(`SELECT * FROM ${table} WHERE ${safeField} = ?`)
        .bind(safeValue)
        .all?.()) as { results: any[] };
      records = result.results || [];
    } else {
      const result = (await indexDb
        .prepare(
          `SELECT * FROM ${table} WHERE uuid = ? OR battle_id = ? OR id = ?`,
        )
        .bind(safeValue, safeValue, safeValue)
        .all?.()) as { results: any[] };
      records = result.results || [];
    }

    if (table === "opening_raigeki") {
      records = (records || []).map((r) => transformOpeningRaigekiData(r));
    }

    const payload = {
      success: true,
      table,
      count: records.length,
      records: records,
      source: "dev-local-d1",
    };

    return c.json(payload);
  } catch (err) {
    const msg = String((err as any)?.message || err || "");
    if (msg.includes("no such table") || msg.includes("no such column")) {
      // During partial/local seeding, some optional tables may be absent.
      // Some tables also do not have every fallback key column (uuid/battle_id/id).
      return c.json(
        { success: true, table, count: 0, records: [], source: "dev-local-d1" },
        200,
      );
    }
    console.error("[battle-data] DEV: Failed to query local records:", err);
    return c.json({ error: "Failed to query local records" }, 500);
  }
});

export default app;
