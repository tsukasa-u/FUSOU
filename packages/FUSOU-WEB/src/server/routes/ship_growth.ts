import { Hono } from "hono";
import type { Bindings, D1Database } from "../types";
import { decodeAvroOcfToJson } from "../utils/avro-decoder";
import { getSynergyManifestR2Keys } from "../types/synergy";
import {
  createEnvContext,
  generateSignedToken,
  getEnv,
  parseStrictBoolean,
  resolveDatasetToken,
  timingSafeEqual,
  validateDatasetTokenSecret,
  validateDatasetTokenWithConstraints,
  validateJWT,
  validateTokenPayload,
  verifySignedToken,
  safeWaitUntil,
  safeGetExecutionCtx,
} from "../utils";
import {
  invalidateCanonicalSnapshots,
  loadOrRefreshCanonicalSnapshot,
  saveCanonicalSnapshotToKv,
} from "../utils/snapshot-cache";
import {
  isValidPeriodTagDate,
  validateCachedPeriodTag,
} from "../utils/period-tags";
import { validateSynergyPayload } from "../utils/synergy-payload";
import {
  enforceUploadExecutionSecurityGuards,
  readUploadRequestBodyWithLimit,
  resolveUploadTrustDecision,
} from "../utils/upload";

const SHIP_GROWTH_COLLECTION_SWITCH_ENV = "SHIP_GROWTH_COLLECTION_ENABLED";

const app = new Hono<{ Bindings: Bindings }>();

// ── Types ──────────────────────────────────────────────────────────

interface ShipEntry {
  master_id: number;
  lv: number;
  exp_current: number;
  exp_to_next?: number | null;
  kyouka: number[];
  sp_effect_items_json?: string | null;
  kaihi_observed: number;
  taisen_observed: number;
  sakuteki_observed: number;
  lucky_observed: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
  lucky_naked: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
  slots: { slotitem_id: number; locked: boolean; level: number; alv: number }[];
  exslot?: {
    slotitem_id: number;
    locked: boolean;
    level: number;
    alv: number;
  } | null;
}

interface IngestBody {
  dataset_id: string;
  dataset_token?: string;
  request_id: string;
  payload_hash: string;
  event_type: string;
  timestamp_ms: number;
  period_tag: string;
  table_version: string;
  ships: ShipEntry[];
  content_hash?: string;
  file_size?: number | string;
}

interface MasterSlotStats {
  houk: number;
  tais: number;
  saku: number;
  luck: number;
}

interface DerivedNakedStats {
  kaihi: number;
  taisen: number;
  sakuteki: number;
  lucky: number;
}

interface DeriveResult {
  stats: DerivedNakedStats;
  missingSlotItemIds: number[];
  breakdown: ServerDerivationBreakdown;
}

interface AggregatedExpRow {
  lv: number;
  exp_current: number;
}

interface AggregatedBoundRow {
  master_id: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
  lucky_naked: number;
}

interface AggregatedCapRow {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
}

interface ShipGrowthArchiveBoundRow {
  row_id: number;
  period_tag: string;
  table_version: string;
  master_id: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
  lucky_naked: number;
}

interface ShipGrowthArchiveCapRow {
  row_id: number;
  period_tag: string;
  table_version: string;
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
}

type SpEffectItem = {
  api_kind?: number | null;
  api_houg?: number | null;
  api_kaih?: number | null;
  api_raig?: number | null;
  api_souk?: number | null;
};

interface SpEffectStats {
  kind: number;
  houg: number;
  kaih: number;
  raig: number;
  souk: number;
}

interface SynergyStatTotals {
  kaihi: number;
  taisen: number;
  sakuteki: number;
  lucky: number;
}

interface SynergySingleRule {
  ships?: unknown;
  b?: Record<string, unknown>;
  l?: Record<string, unknown>;
  c2?: Record<string, unknown>;
  c3?: Record<string, unknown>;
}

interface SynergyCrossRule {
  ships?: unknown;
  synergy?: Record<string, unknown>;
}

interface SynergyDataSet {
  singleByItem: Map<number, SynergySingleRule[]>;
  crossByPair: Map<string, SynergyCrossRule[]>;
}

interface ServerDerivationBreakdown {
  removed: {
    slot: SynergyStatTotals;
    spEffect: SynergyStatTotals;
    synergy: {
      single: SynergyStatTotals;
      cross: SynergyStatTotals;
      total: SynergyStatTotals;
    };
  };
  spEffectItems: SpEffectStats[];
}

const MASTER_SLOTITEM_CACHE_TTL_MS = 5 * 60 * 1000;
const SYNERGY_CACHE_TTL_MS = 5 * 60 * 1000;
const masterSlotItemCache = new Map<
  string,
  {
    loadedAt: number;
    statsMap: Map<number, MasterSlotStats>;
  }
>();
const synergyDataCache = new Map<
  string,
  {
    loadedAt: number;
    dataSet: SynergyDataSet;
  }
>();

// ── Helpers ────────────────────────────────────────────────────────

async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data as unknown as BufferSource,
  );
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function isValidInt(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value)
  );
}

function parseMasterSlotStatsMap(
  records: Array<Record<string, unknown>>,
): Map<number, MasterSlotStats> {
  const statsMap = new Map<number, MasterSlotStats>();
  for (const row of records) {
    const rawId = row.id;
    const id =
      typeof rawId === "number" && Number.isFinite(rawId)
        ? Math.trunc(rawId)
        : null;
    if (id == null || id <= 0) continue;

    const houkRaw = row.houk;
    const taisRaw = row.tais;
    const sakuRaw = row.saku;
    const luckRaw = row.luck;

    const houk =
      typeof houkRaw === "number" && Number.isFinite(houkRaw)
        ? Math.trunc(houkRaw)
        : 0;
    const tais =
      typeof taisRaw === "number" && Number.isFinite(taisRaw)
        ? Math.trunc(taisRaw)
        : 0;
    const saku =
      typeof sakuRaw === "number" && Number.isFinite(sakuRaw)
        ? Math.trunc(sakuRaw)
        : 0;
    const luck =
      typeof luckRaw === "number" && Number.isFinite(luckRaw)
        ? Math.trunc(luckRaw)
        : 0;

    statsMap.set(id, { houk, tais, saku, luck });
  }
  return statsMap;
}

async function loadMasterSlotStatsMap(
  env: Bindings,
  periodTag: string,
  tableVersion: string,
): Promise<Map<number, MasterSlotStats>> {
  const cacheKey = `${periodTag}:${tableVersion}`;
  const cached = masterSlotItemCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < MASTER_SLOTITEM_CACHE_TTL_MS) {
    return cached.statsMap;
  }

  const record = (await env.MASTER_DATA_INDEX_DB.prepare(
    `SELECT t.r2_key
       FROM master_data_tables t
       JOIN master_data_index i ON i.id = t.master_data_id
       WHERE i.upload_status = 'completed'
         AND i.period_tag = ?
         AND i.table_version = ?
         AND t.table_name = 'mst_slotitem'
       ORDER BY i.period_revision DESC
       LIMIT 1`,
  )
    .bind(periodTag, tableVersion)
    .first()) as { r2_key?: string } | null;

  if (!record?.r2_key) {
    throw new Error(
      `master data not found for mst_slotitem (period_tag=${periodTag}, table_version=${tableVersion})`,
    );
  }

  const r2Object = await env.MASTER_DATA_BUCKET.get(record.r2_key);
  if (!r2Object) {
    throw new Error(`R2 object missing for mst_slotitem: ${record.r2_key}`);
  }

  const arrayBuffer = await r2Object.arrayBuffer();
  const avroBytes = new Uint8Array(arrayBuffer);
  const decodedRecords = decodeAvroOcfToJson(avroBytes) as Array<
    Record<string, unknown>
  >;
  const statsMap = parseMasterSlotStatsMap(decodedRecords);

  masterSlotItemCache.set(cacheKey, {
    loadedAt: Date.now(),
    statsMap,
  });

  return statsMap;
}

function parseSpEffectItems(json: string | null | undefined): SpEffectItem[] {
  if (!json || !json.trim()) return [];
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is SpEffectItem => typeof item === "object" && item != null,
    );
  } catch {
    return [];
  }
}

function toInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : 0;
}

function emptyTotals(): SynergyStatTotals {
  return { kaihi: 0, taisen: 0, sakuteki: 0, lucky: 0 };
}

function addTotals(
  a: SynergyStatTotals,
  b: SynergyStatTotals,
): SynergyStatTotals {
  return {
    kaihi: a.kaihi + b.kaihi,
    taisen: a.taisen + b.taisen,
    sakuteki: a.sakuteki + b.sakuteki,
    lucky: a.lucky + b.lucky,
  };
}

function scaleTotals(value: SynergyStatTotals, n: number): SynergyStatTotals {
  return {
    kaihi: value.kaihi * n,
    taisen: value.taisen * n,
    sakuteki: value.sakuteki * n,
    lucky: value.lucky * n,
  };
}

function toShipTotals(
  raw: Record<string, unknown> | undefined,
): SynergyStatTotals {
  if (!raw) return emptyTotals();
  const kaihi = toInt(raw.kaih) + toInt(raw.houk) + toInt(raw.kaihi);
  const taisen = toInt(raw.tais) + toInt(raw.taisen);
  const sakuteki = toInt(raw.saku) + toInt(raw.sakuteki);
  const lucky = toInt(raw.luck) + toInt(raw.luk) + toInt(raw.lucky);
  return { kaihi, taisen, sakuteki, lucky };
}

function hasShipRule(
  rule: SynergySingleRule | SynergyCrossRule,
  masterId: number,
): boolean {
  return (
    Array.isArray(rule.ships) && rule.ships.some((id) => toInt(id) === masterId)
  );
}

function pickSingleSynergyTotals(
  rule: SynergySingleRule,
  count: number,
  hasStar10: boolean,
): SynergyStatTotals {
  const base = toShipTotals((hasStar10 ? rule.l : rule.b) ?? rule.b ?? rule.l);
  if (count <= 1) return base;

  if (count === 2) {
    const c2 = toShipTotals(rule.c2);
    return c2.kaihi !== 0 ||
      c2.taisen !== 0 ||
      c2.sakuteki !== 0 ||
      c2.lucky !== 0
      ? c2
      : scaleTotals(base, 2);
  }

  const c3 = toShipTotals(rule.c3);
  return c3.kaihi !== 0 ||
    c3.taisen !== 0 ||
    c3.sakuteki !== 0 ||
    c3.lucky !== 0
    ? c3
    : scaleTotals(base, count);
}

async function loadSynergyDataSet(
  env: Bindings,
  periodTag: string,
): Promise<SynergyDataSet> {
  const rows = (await env.MASTER_DATA_INDEX_DB.prepare(
    `SELECT period_tag, period_revision, content_hash, sp_effect_sha256
     FROM synergy_manifest
     WHERE period_tag = ?
       AND upload_status = 'completed'
     ORDER BY period_revision DESC
     LIMIT 20`,
  )
    .bind(periodTag)
    .all()) as {
    results?: Array<{
      period_tag?: string;
      period_revision?: number;
      content_hash?: string;
      sp_effect_sha256?: string;
    }>;
  };

  const manifests = rows.results ?? [];
  if (manifests.length === 0) {
    throw new Error(`synergy manifest not found for period_tag=${periodTag}`);
  }

  let selectedManifest: {
    period_tag: string;
    period_revision: number;
    content_hash: string;
    sp_effect_sha256: string;
  } | null = null;
  type ParsedSynergyPayload = {
    effects?: Record<string, unknown>;
    cross_effects?: Record<string, unknown>;
    effect_rules?: Array<{
      ships: number[];
      b: Record<string, number>;
      l?: Record<string, number>;
      c2?: Record<string, number>;
      c3?: Record<string, number>;
      items: number[];
    }>;
    cross_rules?: Array<{
      ships: number[];
      synergy: Record<string, number>;
      pairs: Array<[number, number]>;
    }>;
  };

  let parsed: ParsedSynergyPayload | null = null;
  let lastLoadError: unknown = null;

  for (const manifest of manifests) {
    const periodRevision = manifest.period_revision;
    if (
      !manifest.period_tag ||
      typeof periodRevision !== "number" ||
      !Number.isInteger(periodRevision) ||
      !manifest.content_hash ||
      !manifest.sp_effect_sha256
    ) {
      continue;
    }

    const cacheKey = `${manifest.period_tag}:${periodRevision}:${manifest.content_hash}:${manifest.sp_effect_sha256}`;
    const cached = synergyDataCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < SYNERGY_CACHE_TTL_MS) {
      return cached.dataSet;
    }

    const r2Keys = getSynergyManifestR2Keys(
      manifest.period_tag,
      periodRevision,
      manifest.content_hash,
    );
    const object = await env.MASTER_DATA_BUCKET.get(r2Keys.sp_effect_json);
    if (!object) {
      continue;
    }

    try {
      parsed = (
        await validateSynergyPayload(
          new Uint8Array(await object.arrayBuffer()),
          manifest.sp_effect_sha256,
        )
      ).parsed as ParsedSynergyPayload;
      selectedManifest = {
        period_tag: manifest.period_tag,
        period_revision: periodRevision,
        content_hash: manifest.content_hash,
        sp_effect_sha256: manifest.sp_effect_sha256,
      };
      break;
    } catch (error) {
      lastLoadError = error;
      console.warn(
        `[ship-growth] skipping invalid synergy payload (period=${periodTag}, revision=${periodRevision}): ${String(error)}`,
      );
    }
  }

  if (!selectedManifest || !parsed) {
    if (lastLoadError) {
      throw new Error(
        `synergy payload validation failed for period_tag=${periodTag}: ${String(lastLoadError)}`,
      );
    }
    throw new Error(`synergy data missing in R2 for period_tag=${periodTag}`);
  }

  const parsedPayload = parsed;

  const singleByItem = new Map<number, SynergySingleRule[]>();
  let droppedSingleCount = 0;

  // Prefer new effect_rules format; fall back to legacy effects dict
  if (parsedPayload.effect_rules && Array.isArray(parsedPayload.effect_rules)) {
    for (const rule of parsedPayload.effect_rules) {
      if (!rule || !Array.isArray(rule.items)) continue;
      const synRule: SynergySingleRule = {
        ships: rule.ships ?? [],
        b: rule.b ?? {},
        l: rule.l,
        c2: rule.c2,
        c3: rule.c3,
      };
      for (const itemId of rule.items) {
        if (!Number.isInteger(itemId) || itemId <= 0) {
          droppedSingleCount++;
          continue;
        }
        let list = singleByItem.get(itemId);
        if (!list) {
          list = [];
          singleByItem.set(itemId, list);
        }
        list.push(synRule);
      }
    }
  } else {
    for (const [itemKey, rawRules] of Object.entries(
      parsedPayload.effects ?? {},
    )) {
      const itemId = Number(itemKey);
      if (
        !Number.isInteger(itemId) ||
        itemId <= 0 ||
        !Array.isArray(rawRules)
      ) {
        droppedSingleCount += 1;
        continue;
      }
      singleByItem.set(
        itemId,
        rawRules.filter(
          (rule) => typeof rule === "object" && rule != null,
        ) as SynergySingleRule[],
      );
    }
  }
  if (droppedSingleCount > 0) {
    console.warn(
      `[ship-growth] Dropped ${droppedSingleCount} invalid synergy single entries (period=${periodTag})`,
    );
  }

  const crossByPair = new Map<string, SynergyCrossRule[]>();
  let droppedCrossCount = 0;

  // Prefer new cross_rules format; fall back to legacy cross_effects dict
  if (parsedPayload.cross_rules && Array.isArray(parsedPayload.cross_rules)) {
    for (const rule of parsedPayload.cross_rules) {
      if (!rule || !Array.isArray(rule.pairs)) continue;
      const synRule: SynergyCrossRule = {
        ships: rule.ships ?? [],
        synergy: rule.synergy ?? {},
      };
      for (const [a, b] of rule.pairs) {
        const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        let list = crossByPair.get(key);
        if (!list) {
          list = [];
          crossByPair.set(key, list);
        }
        list.push(synRule);
      }
    }
  } else {
    for (const [pairKey, rawRules] of Object.entries(
      parsedPayload.cross_effects ?? {},
    )) {
      if (!Array.isArray(rawRules)) {
        droppedCrossCount += 1;
        continue;
      }
      crossByPair.set(
        pairKey,
        rawRules.filter(
          (rule) => typeof rule === "object" && rule != null,
        ) as SynergyCrossRule[],
      );
    }
  }
  if (droppedCrossCount > 0) {
    console.warn(
      `[ship-growth] Dropped ${droppedCrossCount} invalid synergy cross entries (period=${periodTag})`,
    );
  }

  const dataSet: SynergyDataSet = {
    singleByItem,
    crossByPair,
  };
  const cacheKey = `${selectedManifest.period_tag}:${selectedManifest.period_revision}:${selectedManifest.content_hash}:${selectedManifest.sp_effect_sha256}`;
  synergyDataCache.set(cacheKey, {
    loadedAt: Date.now(),
    dataSet,
  });
  return dataSet;
}

function deriveServerNakedStats(
  ship: ShipEntry,
  slotStatsMap: Map<number, MasterSlotStats>,
  synergyDataSet: SynergyDataSet,
): DeriveResult {
  const allSlots = [...ship.slots, ...(ship.exslot ? [ship.exslot] : [])];
  const missingSlotItemIds: number[] = [];

  let slotKaihi = 0;
  let slotTaisen = 0;
  let slotSakuteki = 0;
  let slotLucky = 0;
  for (const slot of allSlots) {
    if (!Number.isInteger(slot.slotitem_id) || slot.slotitem_id <= 0) continue;
    const stats = slotStatsMap.get(slot.slotitem_id);
    if (!stats) {
      missingSlotItemIds.push(slot.slotitem_id);
      continue;
    }
    slotKaihi += stats.houk;
    slotTaisen += stats.tais;
    slotSakuteki += stats.saku;
    slotLucky += stats.luck;
  }

  const spEffectItems = parseSpEffectItems(ship.sp_effect_items_json).map(
    (item) => ({
      kind: toInt(item.api_kind),
      houg: toInt(item.api_houg),
      kaih: toInt(item.api_kaih),
      raig: toInt(item.api_raig),
      souk: toInt(item.api_souk),
    }),
  );
  const spEffectKaihi = spEffectItems.reduce((acc, item) => acc + item.kaih, 0);

  const itemCountMap = new Map<number, { count: number; hasStar10: boolean }>();
  for (const slot of allSlots) {
    if (!Number.isInteger(slot.slotitem_id) || slot.slotitem_id <= 0) continue;
    const current = itemCountMap.get(slot.slotitem_id) ?? {
      count: 0,
      hasStar10: false,
    };
    current.count += 1;
    current.hasStar10 = current.hasStar10 || slot.level >= 10;
    itemCountMap.set(slot.slotitem_id, current);
  }

  let singleSynergyTotals = emptyTotals();
  for (const [itemId, state] of itemCountMap.entries()) {
    const rules = synergyDataSet.singleByItem.get(itemId);
    if (!rules || rules.length === 0) continue;
    const matched = rules.find((rule) => hasShipRule(rule, ship.master_id));
    if (!matched) continue;
    singleSynergyTotals = addTotals(
      singleSynergyTotals,
      pickSingleSynergyTotals(matched, state.count, state.hasStar10),
    );
  }

  const equippedItemIds = Array.from(itemCountMap.keys()).sort((a, b) => a - b);
  let crossSynergyTotals = emptyTotals();
  for (let i = 0; i < equippedItemIds.length; i += 1) {
    for (let j = i + 1; j < equippedItemIds.length; j += 1) {
      const pairKey = `${equippedItemIds[i]}:${equippedItemIds[j]}`;
      const rules = synergyDataSet.crossByPair.get(pairKey);
      if (!rules || rules.length === 0) continue;
      const matched = rules.find((rule) => hasShipRule(rule, ship.master_id));
      if (!matched) continue;
      crossSynergyTotals = addTotals(
        crossSynergyTotals,
        toShipTotals(matched.synergy),
      );
    }
  }

  const totalSynergyTotals = addTotals(singleSynergyTotals, crossSynergyTotals);

  // Server-side normalization: strip known additive contributions from observed stats.
  // Remaining unknown contributions (if any) are intentionally not guessed.
  const kaihiRaw =
    ship.kaihi_observed - slotKaihi - spEffectKaihi - totalSynergyTotals.kaihi;
  const taisenRaw =
    ship.taisen_observed - slotTaisen - totalSynergyTotals.taisen;
  const sakutekiRaw =
    ship.sakuteki_observed - slotSakuteki - totalSynergyTotals.sakuteki;
  // sp_effect_items has no luck field in KanColle's data, so spEffectLucky is
  // structurally 0. We still subtract slot+synergy luck to obtain the naked
  // value (= ship's intrinsic 運 stat at this level).
  const luckyRaw = ship.lucky_observed - slotLucky - totalSynergyTotals.lucky;

  const kaihi = Math.max(0, kaihiRaw);
  const taisen = Math.max(0, taisenRaw);
  const sakuteki = Math.max(0, sakutekiRaw);
  const lucky = Math.max(0, luckyRaw);

  // Log if negative result is clamped to zero—indicates possible data quality issue upstream.
  if (kaihiRaw < 0 || taisenRaw < 0 || sakutekiRaw < 0 || luckyRaw < 0) {
    console.warn(
      `[ship-growth] Derived stat clamped to zero for ship ${ship.master_id} lv${ship.lv}: ` +
        `kaihi=${kaihiRaw} taisen=${taisenRaw} sakuteki=${sakutekiRaw} lucky=${luckyRaw}`,
    );
  }

  const breakdown: ServerDerivationBreakdown = {
    removed: {
      slot: {
        kaihi: slotKaihi,
        taisen: slotTaisen,
        sakuteki: slotSakuteki,
        lucky: slotLucky,
      },
      spEffect: {
        kaihi: spEffectKaihi,
        taisen: 0,
        sakuteki: 0,
        lucky: 0,
      },
      synergy: {
        single: singleSynergyTotals,
        cross: crossSynergyTotals,
        total: totalSynergyTotals,
      },
    },
    spEffectItems,
  };

  return {
    stats: { kaihi, taisen, sakuteki, lucky },
    missingSlotItemIds,
    breakdown,
  };
}

function validateIngestBody(
  body: IngestBody | null,
):
  | { ok: true; datasetId: string; requestId: string; eventType: string }
  | { ok: false; error: string } {
  if (!body) return { ok: false, error: "Missing body" };

  const datasetId = String(body.dataset_id ?? "").trim();
  if (!datasetId) return { ok: false, error: "dataset_id is required" };
  if (!/^[a-f0-9]{64}$/i.test(datasetId)) {
    return {
      ok: false,
      error: "dataset_id must be a 64-character SHA-256 hex string",
    };
  }

  const requestId = String(body.request_id ?? "").trim();
  if (!requestId) return { ok: false, error: "request_id is required" };

  const payloadHash = String(body.payload_hash ?? "").trim();
  if (!/^[a-f0-9]{64}$/i.test(payloadHash)) {
    return {
      ok: false,
      error: "payload_hash must be a valid 64-char SHA-256 hex string",
    };
  }

  const eventType = String(body.event_type ?? "").trim();
  if (eventType !== "snapshot")
    return { ok: false, error: 'event_type must be "snapshot"' };

  if (!body.period_tag || !isValidPeriodTagDate(body.period_tag)) {
    return { ok: false, error: "Invalid period_tag (expected YYYY-MM-DD)" };
  }

  if (!body.table_version) {
    return { ok: false, error: "table_version is required" };
  }

  if (!Array.isArray(body.ships) || body.ships.length === 0) {
    return {
      ok: false,
      error: "ships array is required and must not be empty",
    };
  }

  for (const [index, ship] of body.ships.entries()) {
    // exp_to_next is optional (null for max-level ships) but if present must be valid.
    const hasValidExpToNext =
      ship.exp_to_next == null ||
      (isValidInt(ship.exp_to_next) && ship.exp_to_next >= 0);

    if (
      !isValidInt(ship.master_id) ||
      !isValidInt(ship.lv) ||
      !isValidInt(ship.exp_current) ||
      !hasValidExpToNext ||
      ship.exp_current < 0 ||
      !Array.isArray(ship.kyouka) ||
      ship.kyouka.some((value) => !isValidInt(value)) ||
      !isValidInt(ship.kaihi_observed) ||
      !isValidInt(ship.taisen_observed) ||
      !isValidInt(ship.sakuteki_observed) ||
      !isValidInt(ship.lucky_observed) ||
      !isValidInt(ship.kaihi_max) ||
      !isValidInt(ship.taisen_max) ||
      !isValidInt(ship.sakuteki_max)
    ) {
      return {
        ok: false,
        error: `ships[${index}] has invalid numeric fields`,
      };
    }

    if (
      !Array.isArray(ship.slots) ||
      ship.slots.some(
        (slot) =>
          !isValidInt(slot.slotitem_id) ||
          typeof slot.locked !== "boolean" ||
          !isValidInt(slot.level) ||
          !isValidInt(slot.alv),
      )
    ) {
      return {
        ok: false,
        error: `ships[${index}].slots has invalid fields`,
      };
    }

    if (
      ship.exslot != null &&
      (!isValidInt(ship.exslot.slotitem_id) ||
        typeof ship.exslot.locked !== "boolean" ||
        !isValidInt(ship.exslot.level) ||
        !isValidInt(ship.exslot.alv))
    ) {
      return {
        ok: false,
        error: `ships[${index}].exslot has invalid fields`,
      };
    }
  }

  return { ok: true, datasetId, requestId, eventType };
}

function buildAggregatedShipGrowthRows(
  ships: ShipEntry[],
  derivedByIndex: DeriveResult[],
): {
  expRows: AggregatedExpRow[];
  boundRows: AggregatedBoundRow[];
  capRows: AggregatedCapRow[];
  expInconsistencies: Array<{
    lv: number;
    expected: number;
    actual: number;
    shipIndex: number;
  }>;
} {
  const expByLv = new Map<number, number>();
  const expInconsistencies: Array<{
    lv: number;
    expected: number;
    actual: number;
    shipIndex: number;
  }> = [];
  const boundsByKey = new Map<string, AggregatedBoundRow>();
  const capsByMaster = new Map<number, AggregatedCapRow>();

  for (const [index, ship] of ships.entries()) {
    const derived = derivedByIndex[index];

    if (
      ship.lv > 0 &&
      ship.exp_current >= 0 &&
      isValidInt(ship.exp_to_next) &&
      ship.exp_to_next >= 0
    ) {
      const boundaryLv = ship.lv + 1;
      const boundary = ship.exp_current + ship.exp_to_next;
      const current = expByLv.get(boundaryLv);
      if (current == null) {
        expByLv.set(boundaryLv, boundary);
      } else if (current !== boundary) {
        expInconsistencies.push({
          lv: boundaryLv,
          expected: current,
          actual: boundary,
          shipIndex: index,
        });
      }
    }

    if (ship.lv > 0) {
      const boundKey = `${ship.master_id}:${ship.lv}`;
      const existingBound = boundsByKey.get(boundKey);
      if (!existingBound) {
        boundsByKey.set(boundKey, {
          master_id: ship.master_id,
          lv: ship.lv,
          kaihi_naked: derived.stats.kaihi,
          taisen_naked: derived.stats.taisen,
          sakuteki_naked: derived.stats.sakuteki,
          lucky_naked: derived.stats.lucky,
        });
      } else {
        // Zero-guard: 0 means the derivation was clamped from a negative value
        // (i.e., no reliable observation). Only update if the incoming value is
        // a positive observation. If existing is 0 (unset) and new is positive,
        // take the new value. If both are positive, take the min (tighter bound).
        if (derived.stats.kaihi > 0) {
          existingBound.kaihi_naked =
            existingBound.kaihi_naked > 0
              ? Math.min(existingBound.kaihi_naked, derived.stats.kaihi)
              : derived.stats.kaihi;
        }
        if (derived.stats.taisen > 0) {
          existingBound.taisen_naked =
            existingBound.taisen_naked > 0
              ? Math.min(existingBound.taisen_naked, derived.stats.taisen)
              : derived.stats.taisen;
        }
        if (derived.stats.sakuteki > 0) {
          existingBound.sakuteki_naked =
            existingBound.sakuteki_naked > 0
              ? Math.min(existingBound.sakuteki_naked, derived.stats.sakuteki)
              : derived.stats.sakuteki;
        }
        if (derived.stats.lucky > 0) {
          existingBound.lucky_naked =
            existingBound.lucky_naked > 0
              ? Math.min(existingBound.lucky_naked, derived.stats.lucky)
              : derived.stats.lucky;
        }
      }
    }

    if (ship.kaihi_max > 0 || ship.taisen_max > 0 || ship.sakuteki_max > 0) {
      const existingCap = capsByMaster.get(ship.master_id);
      if (!existingCap) {
        capsByMaster.set(ship.master_id, {
          master_id: ship.master_id,
          kaihi_max: ship.kaihi_max,
          taisen_max: ship.taisen_max,
          sakuteki_max: ship.sakuteki_max,
        });
      } else {
        existingCap.kaihi_max = Math.max(existingCap.kaihi_max, ship.kaihi_max);
        existingCap.taisen_max = Math.max(
          existingCap.taisen_max,
          ship.taisen_max,
        );
        existingCap.sakuteki_max = Math.max(
          existingCap.sakuteki_max,
          ship.sakuteki_max,
        );
      }
    }
  }

  const expRows = Array.from(expByLv.entries())
    .map(([lv, exp_current]) => ({ lv, exp_current }))
    .sort((a, b) => a.lv - b.lv);
  const boundRows = Array.from(boundsByKey.values()).sort(
    (a, b) => a.master_id - b.master_id || a.lv - b.lv,
  );
  const capRows = Array.from(capsByMaster.values()).sort(
    (a, b) => a.master_id - b.master_id,
  );

  return { expRows, boundRows, capRows, expInconsistencies };
}

// D1 supports up to 100 bound parameters per prepared statement.
// Batch rowids into IN clauses (99 per statement) to avoid generating
// tens-of-thousands of individual DELETE statements on large period
// transitions, which would cause D1 batch call storms and Worker timeouts.
const ROWID_IN_CHUNK = 99;

function buildArchivePruneStatements(
  db: D1Database,
  oldBounds: ShipGrowthArchiveBoundRow[],
  oldCaps: ShipGrowthArchiveCapRow[],
): ReturnType<D1Database["prepare"]>[] {
  const stmts: ReturnType<D1Database["prepare"]>[] = [];
  const boundRowIds = Array.from(new Set(oldBounds.map((row) => row.row_id)));
  for (let i = 0; i < boundRowIds.length; i += ROWID_IN_CHUNK) {
    const chunk = boundRowIds.slice(i, i + ROWID_IN_CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    stmts.push(
      db
        .prepare(
          `DELETE FROM ship_growth_bounds WHERE rowid IN (${placeholders})`,
        )
        .bind(...chunk),
    );
  }
  const capRowIds = Array.from(new Set(oldCaps.map((row) => row.row_id)));
  for (let i = 0; i < capRowIds.length; i += ROWID_IN_CHUNK) {
    const chunk = capRowIds.slice(i, i + ROWID_IN_CHUNK);
    const placeholders = chunk.map(() => "?").join(", ");
    stmts.push(
      db
        .prepare(
          `DELETE FROM ship_growth_caps WHERE rowid IN (${placeholders})`,
        )
        .bind(...chunk),
    );
  }
  return stmts;
}

async function collectShipGrowthHistoryForArchive(
  db: D1Database,
  periodTag: string,
  tableVersion: string,
): Promise<{
  oldBounds: ShipGrowthArchiveBoundRow[];
  oldCaps: ShipGrowthArchiveCapRow[];
}> {
  const oldBoundsResult = await db
    .prepare(
      `SELECT rowid AS row_id, period_tag, table_version, master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, lucky_naked
       FROM ship_growth_bounds
       WHERE (period_tag <> ? OR table_version <> ?)`,
    )
    .bind(periodTag, tableVersion)
    .all<ShipGrowthArchiveBoundRow>();

  const oldCapsResult = await db
    .prepare(
      `SELECT rowid AS row_id, period_tag, table_version, master_id, kaihi_max, taisen_max, sakuteki_max
       FROM ship_growth_caps
       WHERE (period_tag <> ? OR table_version <> ?)`,
    )
    .bind(periodTag, tableVersion)
    .all<ShipGrowthArchiveCapRow>();

  const oldBounds = oldBoundsResult.results ?? [];
  const oldCaps = oldCapsResult.results ?? [];

  return { oldBounds, oldCaps };
}

async function uploadShipGrowthArchiveIfNeeded(
  env: Bindings,
  periodTag: string,
  tableVersion: string,
  archivedAt: number,
  oldBounds: ShipGrowthArchiveBoundRow[],
  oldCaps: ShipGrowthArchiveCapRow[],
): Promise<void> {
  if (!env.SHIP_GROWTH_ARCHIVE_BUCKET) {
    throw new Error("SHIP_GROWTH_ARCHIVE_BUCKET is not configured");
  }

  // Write old period/version rows to R2 first; prune only after successful archive upload.
  if (oldBounds.length > 0 || oldCaps.length > 0) {
    const archivePayload = {
      archived_at: archivedAt,
      period_tag_new: periodTag,
      table_version_new: tableVersion,
      keys: {
        ship_levels: Array.from(
          new Set(oldBounds.map((row) => `${row.master_id}:${row.lv}`)),
        ).map((key) => {
          const [masterId, lv] = key.split(":").map((v) => Number(v));
          return { master_id: masterId, lv };
        }),
        master_ids: Array.from(new Set(oldCaps.map((row) => row.master_id))),
      },
      rows: {
        bounds: oldBounds,
        caps: oldCaps,
      },
    };
    const archiveText = JSON.stringify(archivePayload);
    const archiveHash = await sha256Hex(new TextEncoder().encode(archiveText));
    const archiveKey =
      `ship-growth/archive/${periodTag}/${tableVersion}/${archivedAt}-` +
      `${archiveHash.slice(0, 16)}-${crypto.randomUUID()}.json`;

    await env.SHIP_GROWTH_ARCHIVE_BUCKET.put(archiveKey, archiveText, {
      httpMetadata: { contentType: "application/json; charset=utf-8" },
      customMetadata: {
        period_tag: periodTag,
        table_version: tableVersion,
        archived_at: String(archivedAt),
        archive_hash: archiveHash,
      },
    });
  }
}

// ── Cumulative archive aggregation ────────────────────────────────
//
// The R2 archive bucket retains every old period_tag/table_version that has
// been superseded in D1. The page needs a cumulative view (= union of all
// past periods, max-naked / max-cap per ship-level).
//
// IMPORTANT: An archive object's customMetadata records the *new* period
// that triggered the archive (= the period being prune-replaced in D1).
// The *old* periods that the archive actually contains are only knowable
// from the JSON body's `rows[*].period_tag` / `rows[*].table_version`.
// As a result, any feature that depends on knowing archived (old) periods
// must read object bodies, not customMetadata.
//
// Scaling strategy: archive objects are append-only (UUID-suffixed, never
// overwritten or deleted under normal operation). We exploit that to do an
// incremental, KV-cached delta refresh:
//
//   loadFull():   list every archive object, fetch all bodies, merge.
//   delta():      list every archive object (cheap), diff against the cached
//                 `processed_keys` set, fetch only new objects, merge into
//                 cached bounds/caps. Idempotent merges (max(...)) make this
//                 safe even if a key is re-processed.
//
// KV is the single source of truth across isolates. There is no in-isolate
// memo — KV reads are cheap (~ms) and avoid stale-after-invalidation bugs.

const ARCHIVE_PREFIX = "ship-growth/archive/";
const ARCHIVE_FETCH_CONCURRENCY = 4;
const ARCHIVE_LIST_PAGE_LIMIT = 1000;
// Hard upper bound on a single LIST traversal. 1000 pages × 1000 objects =
// 1,000,000 objects. Well above any plausible ingest rate.
const ARCHIVE_LIST_MAX_PAGES = 1000;
const CUMULATIVE_KV_KEY = "sg:cumulative:archive:v1";
const CUMULATIVE_SCHEMA_VERSION = 4;

interface CumulativeBoundsRow {
  master_id: number;
  lv: number;
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
  lucky_naked: number;
  // Source period ("period_tag/table_version") that contributed the winning
  // (minimum) naked value for each stat. Populated during archive merging.
  kaihi_source_period?: string;
  taisen_source_period?: string;
  sakuteki_source_period?: string;
  lucky_source_period?: string;
}

interface CumulativeCapsRow {
  master_id: number;
  kaihi_max: number;
  taisen_max: number;
  sakuteki_max: number;
}

// Snapshot stored in KV. `processed_keys` enables delta refresh: when we
// list R2 again we only fetch keys not already in this set. The list is
// kept sorted to allow a quick set-difference scan.
interface CumulativeKvSnapshot {
  schema_version: typeof CUMULATIVE_SCHEMA_VERSION;
  bounds: CumulativeBoundsRow[];
  caps: CumulativeCapsRow[];
  archive_object_count: number;
  last_archived_at_sec: number;
  processed_keys: string[];
  refreshed_at: number; // epoch ms (CanonicalSnapshotBase)
  db_synced_at: number; // epoch ms (CanonicalSnapshotBase) = last_archived_at_sec * 1000
}

function isCumulativeKvSnapshot(v: unknown): v is CumulativeKvSnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    s.schema_version === CUMULATIVE_SCHEMA_VERSION &&
    Array.isArray(s.bounds) &&
    Array.isArray(s.caps) &&
    typeof s.archive_object_count === "number" &&
    typeof s.last_archived_at_sec === "number" &&
    Array.isArray(s.processed_keys) &&
    typeof s.refreshed_at === "number" &&
    typeof s.db_synced_at === "number"
  );
}

function mergeBoundsRow(
  target: Map<string, CumulativeBoundsRow>,
  row: CumulativeBoundsRow,
): void {
  const key = `${row.master_id}:${row.lv}`;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, { ...row });
    return;
  }
  // Naked stats are derived by stripping known equipment effects from the
  // observed value. Residual measurement noise from unmodelled equipment can
  // only INFLATE the naked value, never deflate it. The true naked stat at
  // (master_id, lv) is therefore best approximated by the MINIMUM observed
  // value across all periods. This matches the in-period D1 UPSERT logic
  // (`kaihi_naked = CASE WHEN excluded.kaihi_naked < kaihi_naked THEN
  // excluded.kaihi_naked ELSE kaihi_naked END`).
  //
  // Zero is treated as "no observation" and is never used to overwrite a
  // positive existing value (otherwise a stub/zero row would always win).
  if (
    row.kaihi_naked > 0 &&
    (existing.kaihi_naked === 0 || row.kaihi_naked < existing.kaihi_naked)
  ) {
    existing.kaihi_naked = row.kaihi_naked;
    existing.kaihi_source_period = row.kaihi_source_period;
  }
  if (
    row.taisen_naked > 0 &&
    (existing.taisen_naked === 0 || row.taisen_naked < existing.taisen_naked)
  ) {
    existing.taisen_naked = row.taisen_naked;
    existing.taisen_source_period = row.taisen_source_period;
  }
  if (
    row.sakuteki_naked > 0 &&
    (existing.sakuteki_naked === 0 ||
      row.sakuteki_naked < existing.sakuteki_naked)
  ) {
    existing.sakuteki_naked = row.sakuteki_naked;
    existing.sakuteki_source_period = row.sakuteki_source_period;
  }
  if (
    row.lucky_naked > 0 &&
    (existing.lucky_naked === 0 || row.lucky_naked < existing.lucky_naked)
  ) {
    existing.lucky_naked = row.lucky_naked;
    existing.lucky_source_period = row.lucky_source_period;
  }
}

function mergeCapsRow(
  target: Map<number, CumulativeCapsRow>,
  row: CumulativeCapsRow,
): void {
  const existing = target.get(row.master_id);
  if (!existing) {
    target.set(row.master_id, { ...row });
    return;
  }
  // Caps grow upward over the life of a ship (kaizou, kaikou-2, etc.). The
  // in-period D1 UPSERT keeps MAX (`excluded.kaihi_max > kaihi_max`); the
  // cumulative across periods uses the same direction.
  if (row.kaihi_max > existing.kaihi_max) existing.kaihi_max = row.kaihi_max;
  if (row.taisen_max > existing.taisen_max)
    existing.taisen_max = row.taisen_max;
  if (row.sakuteki_max > existing.sakuteki_max)
    existing.sakuteki_max = row.sakuteki_max;
}

interface ListedArchiveObject {
  key: string;
  archived_at_sec: number;
}

async function listAllArchiveObjects(
  env: Bindings,
): Promise<ListedArchiveObject[]> {
  const out: ListedArchiveObject[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < ARCHIVE_LIST_MAX_PAGES; page += 1) {
    const listed = await env.SHIP_GROWTH_ARCHIVE_BUCKET.list({
      prefix: ARCHIVE_PREFIX,
      cursor,
      limit: ARCHIVE_LIST_PAGE_LIMIT,
    });
    for (const obj of listed.objects) {
      const archivedAtRaw = obj.customMetadata?.archived_at;
      const archivedAt = archivedAtRaw ? Number(archivedAtRaw) : NaN;
      out.push({
        key: obj.key,
        archived_at_sec: Number.isFinite(archivedAt) ? archivedAt : 0,
      });
    }
    if (!listed.truncated) {
      cursor = undefined; // clear stale cursor so the post-loop check doesn't false-throw
      break;
    }
    cursor = listed.cursor;
    if (!cursor) break;
  }
  if (cursor) {
    throw new Error(
      `archive list exceeded max pages (${ARCHIVE_LIST_MAX_PAGES}); refusing partial cumulative snapshot`,
    );
  }
  return out;
}

async function fetchAndMergeArchiveObject(
  env: Bindings,
  key: string,
  boundsByKey: Map<string, CumulativeBoundsRow>,
  capsByMaster: Map<number, CumulativeCapsRow>,
): Promise<void> {
  const obj = await env.SHIP_GROWTH_ARCHIVE_BUCKET.get(key);
  if (!obj) {
    throw new Error(
      `[ship-growth] archive object disappeared while reading: ${key}`,
    );
  }
  const buffer = await obj.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(buffer);
  let parsed: { rows?: { bounds?: unknown; caps?: unknown } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch (err) {
    throw new Error(
      `[ship-growth] archive ${key} is not valid JSON: ${String(err)}`,
    );
  }
  const bounds = Array.isArray(parsed.rows?.bounds) ? parsed.rows!.bounds! : [];
  const caps = Array.isArray(parsed.rows?.caps) ? parsed.rows!.caps! : [];

  for (const raw of bounds as Array<Record<string, unknown>>) {
    const masterId = Number(raw.master_id);
    const lv = Number(raw.lv);
    if (!Number.isFinite(masterId) || masterId <= 0) continue;
    if (!Number.isFinite(lv) || lv <= 0) continue;
    // The source period is the OLD period the row was observed in (stored
    // inside the archive object body as raw.period_tag / raw.table_version).
    const sourcePeriod =
      raw.period_tag && raw.table_version
        ? `${String(raw.period_tag)}/${String(raw.table_version)}`
        : undefined;
    mergeBoundsRow(boundsByKey, {
      master_id: masterId,
      lv,
      // Clamp to ≥ 0: D1 naked stats are always non-negative (Math.max(0, ...)),
      // but defensive clamping prevents a corrupted archive row with a negative
      // value from permanently poisoning mergeBoundsRow's min-selection logic
      // (a negative "existing" value would block all future positive updates).
      kaihi_naked: Math.max(0, Number(raw.kaihi_naked) || 0),
      taisen_naked: Math.max(0, Number(raw.taisen_naked) || 0),
      sakuteki_naked: Math.max(0, Number(raw.sakuteki_naked) || 0),
      lucky_naked: Math.max(0, Number(raw.lucky_naked) || 0),
      kaihi_source_period: sourcePeriod,
      taisen_source_period: sourcePeriod,
      sakuteki_source_period: sourcePeriod,
      lucky_source_period: sourcePeriod,
    });
  }

  for (const raw of caps as Array<Record<string, unknown>>) {
    const masterId = Number(raw.master_id);
    if (!Number.isFinite(masterId) || masterId <= 0) continue;
    mergeCapsRow(capsByMaster, {
      master_id: masterId,
      kaihi_max: Number(raw.kaihi_max) || 0,
      taisen_max: Number(raw.taisen_max) || 0,
      sakuteki_max: Number(raw.sakuteki_max) || 0,
    });
  }
}

async function fetchAndMergeMany(
  env: Bindings,
  keys: string[],
  boundsByKey: Map<string, CumulativeBoundsRow>,
  capsByMaster: Map<number, CumulativeCapsRow>,
): Promise<void> {
  for (let i = 0; i < keys.length; i += ARCHIVE_FETCH_CONCURRENCY) {
    const batch = keys.slice(i, i + ARCHIVE_FETCH_CONCURRENCY);
    await Promise.all(
      batch.map((key) =>
        fetchAndMergeArchiveObject(env, key, boundsByKey, capsByMaster),
      ),
    );
  }
}

function buildSnapshotFromMaps(
  boundsByKey: Map<string, CumulativeBoundsRow>,
  capsByMaster: Map<number, CumulativeCapsRow>,
  processedKeys: string[],
  archiveObjectCount: number,
  lastArchivedAtSec: number,
): CumulativeKvSnapshot {
  const sortedKeys = processedKeys.slice().sort();
  return {
    schema_version: CUMULATIVE_SCHEMA_VERSION,
    bounds: Array.from(boundsByKey.values()).sort(
      (a, b) => a.master_id - b.master_id || a.lv - b.lv,
    ),
    caps: Array.from(capsByMaster.values()).sort(
      (a, b) => a.master_id - b.master_id,
    ),
    archive_object_count: archiveObjectCount,
    last_archived_at_sec: lastArchivedAtSec,
    processed_keys: sortedKeys,
    refreshed_at: Date.now(),
    db_synced_at: lastArchivedAtSec * 1000,
  };
}

async function loadFullCumulativeSnapshot(
  env: Bindings,
): Promise<CumulativeKvSnapshot> {
  const objects = await listAllArchiveObjects(env);
  const boundsByKey = new Map<string, CumulativeBoundsRow>();
  const capsByMaster = new Map<number, CumulativeCapsRow>();
  let lastArchivedAtSec = 0;
  for (const obj of objects) {
    if (obj.archived_at_sec > lastArchivedAtSec)
      lastArchivedAtSec = obj.archived_at_sec;
  }
  await fetchAndMergeMany(
    env,
    objects.map((o) => o.key),
    boundsByKey,
    capsByMaster,
  );
  return buildSnapshotFromMaps(
    boundsByKey,
    capsByMaster,
    objects.map((o) => o.key),
    objects.length,
    lastArchivedAtSec,
  );
}

async function deltaRefreshCumulativeSnapshot(
  env: Bindings,
  cached: CumulativeKvSnapshot,
): Promise<{ snapshot: CumulativeKvSnapshot; changed: boolean }> {
  const objects = await listAllArchiveObjects(env);
  const liveKeys = objects.map((o) => o.key);
  const liveKeySet = new Set(liveKeys);

  const cachedKeySet = new Set(cached.processed_keys);
  const newKeys: string[] = [];
  for (const key of liveKeys) if (!cachedKeySet.has(key)) newKeys.push(key);

  // Detect deletions: a key in cache that is no longer in R2. Should not
  // happen under normal operation (archives are append-only). If it does
  // (e.g. manual cleanup), force a full rebuild because cached merged values
  // may have absorbed deleted-object data and we cannot un-merge.
  let removedDetected = false;
  for (const key of cached.processed_keys) {
    if (!liveKeySet.has(key)) {
      removedDetected = true;
      break;
    }
  }
  if (removedDetected) {
    console.warn(
      "[ship-growth] cumulative archive: detected disappeared keys; rebuilding from scratch",
    );
    const full = await loadFullCumulativeSnapshot(env);
    return { snapshot: full, changed: true };
  }

  if (newKeys.length === 0) {
    // Cache still valid; just bump refreshed_at so `isFreshSnapshot` is happy.
    return {
      snapshot: { ...cached, refreshed_at: Date.now() },
      changed: false,
    };
  }

  const boundsByKey = new Map<string, CumulativeBoundsRow>();
  for (const r of cached.bounds)
    boundsByKey.set(`${r.master_id}:${r.lv}`, { ...r });
  const capsByMaster = new Map<number, CumulativeCapsRow>();
  for (const r of cached.caps) capsByMaster.set(r.master_id, { ...r });

  await fetchAndMergeMany(env, newKeys, boundsByKey, capsByMaster);

  let lastArchivedAtSec = cached.last_archived_at_sec;
  for (const obj of objects) {
    if (obj.archived_at_sec > lastArchivedAtSec)
      lastArchivedAtSec = obj.archived_at_sec;
  }

  const snapshot = buildSnapshotFromMaps(
    boundsByKey,
    capsByMaster,
    liveKeys,
    objects.length,
    lastArchivedAtSec,
  );
  return { snapshot, changed: true };
}

async function loadCumulativeShipGrowthSnapshot(env: Bindings): Promise<{
  snapshot: CumulativeKvSnapshot;
  cacheStatus: "HIT" | "REFRESHED" | "REVALIDATED" | "MISS" | "RESET";
}> {
  return loadOrRefreshCanonicalSnapshot<CumulativeKvSnapshot>({
    kv: env.DATA_LOADER_CACHE_KV,
    cacheKey: CUMULATIVE_KV_KEY,
    ttlMs: KV_SNAPSHOT_TTL_MS,
    expirationTtlSeconds: KV_EXPIRATION_TTL_S,
    isValidSnapshot: isCumulativeKvSnapshot,
    refreshFromDelta: (cached) => deltaRefreshCumulativeSnapshot(env, cached),
    loadFull: () => loadFullCumulativeSnapshot(env),
  });
}

/**
 * Read-only cumulative snapshot peek for /summary. Does NOT trigger a
 * refresh: returns whatever KV currently holds (or null). This keeps the
 * /summary endpoint cheap (one KV read, no R2 access). After the very first
 * archive write, the next /cumulative request populates KV; from then on
 * /summary will report `cumulative_available: true`.
 */
async function peekCumulativeShipGrowthSnapshot(
  env: Bindings,
): Promise<CumulativeKvSnapshot | null> {
  const kv = env.DATA_LOADER_CACHE_KV;
  if (!kv) return null;
  const raw = await kv.get(CUMULATIVE_KV_KEY, "json");
  return isCumulativeKvSnapshot(raw) ? raw : null;
}

// ── Ingest processing ──────────────────────────────────────────────

async function processShipGrowthIngest(
  env: Bindings,
  db: D1Database,
  body: IngestBody,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { period_tag, table_version, ships } = body;

  const nowSec = Math.floor(Date.now() / 1000);

  let slotStatsMap: Map<number, MasterSlotStats>;
  try {
    slotStatsMap = await loadMasterSlotStatsMap(env, period_tag, table_version);
  } catch (error) {
    return {
      status: 503,
      body: {
        error: "Server-side normalization prerequisite missing",
        detail: String(error),
        action:
          "Upload/complete master-data mst_slotitem for the same period_tag and table_version",
      },
    };
  }

  let synergyDataSet: SynergyDataSet;
  try {
    synergyDataSet = await loadSynergyDataSet(env, period_tag);
  } catch (error) {
    return {
      status: 503,
      body: {
        error: "Synergy data prerequisite missing",
        detail: String(error),
        action:
          "Upload/complete synergy manifest and sp_effect_item.json for the same period_tag",
      },
    };
  }

  const derivedByIndex = ships.map((ship) =>
    deriveServerNakedStats(ship, slotStatsMap, synergyDataSet),
  );
  for (const derived of derivedByIndex) {
    if (derived.missingSlotItemIds.length > 0) {
      return {
        status: 500,
        body: {
          error: "Failed to derive naked stats",
          detail: `missing mst_slotitem entries for slotitem_id(s): ${Array.from(new Set(derived.missingSlotItemIds)).join(", ")}`,
        },
      };
    }
  }

  // De-duplicate request rows by natural keys before DB writes:
  // - bounds: master_id + lv
  // - caps: master_id
  // - exp: boundary-lv (= current lv + 1) using exp_current + exp_to_next
  const { expRows, boundRows, capRows, expInconsistencies } =
    buildAggregatedShipGrowthRows(ships, derivedByIndex);

  if (expInconsistencies.length > 0) {
    return {
      status: 400,
      body: {
        error: "Inconsistent EXP boundary candidates for same boundary level",
        detail: expInconsistencies.slice(0, 5),
      },
    };
  }

  let oldBounds: ShipGrowthArchiveBoundRow[];
  let oldCaps: ShipGrowthArchiveCapRow[];
  try {
    ({ oldBounds, oldCaps } = await collectShipGrowthHistoryForArchive(
      db,
      period_tag,
      table_version,
    ));
  } catch (error) {
    return {
      status: 500,
      body: {
        error: "Failed to collect ship growth history for archiving",
        detail: String(error),
      },
    };
  }

  // Pre-check EXP boundary conflicts against existing DB rows before writing.
  // D1 allows max 100 bound parameters per statement; 2 slots are used for
  // period_tag and table_version, so at most 98 lv values per query. Chunk
  // the lv list and run all chunks in parallel for minimum latency.
  if (expRows.length > 0) {
    const EXP_CHECK_CHUNK = 98;
    const existingExpMap = new Map<number, number>();
    const chunkPromises: Promise<void>[] = [];
    for (let ci = 0; ci < expRows.length; ci += EXP_CHECK_CHUNK) {
      const chunk = expRows.slice(ci, ci + EXP_CHECK_CHUNK);
      const placeholders = chunk.map(() => "?").join(", ");
      chunkPromises.push(
        db
          .prepare(
            `SELECT lv, exp_current
             FROM ship_level_exp_pairs
             WHERE period_tag = ? AND table_version = ? AND lv IN (${placeholders})`,
          )
          .bind(period_tag, table_version, ...chunk.map((r) => r.lv))
          .all()
          .then((result) => {
            for (const r of (result.results ?? []) as {
              lv: number;
              exp_current: number;
            }[]) {
              existingExpMap.set(r.lv, r.exp_current);
            }
          }),
      );
    }
    await Promise.all(chunkPromises);

    for (const expRow of expRows) {
      const existingValue = existingExpMap.get(expRow.lv);
      if (existingValue !== undefined && existingValue !== expRow.exp_current) {
        return {
          status: 409,
          body: {
            error: "EXP boundary conflicts with existing DB rows",
            detail: `exp boundary conflict for lv=${expRow.lv}: existing=${existingValue}, incoming=${expRow.exp_current}`,
          },
        };
      }
    }
  }

  // Persist old period/version rows to R2 BEFORE pruning them from D1.
  // If R2 write fails, abort the ingest so the archive stays the source of truth
  // for past periods. (Worst case on D1 failure after R2 success: a duplicate
  // archive object will be written by the next ingest, which is harmless.)
  if (oldBounds.length > 0 || oldCaps.length > 0) {
    try {
      await uploadShipGrowthArchiveIfNeeded(
        env,
        period_tag,
        table_version,
        nowSec,
        oldBounds,
        oldCaps,
      );
    } catch (archiveError) {
      console.error(
        "[ship-growth] Failed to archive old rows to R2; aborting ingest to avoid data loss:",
        archiveError,
      );
      return {
        status: 500,
        body: {
          error: "Failed to archive previous period data to R2 before prune",
          detail: String(archiveError),
        },
      };
    }
  }

  // Build all write statements: exp inserts + bounds upserts + caps upserts + archive prune DELETEs.
  // D1 does not support BEGIN/COMMIT; use db.batch() for atomicity (100-stmt chunks).
  //
  // IMPORTANT: DELETEs (archive prune) are appended LAST so that if a middle
  // batch fails, the old rows are still in D1 and can be re-archived on the
  // next ingest. A failure in the final DELETE batch leaves temporary duplicate
  // rows (old + new period) which are harmless — the next ingest will clean them.
  const stmts: ReturnType<D1Database["prepare"]>[] = [];

  for (const expRow of expRows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO ship_level_exp_pairs (period_tag, table_version, lv, exp_current, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(period_tag, table_version, lv) DO UPDATE SET
             exp_current = excluded.exp_current,
             updated_at = excluded.updated_at`,
        )
        .bind(period_tag, table_version, expRow.lv, expRow.exp_current, nowSec),
    );
  }

  for (const row of boundRows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO ship_growth_bounds (period_tag, table_version, master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, lucky_naked, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(period_tag, table_version, master_id, lv) DO UPDATE SET
             kaihi_naked = CASE WHEN excluded.kaihi_naked > 0 AND (kaihi_naked = 0 OR excluded.kaihi_naked < kaihi_naked) THEN excluded.kaihi_naked ELSE kaihi_naked END,
             taisen_naked = CASE WHEN excluded.taisen_naked > 0 AND (taisen_naked = 0 OR excluded.taisen_naked < taisen_naked) THEN excluded.taisen_naked ELSE taisen_naked END,
             sakuteki_naked = CASE WHEN excluded.sakuteki_naked > 0 AND (sakuteki_naked = 0 OR excluded.sakuteki_naked < sakuteki_naked) THEN excluded.sakuteki_naked ELSE sakuteki_naked END,
             lucky_naked = CASE WHEN excluded.lucky_naked > 0 AND (lucky_naked = 0 OR excluded.lucky_naked < lucky_naked) THEN excluded.lucky_naked ELSE lucky_naked END,
             updated_at = CASE WHEN (excluded.kaihi_naked > 0 AND (kaihi_naked = 0 OR excluded.kaihi_naked < kaihi_naked)) OR (excluded.taisen_naked > 0 AND (taisen_naked = 0 OR excluded.taisen_naked < taisen_naked)) OR (excluded.sakuteki_naked > 0 AND (sakuteki_naked = 0 OR excluded.sakuteki_naked < sakuteki_naked)) OR (excluded.lucky_naked > 0 AND (lucky_naked = 0 OR excluded.lucky_naked < lucky_naked)) THEN excluded.updated_at ELSE updated_at END`,
        )
        .bind(
          period_tag,
          table_version,
          row.master_id,
          row.lv,
          row.kaihi_naked,
          row.taisen_naked,
          row.sakuteki_naked,
          row.lucky_naked,
          nowSec,
        ),
    );
  }

  for (const row of capRows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO ship_growth_caps (period_tag, table_version, master_id, kaihi_max, taisen_max, sakuteki_max, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(period_tag, table_version, master_id) DO UPDATE SET
             kaihi_max = CASE WHEN excluded.kaihi_max > kaihi_max THEN excluded.kaihi_max ELSE kaihi_max END,
             taisen_max = CASE WHEN excluded.taisen_max > taisen_max THEN excluded.taisen_max ELSE taisen_max END,
             sakuteki_max = CASE WHEN excluded.sakuteki_max > sakuteki_max THEN excluded.sakuteki_max ELSE sakuteki_max END,
             updated_at = CASE WHEN excluded.kaihi_max > kaihi_max OR excluded.taisen_max > taisen_max OR excluded.sakuteki_max > sakuteki_max THEN excluded.updated_at ELSE updated_at END`,
        )
        .bind(
          period_tag,
          table_version,
          row.master_id,
          row.kaihi_max,
          row.taisen_max,
          row.sakuteki_max,
          nowSec,
        ),
    );
  }

  // DELETEs last — see ordering note above.
  stmts.push(...buildArchivePruneStatements(db, oldBounds, oldCaps));

  const BATCH_SIZE = 100;
  try {
    // Execute batches, tracking failure points for debugging orphaned data.
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      const batchIndex = i / BATCH_SIZE;
      try {
        await db.batch(stmts.slice(i, i + BATCH_SIZE));
      } catch (batchError) {
        console.error(
          `[ship-growth] Batch ${batchIndex} failed (offset ${i}/${stmts.length}):`,
          batchError,
        );
        throw batchError;
      }
    }
  } catch (error) {
    return {
      status: 500,
      body: {
        error: "Failed to persist ship growth ingest atomically",
        detail: String(error),
      },
    };
  }

  // R2 archive was already written above (before D1 prune) so the old rows are
  // safely persisted. Nothing more to do here.

  return {
    status: 200,
    body: {
      ok: true,
      ingested: ships.length,
      period_tag,
      message: `Ingested ${ships.length} ship growth entries`,
    },
  };
}

// ── Cache invalidation ─────────────────────────────────────────────

async function invalidateShipGrowthCaches(
  cache: Cache,
  requestUrl: string,
): Promise<void> {
  // Invalidate /summary, /exp, /bounds endpoints since data changed.
  const origin = new URL(requestUrl).origin;
  const targets = [
    new URL("/ship-growth/summary", origin).toString(),
    new URL("/ship-growth/exp", origin).toString(),
    new URL("/ship-growth/bounds", origin).toString(),
    new URL("/ship-growth/cumulative", origin).toString(),
    new URL("/ship-growth/all-periods", origin).toString(),
    new URL("/api/ship-growth/summary", origin).toString(),
    new URL("/api/ship-growth/exp", origin).toString(),
    new URL("/api/ship-growth/bounds", origin).toString(),
    new URL("/api/ship-growth/cumulative", origin).toString(),
    new URL("/api/ship-growth/all-periods", origin).toString(),
  ];

  for (const target of targets) {
    try {
      await cache.delete(new Request(target, { method: "GET" }));
    } catch (err) {
      console.warn(
        `[ship-growth] Failed to invalidate cache for ${target}:`,
        err,
      );
      // Continue; Cache API delete might not work in all contexts.
    }
  }
}

// ── KV-delta snapshot cache ────────────────────────────────────────

const KV_SNAPSHOT_TTL_MS = 60 * 60 * 1000; // 1 hour in-memory freshness
const KV_EXPIRATION_TTL_S = 7 * 24 * 60 * 60; // 7-day KV key TTL

// Exp snapshot stored in KV (DATA_LOADER_CACHE_KV)
interface ExpKvSnapshot {
  period_tag: string;
  table_version: string;
  rows: Array<{ lv: number; exp_current: number }>;
  refreshed_at: number; // epoch ms — when KV was last written
  db_synced_at: number; // epoch s — max updated_at seen from DB
}

// Full-bounds snapshot stored in KV (no master_id filter = whole dataset)
interface BoundsKvSnapshot {
  period_tag: string;
  table_version: string;
  schema_version: 3;
  bounds: Array<{
    master_id: number;
    lv: number;
    kaihi_naked: number;
    taisen_naked: number;
    sakuteki_naked: number;
    lucky_naked: number;
  }>;
  caps: Array<{
    master_id: number;
    kaihi_max: number;
    taisen_max: number;
    sakuteki_max: number;
  }>;
  refreshed_at: number;
  db_synced_at: number;
}

function isExpKvSnapshot(v: unknown): v is ExpKvSnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    typeof s.period_tag === "string" &&
    typeof s.table_version === "string" &&
    Array.isArray(s.rows) &&
    typeof s.refreshed_at === "number" &&
    typeof s.db_synced_at === "number"
  );
}

function isBoundsKvSnapshot(v: unknown): v is BoundsKvSnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  // schema_version === 3 indicates the snapshot includes the lucky_naked field.
  // Older snapshots are treated as invalid so the cache rebuilds.
  if (s.schema_version !== 3) return false;
  return (
    typeof s.period_tag === "string" &&
    typeof s.table_version === "string" &&
    Array.isArray(s.bounds) &&
    Array.isArray(s.caps) &&
    typeof s.refreshed_at === "number" &&
    typeof s.db_synced_at === "number"
  );
}

async function invalidateShipGrowthKvSnapshots(
  kv: KVNamespace | undefined,
  period_tag: string,
  table_version: string,
): Promise<void> {
  // Run both invalidations in parallel: they are independent and sequential
  // execution leaves a window where exp/bounds are invalidated but the
  // cumulative snapshot is not yet stale-marked (or vice-versa).
  await Promise.all([
    invalidateCanonicalSnapshots(kv, [
      `sg:exp:${period_tag}:${table_version}`,
      `sg:bounds:${period_tag}:${table_version}`,
    ]),
    // Cumulative archive snapshot: instead of deleting (which forces a full
    // N-object rebuild on the next read), STALE-MARK by writing the cached
    // value back with refreshed_at = 0. The next read sees the cache as stale,
    // takes the delta-refresh branch in loadOrRefreshCanonicalSnapshot, and
    // only fetches the *newly added* archive object(s). This keeps the
    // post-ingest hot path O(1 R2 GET) instead of O(N R2 GETs).
    staleMarkCumulativeShipGrowthSnapshot(kv),
    staleMarkAllPeriodsSnapshot(kv),
  ]);
}

async function staleMarkCumulativeShipGrowthSnapshot(
  kv: KVNamespace | undefined,
): Promise<void> {
  if (!kv) return;
  try {
    const raw = await kv.get(CUMULATIVE_KV_KEY, "json");
    if (!isCumulativeKvSnapshot(raw)) {
      // No valid cache to stale-mark; ensure the slot is clear so the next
      // read does a fresh full load (which is unavoidable anyway).
      await kv.delete(CUMULATIVE_KV_KEY);
      return;
    }
    await saveCanonicalSnapshotToKv(
      kv,
      CUMULATIVE_KV_KEY,
      { ...raw, refreshed_at: 0 },
      KV_EXPIRATION_TTL_S,
    );
  } catch (err) {
    console.warn(
      "[ship-growth] Failed to stale-mark cumulative snapshot; falling back to delete",
      err,
    );
    await kv.delete(CUMULATIVE_KV_KEY).catch(() => {});
  }
}

async function staleMarkAllPeriodsSnapshot(
  kv: KVNamespace | undefined,
): Promise<void> {
  if (!kv) return;
  try {
    const raw = await kv.get(ALL_PERIODS_KV_KEY, "json");
    if (!isAllPeriodsKvSnapshot(raw)) {
      await kv.delete(ALL_PERIODS_KV_KEY);
      return;
    }
    await saveCanonicalSnapshotToKv(
      kv,
      ALL_PERIODS_KV_KEY,
      { ...raw, refreshed_at: 0 },
      KV_EXPIRATION_TTL_S,
    );
  } catch (err) {
    console.warn(
      "[ship-growth] Failed to stale-mark all-periods snapshot; falling back to delete",
      err,
    );
    await kv.delete(ALL_PERIODS_KV_KEY).catch(() => {});
  }
}

// ── Cache helper ───────────────────────────────────────────────────

async function putShipGrowthCache(
  c: any,
  cache: Cache,
  cacheKey: Request,
  response: Response,
): Promise<void> {
  const putPromise = cache.put(cacheKey, response.clone());
  safeWaitUntil(c, putPromise);
}

function scheduleShipGrowthTask(
  c: any,
  task: Promise<unknown>,
): void {
  safeWaitUntil(c, task);
}

// ── Public READ endpoints ──────────────────────────────────────────

/**
 * GET /summary — Available period_tag/table_version combinations.
 * Cache: 1 h CF Cache, 1 h max-age, 24 h stale-while-revalidate.
 */
app.get("/summary", async (c) => {
  const db = c.env.SHIP_GROWTH_DB;
  if (!db) return c.json({ error: "SHIP_GROWTH_DB not configured" }, 503);

  const cache = (globalThis as { caches?: { default?: Cache } }).caches
    ?.default;
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
    const periods = ((
      await db
        .prepare(
          `SELECT DISTINCT period_tag, table_version
         FROM ship_growth_bounds
         ORDER BY period_tag DESC, table_version DESC
         LIMIT 20`,
        )
        .all()
    ).results ?? []) as Array<{ period_tag: string; table_version: string }>;

    // Archive presence check: prefer KV snapshot (cheap), but fall back to
    // a tiny R2 LIST(limit=1) so first-ever archive data is visible in the UI
    // before /cumulative has had a chance to populate KV.
    let archiveObjectCount = 0;
    if (c.env.SHIP_GROWTH_ARCHIVE_BUCKET) {
      try {
        const cached = await peekCumulativeShipGrowthSnapshot(c.env);
        archiveObjectCount = cached?.archive_object_count ?? 0;
        if (archiveObjectCount === 0) {
          const listed = await c.env.SHIP_GROWTH_ARCHIVE_BUCKET.list({
            prefix: ARCHIVE_PREFIX,
            limit: 1,
          });
          archiveObjectCount = listed.objects.length > 0 ? 1 : 0;
        }
      } catch (err) {
        console.warn(
          "[ship-growth] Failed to peek cumulative snapshot for summary:",
          err,
        );
      }
    }

    const response = c.json({
      ok: true,
      periods,
      cumulative_available: archiveObjectCount > 0,
      archive_object_count: archiveObjectCount,
    });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", "MISS");
    if (cache) {
      try {
        await putShipGrowthCache(c, cache, cacheKey, response);
      } catch (cacheErr) {
        console.warn(
          "[ship-growth] Failed to populate CF cache for /summary:",
          cacheErr,
        );
      }
    }
    return response;
  } catch (err) {
    console.error("[ship-growth] Failed to query summary:", err);
    return c.json({ error: "Failed to retrieve summary" }, 500);
  }
});

/**
 * GET /exp — Exp-per-level table for a period (ship_level_exp_pairs).
 * Query params: period_tag, table_version (both required).
 * Cache strategy: KV snapshot refreshed at most once per hour via delta query
 * (WHERE updated_at > db_synced_at). DB access only on cache miss or stale.
 */
app.get("/exp", async (c) => {
  const db = c.env.SHIP_GROWTH_DB;
  if (!db) return c.json({ error: "SHIP_GROWTH_DB not configured" }, 503);

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

  const periodTag = (c.req.query("period_tag") ?? "").trim();
  const tableVersion = (c.req.query("table_version") ?? "").trim();

  if (!periodTag || !tableVersion) {
    return c.json({ error: "period_tag and table_version are required" }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodTag)) {
    return c.json({ error: "Invalid period_tag (expected YYYY-MM-DD)" }, 400);
  }

  const kv = c.env.DATA_LOADER_CACHE_KV;
  const kvKey = `sg:exp:${periodTag}:${tableVersion}`;

  try {
    const { snapshot, cacheStatus } = await loadOrRefreshCanonicalSnapshot({
      kv,
      cacheKey: kvKey,
      ttlMs: KV_SNAPSHOT_TTL_MS,
      expirationTtlSeconds: KV_EXPIRATION_TTL_S,
      isValidSnapshot: isExpKvSnapshot,
      refreshFromDelta: async (cached) => {
        const deltaRows = ((
          await db
            .prepare(
              `SELECT lv, exp_current, updated_at FROM ship_level_exp_pairs
               WHERE period_tag = ? AND table_version = ? AND updated_at > ?
               ORDER BY lv ASC`,
            )
            .bind(periodTag, tableVersion, cached.db_synced_at)
            .all()
        ).results ?? []) as Array<{
          lv: number;
          exp_current: number;
          updated_at: number;
        }>;

        const byLv = new Map(cached.rows.map((r) => [r.lv, r]));
        for (const r of deltaRows) {
          byLv.set(r.lv, { lv: r.lv, exp_current: r.exp_current });
        }

        const maxUpdatedAt = deltaRows.reduce(
          (max, row) => Math.max(max, Number(row.updated_at) || 0),
          0,
        );

        return {
          changed: deltaRows.length > 0,
          snapshot: {
            period_tag: periodTag,
            table_version: tableVersion,
            rows: Array.from(byLv.values()).sort((a, b) => a.lv - b.lv),
            refreshed_at: Date.now(),
            db_synced_at: Math.max(cached.db_synced_at, maxUpdatedAt),
          },
        };
      },
      loadFull: async () => {
        const fullRows = ((
          await db
            .prepare(
              `SELECT lv, exp_current, updated_at FROM ship_level_exp_pairs
               WHERE period_tag = ? AND table_version = ?
               ORDER BY lv ASC`,
            )
            .bind(periodTag, tableVersion)
            .all()
        ).results ?? []) as Array<{
          lv: number;
          exp_current: number;
          updated_at: number;
        }>;

        const maxUpdatedAt = fullRows.reduce(
          (max, row) => Math.max(max, Number(row.updated_at) || 0),
          0,
        );

        return {
          period_tag: periodTag,
          table_version: tableVersion,
          rows: fullRows.map((r) => ({ lv: r.lv, exp_current: r.exp_current })),
          refreshed_at: Date.now(),
          db_synced_at: maxUpdatedAt,
        };
      },
    });

    const response = c.json({
      ok: true,
      period_tag: periodTag,
      table_version: tableVersion,
      exp: snapshot.rows,
      updated_at: snapshot.db_synced_at,
      updated_at_iso:
        snapshot.db_synced_at > 0
          ? new Date(snapshot.db_synced_at * 1000).toISOString()
          : null,
    });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", cacheStatus);
    if (cache) {
      try {
        await putShipGrowthCache(c, cache, cacheKey, response);
      } catch (cacheErr) {
        console.warn("[ship-growth] Failed to populate CF cache for /exp:", cacheErr);
      }
    }
    return response;
  } catch (err) {
    const message = String(err);
    if (message.includes("no such column: updated_at")) {
      // Local legacy D1 schema compatibility: serve full snapshot without delta columns.
      try {
        const legacyRows = ((
          await db
            .prepare(
              `SELECT lv, exp_current FROM ship_level_exp_pairs
               WHERE period_tag = ? AND table_version = ?
               ORDER BY lv ASC`,
            )
            .bind(periodTag, tableVersion)
            .all()
        ).results ?? []) as Array<{
          lv: number;
          exp_current: number;
        }>;

        const response = c.json({
          ok: true,
          period_tag: periodTag,
          table_version: tableVersion,
          exp: legacyRows,
          updated_at: 0,
          updated_at_iso: null,
        });
        response.headers.set(
          "Cache-Control",
          "public, max-age=60, stale-while-revalidate=300",
        );
        response.headers.set("X-FUSOU-Cache", "legacy-schema-fallback");
        return response;
      } catch (fallbackErr) {
        console.error("[ship-growth] Legacy exp fallback failed:", fallbackErr);
      }
    }
    console.error("[ship-growth] Failed to query exp:", err);
    return c.json({ error: "Failed to retrieve exp data" }, 500);
  }
});
/**
 * GET /bounds — Naked parameter growth by level (ship_growth_bounds + ship_growth_caps).
 * Query params: period_tag, table_version (required), master_id (optional — filters to one ship).
 * Cache strategy:
 *   - Always load full snapshot via KV+delta.
 *   - If master_id is provided, filter in-memory from the full snapshot.
 * This avoids per-ship DB round-trips and encourages client-side reuse.
 */
app.get("/bounds", async (c) => {
  const db = c.env.SHIP_GROWTH_DB;
  if (!db) return c.json({ error: "SHIP_GROWTH_DB not configured" }, 503);

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

  const periodTag = (c.req.query("period_tag") ?? "").trim();
  const tableVersion = (c.req.query("table_version") ?? "").trim();
  const masterIdRaw = c.req.query("master_id");
  const masterId = masterIdRaw != null ? parseInt(masterIdRaw, 10) : null;

  if (!periodTag || !tableVersion) {
    return c.json({ error: "period_tag and table_version are required" }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodTag)) {
    return c.json({ error: "Invalid period_tag (expected YYYY-MM-DD)" }, 400);
  }
  if (masterId !== null && (!Number.isFinite(masterId) || masterId <= 0)) {
    return c.json({ error: "master_id must be a positive integer" }, 400);
  }

  type BoundsRow = {
    master_id: number;
    lv: number;
    kaihi_naked: number;
    taisen_naked: number;
    sakuteki_naked: number;
    lucky_naked: number;
  };
  type CapsRow = {
    master_id: number;
    kaihi_max: number;
    taisen_max: number;
    sakuteki_max: number;
  };

  try {
    const kv = c.env.DATA_LOADER_CACHE_KV;
    const kvKey = `sg:bounds:${periodTag}:${tableVersion}`;

    const { snapshot, cacheStatus } = await loadOrRefreshCanonicalSnapshot({
      kv,
      cacheKey: kvKey,
      ttlMs: KV_SNAPSHOT_TTL_MS,
      expirationTtlSeconds: KV_EXPIRATION_TTL_S,
      isValidSnapshot: isBoundsKvSnapshot,
      refreshFromDelta: async (cached) => {
        const deltaBounds = ((
          await db
            .prepare(
              `SELECT master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, lucky_naked, updated_at
               FROM ship_growth_bounds
               WHERE period_tag = ? AND table_version = ? AND updated_at > ?
               ORDER BY master_id ASC, lv ASC`,
            )
            .bind(periodTag, tableVersion, cached.db_synced_at)
            .all()
        ).results ?? []) as Array<BoundsRow & { updated_at: number }>;

        const deltaCaps = ((
          await db
            .prepare(
              `SELECT master_id, kaihi_max, taisen_max, sakuteki_max, updated_at
               FROM ship_growth_caps
               WHERE period_tag = ? AND table_version = ? AND updated_at > ?`,
            )
            .bind(periodTag, tableVersion, cached.db_synced_at)
            .all()
        ).results ?? []) as Array<CapsRow & { updated_at: number }>;

        const boundsMap = new Map(
          cached.bounds.map((r) => [`${r.master_id}:${r.lv}`, r]),
        );
        for (const r of deltaBounds) {
          boundsMap.set(`${r.master_id}:${r.lv}`, {
            master_id: r.master_id,
            lv: r.lv,
            kaihi_naked: r.kaihi_naked,
            taisen_naked: r.taisen_naked,
            sakuteki_naked: r.sakuteki_naked,
            lucky_naked: r.lucky_naked,
          });
        }

        const capsMap = new Map(cached.caps.map((r) => [r.master_id, r]));
        for (const r of deltaCaps) {
          capsMap.set(r.master_id, {
            master_id: r.master_id,
            kaihi_max: r.kaihi_max,
            taisen_max: r.taisen_max,
            sakuteki_max: r.sakuteki_max,
          });
        }

        const maxBoundUpdatedAt = deltaBounds.reduce(
          (max, row) => Math.max(max, Number(row.updated_at) || 0),
          0,
        );
        const maxCapUpdatedAt = deltaCaps.reduce(
          (max, row) => Math.max(max, Number(row.updated_at) || 0),
          0,
        );

        return {
          changed: deltaBounds.length > 0 || deltaCaps.length > 0,
          snapshot: {
            period_tag: periodTag,
            table_version: tableVersion,
            schema_version: 3,
            bounds: Array.from(boundsMap.values()).sort(
              (a, b) => a.master_id - b.master_id || a.lv - b.lv,
            ),
            caps: Array.from(capsMap.values()).sort(
              (a, b) => a.master_id - b.master_id,
            ),
            refreshed_at: Date.now(),
            db_synced_at: Math.max(
              cached.db_synced_at,
              maxBoundUpdatedAt,
              maxCapUpdatedAt,
            ),
          },
        };
      },
      loadFull: async () => {
        // Paginate bounds to handle large datasets (D1 per-query response size cap).
        // KanColle can have 400+ ship classes × 180 levels = 72,000+ rows, well above
        // a conservative per-query row limit. We use db.batch to fetch pages in parallel.
        const countRes = await db
          .prepare(`SELECT COUNT(*) as c FROM ship_growth_bounds WHERE period_tag = ? AND table_version = ?`)
          .bind(periodTag, tableVersion)
          .first();
        const totalRows = (countRes?.c as number) || 0;

        const BOUNDS_PAGE = 5000;
        let boundsRows: Array<BoundsRow & { updated_at: number }> = [];

        if (totalRows > 0) {
          const stmts: any[] = [];
          for (let offset = 0; offset < totalRows; offset += BOUNDS_PAGE) {
            stmts.push(
              db.prepare(
                `SELECT master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, lucky_naked, updated_at
                 FROM ship_growth_bounds
                 WHERE period_tag = ? AND table_version = ?
                 ORDER BY master_id ASC, lv ASC LIMIT ? OFFSET ?`
              ).bind(periodTag, tableVersion, BOUNDS_PAGE, offset)
            );
          }
          const BATCH_LIMIT = 100; // max statements per db.batch
          for (let i = 0; i < stmts.length; i += BATCH_LIMIT) {
            const batchResults = await db.batch(stmts.slice(i, i + BATCH_LIMIT));
            for (const res of batchResults) {
              boundsRows = boundsRows.concat((res.results ?? []) as Array<BoundsRow & { updated_at: number }>);
            }
          }
        }

        const capsRows = ((
          await db
            .prepare(
              `SELECT master_id, kaihi_max, taisen_max, sakuteki_max, updated_at
               FROM ship_growth_caps
               WHERE period_tag = ? AND table_version = ?`,
            )
            .bind(periodTag, tableVersion)
            .all()
        ).results ?? []) as Array<CapsRow & { updated_at: number }>;

        const maxBoundUpdatedAt = boundsRows.reduce(
          (max, row) => Math.max(max, Number(row.updated_at) || 0),
          0,
        );
        const maxCapUpdatedAt = capsRows.reduce(
          (max, row) => Math.max(max, Number(row.updated_at) || 0),
          0,
        );

        return {
          period_tag: periodTag,
          table_version: tableVersion,
          schema_version: 3,
          bounds: boundsRows.map((r) => ({
            master_id: r.master_id,
            lv: r.lv,
            kaihi_naked: r.kaihi_naked,
            taisen_naked: r.taisen_naked,
            sakuteki_naked: r.sakuteki_naked,
            lucky_naked: r.lucky_naked,
          })),
          caps: capsRows.map((r) => ({
            master_id: r.master_id,
            kaihi_max: r.kaihi_max,
            taisen_max: r.taisen_max,
            sakuteki_max: r.sakuteki_max,
          })),
          refreshed_at: Date.now(),
          db_synced_at: Math.max(maxBoundUpdatedAt, maxCapUpdatedAt),
        };
      },
    });

    const responseBounds =
      masterId === null
        ? snapshot.bounds
        : snapshot.bounds.filter((row) => row.master_id === masterId);
    const responseCaps =
      masterId === null
        ? snapshot.caps
        : snapshot.caps.filter((row) => row.master_id === masterId);

    const response = c.json({
      ok: true,
      period_tag: periodTag,
      table_version: tableVersion,
      bounds: responseBounds,
      caps: responseCaps,
      updated_at: snapshot.db_synced_at,
      updated_at_iso:
        snapshot.db_synced_at > 0
          ? new Date(snapshot.db_synced_at * 1000).toISOString()
          : null,
    });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", cacheStatus);
    if (cache) {
      try {
        await putShipGrowthCache(c, cache, cacheKey, response);
      } catch (cacheErr) {
        console.warn("[ship-growth] Failed to populate CF cache for /bounds:", cacheErr);
      }
    }
    return response;
  } catch (err) {
    const message = String(err);
    if (
      message.includes("no such column: updated_at") ||
      message.includes("no such column: lucky_naked")
    ) {
      // Local legacy D1 schema compatibility: serve full data without delta/new luck columns.
      try {
        const countRes = await db
          .prepare(`SELECT COUNT(*) as c FROM ship_growth_bounds WHERE period_tag = ? AND table_version = ?`)
          .bind(periodTag, tableVersion)
          .first();
        const totalRows = (countRes?.c as number) || 0;

        const BOUNDS_PAGE = 5000;
        let legacyBounds: Array<BoundsRow> = [];

        if (totalRows > 0) {
          const stmts: any[] = [];
          for (let offset = 0; offset < totalRows; offset += BOUNDS_PAGE) {
            stmts.push(
              db.prepare(
                `SELECT master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked
                 FROM ship_growth_bounds
                 WHERE period_tag = ? AND table_version = ?
                 ORDER BY master_id ASC, lv ASC LIMIT ? OFFSET ?`
              ).bind(periodTag, tableVersion, BOUNDS_PAGE, offset)
            );
          }
          const BATCH_LIMIT = 100;
          for (let i = 0; i < stmts.length; i += BATCH_LIMIT) {
            const batchResults = await db.batch(stmts.slice(i, i + BATCH_LIMIT));
            for (const res of batchResults) {
              const page = (res.results ?? []) as Array<Omit<BoundsRow, "lucky_naked">>;
              legacyBounds = legacyBounds.concat(page.map((r) => ({ ...r, lucky_naked: 0 })));
            }
          }
        }

        const legacyCaps = ((
          await db
            .prepare(
              `SELECT master_id, kaihi_max, taisen_max, sakuteki_max
               FROM ship_growth_caps
               WHERE period_tag = ? AND table_version = ?`,
            )
            .bind(periodTag, tableVersion)
            .all()
        ).results ?? []) as Array<CapsRow>;

        const responseBounds =
          masterId === null
            ? legacyBounds
            : legacyBounds.filter((row) => row.master_id === masterId);
        const responseCaps =
          masterId === null
            ? legacyCaps
            : legacyCaps.filter((row) => row.master_id === masterId);

        const response = c.json({
          ok: true,
          period_tag: periodTag,
          table_version: tableVersion,
          bounds: responseBounds,
          caps: responseCaps,
          updated_at: 0,
          updated_at_iso: null,
        });
        response.headers.set(
          "Cache-Control",
          "public, max-age=60, stale-while-revalidate=300",
        );
        response.headers.set("X-FUSOU-Cache", "legacy-schema-fallback");
        return response;
      } catch (fallbackErr) {
        console.error(
          "[ship-growth] Legacy bounds fallback failed:",
          fallbackErr,
        );
      }
    }
    console.error("[ship-growth] Failed to query bounds:", err);
    return c.json({ error: "Failed to retrieve bounds data" }, 500);
  }
});

/**
 * GET /cumulative — Cumulative bounds/caps merged from all R2 archive objects.
 *
 * Aggregation policy:
 *  - bounds: per (master_id, lv), min naked stat across every archive object (zero = no observation, never overwrites positive).
 *  - caps:   per master_id,        max cap stat across every archive object.
 *
 * Caching: canonical KV snapshot (1h freshness, 7-day TTL) with delta refresh.
 *
 * Note: per-period filtering is intentionally not exposed here. The archive
 * object's customMetadata records the *new* period that triggered the
 * archive, not the *old* periods stored inside it, so a query-only filter
 * cannot be served from list metadata. If individual past-period selection
 * is needed later, build it as a separate endpoint that reads object bodies
 * (with its own caching).
 */
app.get("/cumulative", async (c) => {
  const env = c.env;
  if (!env.SHIP_GROWTH_ARCHIVE_BUCKET) {
    return c.json({ error: "SHIP_GROWTH_ARCHIVE_BUCKET not configured" }, 503);
  }

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
    const { snapshot, cacheStatus } =
      await loadCumulativeShipGrowthSnapshot(env);

    const response = c.json({
      ok: true,
      bounds: snapshot.bounds,
      caps: snapshot.caps,
      archive_object_count: snapshot.archive_object_count,
      last_archived_at_sec: snapshot.last_archived_at_sec,
    });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", cacheStatus);
    if (cache) {
      try {
        await putShipGrowthCache(c, cache, cacheKey, response);
      } catch (cacheErr) {
        console.warn("[ship-growth] Failed to populate CF cache for /cumulative:", cacheErr);
      }
    }
    return response;
  } catch (err) {
    console.error("[ship-growth] Failed to load cumulative archive:", err);
    return c.json({ error: "Failed to load cumulative archive" }, 500);
  }
});

// ── All-periods snapshot (per-period breakdown from archive objects) ──────────

const ALL_PERIODS_KV_KEY = "sg:all-periods:archive:v1";
const ALL_PERIODS_SCHEMA_VERSION = 3;

/**
 * One entry per (period_tag, table_version) observed across all archive
 * objects. Bounds within a period use MIN (same logic as cumulative); caps use
 * MAX.
 */
interface AllPeriodsEntry {
  period_tag: string;
  table_version: string;
  bounds: Array<{
    master_id: number;
    lv: number;
    kaihi_naked: number;
    taisen_naked: number;
    sakuteki_naked: number;
    lucky_naked: number;
  }>;
  caps: Array<{
    master_id: number;
    kaihi_max: number;
    taisen_max: number;
    sakuteki_max: number;
  }>;
}

interface AllPeriodsKvSnapshot {
  schema_version: typeof ALL_PERIODS_SCHEMA_VERSION;
  entries: AllPeriodsEntry[];
  archive_object_count: number;
  processed_keys: string[];
  refreshed_at: number;
  db_synced_at: number;
}

function isAllPeriodsKvSnapshot(v: unknown): v is AllPeriodsKvSnapshot {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  return (
    s.schema_version === ALL_PERIODS_SCHEMA_VERSION &&
    Array.isArray(s.entries) &&
    typeof s.archive_object_count === "number" &&
    Array.isArray(s.processed_keys) &&
    typeof s.refreshed_at === "number" &&
    typeof s.db_synced_at === "number"
  );
}

// Per-period working maps used during snapshot construction.
type PeriodBoundsMap = Map<string, CumulativeBoundsRow>; // key: "master_id:lv"
type PeriodCapsMap = Map<number, CumulativeCapsRow>; // key: master_id

async function fetchAndMergeArchiveObjectForAllPeriods(
  env: Bindings,
  key: string,
  byPeriod: Map<string, { bounds: PeriodBoundsMap; caps: PeriodCapsMap }>,
): Promise<void> {
  const obj = await env.SHIP_GROWTH_ARCHIVE_BUCKET.get(key);
  if (!obj) {
    throw new Error(
      `[ship-growth] archive object disappeared while reading: ${key}`,
    );
  }
  const buffer = await obj.arrayBuffer();
  const text = new TextDecoder("utf-8").decode(buffer);
  let parsed: { rows?: { bounds?: unknown; caps?: unknown } };
  try {
    parsed = JSON.parse(text) as typeof parsed;
  } catch (err) {
    throw new Error(
      `[ship-growth] archive ${key} is not valid JSON: ${String(err)}`,
    );
  }

  const bounds = Array.isArray(parsed.rows?.bounds)
    ? (parsed.rows!.bounds! as Array<Record<string, unknown>>)
    : [];
  const caps = Array.isArray(parsed.rows?.caps)
    ? (parsed.rows!.caps! as Array<Record<string, unknown>>)
    : [];

  for (const raw of bounds) {
    const masterId = Number(raw.master_id);
    const lv = Number(raw.lv);
    if (!Number.isFinite(masterId) || masterId <= 0) continue;
    if (!Number.isFinite(lv) || lv <= 0) continue;
    const periodTag = typeof raw.period_tag === "string" ? raw.period_tag : "";
    const tableVersion =
      typeof raw.table_version === "string" ? raw.table_version : "";
    if (!periodTag || !tableVersion) continue;

    const pKey = `${periodTag}/${tableVersion}`;
    if (!byPeriod.has(pKey))
      byPeriod.set(pKey, {
        bounds: new Map(),
        caps: new Map(),
      });
    const entry = byPeriod.get(pKey)!;
    mergeBoundsRow(entry.bounds, {
      master_id: masterId,
      lv,
      kaihi_naked: Math.max(0, Number(raw.kaihi_naked) || 0),
      taisen_naked: Math.max(0, Number(raw.taisen_naked) || 0),
      sakuteki_naked: Math.max(0, Number(raw.sakuteki_naked) || 0),
      lucky_naked: Math.max(0, Number(raw.lucky_naked) || 0),
    });
  }

  for (const raw of caps) {
    const masterId = Number(raw.master_id);
    if (!Number.isFinite(masterId) || masterId <= 0) continue;
    const periodTag = typeof raw.period_tag === "string" ? raw.period_tag : "";
    const tableVersion =
      typeof raw.table_version === "string" ? raw.table_version : "";
    if (!periodTag || !tableVersion) continue;

    const pKey = `${periodTag}/${tableVersion}`;
    if (!byPeriod.has(pKey))
      byPeriod.set(pKey, { bounds: new Map(), caps: new Map() });
    const entry = byPeriod.get(pKey)!;
    mergeCapsRow(entry.caps, {
      master_id: masterId,
      kaihi_max: Number(raw.kaihi_max) || 0,
      taisen_max: Number(raw.taisen_max) || 0,
      sakuteki_max: Number(raw.sakuteki_max) || 0,
    });
  }
}

function buildAllPeriodsSnapshotFromMaps(
  byPeriod: Map<string, { bounds: PeriodBoundsMap; caps: PeriodCapsMap }>,
  processedKeys: string[],
  archiveObjectCount: number,
  lastArchivedAtSec: number,
): AllPeriodsKvSnapshot {
  const entries: AllPeriodsEntry[] = [];
  for (const [pKey, maps] of byPeriod) {
    const slash = pKey.indexOf("/");
    const period_tag = slash >= 0 ? pKey.slice(0, slash) : pKey;
    const table_version = slash >= 0 ? pKey.slice(slash + 1) : "";
    entries.push({
      period_tag,
      table_version,
      bounds: Array.from(maps.bounds.values()).sort(
        (a, b) => a.master_id - b.master_id || a.lv - b.lv,
      ),
      caps: Array.from(maps.caps.values()).sort(
        (a, b) => a.master_id - b.master_id,
      ),
    });
  }
  // Sort entries by period_tag ascending (older first).
  entries.sort(
    (a, b) =>
      a.period_tag.localeCompare(b.period_tag) ||
      a.table_version.localeCompare(b.table_version),
  );
  return {
    schema_version: ALL_PERIODS_SCHEMA_VERSION,
    entries,
    archive_object_count: archiveObjectCount,
    processed_keys: processedKeys.slice().sort(),
    refreshed_at: Date.now(),
    db_synced_at: lastArchivedAtSec * 1000,
  };
}

async function loadFullAllPeriodsSnapshot(
  env: Bindings,
): Promise<AllPeriodsKvSnapshot> {
  const objects = await listAllArchiveObjects(env);
  const byPeriod = new Map<
    string,
    { bounds: PeriodBoundsMap; caps: PeriodCapsMap }
  >();
  let lastArchivedAtSec = 0;
  for (const obj of objects) {
    if (obj.archived_at_sec > lastArchivedAtSec)
      lastArchivedAtSec = obj.archived_at_sec;
  }
  for (let i = 0; i < objects.length; i += ARCHIVE_FETCH_CONCURRENCY) {
    const batch = objects.slice(i, i + ARCHIVE_FETCH_CONCURRENCY);
    await Promise.all(
      batch.map((o) =>
        fetchAndMergeArchiveObjectForAllPeriods(env, o.key, byPeriod),
      ),
    );
  }
  return buildAllPeriodsSnapshotFromMaps(
    byPeriod,
    objects.map((o) => o.key),
    objects.length,
    lastArchivedAtSec,
  );
}

async function deltaRefreshAllPeriodsSnapshot(
  env: Bindings,
  cached: AllPeriodsKvSnapshot,
): Promise<{ snapshot: AllPeriodsKvSnapshot; changed: boolean }> {
  const objects = await listAllArchiveObjects(env);
  const liveKeys = objects.map((o) => o.key);
  const liveKeySet = new Set(liveKeys);

  const cachedKeySet = new Set(cached.processed_keys);
  const newKeys: string[] = [];
  for (const key of liveKeys) if (!cachedKeySet.has(key)) newKeys.push(key);

  // Detect deletions → full rebuild (cannot un-merge).
  let removedDetected = false;
  for (const key of cached.processed_keys) {
    if (!liveKeySet.has(key)) {
      removedDetected = true;
      break;
    }
  }
  if (removedDetected) {
    console.warn(
      "[ship-growth] all-periods archive: detected disappeared keys; rebuilding from scratch",
    );
    const full = await loadFullAllPeriodsSnapshot(env);
    return { snapshot: full, changed: true };
  }

  if (newKeys.length === 0) {
    return {
      snapshot: { ...cached, refreshed_at: Date.now() },
      changed: false,
    };
  }

  // Rebuild per-period maps from cached entries, then merge new objects.
  const byPeriod = new Map<
    string,
    { bounds: PeriodBoundsMap; caps: PeriodCapsMap }
  >();
  for (const entry of cached.entries) {
    const pKey = `${entry.period_tag}/${entry.table_version}`;
    const boundsMap: PeriodBoundsMap = new Map();
    for (const r of entry.bounds)
      boundsMap.set(`${r.master_id}:${r.lv}`, { ...r });
    const capsMap: PeriodCapsMap = new Map();
    for (const r of entry.caps) capsMap.set(r.master_id, { ...r });
    byPeriod.set(pKey, { bounds: boundsMap, caps: capsMap });
  }

  for (let i = 0; i < newKeys.length; i += ARCHIVE_FETCH_CONCURRENCY) {
    const batch = newKeys.slice(i, i + ARCHIVE_FETCH_CONCURRENCY);
    await Promise.all(
      batch.map((key) =>
        fetchAndMergeArchiveObjectForAllPeriods(env, key, byPeriod),
      ),
    );
  }

  let lastArchivedAtSec = 0;
  for (const obj of objects) {
    if (obj.archived_at_sec > lastArchivedAtSec)
      lastArchivedAtSec = obj.archived_at_sec;
  }

  const snapshot = buildAllPeriodsSnapshotFromMaps(
    byPeriod,
    liveKeys,
    objects.length,
    lastArchivedAtSec,
  );
  return { snapshot, changed: true };
}

async function loadAllPeriodsShipGrowthSnapshot(env: Bindings): Promise<{
  snapshot: AllPeriodsKvSnapshot;
  cacheStatus: "HIT" | "REFRESHED" | "REVALIDATED" | "MISS" | "RESET";
}> {
  return loadOrRefreshCanonicalSnapshot<AllPeriodsKvSnapshot>({
    kv: env.DATA_LOADER_CACHE_KV,
    cacheKey: ALL_PERIODS_KV_KEY,
    ttlMs: KV_SNAPSHOT_TTL_MS,
    expirationTtlSeconds: KV_EXPIRATION_TTL_S,
    isValidSnapshot: isAllPeriodsKvSnapshot,
    refreshFromDelta: (cached) => deltaRefreshAllPeriodsSnapshot(env, cached),
    loadFull: () => loadFullAllPeriodsSnapshot(env),
  });
}

/**
 * GET /all-periods — Per-period breakdown of bounds/caps from all R2 archive
 * objects.
 *
 * Each entry corresponds to a distinct (period_tag, table_version) observed
 * inside archive object bodies. Within a period, bounds are aggregated with
 * the same MIN policy as /cumulative; caps use MAX.
 *
 * This endpoint intentionally does NOT include the current live period — the
 * client fetches that separately via /bounds if needed.
 */
app.get("/all-periods", async (c) => {
  const env = c.env;
  if (!env.SHIP_GROWTH_ARCHIVE_BUCKET) {
    return c.json({ error: "SHIP_GROWTH_ARCHIVE_BUCKET not configured" }, 503);
  }

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
    const { snapshot, cacheStatus } =
      await loadAllPeriodsShipGrowthSnapshot(env);

    const response = c.json({
      ok: true,
      entries: snapshot.entries,
      archive_object_count: snapshot.archive_object_count,
    });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", cacheStatus);
    if (cache) {
      try {
        await putShipGrowthCache(c, cache, cacheKey, response);
      } catch (cacheErr) {
        console.warn("[ship-growth] Failed to populate CF cache for /all-periods:", cacheErr);
      }
    }
    return response;
  } catch (err) {
    console.error("[ship-growth] Failed to load all-periods archive:", err);
    return c.json({ error: "Failed to load all-periods archive" }, 500);
  }
});

// ── Two-stage ingest endpoint ──────────────────────────────────────

app.post("/ingest", async (c) => {
  const db = c.env.SHIP_GROWTH_DB;
  if (!db) return c.json({ error: "SHIP_GROWTH_DB not configured" }, 503);

  // kill switch
  const env = createEnvContext(c);
  let collectionEnabled = false;
  try {
    collectionEnabled = parseStrictBoolean(
      getEnv(env, SHIP_GROWTH_COLLECTION_SWITCH_ENV),
      SHIP_GROWTH_COLLECTION_SWITCH_ENV,
    );
  } catch (err) {
    return c.json(
      {
        error:
          err instanceof Error
            ? err.message
            : `${SHIP_GROWTH_COLLECTION_SWITCH_ENV} is invalid`,
      },
      500,
    );
  }
  if (!collectionEnabled) {
    return c.json({ error: "Ship growth collection is disabled" }, 503);
  }

  const signingSecret = getEnv(env, "SHIP_GROWTH_SIGNING_SECRET");
  if (!signingSecret) {
    return c.json({ error: "SHIP_GROWTH_SIGNING_SECRET is required" }, 500);
  }

  const uploadToken = c.req.header("X-Upload-Token");

  // ── Stage 1: Handshake ───────────────────────────────────────────
  if (!uploadToken) {
    const authHeader = c.req.header("Authorization");
    const bearer = authHeader?.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : null;
    if (!bearer) return c.json({ error: "Unauthorized" }, 401);
    const user = await validateJWT(bearer);
    if (!user?.id)
      return c.json({ error: "Invalid or expired JWT token" }, 401);

    const handshakeBody = (await c.req
      .json()
      .catch(() => null)) as IngestBody | null;

    const validated = validateIngestBody(handshakeBody);
    if (!validated.ok) return c.json({ error: validated.error }, 400);
    const periodTagValidation = await validateCachedPeriodTag(
      c,
      String(handshakeBody?.period_tag ?? "").trim(),
      { cacheKV: c.env.DATA_LOADER_CACHE_KV },
    );
    if (!periodTagValidation.ok) {
      return c.json(
        { error: periodTagValidation.error },
        periodTagValidation.status,
      );
    }

    // Require dataset_token to prove ownership of dataset_id.
    const datasetToken = resolveDatasetToken(
      c.req.header("X-Dataset-Token"),
      handshakeBody?.dataset_token,
    );
    const datasetTokenSecret = getEnv(env, "DATASET_TOKEN_SECRET");
    // Validate secret length upfront
    const secretValidation = validateDatasetTokenSecret(datasetTokenSecret);
    if (!secretValidation.ok) {
      return c.json({ error: secretValidation.error }, 500);
    }
    const tokenValidation = await validateDatasetTokenWithConstraints({
      token: datasetToken,
      secret: datasetTokenSecret,
      expectedDatasetId: validated.datasetId,
      // expectedUserId は検証しない: 複数端末では端末ごとの匿名 user_id が異なるため。
      // データ帰属は dataset_id (member_id_hash) の照合で担保する。
    });
    if (!tokenValidation.ok) {
      return c.json(
        { error: tokenValidation.error },
        tokenValidation.status ?? 401,
      );
    }
    const actingUserId = tokenValidation.token!.user_id;

    const contentHash = String(handshakeBody?.content_hash ?? "").trim();
    if (!contentHash) return c.json({ error: "content_hash is required" }, 400);

    const declaredSize = Number(handshakeBody?.file_size ?? 0);
    const MAX_INGEST_BYTES = 10 * 1024 * 1024; // 10 MB
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return c.json({ error: "file_size must be > 0" }, 400);
    }
    if (declaredSize > MAX_INGEST_BYTES) {
      return c.json(
        {
          error: `file_size exceeds maximum allowed size (${MAX_INGEST_BYTES} bytes)`,
        },
        400,
      );
    }

    // Calculate token expiry based on file size to accommodate slow/large uploads.
    // Base 30s + 10s per 10MB, clamped to [300, 3600] seconds.
    const tokenTtl = Math.max(
      300,
      Math.min(3600, 30 + Math.ceil(declaredSize / (10 * 1024 * 1024)) * 10),
    );

    const uploadTrust = await resolveUploadTrustDecision({
      c,
      body: handshakeBody,
      requirement: "require_report",
      datasetId: validated.datasetId,
    });
    if (!uploadTrust.allow) {
      return c.json(
        { error: uploadTrust.error ?? "attestation_policy_rejected" },
        uploadTrust.status,
      );
    }

    const token = await generateSignedToken(
      {
        user_id: actingUserId,
        upload_jti: crypto.randomUUID(),
        content_hash: contentHash,
        declared_size: declaredSize,
        dataset_id: validated.datasetId,
        request_id: validated.requestId,
        event_type: validated.eventType,
        trust_tag: uploadTrust.trustTag,
        attestation_level: uploadTrust.attestationLevel,
        attestation_valid: uploadTrust.attestationValid,
        token_trust_tag_audit: tokenValidation.token?.trust_tag ?? null,
      },
      signingSecret,
      tokenTtl,
    );

    const uploadUrl = new URL(c.req.url);
    // stripApiPrefix() removes /api/ before Hono sees the URL; restore it for Stage-2 clients.
    if (!uploadUrl.pathname.startsWith("/api/")) {
      uploadUrl.pathname =
        "/api" +
        (uploadUrl.pathname.startsWith("/")
          ? uploadUrl.pathname
          : "/" + uploadUrl.pathname);
    }
    return c.json({
      uploadUrl: uploadUrl.toString(),
      token,
      expiresAt: new Date(Date.now() + tokenTtl * 1000).toISOString(),
    });
  }

  // ── Stage 2: Execution ───────────────────────────────────────────
  const authHeader = c.req.header("Authorization");
  const bearer = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : null;
  if (!bearer) return c.json({ error: "Unauthorized" }, 401);
  const user = await validateJWT(bearer);
  if (!user?.id) return c.json({ error: "Invalid or expired JWT token" }, 401);

  const tokenPayload = await verifySignedToken(uploadToken, signingSecret);
  if (!tokenPayload)
    return c.json({ error: "Invalid or expired upload token" }, 401);

  const payloadValidation = validateTokenPayload(tokenPayload, [
    "content_hash",
    "declared_size",
    "dataset_id",
    "request_id",
    "event_type",
  ]);
  if (!payloadValidation.valid) {
    return c.json(
      { error: payloadValidation.error ?? "Invalid upload token payload" },
      400,
    );
  }
  const securityGuards = await enforceUploadExecutionSecurityGuards({
    c,
    request: c.req.raw,
    tokenPayload,
    requireDatasetToken: true,
  });
  if (!securityGuards.ok) {
    return c.json({ error: securityGuards.error }, securityGuards.status);
  }
  // user_id 照合は行わない: upload token の user_id は dataset_token.sub（帰属者）であり
  // JWT user_id（端末固有）と一致しないことがある。JWT 有効性は上で確認済み。

  const declaredSize = Number(tokenPayload.declared_size);
  if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
    return c.json({ error: "Invalid token payload (declared_size)" }, 400);
  }

  const uploadedBody = await readUploadRequestBodyWithLimit({
    request: c.req.raw,
    maxBodySize: declaredSize,
  });
  if (!uploadedBody.ok) {
    return c.json(
      {
        error: uploadedBody.error,
        ...(uploadedBody.limit != null ? { limit: uploadedBody.limit } : {}),
        ...(uploadedBody.actual != null ? { actual: uploadedBody.actual } : {}),
      },
      uploadedBody.status,
    );
  }
  const uploaded = uploadedBody.data;

  if (uploaded.byteLength !== declaredSize) {
    return c.json(
      {
        error: "Data size mismatch",
        expected: declaredSize,
        actual: uploaded.byteLength,
      },
      400,
    );
  }

  // Hash check
  const actualHash = await sha256Hex(uploaded);
  const expectedHash = String(tokenPayload.content_hash ?? "").toLowerCase();
  if (!timingSafeEqual(actualHash.toLowerCase(), expectedHash)) {
    return c.json(
      { error: "Content hash mismatch - data may be corrupted" },
      400,
    );
  }

  // Parse JSON payload
  let body: IngestBody;
  try {
    body = JSON.parse(new TextDecoder().decode(uploaded)) as IngestBody;
  } catch {
    return c.json({ error: "Invalid JSON upload payload" }, 400);
  }

  const verified = validateIngestBody(body);
  if (!verified.ok) return c.json({ error: verified.error }, 400);
  const periodTagValidation = await validateCachedPeriodTag(
    c,
    body.period_tag,
    { cacheKV: c.env.DATA_LOADER_CACHE_KV },
  );
  if (!periodTagValidation.ok) {
    return c.json(
      { error: periodTagValidation.error },
      periodTagValidation.status,
    );
  }

  // Verify claims match payload
  if (
    verified.datasetId !== String(tokenPayload.dataset_id) ||
    verified.requestId !== String(tokenPayload.request_id) ||
    verified.eventType !== String(tokenPayload.event_type)
  ) {
    return c.json(
      { error: "Upload payload does not match upload token claims" },
      400,
    );
  }

  const result = await processShipGrowthIngest(c.env, db, body);

  // On successful ingest, invalidate KV snapshots and CF Cache entries.
  if (result.status === 200) {
    const period_tag = body.period_tag;
    const table_version = body.table_version;

    // KV invalidation (primary cache layer)
    if (period_tag && table_version) {
      scheduleShipGrowthTask(
        c,
        (async () => {
          await invalidateShipGrowthKvSnapshots(
            c.env.DATA_LOADER_CACHE_KV,
            period_tag,
            table_version,
          );
          // Pre-warm caches immediately after invalidation so the next user doesn't hit a full D1 scan
          try {
            await app.request(
              `/summary`,
              {},
              c.env,
              safeGetExecutionCtx(c)
            );
            await app.request(
              `/exp?period_tag=${period_tag}&table_version=${table_version}`,
              {},
              c.env,
              safeGetExecutionCtx(c)
            );
            await app.request(
              `/bounds?period_tag=${period_tag}&table_version=${table_version}`,
              {},
              c.env,
              safeGetExecutionCtx(c)
            );
          } catch (err) {
            console.warn("[ship-growth] Failed to pre-warm caches:", err);
          }
        })()
      );
    }

    // Cumulative archive KV snapshot is invalidated as part of
    // invalidateShipGrowthKvSnapshots (see CUMULATIVE_KV_KEY) above.

    // CF Cache invalidation (best-effort, non-critical)
    const cfCache = (globalThis as { caches?: { default?: Cache } }).caches
      ?.default;
    if (cfCache) {
      scheduleShipGrowthTask(
        c,
        invalidateShipGrowthCaches(cfCache, c.req.url).catch((err) => {
          console.warn(
            "[ship-growth] Failed to invalidate CF caches after ingest:",
            err,
          );
        }),
      );
    }
  }

  return c.json(result.body, result.status as 200 | 400 | 409 | 500 | 503);
});

export default app;
