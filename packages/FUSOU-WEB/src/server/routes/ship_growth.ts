import { Hono } from "hono";
import type { Bindings, D1Database } from "../types";
import { decodeAvroOcfToJson } from "../utils/avro-decoder";
import { getSynergyManifestR2Keys } from "../types/synergy";
import {
  createEnvContext,
  generateSignedToken,
  getEnv,
  resolveDatasetToken,
  timingSafeEqual,
  validateDatasetTokenSecret,
  validateDatasetTokenWithConstraints,
  validateJWT,
  validateTokenPayload,
  verifySignedToken,
} from "../utils";
import {
  invalidateCanonicalSnapshots,
  loadOrRefreshCanonicalSnapshot,
} from "../utils/snapshot-cache";

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
  kaihi_naked: number;
  taisen_naked: number;
  sakuteki_naked: number;
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
}

interface DerivedNakedStats {
  kaihi: number;
  taisen: number;
  sakuteki: number;
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

    statsMap.set(id, { houk, tais, saku });
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
  return { kaihi: 0, taisen: 0, sakuteki: 0 };
}

function addTotals(
  a: SynergyStatTotals,
  b: SynergyStatTotals,
): SynergyStatTotals {
  return {
    kaihi: a.kaihi + b.kaihi,
    taisen: a.taisen + b.taisen,
    sakuteki: a.sakuteki + b.sakuteki,
  };
}

function scaleTotals(value: SynergyStatTotals, n: number): SynergyStatTotals {
  return {
    kaihi: value.kaihi * n,
    taisen: value.taisen * n,
    sakuteki: value.sakuteki * n,
  };
}

function toShipTotals(
  raw: Record<string, unknown> | undefined,
): SynergyStatTotals {
  if (!raw) return emptyTotals();
  const kaihi = toInt(raw.kaih) + toInt(raw.houk) + toInt(raw.kaihi);
  const taisen = toInt(raw.tais) + toInt(raw.taisen);
  const sakuteki = toInt(raw.saku) + toInt(raw.sakuteki);
  return { kaihi, taisen, sakuteki };
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
    return c2.kaihi !== 0 || c2.taisen !== 0 || c2.sakuteki !== 0
      ? c2
      : scaleTotals(base, 2);
  }

  const c3 = toShipTotals(rule.c3);
  return c3.kaihi !== 0 || c3.taisen !== 0 || c3.sakuteki !== 0
    ? c3
    : scaleTotals(base, count);
}

async function loadSynergyDataSet(
  env: Bindings,
  periodTag: string,
): Promise<SynergyDataSet> {
  const manifest = (await env.MASTER_DATA_INDEX_DB.prepare(
    `SELECT period_tag, period_revision, content_hash
     FROM synergy_manifest
     WHERE period_tag = ?
       AND upload_status = 'completed'
     ORDER BY period_revision DESC
     LIMIT 1`,
  )
    .bind(periodTag)
    .first()) as {
    period_tag?: string;
    period_revision?: number;
    content_hash?: string;
  } | null;

  const periodRevision = manifest?.period_revision;
  if (
    !manifest?.period_tag ||
    typeof periodRevision !== "number" ||
    !Number.isInteger(periodRevision) ||
    !manifest.content_hash
  ) {
    throw new Error(`synergy manifest not found for period_tag=${periodTag}`);
  }

  const cacheKey = `${manifest.period_tag}:${periodRevision}:${manifest.content_hash}`;
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
    throw new Error(`synergy data missing in R2: ${r2Keys.sp_effect_json}`);
  }

  const parsed = JSON.parse(
    new TextDecoder().decode(await object.arrayBuffer()),
  ) as {
    effects?: Record<string, unknown>;
    cross_effects?: Record<string, unknown>;
  };

  const singleByItem = new Map<number, SynergySingleRule[]>();
  let droppedSingleCount = 0;
  for (const [itemKey, rawRules] of Object.entries(parsed.effects ?? {})) {
    const itemId = Number(itemKey);
    if (!Number.isInteger(itemId) || itemId <= 0 || !Array.isArray(rawRules)) {
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
  if (droppedSingleCount > 0) {
    console.warn(
      `[ship-growth] Dropped ${droppedSingleCount} invalid synergy single entries (period=${periodTag})`,
    );
  }

  const crossByPair = new Map<string, SynergyCrossRule[]>();
  let droppedCrossCount = 0;
  for (const [pairKey, rawRules] of Object.entries(
    parsed.cross_effects ?? {},
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
  if (droppedCrossCount > 0) {
    console.warn(
      `[ship-growth] Dropped ${droppedCrossCount} invalid synergy cross entries (period=${periodTag})`,
    );
  }

  const dataSet: SynergyDataSet = {
    singleByItem,
    crossByPair,
  };
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
  const kaihiRaw = ship.kaihi_observed - slotKaihi - spEffectKaihi - totalSynergyTotals.kaihi;
  const taisenRaw = ship.taisen_observed - slotTaisen - totalSynergyTotals.taisen;
  const sakutekiRaw = ship.sakuteki_observed - slotSakuteki - totalSynergyTotals.sakuteki;

  const kaihi = Math.max(0, kaihiRaw);
  const taisen = Math.max(0, taisenRaw);
  const sakuteki = Math.max(0, sakutekiRaw);

  // Log if negative result is clamped to zero—indicates possible data quality issue upstream.
  if (kaihiRaw < 0 || taisenRaw < 0 || sakutekiRaw < 0) {
    console.warn(
      `[ship-growth] Derived stat clamped to zero for ship ${ship.master_id} lv${ship.lv}: ` +
        `kaihi=${kaihiRaw} taisen=${taisenRaw} sakuteki=${sakutekiRaw}`,
    );
  }

  const breakdown: ServerDerivationBreakdown = {
    removed: {
      slot: {
        kaihi: slotKaihi,
        taisen: slotTaisen,
        sakuteki: slotSakuteki,
      },
      spEffect: {
        kaihi: spEffectKaihi,
        taisen: 0,
        sakuteki: 0,
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
    stats: { kaihi, taisen, sakuteki },
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

  if (!body.period_tag || !/^\d{4}-\d{2}-\d{2}$/.test(body.period_tag)) {
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
      ship.exp_to_next == null || (isValidInt(ship.exp_to_next) && ship.exp_to_next >= 0);

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
        });
      } else {
        existingBound.kaihi_naked = Math.min(
          existingBound.kaihi_naked,
          derived.stats.kaihi,
        );
        existingBound.taisen_naked = Math.min(
          existingBound.taisen_naked,
          derived.stats.taisen,
        );
        existingBound.sakuteki_naked = Math.min(
          existingBound.sakuteki_naked,
          derived.stats.sakuteki,
        );
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

function buildArchivePruneStatements(
  db: D1Database,
  oldBounds: ShipGrowthArchiveBoundRow[],
  oldCaps: ShipGrowthArchiveCapRow[],
): ReturnType<D1Database["prepare"]>[] {
  const stmts: ReturnType<D1Database["prepare"]>[] = [];
  const boundRowIds = Array.from(new Set(oldBounds.map((row) => row.row_id)));
  for (const rowId of boundRowIds) {
    stmts.push(
      db.prepare(`DELETE FROM ship_growth_bounds WHERE rowid = ?`).bind(rowId),
    );
  }
  const capRowIds = Array.from(new Set(oldCaps.map((row) => row.row_id)));
  for (const rowId of capRowIds) {
    stmts.push(
      db.prepare(`DELETE FROM ship_growth_caps WHERE rowid = ?`).bind(rowId),
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
      `SELECT rowid AS row_id, period_tag, table_version, master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked
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
    // DO NOT upload archive yet—wait until after DB batch succeeds to avoid orphaned R2 objects.
  } catch (error) {
    const detail = String(error);
    if (detail.includes("SHIP_GROWTH_ARCHIVE_BUCKET is not configured")) {
      return {
        status: 503,
        body: {
          error: "Ship growth archive bucket is not configured",
          action: "Configure SHIP_GROWTH_ARCHIVE_BUCKET in worker bindings",
        },
      };
    }

    return {
      status: 500,
      body: {
        error: "Failed to collect ship growth history for archiving",
        detail,
      },
    };
  }

  // Pre-check EXP boundary conflicts against existing DB rows before writing.
  // Batch all LV lookups into a single IN-clause query instead of N sequential queries.
  if (expRows.length > 0) {
    const placeholders = expRows.map(() => "?").join(", ");
    const existingExpRows = (
      await db
        .prepare(
          `SELECT lv, exp_current
           FROM ship_level_exp_pairs
           WHERE period_tag = ? AND table_version = ? AND lv IN (${placeholders})`,
        )
        .bind(period_tag, table_version, ...expRows.map((r) => r.lv))
        .all()
    ).results as { lv: number; exp_current: number }[];

    const existingExpMap = new Map(
      existingExpRows.map((r) => [r.lv, r.exp_current]),
    );
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

  // Build all write statements: archive prune + exp inserts + bounds upserts + caps upserts.
  // D1 does not support BEGIN/COMMIT; use db.batch() for atomicity (100-stmt chunks).
  const stmts: ReturnType<D1Database["prepare"]>[] = [];

  stmts.push(...buildArchivePruneStatements(db, oldBounds, oldCaps));

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
          `INSERT INTO ship_growth_bounds (period_tag, table_version, master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(period_tag, table_version, master_id, lv) DO UPDATE SET
             kaihi_naked = CASE WHEN excluded.kaihi_naked < kaihi_naked THEN excluded.kaihi_naked ELSE kaihi_naked END,
             taisen_naked = CASE WHEN excluded.taisen_naked < taisen_naked THEN excluded.taisen_naked ELSE taisen_naked END,
             sakuteki_naked = CASE WHEN excluded.sakuteki_naked < sakuteki_naked THEN excluded.sakuteki_naked ELSE sakuteki_naked END,
             updated_at = CASE WHEN excluded.kaihi_naked < kaihi_naked OR excluded.taisen_naked < taisen_naked OR excluded.sakuteki_naked < sakuteki_naked THEN excluded.updated_at ELSE updated_at END`,
        )
        .bind(
          period_tag,
          table_version,
          row.master_id,
          row.lv,
          row.kaihi_naked,
          row.taisen_naked,
          row.sakuteki_naked,
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

  // DB batch succeeded; now archive old rows to R2 (after DB write, not before).
  // This prevents orphaned archives if DB batch had failed.
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
    // Archive failed but DB succeeded—continue
    console.error("[ship-growth] Failed to archive old rows to R2:", archiveError);
    // Continue: do not fail the ingest response.
  }

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
    new URL("/api/ship-growth/summary", origin).toString(),
    new URL("/api/ship-growth/exp", origin).toString(),
    new URL("/api/ship-growth/bounds", origin).toString(),
  ];

  for (const target of targets) {
    try {
      await cache.delete(new Request(target, { method: "GET" }), {
        ignoreSearch: true,
      });
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
  bounds: Array<{
    master_id: number;
    lv: number;
    kaihi_naked: number;
    taisen_naked: number;
    sakuteki_naked: number;
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
  await invalidateCanonicalSnapshots(kv, [
    `sg:exp:${period_tag}:${table_version}`,
    `sg:bounds:${period_tag}:${table_version}`,
  ]);
}

// ── Cache helper ───────────────────────────────────────────────────

async function putShipGrowthCache(
  c: { executionCtx?: { waitUntil?: (p: Promise<unknown>) => void } },
  cache: Cache,
  cacheKey: Request,
  response: Response,
): Promise<void> {
  const putPromise = cache.put(cacheKey, response.clone());
  try {
    const waitUntil = c.executionCtx?.waitUntil;
    if (typeof waitUntil === "function") {
      waitUntil.call(c.executionCtx, putPromise);
      return;
    }
  } catch (err) {
    if (!(err instanceof Error && /no executioncontext/i.test(err.message))) {
      console.warn(
        "[ship-growth] ExecutionContext unavailable for cache put",
        err,
      );
    }
  }
  await putPromise;
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

    const response = c.json({ ok: true, periods });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", "MISS");
    if (cache) {
      await putShipGrowthCache(c, cache, cacheKey, response);
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
    });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", cacheStatus);
    return response;
  } catch (err) {
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
              `SELECT master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, updated_at
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
        const boundsRows = ((
          await db
            .prepare(
              `SELECT master_id, lv, kaihi_naked, taisen_naked, sakuteki_naked, updated_at
               FROM ship_growth_bounds
               WHERE period_tag = ? AND table_version = ?
               ORDER BY master_id ASC, lv ASC LIMIT 10000`,
            )
            .bind(periodTag, tableVersion)
            .all()
        ).results ?? []) as Array<BoundsRow & { updated_at: number }>;

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
          bounds: boundsRows.map((r) => ({
            master_id: r.master_id,
            lv: r.lv,
            kaihi_naked: r.kaihi_naked,
            taisen_naked: r.taisen_naked,
            sakuteki_naked: r.sakuteki_naked,
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
    });
    response.headers.set(
      "Cache-Control",
      "public, max-age=3600, stale-while-revalidate=86400",
    );
    response.headers.set("X-FUSOU-Cache", cacheStatus);
    return response;
  } catch (err) {
    console.error("[ship-growth] Failed to query bounds:", err);
    return c.json({ error: "Failed to retrieve bounds data" }, 500);
  }
});
// ── Two-stage ingest endpoint ──────────────────────────────────────

app.post("/ingest", async (c) => {
  const db = c.env.SHIP_GROWTH_DB;
  if (!db) return c.json({ error: "SHIP_GROWTH_DB not configured" }, 503);

  const env = createEnvContext(c);
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
    if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
      return c.json({ error: "file_size must be > 0" }, 400);
    }

    // Calculate token expiry based on file size to accommodate slow/large uploads.
    // Base 30s + 10s per 10MB, clamped to [300, 3600] seconds.
    const tokenTtl = Math.max(
      300,
      Math.min(3600, 30 + Math.ceil(declaredSize / (10 * 1024 * 1024)) * 10),
    );

    const token = await generateSignedToken(
      {
        user_id: actingUserId,
        content_hash: contentHash,
        declared_size: declaredSize,
        dataset_id: validated.datasetId,
        request_id: validated.requestId,
        event_type: validated.eventType,
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
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
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
  // user_id 照合は行わない: upload token の user_id は dataset_token.sub（帰属者）であり
  // JWT user_id（端末固有）と一致しないことがある。JWT 有効性は上で確認済み。

  // Read binary body
  const bodyStream = c.req.raw.body;
  if (!bodyStream) return c.json({ error: "Upload payload is missing" }, 400);
  const uploaded = new Uint8Array(await new Response(bodyStream).arrayBuffer());

  // Size check
  const declaredSize = Number(tokenPayload.declared_size);
  if (!Number.isFinite(declaredSize) || uploaded.byteLength !== declaredSize) {
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
      c.executionCtx?.waitUntil(
        invalidateShipGrowthKvSnapshots(c.env.DATA_LOADER_CACHE_KV, period_tag, table_version),
      );
    }

    // CF Cache invalidation (best-effort, non-critical)
    const cfCache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
    if (cfCache) {
      c.executionCtx?.waitUntil(
        invalidateShipGrowthCaches(cfCache, c.req.url).catch((err) => {
          console.warn("[ship-growth] Failed to invalidate CF caches after ingest:", err);
        }),
      );
    }
  }

  return c.json(result.body, result.status as 200 | 400 | 409 | 500 | 503);
});

export default app;
