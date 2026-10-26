
function isPlainJsonBuffer(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length && i < 100; i++) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) continue;
    return b === 0x7b || b === 0x5b; // '{' or '['
  }
  return false;
}

async function decompressSnapshotPayload(arrayBuf: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(arrayBuf);
  if (isPlainJsonBuffer(bytes)) {
    return new TextDecoder("utf-8").decode(bytes);
  }
  const buf = Buffer.from(arrayBuf);
  try {
    const decompressed = await brotliDecompressAsync(buf);
    return decompressed.toString("utf-8");
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

async function buildSnapshotResponse(
  _c: Context,
  arrayBuf: ArrayBuffer,
  cacheControl: string,
  etag?: string | null,
): Promise<Response> {
  const headers = new Headers();
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", cacheControl);
  headers.set("X-FUSOU-Cache", "SNAPSHOT-HIT");
  headers.set("X-FUSOU-Data-Source", "R2-SNAPSHOT");
  if (etag) {
    headers.set("ETag", etag);
  }

  const buf = Buffer.from(arrayBuf);
  let payloadText: string;
  try {
    const decomp = await brotliDecompressAsync(buf);
    payloadText = decomp.toString("utf-8");
  } catch {
    payloadText = buf.toString("utf-8");
  }

  // Always return plain JSON text so Cloudflare Edge Proxy applies compression (br/gzip)
  // transparently and once, preventing double-compression and binary corruptions.
  return new Response(payloadText, { headers });
}

const KNOWN_PERIOD_TAGS = ["2026-10-14", "2026-09-10", "2026-08-05", "2026-07-08"];

export function inferPeriodTagFromTimestamp(ts: number): string {
  // Direct instant mapping based on official event / maintenance boundaries
  if (ts >= 1791936000000) return "2026-10-14";
  if (ts >= 1788998400000) return "2026-09-10";
  if (ts >= 1785888000000) return "2026-08-05";
  return "2026-07-08";
}

async function resolveSnapshotPeriodTag(
  db: D1Database | undefined,
  requestedTag: string,
  envUuid?: string,
): Promise<string> {
  const tag = (requestedTag || "").trim();
  if (tag && tag !== "latest" && tag !== "all" && /^\d{4}-\d{2}-\d{2}$/.test(tag)) {
    return tag;
  }

  if (envUuid) {
    const ts = extractTimestampFromUuidV7(envUuid);
    if (ts !== null) {
      // Instant calculation from UUID v7 timestamp without slow D1 queries (0ms)
      return inferPeriodTagFromTimestamp(ts);
    }
  }

  if (tag && tag !== "latest" && tag !== "all") {
    return tag;
  }

  // Pure deterministic R2 snapshot default: eliminate all D1 block_indexes queries
  return KNOWN_PERIOD_TAGS[0] ?? "2026-10-14";
}

import { Hono, type Context } from "hono";
import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";
import { promisify } from "node:util";
import { brotliDecompress, brotliCompress } from "node:zlib";
import type { Bindings } from "../types";
import { CORS_HEADERS, MAX_UPLOAD_BYTES } from "../constants";
import { createEnvContext, getEnv, timingSafeEqual, safeWaitUntil } from "../utils";
import {
  getAllowedPeriodTagSet,
  getLatestMasterPeriodTag,
  validateCachedPeriodTag,
} from "../utils/period-tags";
import { handleTwoStageUpload } from "../utils/upload";
import {
  parseOffsetMetadata,
  validateOffsetMetadata,
  type TableOffsetMetadata,
} from "../validators/offsets";
import {
  decodeAvroDataBlocksWithContext,
  decodeAvroOcfToJson,
  prepareAvroDecoderContext,
  type AvroJsonRecord,
  type PreparedAvroDecoderContext,
} from "../utils/avro-decoder";
import { parseOcfHeader } from "../../features/avro/ocf-header";
import {
  validateAvroOCFSmart,
  extractSchemaFromOCF,
  validateAvroHeader,
} from "../utils/avro-validator";
import { buildBattleOverviewPayload } from "../../features/battles/resolvers/overview";
import { buildBattleDropsPayload } from "../../features/battles/resolvers/drops";
import { resolveBattleDetail } from "../../features/battles/resolvers/detail";
import { compareTableVersions } from "../../features/battles/helpers";
import {
  BattleMasterDataRowSchema,
  parseBattleBlockRows,
  parseBattleChunkRows,
  parseBattleJsonRecords,
  BattlePeriodTagRowsSchema,
  BattleSummaryRowsSchema,
  type BattleBlockRow,
} from "../schemas/battle-data";
import { BattleDataTokenPayloadSchema } from "../schemas/tokens";

const app = new Hono<{ Bindings: Bindings }>();
const brotliDecompressAsync = promisify(brotliDecompress);
const brotliCompressAsync = promisify(brotliCompress);

type BattleRecord = Record<string, unknown>;
type ValidatedTableOffset = Omit<TableOffsetMetadata, "format"> & {
  record_count: number;
};

function transformOpeningRaigekiData(raw: BattleRecord): BattleRecord {
  const result: BattleRecord = {};
  if (raw["frai_list_items"]) {
    result["f_rai"] =
      typeof raw["frai_list_items"] === "string"
        ? JSON.parse(raw["frai_list_items"])
        : raw["frai_list_items"];
  }
  if (raw["erai_list_items"]) {
    result["e_rai"] =
      typeof raw["erai_list_items"] === "string"
        ? JSON.parse(raw["erai_list_items"])
        : raw["erai_list_items"];
  }
  if (raw["friend_damage"]) {
    result["f_dam"] =
      typeof raw["friend_damage"] === "string"
        ? JSON.parse(raw["friend_damage"])
        : raw["friend_damage"];
  }
  if (raw["enemy_damage"]) {
    result["e_dam"] =
      typeof raw["enemy_damage"] === "string"
        ? JSON.parse(raw["enemy_damage"])
        : raw["enemy_damage"];
  }
  return result;
}

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
  "battle", "cells", "destruction_battle", "env_info", "enemy_deck",
  "enemy_ship", "enemy_slotitem", "own_deck", "own_ship", "own_slotitem",
  "battle_result", "carrierbase_assault", "closing_raigeki", "hougeki",
  "hougeki_list", "midnight_hougeki", "midnight_hougeki_list",
  "opening_airattack", "opening_airattack_list", "opening_raigeki",
  "opening_taisen", "opening_taisen_list", "airbase", "plane_info",
  "friend_slotitem", "friend_ship", "support_deck", "friend_deck",
  "airbase_airattack", "airbase_airattack_list", "airbase_assult",
  "friendly_support_hourai", "friendly_support_hourai_list",
  "night_support_hourai", "night_support_airattack", "support_airattack",
  "support_hourai",
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
  datasetId?: string;
  limitBlocks: number;
  limitRecords: number;
  filter?: Record<string, unknown>;
  includeSortieKey?: boolean;
  fromTimestampMs?: number;
  toTimestampMs?: number;
}): string {
  const datasetId = options.datasetId?.trim();
  const datasetIdParam = datasetId
    ? `&dataset_id=${encodeURIComponent(datasetId)}`
    : "";
  const filterJson = options.filter
    ? `&filter_json=${encodeURIComponent(JSON.stringify(options.filter))}`
    : "";
  const includeSortieKey = options.includeSortieKey
    ? "&include_sortie_key=1"
    : "";
  const fromTsParam =
    options.fromTimestampMs != null && Number.isFinite(options.fromTimestampMs)
      ? `&from_timestamp_ms=${Math.trunc(options.fromTimestampMs)}`
      : "";
  const toTsParam =
    options.toTimestampMs != null && Number.isFinite(options.toTimestampMs)
      ? `&to_timestamp_ms=${Math.trunc(options.toTimestampMs)}`
      : "";
  return `/api/battle-data/global/records?table=${encodeURIComponent(options.table)}&period_tag=${encodeURIComponent(options.periodTag)}${buildTableVersionSearchParam(options.tableVersion)}${datasetIdParam}&limit_blocks=${options.limitBlocks}&limit_records=${options.limitRecords}${includeSortieKey}${fromTsParam}${toTsParam}${filterJson}`;
}

function toBattleDataInternalPath(path: string): string {
  if (path.startsWith("/api/battle-data/")) {
    return path.replace(/^\/api\/battle-data/, "");
  }
  if (path === "/api/battle-data") return "/";
  return path;
}

async function fetchBattleDataJsonInternal(
  c: Context<{ Bindings: Bindings }>,
  path: string,
): Promise<unknown> {
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
    throw new Error(`Failed to fetch ${targetUrl.pathname}: HTTP ${response.status}`);
  }
  const payload: unknown = await response.json();
  return payload;
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

function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseJsonRecords(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const records: Array<Record<string, unknown>> = [];
  for (const item of value) {
    if (!isJsonRecord(item)) return null;
    records.push(item);
  }
  return records;
}

type BattleRecordsPayload = {
  records?: Array<Record<string, unknown>>;
  period_tag?: string;
  table_version?: string | null;
  matched_min_start_timestamp_ms?: number | null;
  matched_max_end_timestamp_ms?: number | null;
};

function parseRecordsPayload(value: unknown): BattleRecordsPayload | null {
  if (!isJsonRecord(value)) return null;
  if (!("records" in value)) return {};
  const records = parseJsonRecords(value["records"]);
  if (!records) return null;
  const matchedMin = value["matched_min_start_timestamp_ms"];
  const matchedMax = value["matched_max_end_timestamp_ms"];
  return {
    records,
    ...(typeof value["period_tag"] === "string"
      ? { period_tag: value["period_tag"] }
      : {}),
    ...(typeof value["table_version"] === "string" || value["table_version"] === null
      ? { table_version: value["table_version"] }
      : {}),
    ...(typeof matchedMin === "number" && Number.isFinite(matchedMin)
      ? { matched_min_start_timestamp_ms: matchedMin }
      : {}),
    ...(typeof matchedMax === "number" && Number.isFinite(matchedMax)
      ? { matched_max_end_timestamp_ms: matchedMax }
      : {}),
  };
}

function parseBattleEnvBundlePayload(
  value: unknown,
): BattleEnvBundlePayload | null {
  if (!isJsonRecord(value)) return null;
  const payload: BattleEnvBundlePayload = {
    ownDecks: [],
    ownShips: [],
    ownSlotItems: [],
    enemyDecks: [],
    enemyShips: [],
    enemySlotItems: [],
  };
  for (const key of [
    "ownDecks",
    "ownShips",
    "ownSlotItems",
    "enemyDecks",
    "enemyShips",
    "enemySlotItems",
  ] as const) {
    const records = parseJsonRecords(value[key]);
    if (!records) return null;
    payload[key] = records;
  }
  return payload;
}

function parseJsonObjectText(text: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(text);
  if (!isJsonRecord(parsed)) throw new Error("Expected JSON object");
  return parsed;
}

const MASTER_DATA_MEM_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour memory TTL
const masterDataGlobalPayloadCache = new Map<
  string,
  { expiresAt: number; promise: Promise<MasterDataJsonPayload> }
>();
const masterDataImmutableRecordsCache = new Map<
  string,
  Array<Record<string, unknown>>
>();

async function fetchMasterDataJsonDirect(
  c: Context<{ Bindings: Bindings }>,
  tableName: string,
  periodTagParam?: string,
): Promise<MasterDataJsonPayload> {
  const env = createEnvContext(c);
  const bucket = env.runtime["MASTER_DATA_BUCKET"];
  if (!bucket) throw new Error("Master data storage not configured");

  const targetTag = periodTagParam && periodTagParam !== "latest" && periodTagParam !== "all"
    ? periodTagParam
    : "2026-10-14";

  const cacheKey = `${tableName}:${targetTag}`;
  const now = Date.now();
  const cachedEntry = masterDataGlobalPayloadCache.get(cacheKey);
  if (cachedEntry && cachedEntry.expiresAt > now) {
    return cachedEntry.promise;
  }

  const loadPromise = (async (): Promise<MasterDataJsonPayload> => {
    const candidateR2Keys = [
      `master_data/0.6.0/${targetTag}/rev1/${tableName}.avro`,
      `master_data/1.0/${targetTag}/rev1/${tableName}.avro`,
      `master_data/0.5.0/${targetTag}/rev1/${tableName}.avro`,
      `master_data/0.6.0/2026-10-14/rev1/${tableName}.avro`,
    ];

    let r2Object: Awaited<ReturnType<R2Bucket["get"]>> = null;
    for (const key of candidateR2Keys) {
      const obj = await bucket.get(key);
      if (obj) {
        r2Object = obj;
        break;
      }
    }

    let rowVersion: string | null = "0.6.0";
    let rowPeriodTag: string | null = targetTag;
    let rowRevision: number | null = 1;

    if (!r2Object) {
      const db = env.runtime["MASTER_DATA_INDEX_DB"];
      if (db) {
        try {
          const activePeriodTag = targetTag;
          const rowResult = await db
            .prepare(
              `SELECT i.period_tag, i.table_version, i.period_revision, t.r2_key
               FROM master_data_tables t
               JOIN master_data_index i ON i.id = t.master_data_id
               WHERE i.upload_status = 'completed' AND t.table_name = ? AND i.period_tag = ?
               ORDER BY i.completed_at DESC, i.period_revision DESC
               LIMIT 1`,
            )
            .bind(tableName, activePeriodTag)
            .first();

          if (rowResult) {
            const parsedRow = BattleMasterDataRowSchema.safeParse(rowResult);
            if (parsedRow.success) {
              rowVersion = parsedRow.data.table_version;
              rowPeriodTag = parsedRow.data.period_tag;
              rowRevision = parsedRow.data.period_revision;
              r2Object = await bucket.get(parsedRow.data.r2_key);
            }
          }
        } catch {
          // Fall through
        }
      }
    }

    if (!r2Object) {
      return {
        table_name: tableName,
        table_version: rowVersion,
        period_tag: rowPeriodTag,
        period_revision: rowRevision,
        count: 0,
        records: [],
      };
    }

    const MAX_AVRO_BYTES = 50 * 1024 * 1024;
    if (r2Object.size > MAX_AVRO_BYTES) {
      throw new Error(`Master data object too large: ${r2Object.size} bytes`);
    }

    const avroBytes = new Uint8Array(await r2Object.arrayBuffer());
    let decodedRecords: BattleRecord[] | null = null;
    if (isPlainJsonBuffer(avroBytes)) {
      decodedRecords = parseBattleJsonRecords(JSON.parse(new TextDecoder("utf-8").decode(avroBytes)));
    } else {
      decodedRecords = parseBattleJsonRecords(
        decodeAvroOcfToJson(avroBytes),
      );
    }
    if (!decodedRecords) {
      throw new Error("Decoded master data payload is not a record array");
    }

    return {
      table_name: tableName,
      table_version: rowVersion,
      period_tag: rowPeriodTag,
      period_revision: rowRevision,
      count: decodedRecords.length,
      records: decodedRecords,
    };
  })();

  masterDataGlobalPayloadCache.set(cacheKey, {
    expiresAt: now + MASTER_DATA_MEM_CACHE_TTL_MS,
    promise: loadPromise,
  });

  try {
    return await loadPromise;
  } catch (err) {
    masterDataGlobalPayloadCache.delete(cacheKey);
    throw err;
  }
}

async function fetchBattleEnvBundleInternal(
  c: Context<{ Bindings: Bindings }>,
  envUuid: string,
  tableVersion: string,
  periodTag: string,
  datasetId?: string,
  timeWindow?: { fromTimestampMs?: number; toTimestampMs?: number },
): Promise<BattleEnvBundlePayload> {
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const normalizedDatasetId = datasetId?.trim() || "";
  const cacheKey = new Request(
    new URL(
      `/api/battle-data/detail-env?env_uuid=${encodeURIComponent(envUuid)}&period_tag=${encodeURIComponent(periodTag)}&table_version=${encodeURIComponent(tableVersion || "")}&dataset_id=${encodeURIComponent(normalizedDatasetId)}`,
      c.req.url,
    ).toString(),
    { method: "GET" },
  );

  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const payload = parseBattleEnvBundlePayload(await cached.json());
      if (payload) return payload;
    }
  }

  const baseScope = {
    periodTag,
    tableVersion,
    ...(normalizedDatasetId ? { datasetId: normalizedDatasetId } : {}),
  };

  const runBundleFetch = async (windowScope: {
    fromTimestampMs?: number;
    toTimestampMs?: number;
  }) => {
    const scope = { ...baseScope, ...windowScope };
    const [
      ownDecksPayload,
      ownShipsPayload,
      ownSlotItemsPayload,
      enemyDecksPayload,
      enemyShipsPayload,
      enemySlotItemsPayload,
    ] = await queryGlobalRecordsDirectBatch(c, [
      {
        table: "own_deck",
        ...scope,
        limitBlocks: 120,
        limitRecords: 200,
        filter: { env_uuid: envUuid },
      },
      {
        table: "own_ship",
        ...scope,
        limitBlocks: 120,
        limitRecords: 2000,
        filter: { env_uuid: envUuid },
      },
      {
        table: "own_slotitem",
        ...scope,
        limitBlocks: 120,
        limitRecords: 4000,
        filter: { env_uuid: envUuid },
      },
      {
        table: "enemy_deck",
        ...scope,
        limitBlocks: 120,
        limitRecords: 200,
        filter: { env_uuid: envUuid },
      },
      {
        table: "enemy_ship",
        ...scope,
        limitBlocks: 120,
        limitRecords: 2000,
        filter: { env_uuid: envUuid },
      },
      {
        table: "enemy_slotitem",
        ...scope,
        limitBlocks: 120,
        limitRecords: 4000,
        filter: { env_uuid: envUuid },
      },
    ]);
    const ownDecks = ownDecksPayload?.records || [];
    const ownShips = ownShipsPayload?.records || [];
    const ownSlotItems = ownSlotItemsPayload?.records || [];
    const enemyDecks = enemyDecksPayload?.records || [];
    const enemyShips = enemyShipsPayload?.records || [];
    const enemySlotItems = enemySlotItemsPayload?.records || [];
    return {
      ownDecks,
      ownShips,
      ownSlotItems,
      enemyDecks,
      enemyShips,
      enemySlotItems,
    };
  };

  const hasTimeWindow =
    timeWindow?.fromTimestampMs !== undefined ||
    timeWindow?.toTimestampMs !== undefined;
  let payload = await runBundleFetch(timeWindow ?? {});
  if (
    hasTimeWindow &&
    payload.ownDecks.length === 0 &&
    payload.enemyDecks.length === 0
  ) {
    payload = await runBundleFetch({});
  }

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

const WEAPON_ICON_CACHE_TTL_MS = 10 * 60 * 1000;
const weaponIconBucketCache = new WeakMap<
  object,
  { expiresAt: number; promise: Promise<Record<string, unknown>> }
>();

async function fetchWeaponIconFramesDirect(
  c: Context<{ Bindings: Bindings }>,
): Promise<Record<string, unknown>> {
  const envCtx = createEnvContext(c);
  const bucket = envCtx.runtime["ASSET_SYNC_BUCKET"];
  if (!bucket) throw new Error("Asset storage not configured");

  const now = Date.now();
  const cached = weaponIconBucketCache.get(bucket);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const loadPromise = (async (): Promise<Record<string, unknown>> => {
    const r2Object = await bucket.get("assets/kcs2/img/common/common_icon_weapon.json");
    if (!r2Object) {
      if (envCtx.isDev) {
        console.warn("[battle-data] Sprite atlas 'assets/kcs2/img/common/common_icon_weapon.json' not found in ASSET_SYNC_BUCKET; returning empty frames in dev mode");
        return {};
      }
      throw new Error("Sprite atlas not found");
    }
    const atlasRaw = new Uint8Array(await r2Object.arrayBuffer());
    try {
      return parseJsonObjectText(new TextDecoder().decode(atlasRaw));
    } catch {
      const decompressed = await brotliDecompressAsync(atlasRaw);
      return parseJsonObjectText(decompressed.toString("utf8"));
    }
  })();

  weaponIconBucketCache.set(bucket, {
    expiresAt: now + WEAPON_ICON_CACHE_TTL_MS,
    promise: loadPromise,
  });
  try {
    return await loadPromise;
  } catch (err) {
    weaponIconBucketCache.delete(bucket);
    throw err;
  }
}

async function fetchGlobalRecordsInternal(
  c: Context<{ Bindings: Bindings }>,
  options: {
    table: string;
    periodTag: string;
    tableVersion: string;
    datasetId?: string;
    limitBlocks: number;
    limitRecords: number;
    filter?: Record<string, unknown>;
    includeSortieKey?: boolean;
    fromTimestampMs?: number;
    toTimestampMs?: number;
  },
): Promise<Array<Record<string, unknown>>> {
  const payload = await fetchGlobalRecordsPayloadInternal(c, options);
  return payload.records || [];
}

async function fetchGlobalRecordsPayloadInternal(
  c: Context<{ Bindings: Bindings }>,
  options: {
    table: string;
    periodTag: string;
    tableVersion: string;
    datasetId?: string;
    limitBlocks: number;
    limitRecords: number;
    filter?: Record<string, unknown>;
    includeSortieKey?: boolean;
    fromTimestampMs?: number;
    toTimestampMs?: number;
  },
): Promise<BattleRecordsPayload> {
  const datasetId = options.datasetId ?? c.req.query("dataset_id")?.trim();
  const pathOptions =
    datasetId === undefined ? options : { ...options, datasetId };
  return queryGlobalRecordsDirect(c, pathOptions);
}

function toGroupIdsForBattleQuery(rawIds: unknown): string[] {
  if (Array.isArray(rawIds)) return rawIds.filter((id): id is string => typeof id === "string" && id.length > 0);
  return typeof rawIds === "string" && rawIds.length > 0 ? [rawIds] : [];
}

const SORTIE_SPLIT_GAP_MS = 90 * 60 * 1000;
type CompactionTier = "hourly" | "daily" | "weekly" | "period";
const TIER_RANK: Record<CompactionTier, number> = {
  period: 0,
  weekly: 1,
  daily: 2,
  hourly: 3,
};

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

const PERIOD_META_MEM_CACHE_TTL_MS = 60 * 1000;
const allowedPeriodsByDbCache = new WeakMap<
  object,
  Map<string, { expiresAt: number; promise: Promise<Set<string>> }>
>();
const resolvedPeriodVersionByDbCache = new WeakMap<
  object,
  Map<
    string,
    {
      expiresAt: number;
      promise: Promise<{
        resolvedPeriodTag: string | null;
        resolvedTableVersion: string | null;
      }>;
    }
  >
>();

async function resolveAllowedPeriodTagsForRecords(
  c: { env: Bindings },
  indexDb: D1Database,
  table: string,
  cacheKV?: KVNamespace,
): Promise<Set<string>> {
  let dbCache = allowedPeriodsByDbCache.get(indexDb);
  if (!dbCache) {
    dbCache = new Map();
    allowedPeriodsByDbCache.set(indexDb, dbCache);
  }
  const now = Date.now();
  const cached = dbCache.get(table);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const loadPromise = (async (): Promise<Set<string>> => {
    try {
      return await getAllowedPeriodTagSet(c, cacheKV);
    } catch (error) {
      console.warn(
        "[battle-data] allow-list fetch failed; falling back to local period tags:",
        error,
      );
    }

    const fallbackRowsResult = await indexDb
      .prepare(
        "SELECT DISTINCT period_tag FROM block_indexes WHERE table_name = ? ORDER BY period_tag DESC LIMIT 200",
      )
      .bind(table)
      .all();
    const parsedFallbackRows = BattlePeriodTagRowsSchema.safeParse(
      fallbackRowsResult.results ?? [],
    );
    if (!parsedFallbackRows.success) {
      throw new Error("Invalid battle period-tag rows");
    }

    const fallbackSet = new Set<string>();
    for (const row of parsedFallbackRows.data) {
      const periodTag = row?.period_tag;
      if (typeof periodTag !== "string" || !periodTag) continue;
      const validation = await validateCachedPeriodTag(c, periodTag, {
        fieldName: "period_tag",
        ...(cacheKV ? { cacheKV } : {}),
      });
      if (validation.ok) {
        fallbackSet.add(periodTag);
      }
    }

    if (fallbackSet.size > 0) {
      return fallbackSet;
    }

    throw new Error(`Failed to resolve allowed period tags for table ${table}`);
  })();

  dbCache.set(table, {
    expiresAt: now + PERIOD_META_MEM_CACHE_TTL_MS,
    promise: loadPromise,
  });
  try {
    return await loadPromise;
  } catch (err) {
    dbCache.delete(table);
    throw err;
  }
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

function normalizeMapCoordinate(value: unknown): number | null {
  if (value == null || (typeof value === "string" && value.trim() === "")) {
    return null;
  }
  const coordinate = Number(value);
  return Number.isSafeInteger(coordinate) && coordinate > 0
    ? coordinate
    : null;
}

function formatTimestamp(value: unknown): string | null {
  const timestamp = normalizeTimestamp(value);
  return timestamp === null ? null : new Date(timestamp).toISOString();
}

export function attachSortieIds(records: BattleRecord[]): void {
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
        normalizeTimestamp(rec["timestamp"]) ??
        normalizeTimestamp(rec["midnight_timestamp"]),
    }))
    .sort((a, b) => {
      const aTs = a.ts ?? Number.MAX_SAFE_INTEGER;
      const bTs = b.ts ?? Number.MAX_SAFE_INTEGER;
      return aTs - bTs;
    });

  const byDataset = new Map<
    string,
    { mapKey: string | null; ts: number | null; sortieNo: number }
  >();

  for (const item of sortable) {
    const datasetId =
      typeof item.rec["dataset_id"] === "string" && item.rec["dataset_id"]
        ? item.rec["dataset_id"]
        : "global";
    const mapArea = normalizeMapCoordinate(item.rec["maparea_id"]);
    const mapInfo = normalizeMapCoordinate(item.rec["mapinfo_no"]);
    const mapKey =
      mapArea === null || mapInfo === null ? null : `${mapArea}-${mapInfo}`;

    const prev = byDataset.get(datasetId);
    let sortieNo = 1;
    if (prev) {
      const sameMap =
        prev.mapKey !== null && mapKey !== null && prev.mapKey === mapKey;
      const withinGap =
        prev.ts != null && item.ts != null
          ? Math.abs(item.ts - prev.ts) <= SORTIE_SPLIT_GAP_MS
          : sameMap;
      sortieNo = sameMap && withinGap ? prev.sortieNo : prev.sortieNo + 1;
    }

    byDataset.set(datasetId, { mapKey, ts: item.ts, sortieNo });
    item.rec["__sortie_id"] = `${datasetId}:${mapKey ?? "unknown"}:${sortieNo}`;
  }
}

type CompiledFilterRule =
  | { kind: "set"; values: Set<unknown> }
  | { kind: "null" }
  | { kind: "number"; value: number }
  | { kind: "boolean"; value: boolean }
  | { kind: "string"; value: string };

type CompiledRecordFilter = Array<[string, CompiledFilterRule]>;

function compileRecordFilter(
  filterObj: Record<string, unknown>,
): CompiledRecordFilter {
  const entries: CompiledRecordFilter = [];
  for (const [key, expected] of Object.entries(filterObj)) {
    if (Array.isArray(expected)) {
      entries.push([key, { kind: "set", values: new Set(expected) }]);
    } else if (expected === null) {
      entries.push([key, { kind: "null" }]);
    } else if (typeof expected === "number") {
      entries.push([key, { kind: "number", value: expected }]);
    } else if (typeof expected === "boolean") {
      entries.push([key, { kind: "boolean", value: expected }]);
    } else {
      entries.push([key, { kind: "string", value: String(expected) }]);
    }
  }
  return entries;
}

function matchesCompiledRecordFilter(
  record: unknown,
  compiled: CompiledRecordFilter,
): boolean {
  if (!record || typeof record !== "object") {
    return false;
  }
  const rec = record as Record<string, unknown>;
  for (let i = 0; i < compiled.length; i += 1) {
    const entry = compiled[i];
    if (!entry) continue;
    const [key, rule] = entry;
    const actual = rec[key];

    switch (rule.kind) {
      case "set":
        if (!rule.values.has(actual)) {
          return false;
        }
        break;
      case "null":
        if (actual !== null && actual !== undefined) {
          return false;
        }
        break;
      case "number": {
        const actualNum = Number(actual);
        if (!Number.isFinite(actualNum) || actualNum !== rule.value) {
          return false;
        }
        break;
      }
      case "boolean":
        if (Boolean(actual) !== rule.value) {
          return false;
        }
        break;
      case "string":
        if (String(actual) !== rule.value) {
          return false;
        }
        break;
    }
  }
  return true;
}

export function extractTimestampFromUuidV7(uuidStr: string): number | null {
  const hex = uuidStr.replace(/-/g, "").trim();
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) return null;
  const version = Number.parseInt(hex[12] ?? "", 16);
  if (version !== 7) return null;
  const ts = Number(BigInt(`0x${hex.slice(0, 12)}`));
  // Valid epoch ms between 2020-01-01 and 2100-01-01
  if (!Number.isFinite(ts) || ts < 1_577_836_800_000 || ts > 4_102_444_800_000) {
    return null;
  }
  return ts;
}

function shouldFetchBattlePhase(
  battle: Record<string, unknown> | undefined,
  field: string,
): boolean {
  if (!battle) return true;
  if (!(field in battle)) return true;
  const value = battle[field];
  if (value === null || value === undefined || value === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

async function putCacheSafely(
  c: Context<{ Bindings: Bindings }>,
  cache: Cache,
  cacheKey: Request,
  response: Response,
): Promise<void> {
  const putPromise = cache.put(cacheKey, response.clone());
  safeWaitUntil(c, putPromise);
}

const bucketDecoderContextCache = new WeakMap<
  object,
  Map<string, Promise<PreparedAvroDecoderContext>>
>();

function getDecoderContextCacheForBucket(
  bucket: R2Bucket,
): Map<string, Promise<PreparedAvroDecoderContext>> {
  let cache = bucketDecoderContextCache.get(bucket);
  if (!cache) {
    cache = new Map();
    bucketDecoderContextCache.set(bucket, cache);
  }
  return cache;
}

async function getOrLoadDecoderContext(
  bucket: R2Bucket,
  filePath: string,
  minStartByte: number,
  contextCache: Map<string, Promise<PreparedAvroDecoderContext>>,
): Promise<PreparedAvroDecoderContext> {
  let contextPromise = contextCache.get(filePath);
  if (!contextPromise) {
    contextPromise = (async () => {
      let prefixLength = Math.min(minStartByte, 64 * 1024);
      while (prefixLength > 0) {
        const prefixObject = await bucket.get(filePath, {
          range: { offset: 0, length: prefixLength },
        });
        if (!prefixObject) {
          throw new Error(`AVRO object not found: ${filePath}`);
        }

        const prefixBytes = new Uint8Array(await prefixObject.arrayBuffer());
        try {
          const headerLength = parseOcfHeader(prefixBytes).bodyOffset;
          return prepareAvroDecoderContext(prefixBytes.subarray(0, headerLength));
        } catch (error) {
          if (prefixLength >= minStartByte) {
            throw error;
          }
          prefixLength = Math.min(minStartByte, prefixLength * 2);
        }
      }
      throw new Error(`AVRO header range is empty: ${filePath}`);
    })();
    contextCache.set(filePath, contextPromise);
  }

  try {
    return await contextPromise;
  } catch (error) {
    contextCache.delete(filePath);
    throw error;
  }
}

const MAX_R2_COALESCE_GAP_BYTES = 64 * 1024;
const MAX_R2_COALESCE_SPAN_BYTES = 16 * 1024 * 1024;

async function decodeIndexedBlocksCoalesced(
  bucket: R2Bucket,
  rows: BattleBlockRow[],
  table: string,
  compiledFilter: CompiledRecordFilter | null,
): Promise<AvroJsonRecord[][]> {
  const results: AvroJsonRecord[][] = Array.from({ length: rows.length }, () => []);
  const contextCache = getDecoderContextCacheForBucket(bucket);

  type BlockTask = {
    rowIndex: number;
    row: BattleBlockRow;
    filePath: string;
    startByte: number;
    length: number;
  };

  const tasksByFile = new Map<string, BlockTask[]>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row) continue;
    const startByte = Number(row.start_byte || 0);
    const length = Number(row.length || 0);
    if (startByte <= 0 || length <= 0 || !row.file_path) {
      continue;
    }
    const list = tasksByFile.get(row.file_path) ?? [];
    list.push({
      rowIndex: i,
      row,
      filePath: row.file_path,
      startByte,
      length,
    });
    tasksByFile.set(row.file_path, list);
  }

  await Promise.all(
    Array.from(tasksByFile.entries()).map(async ([filePath, fileTasks]) => {
      const sortedTasks = [...fileTasks].sort((a, b) => a.startByte - b.startByte);
      const minStartByte = sortedTasks[0]?.startByte ?? 0;
      if (minStartByte <= 0) return;

      type CoalescedGroup = {
        groupStart: number;
        groupEnd: number;
        tasks: BlockTask[];
      };

      const groups: CoalescedGroup[] = [];
      for (const task of sortedTasks) {
        const taskStart = task.startByte;
        const taskEnd = task.startByte + task.length;
        const lastGroup = groups[groups.length - 1];
        if (
          lastGroup &&
          taskStart >= lastGroup.groupStart &&
          taskStart - lastGroup.groupEnd <= MAX_R2_COALESCE_GAP_BYTES &&
          Math.max(lastGroup.groupEnd, taskEnd) - lastGroup.groupStart <=
            MAX_R2_COALESCE_SPAN_BYTES
        ) {
          lastGroup.groupEnd = Math.max(lastGroup.groupEnd, taskEnd);
          lastGroup.tasks.push(task);
        } else {
          groups.push({
            groupStart: taskStart,
            groupEnd: taskEnd,
            tasks: [task],
          });
        }
      }

      const firstGroup = groups[0];
      let prefetchedFirstGroupPromise: Promise<Uint8Array | null> | null = null;
      let contextPromise: Promise<PreparedAvroDecoderContext>;

      if (
        !contextCache.has(filePath) &&
        firstGroup !== undefined &&
        firstGroup.groupStart <= MAX_R2_COALESCE_GAP_BYTES &&
        firstGroup.groupEnd <= MAX_R2_COALESCE_SPAN_BYTES
      ) {
        const combinedLoadPromise = (async () => {
          const combinedObject = await bucket.get(filePath, {
            range: {
              offset: 0,
              length: firstGroup.groupEnd,
            },
          });
          if (!combinedObject) {
            throw new Error(`AVRO object not found: ${filePath}`);
          }
          const combinedBytes = new Uint8Array(await combinedObject.arrayBuffer());
          const headerLimit = Math.min(
            firstGroup.groupStart,
            combinedBytes.byteLength,
          );
          const headerSlice = combinedBytes.subarray(0, headerLimit);
          const headerLength = parseOcfHeader(headerSlice).bodyOffset;
          const ctx = prepareAvroDecoderContext(
            headerSlice.subarray(0, headerLength),
          );
          const groupBytes =
            combinedBytes.byteLength > firstGroup.groupStart
              ? combinedBytes.subarray(
                  firstGroup.groupStart,
                  Math.min(firstGroup.groupEnd, combinedBytes.byteLength),
                )
              : new Uint8Array(0);
          return { ctx, groupBytes };
        })();

        contextPromise = combinedLoadPromise.then((res) => res.ctx);
        contextCache.set(filePath, contextPromise);
        contextPromise.catch(() => {
          contextCache.delete(filePath);
        });
        prefetchedFirstGroupPromise = combinedLoadPromise
          .then((res) => res.groupBytes)
          .catch((err) => {
            console.warn(
              "[battle-data] failed to load coalesced header+group in /global/records",
              {
                table,
                filePath,
                error: String(err),
              },
            );
            return null;
          });
      } else {
        contextPromise = getOrLoadDecoderContext(
          bucket,
          filePath,
          minStartByte,
          contextCache,
        );
      }

      await Promise.all(
        groups.map(async (group, groupIndex) => {
          let groupBytes: Uint8Array;
          if (groupIndex === 0 && prefetchedFirstGroupPromise !== null) {
            const prefetched = await prefetchedFirstGroupPromise;
            if (!prefetched || prefetched.length === 0) return;
            groupBytes = prefetched;
          } else {
            try {
              const dataObject = await bucket.get(filePath, {
                range: {
                  offset: group.groupStart,
                  length: group.groupEnd - group.groupStart,
                },
              });
              if (!dataObject) return;
              groupBytes = new Uint8Array(await dataObject.arrayBuffer());
              if (groupBytes.length === 0) return;
            } catch (err) {
              console.warn(
                "[battle-data] failed to read coalesced R2 range in /global/records",
                {
                  table,
                  filePath,
                  groupStart: group.groupStart,
                  groupLength: group.groupEnd - group.groupStart,
                  error: String(err),
                },
              );
              return;
            }
          }

          let context: PreparedAvroDecoderContext;
          try {
            context = await contextPromise;
          } catch (err) {
            console.warn("[battle-data] failed to load header in /global/records", {
              table,
              filePath,
              error: String(err),
            });
            return;
          }

          for (const task of group.tasks) {
            const relStart = task.startByte - group.groupStart;
            const relEnd = relStart + task.length;
            if (relStart < 0 || relStart >= groupBytes.byteLength) {
              continue;
            }
            const sliceBytes = groupBytes.subarray(
              relStart,
              Math.min(relEnd, groupBytes.byteLength),
            );
            if (sliceBytes.byteLength === 0) continue;

            const rowDatasetId =
              typeof task.row.dataset_id === "string"
                ? task.row.dataset_id.trim()
                : "";

            try {
              const decoded = await decodeAvroDataBlocksWithContext(
                context,
                sliceBytes,
                {
                  recordFilter: (rec) => {
                    if (
                      rowDatasetId &&
                      (rec["dataset_id"] === undefined ||
                        rec["dataset_id"] === null ||
                        rec["dataset_id"] === "")
                    ) {
                      rec["dataset_id"] = rowDatasetId;
                    }
                    return compiledFilter
                      ? matchesCompiledRecordFilter(rec, compiledFilter)
                      : true;
                  },
                },
              );
              results[task.rowIndex] = decoded;
            } catch (err) {
              console.warn(
                "[battle-data] failed to decode block in /global/records",
                {
                  table,
                  blockId: task.row.id,
                  filePath: task.row.file_path,
                  error: String(err),
                },
              );
              results[task.rowIndex] = [];
            }
          }
        }),
      );
    }),
  );

  return results;
}
export function pruneSubsumedTierBlocks(rows: BattleBlockRow[]): {
  rows: BattleBlockRow[];
  effectiveTier: CompactionTier | null;
} {
  const seenBlockIds = new Set<number>();
  const uniqueRows: BattleBlockRow[] = [];
  for (const row of rows) {
    const id = Number(row?.id ?? NaN);
    if (Number.isFinite(id)) {
      if (seenBlockIds.has(id)) continue;
      seenBlockIds.add(id);
    }
    uniqueRows.push(row);
  }

  const byTierPriority = [...uniqueRows].sort((a, b) => {
    const tierA = parseCompactionTier(a.compaction_tier ?? undefined);
    const tierB = parseCompactionTier(b.compaction_tier ?? undefined);
    const rankA = tierA ? TIER_RANK[tierA] : 4;
    const rankB = tierB ? TIER_RANK[tierB] : 4;
    if (rankA !== rankB) return rankA - rankB;
    return (
      (normalizeTimestamp(b?.start_timestamp) ?? Number.MIN_SAFE_INTEGER) -
      (normalizeTimestamp(a?.start_timestamp) ?? Number.MIN_SAFE_INTEGER)
    );
  });

  type CoveredInterval = {
    rank: number;
    tier: CompactionTier;
    startMs: number;
    endMs: number;
  };
  const coveredByDatasetAndPeriod = new Map<string, CoveredInterval[]>();
  const accepted: BattleBlockRow[] = [];
  const usedTiers = new Set<CompactionTier>();

  for (const row of byTierPriority) {
    const rowTier = parseCompactionTier(row.compaction_tier ?? undefined);
    const rowRank = rowTier ? TIER_RANK[rowTier] : 4;
    const ds = String(row.dataset_id ?? "");
    const pt = String(row.period_tag ?? "");
    const key = `${ds}\0${pt}`;
    const startTs = normalizeTimestamp(row.start_timestamp) ?? 0;
    const endTs = normalizeTimestamp(row.end_timestamp) ?? startTs;

    const existingIntervals = coveredByDatasetAndPeriod.get(key);
    let subsumed = false;
    if (existingIntervals) {
      for (const cov of existingIntervals) {
        if (cov.rank < rowRank) {
          if (
            cov.tier === "period" ||
            (startTs >= cov.startMs && endTs <= cov.endMs)
          ) {
            subsumed = true;
            break;
          }
        }
      }
    }
    if (subsumed) {
      continue;
    }

    accepted.push(row);
    if (rowTier) {
      usedTiers.add(rowTier);
      if (rowRank < 3) {
        const winStart = normalizeTimestamp(row.window_start_ms);
        const winEnd = normalizeTimestamp(row.window_end_ms);
        const covStart =
          winStart !== null && winStart > 0
            ? Math.min(winStart, startTs)
            : startTs;
        const covEnd =
          winEnd !== null && winEnd > 0 ? Math.max(winEnd, endTs) : endTs;
        const list = existingIntervals ?? [];
        list.push({
          rank: rowRank,
          tier: rowTier,
          startMs: covStart,
          endMs: covEnd,
        });
        coveredByDatasetAndPeriod.set(key, list);
      }
    }
  }

  accepted.sort(
    (a, b) =>
      (normalizeTimestamp(b?.start_timestamp) ?? Number.MIN_SAFE_INTEGER) -
      (normalizeTimestamp(a?.start_timestamp) ?? Number.MIN_SAFE_INTEGER),
  );

  return {
    rows: accepted,
    effectiveTier: usedTiers.size === 1 ? ([...usedTiers][0] ?? null) : null,
  };
}

async function resolvePeriodAndTableVersionCached(params: {
  indexDb: D1Database;
  table: string;
  periodTagParam: string;
  tableVersionParam: string;
  datasetId: string | undefined;
  allowedPeriodTagSet: Set<string>;
}): Promise<{
  resolvedPeriodTag: string | null;
  resolvedTableVersion: string | null;
}> {
  const {
    indexDb,
    table,
    periodTagParam,
    tableVersionParam,
    datasetId,
    allowedPeriodTagSet,
  } = params;

  if (periodTagParam !== "latest" && (periodTagParam === "all" || tableVersionParam)) {
    return {
      resolvedPeriodTag: periodTagParam === "all" ? null : periodTagParam,
      resolvedTableVersion: tableVersionParam || null,
    };
  }

  let dbCache = resolvedPeriodVersionByDbCache.get(indexDb);
  if (!dbCache) {
    dbCache = new Map();
    resolvedPeriodVersionByDbCache.set(indexDb, dbCache);
  }
  const cacheKey = `${table}\0${periodTagParam}\0${tableVersionParam || ""}\0${datasetId || ""}`;
  const now = Date.now();
  const cached = dbCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const loadPromise = (async () => {
    let resolvedPeriodTag: string | null = null;
    let resolvedTableVersion: string | null = tableVersionParam || null;
    if (periodTagParam === "latest") {
      let latestPeriodSql =
        "SELECT DISTINCT period_tag, table_version FROM block_indexes WHERE table_name = ?";
      const latestPeriodParams: unknown[] = [table];
      if (tableVersionParam) {
        latestPeriodSql += " AND table_version = ?";
        latestPeriodParams.push(tableVersionParam);
      }
      if (datasetId) {
        latestPeriodSql += " AND dataset_id = ?";
        latestPeriodParams.push(datasetId);
      }
      latestPeriodSql += " ORDER BY period_tag DESC, table_version DESC LIMIT 200";
      const latestRowsResult = await indexDb
        .prepare(latestPeriodSql)
        .bind(...latestPeriodParams)
        .all();
      const parsedLatestRows = BattleSummaryRowsSchema.safeParse(
        latestRowsResult.results ?? [],
      );
      if (!parsedLatestRows.success) {
        throw new Error("Invalid latest battle period-tag rows");
      }
      const latestAllowed = parsedLatestRows.data.find((row) =>
        allowedPeriodTagSet.has(row.period_tag),
      );
      resolvedPeriodTag = latestAllowed?.period_tag ?? null;
      const latestPeriodRows = latestAllowed
        ? parsedLatestRows.data.filter(
            (row) => row.period_tag === latestAllowed.period_tag,
          )
        : [];
      const latestResolvedVersion = latestPeriodRows.reduce<string | null>(
        (latestVersion, row) =>
          latestVersion === null ||
          compareTableVersions(row.table_version, latestVersion) > 0
            ? row.table_version
            : latestVersion,
        null,
      );
      resolvedTableVersion = latestResolvedVersion ?? (tableVersionParam || null);
    } else if (periodTagParam !== "all") {
      resolvedPeriodTag = periodTagParam;
      if (!tableVersionParam) {
        const versionRowsResult = await indexDb
          .prepare(
            "SELECT DISTINCT period_tag, table_version FROM block_indexes WHERE table_name = ? AND period_tag = ?" +
              (datasetId ? " AND dataset_id = ?" : "") +
              " ORDER BY table_version DESC LIMIT 200",
          )
          .bind(
            ...([
              table,
              periodTagParam,
              ...(datasetId ? [datasetId] : []),
            ] as unknown[]),
          )
          .all();
        const parsedVersionRows = BattleSummaryRowsSchema.safeParse(
          versionRowsResult.results ?? [],
        );
        if (!parsedVersionRows.success) {
          throw new Error("Invalid battle table-version rows");
        }
        resolvedTableVersion = parsedVersionRows.data.reduce<string | null>(
          (latestVersion, row) =>
            latestVersion === null ||
            compareTableVersions(row.table_version, latestVersion) > 0
              ? row.table_version
              : latestVersion,
          null,
        );
      }
    }
    return { resolvedPeriodTag, resolvedTableVersion };
  })();

  dbCache.set(cacheKey, {
    expiresAt: now + PERIOD_META_MEM_CACHE_TTL_MS,
    promise: loadPromise,
  });
  try {
    return await loadPromise;
  } catch (err) {
    dbCache.delete(cacheKey);
    throw err;
  }
}

export type TableQueryOptions = {
  table: string;
  periodTag: string;
  tableVersion: string;
  datasetId?: string;
  limitBlocks: number;
  limitRecords: number;
  filter?: Record<string, unknown>;
  includeSortieKey?: boolean;
  fromTimestampMs?: number;
  toTimestampMs?: number;
};

export async function queryGlobalRecordsDirectBatch(
  c: Context<{ Bindings: Bindings }>,
  optionsList: TableQueryOptions[],
): Promise<BattleRecordsPayload[]> {
  if (optionsList.length === 0) return [];

  const env = createEnvContext(c);
  const indexDb = env.runtime["BATTLE_INDEX_DB"];
  const bucket = env.runtime["BATTLE_DATA_BUCKET"];
  if (!indexDb || !bucket) {
    throw new Error("Storage not configured");
  }

  type PreparedTableQuery = {
    opt: TableQueryOptions;
    resolvedPeriodTag: string | null;
    resolvedTableVersion: string | null;
    statement: D1PreparedStatement | null;
  };

  const preparedQueries: PreparedTableQuery[] = await Promise.all(
    optionsList.map(async (options) => {
      const table = options.table.trim();
      const periodTagParam = (options.periodTag || "latest").trim();
      const tableVersionParam = (options.tableVersion || "").trim();
      const datasetId = options.datasetId?.trim() || undefined;
      const limitBlocks = Math.max(1, Math.min(options.limitBlocks, 400));
      const fromTimestampMs =
        options.fromTimestampMs != null && Number.isFinite(options.fromTimestampMs)
          ? Math.trunc(options.fromTimestampMs)
          : null;
      const toTimestampMs =
        options.toTimestampMs != null && Number.isFinite(options.toTimestampMs)
          ? Math.trunc(options.toTimestampMs)
          : null;

      const allowedPeriodTagSet = await resolveAllowedPeriodTagsForRecords(
        c,
        indexDb,
        table,
        env.runtime["DATA_LOADER_CACHE_KV"],
      );

      const { resolvedPeriodTag, resolvedTableVersion } =
        await resolvePeriodAndTableVersionCached({
          indexDb,
          table,
          periodTagParam,
          tableVersionParam,
          datasetId,
          allowedPeriodTagSet,
        });

      const perTierFetchLimit = Math.max(limitBlocks + 1, 200);
      let sql = `SELECT bi.id, bi.dataset_id, bi.start_byte, bi.length, bi.start_timestamp, bi.end_timestamp, bi.period_tag, bi.window_start_ms, bi.window_end_ms, bi.compaction_tier, af.file_path
                 FROM block_indexes bi
                 JOIN archived_files af ON af.id = bi.file_id
                 WHERE bi.table_name = ?`;
      const params: unknown[] = [table];

      if (resolvedTableVersion) {
        sql += " AND bi.table_version = ?";
        params.push(resolvedTableVersion);
      }

      if (resolvedPeriodTag) {
        sql += " AND bi.period_tag = ?";
        params.push(resolvedPeriodTag);
      } else {
        const allowedTags = [...allowedPeriodTagSet];
        if (allowedTags.length === 0) {
          return {
            opt: options,
            resolvedPeriodTag,
            resolvedTableVersion,
            statement: null,
          };
        }
        const placeholders = allowedTags.map(() => "?").join(", ");
        sql += ` AND bi.period_tag IN (${placeholders})`;
        params.push(...allowedTags);
      }

      if (fromTimestampMs != null) {
        sql += " AND bi.end_timestamp >= ?";
        params.push(fromTimestampMs);
      }

      if (toTimestampMs != null) {
        sql += " AND bi.start_timestamp <= ?";
        params.push(toTimestampMs);
      }

      if (datasetId) {
        sql += " AND bi.dataset_id = ?";
        params.push(datasetId);
      }

      sql +=
        " ORDER BY CASE bi.compaction_tier WHEN 'period' THEN 0 WHEN 'weekly' THEN 1 WHEN 'daily' THEN 2 ELSE 3 END ASC, bi.start_timestamp DESC LIMIT ?";
      params.push(perTierFetchLimit);

      const statement = indexDb.prepare(sql).bind(...params);
      return {
        opt: options,
        resolvedPeriodTag,
        resolvedTableVersion,
        statement,
      };
    }),
  );

  const queriesWithStatements = preparedQueries.filter(
    (q): q is PreparedTableQuery & { statement: D1PreparedStatement } =>
      q.statement !== null,
  );

  const statementResultsMap = new Map<
    D1PreparedStatement,
    { results?: Array<Record<string, unknown>> }
  >();

  if (queriesWithStatements.length === 1) {
    const single = queriesWithStatements[0]!;
    const res = await single.statement.all();
    statementResultsMap.set(single.statement, res || {});
  } else if (queriesWithStatements.length > 1) {
    const stmts = queriesWithStatements.map((q) => q.statement);
    let batchResults: Array<{ results?: Array<Record<string, unknown>> }>;
    if (typeof (indexDb as unknown as { batch?: unknown }).batch === "function") {
      batchResults = await (
        indexDb as unknown as {
          batch: (
            s: D1PreparedStatement[],
          ) => Promise<Array<{ results?: Array<Record<string, unknown>> }>>;
        }
      ).batch(stmts);
    } else {
      batchResults = await Promise.all(stmts.map((s) => s.all()));
    }
    for (let i = 0; i < stmts.length; i++) {
      statementResultsMap.set(stmts[i]!, batchResults[i] || {});
    }
  }

  return Promise.all(
    preparedQueries.map(async (pq) => {
      const { opt, resolvedPeriodTag, resolvedTableVersion, statement } = pq;
      const periodTagParam = (opt.periodTag || "latest").trim();
      const limitBlocks = Math.max(1, Math.min(opt.limitBlocks, 400));
      const limitRecords = Math.max(1, Math.min(opt.limitRecords, 40000));

      if (!statement) {
        return {
          records: [],
          period_tag: periodTagParam,
          table_version: resolvedTableVersion,
        };
      }

      const rawResult = statementResultsMap.get(statement);
      if (!rawResult) {
        return {
          records: [],
          period_tag: resolvedPeriodTag || periodTagParam,
          table_version: resolvedTableVersion,
        };
      }

      const parsedRows = parseBattleBlockRows(rawResult.results || []);
      if (!parsedRows) {
        throw new Error("D1 returned malformed results for block query");
      }

      const pruned = pruneSubsumedTierBlocks(parsedRows);
      const rows = pruned.rows.slice(0, limitBlocks);
      if (rows.length === 0) {
        return {
          records: [],
          period_tag: resolvedPeriodTag || periodTagParam,
          table_version: resolvedTableVersion,
        };
      }

      const compiledFilter = opt.filter
        ? compileRecordFilter(opt.filter)
        : null;
      const decodedBlocks = await decodeIndexedBlocksCoalesced(
        bucket,
        rows,
        opt.table,
        compiledFilter,
      );

      const decodedRecords: AvroJsonRecord[] = [];
      const seenRecordKeys = new Set<string>();
      let matchedMinStartTimestampMs: number | null = null;
      let matchedMaxEndTimestampMs: number | null = null;
      outer: for (
        let blockIdx = 0;
        blockIdx < decodedBlocks.length;
        blockIdx += 1
      ) {
        const recs = decodedBlocks[blockIdx] ?? [];
        if (recs.length > 0) {
          const blockRow = rows[blockIdx];
          const bStart = normalizeTimestamp(blockRow?.start_timestamp);
          const bEnd = normalizeTimestamp(blockRow?.end_timestamp) ?? bStart;
          if (bStart !== null) {
            matchedMinStartTimestampMs =
              matchedMinStartTimestampMs === null
                ? bStart
                : Math.min(matchedMinStartTimestampMs, bStart);
          }
          if (bEnd !== null) {
            matchedMaxEndTimestampMs =
              matchedMaxEndTimestampMs === null
                ? bEnd
                : Math.max(matchedMaxEndTimestampMs, bEnd);
          }
        }
        for (const rec of recs) {
          const recUuid = String(rec["uuid"] ?? rec["env_uuid"] ?? "");
          const recIndex = rec["index"] != null ? String(rec["index"]) : (rec["cell_index"] != null ? String(rec["cell_index"]) : "");
          const recKey = recUuid ? `${recUuid}:${recIndex}` : "";
          if (recKey) {
            if (seenRecordKeys.has(recKey)) continue;
            seenRecordKeys.add(recKey);
          }
          decodedRecords.push(rec);
          if (decodedRecords.length >= limitRecords) {
            break outer;
          }
        }
      }

      if (opt.table === "battle" && opt.includeSortieKey) {
        attachSortieIds(decodedRecords);
      }

      return {
        records: decodedRecords,
        period_tag: resolvedPeriodTag || periodTagParam,
        table_version: resolvedTableVersion,
        ...(matchedMinStartTimestampMs !== null
          ? { matched_min_start_timestamp_ms: matchedMinStartTimestampMs }
          : {}),
        ...(matchedMaxEndTimestampMs !== null
          ? { matched_max_end_timestamp_ms: matchedMaxEndTimestampMs }
          : {}),
      };
    }),
  );
}

async function queryGlobalRecordsDirect(
  c: Context<{ Bindings: Bindings }>,
  options: TableQueryOptions,
): Promise<BattleRecordsPayload> {
  const [result] = await queryGlobalRecordsDirectBatch(c, [options]);
  if (!result) {
    throw new Error(`Failed to query table: ${options.table}`);
  }
  return result;
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
  const bucket = env.runtime["BATTLE_DATA_BUCKET"];
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
    maxBodySize: MAX_UPLOAD_BYTES,
    preparationValidator: async (body, _user, authContext) => {
      const datasetIdFromToken =
        authContext.datasetToken?.dataset_id?.trim() ?? "";
      const requestedDatasetId =
        typeof body?.["dataset_id"] === "string"
          ? body["dataset_id"].trim()
          : "";
      if (requestedDatasetId && requestedDatasetId !== datasetIdFromToken) {
        console.warn(`[battle-data] dataset_id mismatch detected`);
        return c.json({ error: "dataset_id does not match token" }, 403);
      }

      const datasetId = datasetIdFromToken || requestedDatasetId;
      const table =
        typeof body?.["table"] === "string" ? body["table"].trim() : "";
      const periodTag =
        typeof body?.["kc_period_tag"] === "string"
          ? body["kc_period_tag"].trim()
          : "";
      const tableVersion =
        typeof body?.["table_version"] === "string"
          ? body["table_version"].trim()
          : typeof body?.["tableVersion"] === "string"
            ? body["tableVersion"].trim()
            : "";
      const declaredSize = parseInt(
        typeof body?.["file_size"] === "string" ? body["file_size"] : "0",
        10,
      );
      const tableOffsets =
        typeof body?.["table_offsets"] === "string"
          ? body["table_offsets"].trim()
          : null;
      const pathTag =
        typeof body?.["path"] === "string" ? body["path"].trim() : null;
      const isBinary =
        typeof body?.["binary"] === "boolean" ? body["binary"] : false;

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
        cacheKV: env.runtime["DATA_LOADER_CACHE_KV"],
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
        typeof body?.["content_hash"] === "string"
          ? body["content_hash"].trim()
          : "";
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
          const parsed = parseOffsetMetadata(JSON.parse(tableOffsets));
          if (!parsed) {
            return c.json(
              {
                error: "Invalid table_offsets",
                details: ["Offset metadata must be an array of valid entries"],
              },
              400,
            );
          }
          console.info(
            `[battle-data] Parsed table_offsets (${parsed.length} tables): ${JSON.stringify(parsed.map((p) => p.table_name))}`,
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
      const payloadValidation = BattleDataTokenPayloadSchema.safeParse(
        tokenPayload,
      );
      if (!payloadValidation.success) {
        return c.json({ error: "Invalid token payload" }, 400);
      }
      const validatedTokenPayload = payloadValidation.data;

      // Content hash verification
      const expectedContentHash = validatedTokenPayload.content_hash;
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

      const datasetId = validatedTokenPayload.dataset_id;
      const table = validatedTokenPayload.table;
      const periodTag = validatedTokenPayload.period_tag;
      let tableOffsets = validatedTokenPayload.table_offsets;
      const tableVersion = validatedTokenPayload.table_version;
      const detectedTableVersions = new Set<string>();

      const triggeredAt = new Date().toISOString();

      console.info("[battle-data] Step: About to enqueue to COMPACTION_QUEUE", {
        datasetId,
        table,
        periodTag,
        queueExists: !!env.runtime["COMPACTION_QUEUE"],
        timestamp: triggeredAt,
      });

      try {
        if (!env.runtime["COMPACTION_QUEUE"]) {
          console.warn("[battle-data] COMPACTION_QUEUE binding not available");
          return c.json(
            {
              error: "Server misconfiguration: COMPACTION_QUEUE not available",
            },
            500,
          );
        }

        // Parse table_offsets and split data into per-table Avro slices
        let offsets: TableOffsetMetadata[] = [];
        if (tableOffsets) {
          try {
            offsets = parseOffsetMetadata(JSON.parse(tableOffsets)) ?? [];
          } catch (e) {
            console.warn(
              "[battle-data] Failed to parse table_offsets for queue split",
              e,
            );
            offsets = [];
          }
        }

        // Get size limit from env (default 64KB per table slice)
        const maxBytes = env.buildtime["MAX_BATTLE_SLICE_BYTES"]
          ? parseInt(env.buildtime["MAX_BATTLE_SLICE_BYTES"], 10)
          : 65536;

        // Validate each table slice before batching
        // This is strict validation - all tables must pass before any are queued
        const validatedOffsets: ValidatedTableOffset[] = [];
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
            await env.runtime["COMPACTION_QUEUE"].send(messageBody);
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
  const indexDb = env.runtime["BATTLE_INDEX_DB"];

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

    const rows = parseBattleChunkRows(result.results || []);
    if (!rows) {
      throw new Error("D1 returned malformed results for chunks query");
    }
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
  const indexDb = env.runtime["BATTLE_INDEX_DB"];

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
      id: row["id"],
      file_path: row["file_path"],
      table: row["table_name"],
      table_version: row["table_version"],
      size: row["size"],
      record_count: row["record_count"],
      uploaded_at: formatTimestamp(row["start_timestamp"]),
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
 * Query params: table, period_tag, dataset_id, from, to
 * Response: array of fragment metadata sorted by uploaded_at DESC
 */
app.get("/global/chunks", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime["BATTLE_INDEX_DB"];
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = c.req.query("table");
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const datasetId = c.req.query("dataset_id")?.trim();
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

    if (periodTag === "latest") {
      const allowedPeriodTags = await resolveAllowedPeriodTagsForRecords(
        c,
        indexDb,
        table,
        env.runtime["DATA_LOADER_CACHE_KV"],
      );
      if (allowedPeriodTags.size === 0) {
        return c.json({ chunks: [], count: 0, table });
      }
      const placeholders = [...allowedPeriodTags].map(() => "?").join(", ");
      sql += ` AND bi.period_tag IN (${placeholders})`;
      params.push(...allowedPeriodTags);
    } else if (periodTag !== "all") {
      sql += " AND bi.period_tag = ?";
      params.push(periodTag);
    }

    if (tableVersion) {
      sql += ` AND bi.table_version = ?`;
      params.push(tableVersion);
    }
    if (datasetId) {
      sql += " AND bi.dataset_id = ?";
      params.push(datasetId);
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

    const rows = parseBattleChunkRows(result.results || []);
    if (!rows) {
      throw new Error("D1 returned malformed results for global chunks query");
    }
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
  const indexDb = env.runtime["BATTLE_INDEX_DB"];
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
      env.runtime["DATA_LOADER_CACHE_KV"],
    );

    const summaryRowsResult = await indexDb
      .prepare(
        "SELECT DISTINCT period_tag, table_version FROM block_indexes WHERE table_name = ? ORDER BY period_tag DESC, table_version DESC LIMIT 500",
      )
      .bind(table)
      .all();
    const parsedSummaryRows = BattleSummaryRowsSchema.safeParse(
      summaryRowsResult.results ?? [],
    );
    if (!parsedSummaryRows.success) {
      throw new Error("Invalid battle summary rows");
    }

    const seen = new Set<string>();
    const periods: Array<{ period_tag: string; table_version: string }> = [];
    for (const row of parsedSummaryRows.data) {
      const periodTag = row.period_tag;
      const tableVersion = row.table_version;
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
  const indexDb = env.runtime["BATTLE_INDEX_DB"];
  const bucket = env.runtime["BATTLE_DATA_BUCKET"];

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
  const fromTimestampMsRaw = c.req.query("from_timestamp_ms")?.trim();
  const toTimestampMsRaw = c.req.query("to_timestamp_ms")?.trim();
  const fromTimestampMs =
    fromTimestampMsRaw && Number.isFinite(Number(fromTimestampMsRaw))
      ? Number(fromTimestampMsRaw)
      : null;
  const toTimestampMs =
    toTimestampMsRaw && Number.isFinite(Number(toTimestampMsRaw))
      ? Number(toTimestampMsRaw)
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
      const parsed: unknown = JSON.parse(filterJsonRaw);
      if (!isJsonRecord(parsed)) {
        return c.json(
          {
            error: "INVALID_FILTER",
            message: "filter_json must be a JSON object",
          },
          400,
        );
      }
      recordFilter = parsed;
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
        cacheKV: env.runtime["DATA_LOADER_CACHE_KV"],
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
  if (cache && c.req.header("cache-control") !== "no-cache") {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const text = await cached.clone().text();
        JSON.parse(text);
        const hit = new Response(text, cached);
        hit.headers.set("X-FUSOU-Cache", "HIT");
        return hit;
      } catch {
        try {
          await cache.delete(cacheKey);
        } catch {
          // ignore cache delete errors
        }
      }
    }
  }

  const cacheKV = env.runtime["DATA_LOADER_CACHE_KV"] as
    | KVNamespace
    | undefined;
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
    kvKey = `battle-data:records:v2:${table}:${periodTagParam}:${tableVersionParam || "_"}:${datasetId || "_"}:${filterHash}:${limitBlocks}:${limitRecords}`;
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
      env.runtime["DATA_LOADER_CACHE_KV"],
    );

    const { resolvedPeriodTag, resolvedTableVersion } =
      await resolvePeriodAndTableVersionCached({
        indexDb,
        table,
        periodTagParam,
        tableVersionParam,
        datasetId,
        allowedPeriodTagSet,
      });

    const perTierFetchLimit = Math.max(limitBlocks + 1, 200);

    const fetchBlocks = async (
      tier: CompactionTier | null,
    ): Promise<{ results: BattleBlockRow[] } | null> => {
      let sql = `SELECT bi.id, bi.dataset_id, bi.start_byte, bi.length, bi.start_timestamp, bi.end_timestamp, bi.period_tag, bi.window_start_ms, bi.window_end_ms, bi.compaction_tier, af.file_path
               FROM block_indexes bi
               JOIN archived_files af ON af.id = bi.file_id
               WHERE bi.table_name = ?`;
      const params: unknown[] = [table];

      if (resolvedTableVersion) {
        sql += " AND bi.table_version = ?";
        params.push(resolvedTableVersion);
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

      if (fromTimestampMs != null) {
        sql += " AND bi.end_timestamp >= ?";
        params.push(fromTimestampMs);
      }

      if (toTimestampMs != null) {
        sql += " AND bi.start_timestamp <= ?";
        params.push(toTimestampMs);
      }

      if (datasetId) {
        sql += " AND bi.dataset_id = ?";
        params.push(datasetId);
      }

      sql += tier
        ? " ORDER BY bi.start_timestamp DESC LIMIT ?"
        : " ORDER BY CASE bi.compaction_tier WHEN 'period' THEN 0 WHEN 'weekly' THEN 1 WHEN 'daily' THEN 2 ELSE 3 END ASC, bi.start_timestamp DESC LIMIT ?";
      params.push(perTierFetchLimit);

      const result = await indexDb.prepare(sql).bind(...params).all?.();
      if (!result) {
        return null;
      }
      const rows = parseBattleBlockRows(result.results || []);
      if (!rows) {
        throw new Error("D1 returned malformed results for block query");
      }
      return { results: rows };
    };

    let blockResult: Awaited<ReturnType<typeof fetchBlocks>> | null | undefined;
    let effectiveTier: CompactionTier | null = compactionTier ?? null;

    if (compactionTier) {
      blockResult = await fetchBlocks(compactionTier);
      effectiveTier = compactionTier;
    } else {
      blockResult = await fetchBlocks(null);
      if (blockResult?.results) {
        const pruned = pruneSubsumedTierBlocks(blockResult.results);
        blockResult = { results: pruned.rows };
        effectiveTier = pruned.effectiveTier;
      }
    }

    if (blockResult == null) {
      const payload = {
        success: true,
        table,
        period_tag: periodTagParam,
        table_version: resolvedTableVersion,
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

    const candidateRows = blockResult?.results || [];
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
        table_version: resolvedTableVersion,
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

    const compiledFilter = recordFilter
      ? compileRecordFilter(recordFilter)
      : null;
    const decodedBlocks = await decodeIndexedBlocksCoalesced(
      bucket,
      rows,
      table,
      compiledFilter,
    );

    const decodedRecords: AvroJsonRecord[] = [];
    let recordsLimitReached = false;
    let matchedMinStartTimestampMs: number | null = null;
    let matchedMaxEndTimestampMs: number | null = null;
    outer: for (let blockIdx = 0; blockIdx < decodedBlocks.length; blockIdx += 1) {
      const recs = decodedBlocks[blockIdx] ?? [];
      if (recs.length > 0) {
        const blockRow = rows[blockIdx];
        const bStart = normalizeTimestamp(blockRow?.start_timestamp);
        const bEnd = normalizeTimestamp(blockRow?.end_timestamp) ?? bStart;
        if (bStart !== null) {
          matchedMinStartTimestampMs =
            matchedMinStartTimestampMs === null
              ? bStart
              : Math.min(matchedMinStartTimestampMs, bStart);
        }
        if (bEnd !== null) {
          matchedMaxEndTimestampMs =
            matchedMaxEndTimestampMs === null
              ? bEnd
              : Math.max(matchedMaxEndTimestampMs, bEnd);
        }
      }
      for (const rec of recs) {
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
      table_version: resolvedTableVersion,
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
      ...(matchedMinStartTimestampMs !== null
        ? { matched_min_start_timestamp_ms: matchedMinStartTimestampMs }
        : {}),
      ...(matchedMaxEndTimestampMs !== null
        ? { matched_max_end_timestamp_ms: matchedMaxEndTimestampMs }
        : {}),
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

async function getAggregatedOverviewPayload(
  bucket: R2Bucket,
  kv: KVNamespace | undefined,
): Promise<string> {
  const kvKey = "overview:snapshot:all:v2";
  if (kv) {
    try {
      const cached = await kv.get(kvKey);
      if (cached) {
        return cached;
      }
    } catch {
      // ignore KV error
    }
  }

  const snapshots = await Promise.all(
    KNOWN_PERIOD_TAGS.map(async (tag) => {
      try {
        const obj = await bucket.get(`snapshots/overview/${tag}.json.br`);
        if (!obj) return null;
        const buf = Buffer.from(await obj.arrayBuffer());
        const decomp = await brotliDecompressAsync(buf);
        return JSON.parse(decomp.toString("utf-8"));
      } catch {
        return null;
      }
    }),
  );

  const battlesMap = new Map<string, BattleRecord>();
  const cellsMap = new Map<string, Record<string, unknown>>();
  const decksMap = new Map<string, Record<string, unknown>>();
  const shipsMap = new Map<string, Record<string, unknown>>();

  for (const snap of snapshots) {
    if (!snap) continue;
    if (Array.isArray(snap.battles)) {
      for (const b of snap.battles) {
        if (!b) continue;
        const key = b.uuid ? String(b.uuid) : `${b.env_uuid}:${b.index}`;
        if (!battlesMap.has(key)) {
          battlesMap.set(key, b as BattleRecord);
        }
      }
    }
    if (Array.isArray(snap.cells)) {
      for (const cell of snap.cells) {
        if (!cell) continue;
        const key = cell.uuid ? String(cell.uuid) : `${cell.env_uuid}:${cell.maparea_id}-${cell.mapinfo_no}`;
        if (!cellsMap.has(key)) {
          cellsMap.set(key, cell as Record<string, unknown>);
        }
      }
    }
    if (Array.isArray(snap.enemy_decks)) {
      for (const deck of snap.enemy_decks) {
        if (!deck) continue;
        const key = deck.uuid ? String(deck.uuid) : `${deck.env_uuid}:${deck.ship_ids}`;
        if (!decksMap.has(key)) {
          decksMap.set(key, deck as Record<string, unknown>);
        }
      }
    }
    if (Array.isArray(snap.enemy_ships)) {
      for (const ship of snap.enemy_ships) {
        if (!ship) continue;
        const key = `${ship.uuid ?? ship.env_uuid}:${ship.index}`;
        if (!shipsMap.has(key)) {
          shipsMap.set(key, ship as Record<string, unknown>);
        }
      }
    }
  }

  const payload = {
    success: true,
    period_tag: "all",
    table_version: 1,
    snapshot_timestamp: Date.now(),
    battles: Array.from(battlesMap.values()),
    cells: Array.from(cellsMap.values()),
    enemy_decks: Array.from(decksMap.values()),
    enemy_ships: Array.from(shipsMap.values()),
  };

  const payloadText = JSON.stringify(payload);

  if (kv) {
    try {
      await kv.put(kvKey, payloadText, { expirationTtl: 86400 });
    } catch {
      // ignore KV write error
    }
  }

  return payloadText;
}

async function getAggregatedDropsPayload(
  bucket: R2Bucket,
  kv: KVNamespace | undefined,
): Promise<string> {
  const kvKey = "drops:snapshot:all:v2";
  if (kv) {
    try {
      const cached = await kv.get(kvKey);
      if (cached) {
        return cached;
      }
    } catch {
      // ignore KV error
    }
  }

  const snapshots = await Promise.all(
    KNOWN_PERIOD_TAGS.map(async (tag) => {
      try {
        const obj = await bucket.get(`snapshots/drops/${tag}.json.br`);
        if (!obj) return null;
        const buf = Buffer.from(await obj.arrayBuffer());
        const decomp = await brotliDecompressAsync(buf);
        return JSON.parse(decomp.toString("utf-8"));
      } catch {
        return null;
      }
    }),
  );

  const battlesMap = new Map<string, BattleRecord>();
  const mstShipsMap = new Map<string, Record<string, unknown>>();

  for (const snap of snapshots) {
    if (!snap) continue;
    if (Array.isArray(snap.battles)) {
      for (const b of snap.battles) {
        if (!b) continue;
        const key = b.uuid ? String(b.uuid) : `${b.env_uuid}:${b.index}`;
        if (!battlesMap.has(key)) {
          battlesMap.set(key, b as BattleRecord);
        }
      }
    }
    if (Array.isArray(snap.mst_ships)) {
      for (const s of snap.mst_ships) {
        if (!s) continue;
        const key = String(s.id ?? s.mst_ship_id ?? JSON.stringify(s));
        if (!mstShipsMap.has(key)) {
          mstShipsMap.set(key, s as Record<string, unknown>);
        }
      }
    }
  }

  const payload = {
    success: true,
    period_tag: "all",
    table_version: 1,
    snapshot_timestamp: Date.now(),
    battles: Array.from(battlesMap.values()),
    mst_ships: Array.from(mstShipsMap.values()),
  };

  const payloadText = JSON.stringify(payload);

  if (kv) {
    try {
      await kv.put(kvKey, payloadText, { expirationTtl: 86400 });
    } catch {
      // ignore KV write error
    }
  }

  return payloadText;
}

app.get("/global/overview", async (c) => {
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const cacheControl = getBattleDataCacheControl(periodTag);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });

  if (cache && c.req.header("cache-control") !== "no-cache") {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const text = await cached.clone().text();
        JSON.parse(text);
        const hit = new Response(text, cached);
        hit.headers.set("X-FUSOU-Cache", "HIT");
        return hit;
      } catch {
        try {
          await cache.delete(cacheKey);
        } catch {
          // ignore cache delete errors
        }
      }
    }
  }

  const env = createEnvContext(c);
  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  const indexDb = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  const kv = env.runtime["DATA_LOADER_CACHE_KV"] as KVNamespace | undefined;
  if (!bucket) {
    return c.json({ error: "Failed to build overview payload", details: "Storage not configured" }, 500);
  }

  if (periodTag === "all") {
    const payloadText = await getAggregatedOverviewPayload(bucket, kv);
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Cache-Control", cacheControl);
    headers.set("X-FUSOU-Cache", "SNAPSHOT-AGGREGATED");
    headers.set("X-FUSOU-Data-Source", "R2-SNAPSHOT");
    return new Response(payloadText, { status: 200, headers });
  }

  const activeTag = await resolveSnapshotPeriodTag(indexDb, periodTag);
  const snapshotKey = `snapshots/overview/${activeTag}.json.br`;
  const snapshotObj = await bucket.get(snapshotKey);
  if (!snapshotObj) {
    return c.json(
      {
        error: `Overview snapshot not found for period: ${activeTag}`,
        code: "SNAPSHOT_NOT_FOUND",
        period_tag: activeTag,
      },
      404,
    );
  }

  return await buildSnapshotResponse(c, await snapshotObj.arrayBuffer(), cacheControl, snapshotObj.httpEtag);
});

app.get("/global/drops", async (c) => {
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const cacheControl = getBattleDataCacheControl(periodTag);
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheKey = new Request(c.req.url, { method: "GET" });

  if (cache && c.req.header("cache-control") !== "no-cache") {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const text = await cached.clone().text();
        JSON.parse(text);
        const hit = new Response(text, cached);
        hit.headers.set("X-FUSOU-Cache", "HIT");
        return hit;
      } catch {
        try {
          await cache.delete(cacheKey);
        } catch {
          // ignore cache delete errors
        }
      }
    }
  }

  const env = createEnvContext(c);
  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  const indexDb = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  const kv = env.runtime["DATA_LOADER_CACHE_KV"] as KVNamespace | undefined;
  if (!bucket) {
    return c.json({ error: "Failed to build drops payload", details: "Storage not configured" }, 500);
  }

  if (periodTag === "all") {
    const payloadText = await getAggregatedDropsPayload(bucket, kv);
    const headers = new Headers();
    headers.set("Content-Type", "application/json");
    headers.set("Cache-Control", cacheControl);
    headers.set("X-FUSOU-Cache", "SNAPSHOT-AGGREGATED");
    headers.set("X-FUSOU-Data-Source", "R2-SNAPSHOT");
    return new Response(payloadText, { status: 200, headers });
  }

  const activeTag = await resolveSnapshotPeriodTag(indexDb, periodTag);
  const snapshotKey = `snapshots/drops/${activeTag}.json.br`;
  const snapshotObj = await bucket.get(snapshotKey);
  if (!snapshotObj) {
    return c.json(
      {
        error: `Drops snapshot not found for period: ${activeTag}`,
        code: "SNAPSHOT_NOT_FOUND",
        period_tag: activeTag,
      },
      404,
    );
  }

  return await buildSnapshotResponse(c, await snapshotObj.arrayBuffer(), cacheControl, snapshotObj.httpEtag);
});


app.get("/detail-env", async (c) => {
  const envUuid = (c.req.query("env_uuid") || "").trim();
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const tableVersion = (c.req.query("table_version") || "").trim();
  const cacheControl = getBattleDataCacheControl(periodTag);

  if (!envUuid) {
    return c.json({ error: "env_uuid is required" }, 400);
  }

  const env = createEnvContext(c);
  const cacheKV = env.runtime["DATA_LOADER_CACHE_KV"] as KVNamespace | undefined;
  const kvKey = `v7:battle_env_detail:${envUuid}`;

  if (cacheKV && c.req.header("cache-control") !== "no-cache") {
    try {
      const kvCached = await cacheKV.get(kvKey);
      if (kvCached) {
        return new Response(kvCached, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": cacheControl,
            "X-FUSOU-Cache": "HIT",
            "X-FUSOU-Data-Source": "KV-CACHE",
          },
        });
      }
    } catch {
      // ignore KV errors
    }
  }

  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  const indexDb = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (bucket) {
    let activeTag = await resolveSnapshotPeriodTag(indexDb, periodTag, envUuid);
    let envObj = await bucket.get(`snapshots/env_detail/${activeTag}/${envUuid}.json.br`);
    if (!envObj && (periodTag === "all" || periodTag === "latest")) {
      const fallbackTags = KNOWN_PERIOD_TAGS.filter((t) => t !== activeTag);
      const fallbackObjs = await Promise.all(
        fallbackTags.map(async (tag) => {
          const obj = await bucket.get(`snapshots/env_detail/${tag}/${envUuid}.json.br`);
          return obj ? { tag, obj } : null;
        }),
      );
      const found = fallbackObjs.find((item) => item !== null);
      if (found) {
        envObj = found.obj;
        activeTag = found.tag;
      }
    }

    if (envObj) {
      try {
        const text = await decompressSnapshotPayload(await envObj.arrayBuffer());
        const bundle = JSON.parse(text);
        if (bundle.tables && typeof bundle.tables === "object" && (!bundle.battles || Object.keys(bundle.battles).length === 0)) {
          const battlesList = Array.isArray(bundle.tables["battle"]) ? bundle.tables["battle"] : [];
          if (battlesList.length > 0) {
            const [mstShipPayload, mstSlotItemPayload, weaponIconFramesPayload] =
              await Promise.all([
                fetchMasterDataJsonDirect(c, "mst_ship").catch(() => ({ table_name: "mst_ship", table_version: null, period_tag: null, period_revision: null, records: [] })),
                fetchMasterDataJsonDirect(c, "mst_slotitem").catch(() => ({ table_name: "mst_slotitem", table_version: null, period_tag: null, period_revision: null, records: [] })),
                fetchWeaponIconFramesDirect(c).catch(() => ({})),
              ]);
            const battlesMap: Record<string, unknown> = {};
            for (const b of battlesList) {
              const bIdx = Number(b["index"] ?? 0);
              const resolved = resolveBattleDetail({
                periodTag: bundle.period_tag || activeTag,
                tableVersion: bundle.table_version || null,
                envUuid,
                battleIndex: bIdx,
                masterShips: mstShipPayload.records || [],
                masterSlotItems: mstSlotItemPayload.records || [],
                weaponIconFrames: weaponIconFramesPayload,
                tables: {
                  battle: battlesList,
                  cells: bundle.tables["cells"] || [],
                  battleResult: bundle.tables["battle_result"] || [],
                  ownDeck: bundle.tables["own_deck"] || [],
                  ownShip: bundle.tables["own_ship"] || [],
                  ownSlotItem: bundle.tables["own_slotitem"] || [],
                  enemyDeck: bundle.tables["enemy_deck"] || [],
                  enemyShip: bundle.tables["enemy_ship"] || [],
                  enemySlotItem: bundle.tables["enemy_slotitem"] || [],
                  midnightHougekiLists: bundle.tables["midnight_hougeki_list"] || [],
                  midnightHougekis: bundle.tables["midnight_hougeki"] || [],
                  openingTaisenLists: bundle.tables["opening_taisen_list"] || [],
                  openingTaisens: bundle.tables["opening_taisen"] || [],
                  hougekiLists: bundle.tables["hougeki_list"] || [],
                  hougekis: bundle.tables["hougeki"] || [],
                  openingAirattackLists: bundle.tables["opening_airattack_list"] || [],
                  openingAirattacks: bundle.tables["opening_airattack"] || [],
                  openingRaigeki: bundle.tables["opening_raigeki"] || [],
                  closingRaigeki: bundle.tables["closing_raigeki"] || [],
                  airbaseAssault: bundle.tables["airbase_assault"] || [],
                  airbaseAirattackLists: bundle.tables["airbase_airattack_list"] || [],
                  airbaseAirattacks: bundle.tables["airbase_airattack"] || [],
                  carrierbaseAssault: bundle.tables["carrierbase_assault"] || [],
                  supportHourai: bundle.tables["support_hourai"] || [],
                  supportAirattack: bundle.tables["support_airattack"] || [],
                  nightSupportHourai: bundle.tables["night_support_hourai"] || [],
                  nightSupportAirattack: bundle.tables["night_support_airattack"] || [],
                  friendlySupportHouraiLists: bundle.tables["friendly_support_hourai_list"] || [],
                  friendlySupportHourai: bundle.tables["friendly_support_hourai"] || [],
                  destructionBattle: bundle.tables["destruction_battle"] || [],
                },
              });
              if (resolved) {
                battlesMap[String(bIdx)] = resolved.payload;
              }
            }
            bundle.battles = battlesMap;
            bundle.success = true;
          }
        }
        const payloadText = JSON.stringify(bundle);
        if (cacheKV) {
          const ttl = periodTag === "latest" ? 86400 : 7 * 86400;
          safeWaitUntil(c, cacheKV.put(kvKey, payloadText, { expirationTtl: ttl }));
        }

        const res = new Response(payloadText, {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": cacheControl,
            "X-FUSOU-Cache": "SNAPSHOT-HIT",
            "X-FUSOU-Data-Source": "R2-SNAPSHOT",
            ...(envObj.httpEtag ? { ETag: envObj.httpEtag } : {}),
          },
        });
        return res;
      } catch (err) {
        console.warn("[battle_data] failed to decompress detail-env snapshot:", err);
      }
    }
  }

  return c.json({ error: "Sortie detail snapshot not found for env_uuid" }, 404);
});

app.get("/detail", async (c) => {
  const envUuid = (c.req.query("env_uuid") || "").trim();
  const battleIndexRaw = (c.req.query("battle_index") || "").trim();
  const periodTag = (c.req.query("period_tag") || "latest").trim();
  const tableVersion = (c.req.query("table_version") || "").trim();
  const datasetId = (c.req.query("dataset_id") || "").trim();
  const cacheControl = getBattleDataCacheControl(periodTag);

  if (!envUuid) {
    return c.json({ error: "env_uuid is required" }, 400);
  }

  if (!battleIndexRaw) {
    return c.json({ error: "battle_index is required" }, 400);
  }

  const battleIndex = Number(battleIndexRaw);
  if (
    !/^\d+$/.test(battleIndexRaw) ||
    !Number.isSafeInteger(battleIndex) ||
    battleIndex < 0
  ) {
    return c.json({ error: "battle_index must be a non-negative integer" }, 400);
  }

  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const cacheUrl = new URL(c.req.url);
  cacheUrl.searchParams.set("_cache_v", "7");
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  if (cache && c.req.header("cache-control") !== "no-cache") {
    const cached = await cache.match(cacheKey);
    if (cached) {
      try {
        const text = await cached.clone().text();
        JSON.parse(text);
        const hit = new Response(text, cached);
        hit.headers.set("X-FUSOU-Cache", "HIT");
        return hit;
      } catch {
        try {
          await cache.delete(cacheKey);
        } catch {
          // ignore
        }
      }
    }
  }

  const env = createEnvContext(c);
  const cacheKV = env.runtime["DATA_LOADER_CACHE_KV"] as KVNamespace | undefined;
  const kvKey = `v7:battle_detail:${envUuid}:${battleIndexRaw}`;

  // 1. Fast KV cache lookup (10-30ms) across all Cloudflare edge locations
  if (cacheKV && c.req.header("cache-control") !== "no-cache") {
    try {
      const kvCached = await cacheKV.get(kvKey);
      if (kvCached) {
        return new Response(kvCached, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": cacheControl,
            "X-FUSOU-Cache": "HIT",
            "X-FUSOU-Data-Source": "KV-CACHE",
          },
        });
      }
    } catch {
      // ignore KV errors
    }
  }

  const bucket = env.runtime["BATTLE_DATA_BUCKET"] as R2Bucket | undefined;
  const indexDb = env.runtime["BATTLE_INDEX_DB"] as D1Database | undefined;
  if (bucket) {
    let activeTag = await resolveSnapshotPeriodTag(indexDb, periodTag, envUuid);
    const tryResolveDetail = async (targetTag: string): Promise<Response | null> => {
      // 1. Direct single-battle snapshot check in R2 (checks plain .json and .json.br)
      const directKeyJson = `snapshots/detail/${targetTag}/${envUuid}_${battleIndexRaw}.json`;
      const directKeyBr = `snapshots/detail/${targetTag}/${envUuid}_${battleIndexRaw}.json.br`;
      const detailObj = (await bucket.get(directKeyJson)) ?? (await bucket.get(directKeyBr));
      if (detailObj) {
        const resp = await buildSnapshotResponse(c, await detailObj.arrayBuffer(), cacheControl, detailObj.httpEtag);
        // Populate KV cache for subsequent instant hits
        if (cacheKV) {
          const cloneResp = resp.clone();
          safeWaitUntil(
            c,
            (async () => {
              try {
                const text = await cloneResp.text();
                const ttl = periodTag === "latest" ? 86400 : 7 * 86400;
                await cacheKV.put(kvKey, text, { expirationTtl: ttl });
              } catch {
                // ignore
              }
            })(),
          );
        }
        return resp;
      }

      // 2. Sortie-level bundled snapshot check in R2
      const envKey = `snapshots/env_detail/${targetTag}/${envUuid}.json.br`;
      const envObj = await bucket.get(envKey);
      if (envObj) {
        try {
          const text = await decompressSnapshotPayload(await envObj.arrayBuffer());
          const bundle = JSON.parse(text);
          // Format A: pre-resolved battles bundle
          const battlePayload = bundle.battles?.[battleIndexRaw] ?? bundle.battles?.[String(battleIndex)];
          if (battlePayload) {
            const payloadStr = JSON.stringify(battlePayload);
            if (cacheKV) {
              const ttl = periodTag === "latest" ? 86400 : 7 * 86400;
              safeWaitUntil(c, cacheKV.put(kvKey, payloadStr, { expirationTtl: ttl }));
            }
            // Asynchronously write through single battle snapshot to R2 directly (plain JSON, infallible and fast)
            if (typeof bucket.put === "function") {
              safeWaitUntil(
                c,
                bucket.put(directKeyJson, payloadStr, {
                  httpMetadata: { contentType: "application/json" },
                }).catch((e) => console.warn("[battle_data] write-through directKeyJson failed:", e))
              );
            }
            return new Response(payloadStr, {
              status: 200,
              headers: {
                "Content-Type": "application/json",
                "Cache-Control": cacheControl,
                "X-FUSOU-Cache": "SNAPSHOT-HIT",
                "X-FUSOU-Data-Source": "R2-SNAPSHOT",
              },
            });
          }

          // Format B: raw tables bundle (generated by workflow snapshot_generator)
          if (bundle.tables && typeof bundle.tables === "object") {
            const [mstShipPayload, mstSlotItemPayload, weaponIconFramesPayload] =
              await Promise.all([
                fetchMasterDataJsonDirect(c, "mst_ship").catch(() => ({ table_name: "mst_ship", table_version: null, period_tag: null, period_revision: null, records: [] })),
                fetchMasterDataJsonDirect(c, "mst_slotitem").catch(() => ({ table_name: "mst_slotitem", table_version: null, period_tag: null, period_revision: null, records: [] })),
                fetchWeaponIconFramesDirect(c).catch(() => ({})),
              ]);
            const resolvedDetail = resolveBattleDetail({
              periodTag: bundle.period_tag || targetTag,
              tableVersion: bundle.table_version || tableVersion || null,
              envUuid,
              battleIndex,
              masterShips: mstShipPayload.records || [],
              masterSlotItems: mstSlotItemPayload.records || [],
              weaponIconFrames: weaponIconFramesPayload,
              tables: {
                battle: bundle.tables["battle"] || [],
                cells: bundle.tables["cells"] || [],
                battleResult: bundle.tables["battle_result"] || [],
                ownDeck: bundle.tables["own_deck"] || [],
                ownShip: bundle.tables["own_ship"] || [],
                ownSlotItem: bundle.tables["own_slotitem"] || [],
                enemyDeck: bundle.tables["enemy_deck"] || [],
                enemyShip: bundle.tables["enemy_ship"] || [],
                enemySlotItem: bundle.tables["enemy_slotitem"] || [],
                midnightHougekiLists: bundle.tables["midnight_hougeki_list"] || [],
                midnightHougekis: bundle.tables["midnight_hougeki"] || [],
                openingTaisenLists: bundle.tables["opening_taisen_list"] || [],
                openingTaisens: bundle.tables["opening_taisen"] || [],
                hougekiLists: bundle.tables["hougeki_list"] || [],
                hougekis: bundle.tables["hougeki"] || [],
                openingAirattackLists: bundle.tables["opening_airattack_list"] || [],
                openingAirattacks: bundle.tables["opening_airattack"] || [],
                openingRaigeki: bundle.tables["opening_raigeki"] || [],
                closingRaigeki: bundle.tables["closing_raigeki"] || [],
                airbaseAssault: bundle.tables["airbase_assault"] || [],
                airbaseAirattackLists: bundle.tables["airbase_airattack_list"] || [],
                airbaseAirattacks: bundle.tables["airbase_airattack"] || [],
                carrierbaseAssault: bundle.tables["carrierbase_assault"] || [],
                supportHourai: bundle.tables["support_hourai"] || [],
                supportAirattack: bundle.tables["support_airattack"] || [],
                nightSupportHourai: bundle.tables["night_support_hourai"] || [],
                nightSupportAirattack: bundle.tables["night_support_airattack"] || [],
                friendlySupportHouraiLists: bundle.tables["friendly_support_hourai_list"] || [],
                friendlySupportHourai: bundle.tables["friendly_support_hourai"] || [],
                destructionBattle: bundle.tables["destruction_battle"] || [],
              },
            });
            if (resolvedDetail) {
              const payloadStr = JSON.stringify(resolvedDetail.payload);
              // Save to global KV cache immediately
              if (cacheKV) {
                const ttl = periodTag === "latest" ? 86400 : 7 * 86400;
                safeWaitUntil(c, cacheKV.put(kvKey, payloadStr, { expirationTtl: ttl }));
              }
              // Asynchronously write through single battle snapshot to R2 directly (plain JSON, infallible and fast)
              if (typeof bucket.put === "function") {
                safeWaitUntil(
                  c,
                  bucket.put(directKeyJson, payloadStr, {
                    httpMetadata: { contentType: "application/json" },
                  }).catch((e) => console.warn("[battle_data] write-through directKeyJson failed:", e))
                );
              }

              return new Response(payloadStr, {
                status: 200,
                headers: {
                  "Content-Type": "application/json",
                  "Cache-Control": cacheControl,
                  "X-FUSOU-Cache": "SNAPSHOT-HIT",
                  "X-FUSOU-Data-Source": "R2-SNAPSHOT",
                },
              });
            }
          }
        } catch (err) {
          console.warn("[battle_data] failed to read env_detail snapshot:", err);
        }
      }
      return null;
    };

    let resolvedResp = await tryResolveDetail(activeTag);
    if (!resolvedResp && (periodTag === "all" || periodTag === "latest")) {
      const fallbackTags = KNOWN_PERIOD_TAGS.filter((t) => t !== activeTag);
      const fallbackResults = await Promise.all(fallbackTags.map((tag) => tryResolveDetail(tag)));
      const hit = fallbackResults.find((r) => r !== null);
      if (hit) {
        resolvedResp = hit;
      }
    }
    if (resolvedResp) {
      if (cache) {
        await putCacheSafely(c, cache, cacheKey, resolvedResp);
      }
      return resolvedResp;
    }

    return c.json(
      {
        error: `Battle detail snapshot not found for env_uuid: ${envUuid}, battle_index: ${battleIndexRaw}`,
        code: "SNAPSHOT_NOT_FOUND",
        env_uuid: envUuid,
        battle_index: battleIndex,
        period_tag: activeTag,
      },
      404,
    );
  }

  return c.json({ error: "Storage not configured" }, 500);
});

app.get("/global/latest", async (c) => {
  const env = createEnvContext(c);
  const indexDb = env.runtime["BATTLE_INDEX_DB"];
  if (!indexDb) {
    return c.json({ error: "D1 database not configured" }, 500);
  }

  const table = c.req.query("table");

  if (!table) {
    return c.json({ error: "table is required" }, 400);
  }

  try {
    const periodTag = (c.req.query("period_tag") || "latest").trim();
    const tableVersion = c.req.query("table_version");
    const datasetId = c.req.query("dataset_id")?.trim();
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
    if (periodTag === "latest") {
      const allowedPeriodTags = await resolveAllowedPeriodTagsForRecords(
        c,
        indexDb,
        table,
        env.runtime["DATA_LOADER_CACHE_KV"],
      );
      if (allowedPeriodTags.size === 0) {
        return c.json({ error: "No fragments found" }, 404);
      }
      const placeholders = [...allowedPeriodTags].map(() => "?").join(", ");
      globalLatestSql += ` AND bi.period_tag IN (${placeholders})`;
      globalLatestParams.push(...allowedPeriodTags);
    } else if (periodTag !== "all") {
      globalLatestSql += " AND bi.period_tag = ?";
      globalLatestParams.push(periodTag);
    }
    if (tableVersion) {
      globalLatestSql += ` AND bi.table_version = ?`;
      globalLatestParams.push(tableVersion);
    }
    if (datasetId) {
      globalLatestSql += " AND bi.dataset_id = ?";
      globalLatestParams.push(datasetId);
    }
    globalLatestSql += ` ORDER BY bi.start_timestamp DESC LIMIT 1`;

    const stmt = indexDb.prepare(globalLatestSql);
    const row = await stmt.bind(...globalLatestParams).first?.();
    if (!row) {
      return c.json({ error: "No fragments found" }, 404);
    }

    const latest = {
      id: row["id"],
      file_path: row["file_path"],
      table: row["table_name"],
      table_version: row["table_version"],
      size: row["size"],
      record_count: row["record_count"],
      uploaded_at: formatTimestamp(row["start_timestamp"]),
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
  const indexDb = env.runtime["BATTLE_INDEX_DB"];

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

    let records: BattleRecord[] = [];

    const parseDetailRows = (value: unknown): BattleRecord[] => {
      const parsed = parseBattleJsonRecords(value);
      if (!parsed) {
        throw new Error("Invalid battle detail D1 rows");
      }
      return parsed;
    };

    if (table === "battle") {
      const battleResult = await indexDb
        .prepare(`SELECT * FROM battle WHERE uuid = ?`)
        .bind(battleId)
        .all?.();

      const openingRaigekiResult = await indexDb
        .prepare(`SELECT * FROM opening_raigeki WHERE battle_id = ?`)
        .bind(battleId)
        .all?.();

      const ownShipResult = await indexDb
        .prepare(`SELECT * FROM own_ship WHERE battle_id = ?`)
        .bind(battleId)
        .all?.();

      const enemyShipResult = await indexDb
        .prepare(`SELECT * FROM enemy_ship WHERE battle_id = ?`)
        .bind(battleId)
        .all?.();

      records = parseDetailRows(battleResult?.results);
      const openingRaigekiRecords = parseDetailRows(openingRaigekiResult?.results);
      const ownShipRecords = parseDetailRows(ownShipResult?.results);
      const enemyShipRecords = parseDetailRows(enemyShipResult?.results);
      const firstRecord = records[0];
      const firstOpeningRaigeki = openingRaigekiRecords[0];
      if (firstRecord && firstOpeningRaigeki) {
        firstRecord["opening_raigeki"] = transformOpeningRaigekiData(
          firstOpeningRaigeki,
        );
      }
      if (firstRecord && ownShipRecords.length) {
        firstRecord["own_ship"] = ownShipRecords;
      }
      if (firstRecord && enemyShipRecords.length) {
        firstRecord["enemy_ship"] = enemyShipRecords;
      }
      // DEV: Inject synthetic hougeki (shelling) data for test UUID
      if (firstRecord && battleId === "test-multi-attacker-001") {
        // 1番艦(idx0)→敵6番(idx5)単発、2番艦(idx1)と3番艦(idx2)→同じ敵5番(idx4)連撃
        // 友軍HP: 全ターン変化なし(被弾なし)
        const fH = [100, 120, 110, 90, 80, 70];
        // 敵HP: ターンごとに減少
        const eH0 = [100, 120, 110, 90, 200, 130]; // 開始前
        const eH1 = [100, 120, 110, 90, 200, 102]; // 1番艦→敵6番 (-28後)
        const eH2 = [100, 120, 110, 90, 165, 102]; // 2番艦→敵5番1/2 (-35後)
        const eH3 = [100, 120, 110, 90, 143, 102]; // 2番艦→敵5番2/2 (-22後)
        const eH4 = [100, 120, 110, 90, 125, 102]; // 3番艦→敵5番1/2 (-18後)
        firstRecord["hougeki"] = {
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
      const result = await indexDb
        .prepare(`SELECT * FROM ${table} WHERE ${safeField} = ?`)
        .bind(safeValue)
        .all?.();
      records = parseDetailRows(result?.results);
    } else {
      const result = await indexDb
        .prepare(
          `SELECT * FROM ${table} WHERE uuid = ? OR battle_id = ? OR id = ?`,
        )
        .bind(safeValue, safeValue, safeValue)
        .all?.();
      records = parseDetailRows(result?.results);
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
    const msg =
      typeof err === "object" && err !== null && "message" in err
        ? String(err.message)
        : String(err ?? "");
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