// ── Data loader: master data import, normalization, asset loading ──

import { z } from "zod";
import {
  addEquipExslotId,
  resetWeaponIconFrames,
  resetShipTypeIconFrames,
  setAssetBaseUrl,
  setBannerMap,
  setCardMap,
  setEquipCardMap,
  setEquipItemOnMap,
  setEquipItemUpMap,
  setHasMasterData,
  setMasterEquipExslotShip,
  setMasterEquipLimitExslot,
  setMasterEquipShip,
  setMasterEquipType,
  setMasterShip,
  setMasterSlotItem,
  setMasterStype,
  setShipIconMap,
  setShipTypeIconFrame,
  setShipTypeSpriteSheetMeta,
  setShipTypeSpriteSheetUrl,
  setSlotItemEffects,
  setSlotItemEffectsMeta,
  setSokuSpeedData,
  setSpriteSheetMeta,
  setSpriteSheetUrl,
  setWeaponIconFrame,
} from "./simulator-mutations";
import { beginBulkLoad, endBulkLoad } from "./state";
import {
  getAssetBaseUrl,
  getMasterDataCounts,
  getSlotItemEffects,
  getSlotItemEffectsMeta,
} from "./simulator-selectors";
import {
  loadAllCachedMasterData,
  saveMasterDataCache,
  type MasterCacheEntry,
} from "./master-data-cache";
import type {
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  SlotItemEffectsData,
  SlotItemEffectsMeta,
  MstStypeData,
  MstEquipShipData,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
} from "./types";
import {
  finiteNumberOrNull,
  jsonRecordOf,
  nullableNumberArray,
} from "./payload-codec";

function numberArrayOrNull(value: unknown): number[] | null {
  if (value == null) return null;
  const parsed = nullableNumberArray(value);
  const result: number[] = [];
  for (const item of parsed) {
    if (item === null) return null;
    result.push(item);
  }
  return result;
}

function numberOrDefault(value: unknown, fallback = 0): number {
  return finiteNumberOrNull(value) ?? fallback;
}

function parseMstShip(value: unknown, idOverride?: unknown): MstShipData | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const id = finiteNumberOrNull(idOverride ?? record["id"]);
  const name = typeof record["name"] === "string" ? record["name"] : null;
  const stype = finiteNumberOrNull(record["stype"]);
  const ctype = finiteNumberOrNull(record["ctype"]);
  if (id === null || name === null || stype === null || ctype === null) {
    return null;
  }
  return {
    id,
    name,
    stype,
    ctype,
    sort_id: numberOrDefault(record["sort_id"]),
    taik: numberArrayOrNull(record["taik"]),
    souk: numberArrayOrNull(record["souk"]),
    houg: numberArrayOrNull(record["houg"]),
    raig: numberArrayOrNull(record["raig"]),
    tyku: numberArrayOrNull(record["tyku"]),
    tais: numberArrayOrNull(record["tais"]),
    kaih: numberArrayOrNull(record["kaih"]),
    saku: numberArrayOrNull(record["saku"]),
    luck: numberArrayOrNull(record["luck"]),
    soku: numberOrDefault(record["soku"]),
    leng: numberOrDefault(record["leng"]),
    slot_num: numberOrDefault(record["slot_num"]),
    maxeq: numberArrayOrNull(record["maxeq"]),
  };
}

function parseMstSlotItem(value: unknown, idOverride?: unknown): MstSlotItemData | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const id = finiteNumberOrNull(idOverride ?? record["id"]);
  const name = typeof record["name"] === "string" ? record["name"] : null;
  const type = numberArrayOrNull(record["type"]);
  if (id === null || name === null || type === null) return null;
  const kaih = finiteNumberOrNull(record["kaih"]);
  const houk = finiteNumberOrNull(record["houk"]);
  const luck = finiteNumberOrNull(record["luck"]);
  const leng = finiteNumberOrNull(record["leng"]);
  const soku = finiteNumberOrNull(record["soku"]);
  return {
    id,
    name,
    sortno: numberOrDefault(record["sortno"]),
    type,
    houg: numberOrDefault(record["houg"]),
    raig: numberOrDefault(record["raig"]),
    tyku: numberOrDefault(record["tyku"]),
    tais: numberOrDefault(record["tais"]),
    baku: numberOrDefault(record["baku"]),
    saku: numberOrDefault(record["saku"]),
    houm: numberOrDefault(record["houm"]),
    souk: numberOrDefault(record["souk"]),
    distance: finiteNumberOrNull(record["distance"]),
    ...(kaih === null ? {} : { kaih }),
    ...(houk === null ? {} : { houk }),
    ...(luck === null ? {} : { luck }),
    ...(leng === null ? {} : { leng }),
    ...(soku === null ? {} : { soku }),
  };
}

function numericRecordOrNull(value: unknown): Record<string, number> | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    const number = finiteNumberOrNull(item);
    if (number === null) return null;
    result[key] = number;
  }
  return result;
}

function nullableNumericRecordOrNull(
  value: unknown,
): Record<string, number> | null {
  if (value === null || value === undefined) return null;
  return numericRecordOrNull(value);
}

function numberArrayRecordOrNull(
  value: unknown,
): Record<string, number[] | null> | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const result: Record<string, number[] | null> = {};
  for (const [key, item] of Object.entries(record)) {
    if (item === null) {
      result[key] = null;
      continue;
    }
    const numbers = numberArrayOrNull(item);
    if (numbers === null) return null;
    result[key] = numbers;
  }
  return result;
}

function parseMstStype(value: unknown, idOverride?: unknown): MstStypeData | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const id = finiteNumberOrNull(idOverride ?? record["id"]);
  const equipType = numericRecordOrNull(record["equip_type"]);
  if (id === null || equipType === null) return null;
  return {
    id,
    sortno: numberOrDefault(record["sortno"]),
    name: typeof record["name"] === "string" ? record["name"] : "",
    equip_type: equipType,
  };
}

function parseMstEquipShip(value: unknown, idOverride?: unknown): MstEquipShipData | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const shipId = finiteNumberOrNull(idOverride ?? record["ship_id"]);
  const equipType = numberArrayRecordOrNull(record["equip_type"]);
  if (shipId === null || equipType === null) return null;
  return { ship_id: shipId, equip_type: equipType };
}

function parseMstEquipExslotShip(
  value: unknown,
  idOverride?: unknown,
): MstEquipExslotShipData | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const slotitemId = finiteNumberOrNull(idOverride ?? record["slotitem_id"]);
  const reqLevel = finiteNumberOrNull(record["req_level"]);
  if (slotitemId === null || reqLevel === null) return null;
  const shipIds = nullableNumericRecordOrNull(record["ship_ids"]);
  const stypes = nullableNumericRecordOrNull(record["stypes"]);
  const ctypes = nullableNumericRecordOrNull(record["ctypes"]);
  const reqAlv = finiteNumberOrNull(record["req_alv"]);
  return {
    slotitem_id: slotitemId,
    ship_ids: shipIds,
    stypes,
    ctypes,
    req_level: reqLevel,
    ...(reqAlv === null ? {} : { req_alv: reqAlv }),
  };
}

function parseMstEquipLimitExslot(
  value: unknown,
  idOverride?: unknown,
): MstEquipLimitExslotData | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const shipId = finiteNumberOrNull(idOverride ?? record["ship_id"]);
  const equip = numberArrayOrNull(record["equip"]);
  if (shipId === null || equip === null) return null;
  return { ship_id: shipId, equip };
}

function parseMstEquipType(
  value: unknown,
  idOverride?: unknown,
): MstSlotItemEquipTypeData | null {
  const record = jsonRecordOf(value);
  if (!record) return null;
  const id = finiteNumberOrNull(idOverride ?? record["id"]);
  const name = typeof record["name"] === "string" ? record["name"] : null;
  return id === null || name === null ? null : { id, name };
}

const responseMetadataShape = {
  period_tag: z.string().optional(),
  period_revision: z.number().int().optional(),
  table_version: z.string().optional(),
};

function parsedRecordsSchema<T>(
  parse: (value: unknown) => T | null,
 ) {
  return z.array(z.unknown()).transform((values) =>
    values.flatMap((value) => {
      const parsed = parse(value);
      return parsed === null ? [] : [parsed];
    }),
  );
}

function masterRecordsResponseSchema<T>(
  parse: (value: unknown) => T | null,
) {
  return z
    .object({
      records: parsedRecordsSchema(parse),
      ...responseMetadataShape,
    })
    .passthrough();
}

const MasterShipResponseSchema = masterRecordsResponseSchema(parseMstShip);
const MasterSlotItemResponseSchema = masterRecordsResponseSchema(
  parseMstSlotItem,
);
const MasterSlotItemEquipTypeResponseSchema = masterRecordsResponseSchema(
  parseMstEquipType,
);
const MasterStypeResponseSchema = masterRecordsResponseSchema(parseMstStype);
const MasterEquipShipResponseSchema = masterRecordsResponseSchema(
  parseMstEquipShip,
);
const MasterEquipExslotShipResponseSchema = masterRecordsResponseSchema(
  parseMstEquipExslotShip,
);
const MasterEquipLimitExslotResponseSchema = masterRecordsResponseSchema(
  parseMstEquipLimitExslot,
);
const MasterEquipExslotResponseSchema = z
  .object({
    records: z.array(
      z.object({ equip: z.number().finite() }).passthrough(),
    ),
    ...responseMetadataShape,
  })
  .passthrough();

const AssetMapResponseSchema = z
  .object({
    base_url: z.string(),
    banners: z.record(z.string()),
  })
  .passthrough();
const CardMapResponseSchema = z
  .object({
    base_url: z.string(),
    cards: z.record(z.string()),
  })
  .passthrough();
const ShipIconMapResponseSchema = z
  .object({
    base_url: z.string(),
    icons: z.record(z.string()),
  })
  .passthrough();
const EquipImageMapResponseSchema = z
  .object({
    base_url: z.string(),
    card: z.record(z.string()),
    item_on: z.record(z.string()),
    item_up: z.record(z.string()),
  })
  .passthrough();

const IconFrameSchema = z
  .object({
    frame: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        w: z.number().finite(),
        h: z.number().finite(),
      })
      .passthrough(),
  })
  .passthrough();
const IconFramesResponseSchema = z
  .object({
    frames: z.record(IconFrameSchema),
    meta: z
      .object({
        size: z
          .object({ w: z.number().finite(), h: z.number().finite() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

const SokuSpeedResponseSchema = z
  .object({
    ok: z.literal(true),
    data: z.record(
      z.array(
        z
          .object({
            soku_observed: z.union([
              z.literal(5),
              z.literal(10),
              z.literal(15),
              z.literal(20),
            ]),
            item_ids: z.array(z.number().int().positive()),
          })
          .passthrough(),
      ),
    ),
  })
  .passthrough();

function filterRecords(value: unknown): Array<{
  record: Record<string, unknown>;
  key: string | null;
}> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const record = jsonRecordOf(item);
      return record ? [{ record, key: null }] : [];
    });
  }
  const object = jsonRecordOf(value);
  return Object.entries(object ?? {}).flatMap(([key, item]) => {
    const record = jsonRecordOf(item);
    return record ? [{ record, key }] : [];
  });
}

export function normalizeMstSlotItem(raw: MstSlotItemData): MstSlotItemData {
  if (raw.kaih == null && raw.houk != null) {
    return { ...raw, kaih: raw.houk };
  }
  return raw;
}

/**
 * Normalize MstShip from Avro-decoded JSON.
 * Avro schema declares `leng` as nullable (["null","int"]); fall back to 0 so
 * downstream stat computations (range bonuses) never see undefined/null base.
 */
export function normalizeMstShip(raw: MstShipData): MstShipData {
  if (raw.leng == null) {
    return { ...raw, leng: 0 };
  }
  return raw;
}

function formatEpochSecondsToJst(value: number | null): string | null {
  if (!Number.isFinite(value) || value == null || value <= 0) return null;
  try {
    return new Date(value * 1000).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  } catch {
    return null;
  }
}

function getSlotItemEffectsMetaForStatus(): string | null {
  const meta = getSlotItemEffectsMeta();
  if (!meta) return null;
  if (meta.source === "dev-fallback") {
    return "ローカル開発フォールバック (収集データ未投入)";
  }
  const completedAtText = formatEpochSecondsToJst(meta.completed_at);
  const when = completedAtText ? `${completedAtText} JST` : "時刻不明";
  const core = `${meta.period_tag} rev${meta.period_revision} (${when})`;
  if (meta.generator_version) {
    return `${core} / ${meta.generator_version}`;
  }
  return core;
}

function parseIntHeader(value: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  return n;
}

type SynergyResponse = SlotItemEffectsData & {
  _meta?: {
    generator_version?: string;
    table_version?: string;
  };
};

function isFiniteNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every(
      (item): item is number =>
        typeof item === "number" && Number.isFinite(item),
    )
  );
}

function isFiniteNumberRecord(value: unknown): value is Record<string, number> {
  const record = jsonRecordOf(value);
  return (
    record !== null &&
    Object.values(record).every(
      (item): item is number =>
        typeof item === "number" && Number.isFinite(item),
    )
  );
}

function isNumberArrayField(record: Record<string, unknown>, key: string): boolean {
  return !(key in record) || isFiniteNumberArray(record[key]);
}

function isSynergyRule(value: unknown, effectRule: boolean): boolean {
  const record = jsonRecordOf(value);
  if (!record || !isFiniteNumberArray(record["ships"])) return false;
  const mainMapKey = effectRule ? "b" : "synergy";
  if (!isFiniteNumberRecord(record[mainMapKey])) return false;

  for (const key of [
    "items",
    "item_pool",
    "fixed_items",
    "free_pool",
    "suppressed_components",
  ]) {
    if (!isNumberArrayField(record, key)) return false;
  }
  if (
    !isNumberArrayField(record, "category_pools") &&
    !(
      Array.isArray(record["category_pools"]) &&
      record["category_pools"].every(isFiniteNumberArray)
    )
  ) {
    return false;
  }
  if (
    "free_pool_with_replacement" in record &&
    typeof record["free_pool_with_replacement"] !== "boolean"
  ) {
    return false;
  }
  if (
    "free_pick_count" in record &&
    (typeof record["free_pick_count"] !== "number" ||
      !Number.isFinite(record["free_pick_count"]))
  ) {
    return false;
  }
  for (const key of ["combos_gz_b64", "combos_b64", "combos_u16_b64", "combos_u32_b64"]) {
    if (key in record && typeof record[key] !== "string") return false;
  }
  if (
    "combos_codec" in record &&
    record["combos_codec"] !== "u8" &&
    record["combos_codec"] !== "u16" &&
    record["combos_codec"] !== "u32"
  ) {
    return false;
  }
  return true;
}

function isSynergyResponse(value: unknown): value is SynergyResponse {
  const record = jsonRecordOf(value);
  if (!record) return false;

  for (const key of [
    "effect_rules",
    "cross_rules",
    "triple_rules",
    "quad_rules",
    "penta_rules",
    "hexa_rules",
  ]) {
    if (!(key in record)) continue;
    if (!Array.isArray(record[key])) return false;
    const effectRule = key === "effect_rules";
    if (!record[key].every((item) => isSynergyRule(item, effectRule))) {
      return false;
    }
  }

  for (const key of [
    "effect_rules_equip_index",
    "cross_rules_equip_index",
    "triple_rules_equip_index",
    "quad_rules_equip_index",
    "penta_rules_equip_index",
    "hexa_rules_equip_index",
  ]) {
    if (!(key in record)) continue;
    const index = jsonRecordOf(record[key]);
    if (!index || !Object.values(index).every(isFiniteNumberArray)) return false;
  }

  for (const key of ["effects", "cross_effects"]) {
    if (!(key in record)) continue;
    const legacy = jsonRecordOf(record[key]);
    if (!legacy || !Object.values(legacy).every(Array.isArray)) return false;
  }

  if ("_meta" in record) {
    const meta = jsonRecordOf(record["_meta"]);
    if (
      !meta ||
      ("generator_version" in meta &&
        typeof meta["generator_version"] !== "string") ||
      ("table_version" in meta && typeof meta["table_version"] !== "string")
    ) {
      return false;
    }
  }
  return true;
}

function base64ToBytes(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    const chunk = bytes.subarray(i, i + 0x8000);
    out += String.fromCharCode(...chunk);
  }
  return btoa(out);
}

async function gunzipBytes(input: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("DecompressionStream is not available in this browser");
  }
  const ds = new DecompressionStream("gzip");
  const ab = new Uint8Array(input).buffer;
  const stream = new Blob([ab]).stream().pipeThrough(ds);
  const out = await new Response(stream).arrayBuffer();
  return new Uint8Array(out);
}

async function normalizeCompressedComboRules(
  data: SlotItemEffectsData,
): Promise<SlotItemEffectsData> {
  const ruleLists = [
    data.triple_rules,
    data.quad_rules,
    data.penta_rules,
    data.hexa_rules,
  ];
  const promises: Promise<void>[] = [];

  for (const rules of ruleLists) {
    if (!rules) continue;
    for (const rule of rules) {
      if (!rule.combos_gz_b64 || !rule.combos_codec) continue;
      
      const p = (async () => {
        const inflated = await gunzipBytes(base64ToBytes(rule.combos_gz_b64!));
        const inflatedB64 = bytesToBase64(inflated);
        if (rule.combos_codec === "u8") {
          rule.combos_b64 = inflatedB64;
        } else if (rule.combos_codec === "u16") {
          rule.combos_u16_b64 = inflatedB64;
        } else {
          rule.combos_u32_b64 = inflatedB64;
        }
        delete rule.combos_gz_b64;
        delete rule.combos_codec;
      })();
      promises.push(p);
    }
  }

  await Promise.all(promises);

  return data;
}

async function fetchSynergyDataWithMeta(
  cached?: MasterCacheEntry<{ data: SlotItemEffectsData; meta: SlotItemEffectsMeta | null }> | null,
): Promise<{
  data: SlotItemEffectsData | null;
  meta: SlotItemEffectsMeta | null;
  fromCache: boolean;
}> {
  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers["If-None-Match"] = cached.etag;
    }
    const res = await fetch("/api/master-data/synergy-data", {
      headers,
    });
    if (res.status === 304 && cached?.data) {
      console.info("[simulator] synergy-data 304 Not Modified — using cached rules");
      return { data: cached.data.data, meta: cached.data.meta, fromCache: true };
    }
    if (!res.ok) {
      console.warn("[simulator] slot_item_effects fetch failed", {
        url: "/api/master-data/synergy-data",
        status: res.status,
      });
      return { data: cached?.data?.data ?? null, meta: cached?.data?.meta ?? null, fromCache: !!cached?.data };
    }

    let parsed: SynergyResponse | null = null;
    try {
      const responseJson = await res.json();
      if (isSynergyResponse(responseJson)) {
        parsed = responseJson;
        parsed = await normalizeCompressedComboRules(parsed);
      }
    } catch (err) {
      console.error("[simulator] slot_item_effects json parse failed", {
        url: "/api/master-data/synergy-data",
        error: String(err),
      });
      return { data: cached?.data?.data ?? null, meta: cached?.data?.meta ?? null, fromCache: !!cached?.data };
    }

    const periodTag = res.headers.get("X-FUSOU-Synergy-Period-Tag") ?? "";
    const periodRevision = parseIntHeader(
      res.headers.get("X-FUSOU-Synergy-Period-Revision"),
    );
    const completedAt = parseIntHeader(
      res.headers.get("X-FUSOU-Synergy-Completed-At"),
    );
    const source = res.headers.get("X-FUSOU-Synergy-Source");

    const meta: SlotItemEffectsMeta | null =
      periodTag && periodRevision != null
        ? {
            period_tag: periodTag,
            period_revision: periodRevision,
            completed_at: completedAt,
            source,
            generator_version: parsed?._meta?.generator_version ?? null,
            table_version: parsed?._meta?.table_version ?? null,
          }
        : source === "dev-fallback"
          ? {
              period_tag: "local-dev",
              period_revision: 0,
              completed_at: null,
              source: "dev-fallback",
              generator_version: null,
              table_version: null,
            }
          : null;

    const etag = res.headers.get("ETag");
    if (parsed) {
      saveMasterDataCache("synergy-bundle", { data: parsed, meta }, { etag, periodTag, periodRevision });
    }

    return { data: parsed, meta, fromCache: false };
  } catch (err) {
    console.error("[simulator] slot_item_effects fetch error", {
      url: "/api/master-data/synergy-data",
      error: String(err),
    });
    return { data: cached?.data?.data ?? null, meta: cached?.data?.meta ?? null, fromCache: !!cached?.data };
  }
}

import { atom } from "nanostores";

export const masterDataStatusStore = atom<{
  hasMasterData: boolean;
  hasSynergyData: boolean;
  shipCount: number;
  equipCount: number;
  synergyMetaText: string | null;
  masterPeriodTag: string | null;
  masterPeriodRevision: number | null;
  results: DataLoadResult[];
}>({
  hasMasterData: false,
  hasSynergyData: false,
  shipCount: 0,
  equipCount: 0,
  synergyMetaText: null,
  masterPeriodTag: null,
  masterPeriodRevision: null,
  results: [],
});

export function updateDataStatus() {
  const counts = getMasterDataCounts();
  const shipCount = counts.ships;
  const equipCount = counts.equips;
  const hasSynergyData = !!getSlotItemEffects();
  
  if (shipCount > 0 || equipCount > 0) {
    setHasMasterData(true);
  } else {
    setHasMasterData(false);
  }

  masterDataStatusStore.set({
    hasMasterData: shipCount > 0 || equipCount > 0,
    hasSynergyData,
    shipCount,
    equipCount,
    synergyMetaText: getSlotItemEffectsMetaForStatus(),
    masterPeriodTag: _masterDataPeriodTag,
    masterPeriodRevision: _masterDataPeriodRevision,
    results: _dataLoadResults.map((r) => ({ ...r })),
  });
}

/**
 * Load equipment filtering tables from a JSON object (e.g. API snapshot).
 * Supports both keyed-object format and array format (Avro records now include key fields).
 *
 * Expected keys (all optional):
 *   mst_stypes:              Record<number, MstStypeData> | MstStypeData[]
 *   mst_equip_exslots:       Record<number, { equip: number }> | { equip: number }[]
 *   mst_equip_ships:         Record<number, MstEquipShipData> | MstEquipShipData[]
 *   mst_equip_exslot_ships:  Record<string, MstEquipExslotShipData> | MstEquipExslotShipData[]
 *   mst_equip_limit_exslots: Record<number, MstEquipLimitExslotData> | MstEquipLimitExslotData[]
 */
export function loadEquipFilterFromJson(obj: Record<string, unknown>) {
  for (const { record, key } of filterRecords(obj["mst_stypes"])) {
    const stype = parseMstStype(record, key);
    if (stype) setMasterStype(stype);
  }

  for (const { record } of filterRecords(obj["mst_equip_exslots"])) {
    const equip = finiteNumberOrNull(record["equip"]);
    if (equip !== null) addEquipExslotId(equip);
  }

  for (const { record, key } of filterRecords(obj["mst_equip_ships"])) {
    const equipShip = parseMstEquipShip(record, key);
    if (equipShip) setMasterEquipShip(equipShip);
  }

  for (const { record, key } of filterRecords(obj["mst_equip_exslot_ships"])) {
    const equipExslotShip = parseMstEquipExslotShip(record, key);
    if (equipExslotShip) setMasterEquipExslotShip(equipExslotShip);
  }

  for (const { record, key } of filterRecords(obj["mst_equip_limit_exslots"])) {
    const equipLimitExslot = parseMstEquipLimitExslot(record, key);
    if (equipLimitExslot) setMasterEquipLimitExslot(equipLimitExslot);
  }
}

export function loadMasterDataFromJson(json: unknown, renderAll: () => void) {
  const obj = jsonRecordOf(json);
  if (!obj) return;

  // Track load results for JSON import
  _dataLoadResults = [
    { name: "mst_ship", status: "pending" },
    { name: "mst_slotitem", status: "pending" },
    { name: "mst_slotitem_equiptype", status: "pending" },
    { name: "mst_stype", status: "pending" },
    { name: "mst_equip_exslot", status: "pending" },
    { name: "mst_equip_ship", status: "pending" },
    { name: "mst_equip_exslot_ship", status: "pending" },
    { name: "mst_equip_limit_exslot", status: "pending" },
  ];

  beginBulkLoad();
  try {
    let shipCount = 0;
    for (const { record, key } of filterRecords(obj["mst_ships"])) {
      const ship = parseMstShip(record, key ?? undefined);
      if (ship) {
        setMasterShip(normalizeMstShip(ship));
        shipCount++;
      }
    }
    const shipResult = _dataLoadResults.find((r) => r.name === "mst_ship");
    if (shipResult) {
      shipResult.status = shipCount > 0 ? "success" : "failed";
      shipResult.recordCount = shipCount;
      shipResult.loadedAt = Date.now();
    }

    let equipCount = 0;
    for (const { record, key } of filterRecords(obj["mst_slot_items"])) {
      const item = parseMstSlotItem(record, key ?? undefined);
      if (item) {
        setMasterSlotItem(normalizeMstSlotItem(item));
        equipCount++;
      }
    }
    const equipResult = _dataLoadResults.find((r) => r.name === "mst_slotitem");
    if (equipResult) {
      equipResult.status = equipCount > 0 ? "success" : "failed";
      equipResult.recordCount = equipCount;
      equipResult.loadedAt = Date.now();
    }

    // Optional: equipment type master for category display
    const equipTypeObj = obj["mst_slotitem_equiptypes"] ?? obj["mst_slotitem_equiptype"];
    for (const { record, key } of filterRecords(equipTypeObj)) {
      const equipType = parseMstEquipType(record, key ?? undefined);
      if (equipType) setMasterEquipType(equipType);
    }

    if (obj["ships"] && !obj["mst_ships"]) {
      loadMasterDataFromJson({ mst_ships: obj["ships"] }, renderAll);
    }
    if (obj["equipments"] && !obj["mst_slot_items"]) {
      loadMasterDataFromJson(
        { mst_slot_items: obj["equipments"] },
        renderAll,
      );
    }

    // ── Equipment filtering tables (JSON import preserves keys) ──
    loadEquipFilterFromJson(obj);

  } finally {
    endBulkLoad("all");
  }
  renderAll();
  updateDataStatus();
}

let _weaponIconDataUrl: string | null = null;
let _shipTypeIconDataUrl: string | null = null;
let _masterDataPeriodTag: string | null = null;
let _masterDataPeriodRevision: number | null = null;
let _masterDataTableVersion: string | null = null;

// ── Data load result tracking ──
interface DataLoadResult {
  name: string;
  status: "pending" | "success" | "failed";
  recordCount?: number;
  error?: string;
  loadedAt?: number;
}

let _dataLoadResults: DataLoadResult[] = [];

export function getLoadedMasterDataMeta(): {
  period_tag: string | null;
  period_revision: number | null;
  table_version: string | null;
} {
  return {
    period_tag: _masterDataPeriodTag,
    period_revision: _masterDataPeriodRevision,
    table_version: _masterDataTableVersion,
  };
}

export function getDataLoadResults(): DataLoadResult[] {
  return [..._dataLoadResults];
}

async function fetchJsonSafeWithEtag<T>(
  url: string,
  cacheKey: string,
  label: string,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  cached?: MasterCacheEntry<T> | null,
): Promise<{ data: T | null; isNotModified: boolean; etag: string | null }> {
  try {
    const headers: Record<string, string> = {};
    if (cached?.etag) {
      headers["If-None-Match"] = cached.etag;
    }
    const res = await fetch(url, { headers });
    if (res.status === 304 && cached?.data) {
      console.info(`[simulator] ${label} 304 Not Modified — using cache`);
      return { data: cached.data, isNotModified: true, etag: cached.etag ?? null };
    }
    if (!res.ok) {
      console.warn(`[simulator] ${label} fetch failed`, {
        url,
        status: res.status,
      });
      return { data: cached?.data ?? null, isNotModified: !!cached?.data, etag: cached?.etag ?? null };
    }

    try {
      const etag = res.headers.get("ETag");
      const parsed = schema.safeParse(await res.json());
      if (!parsed.success) {
        console.error(`[simulator] ${label} response validation failed`, {
          url,
          error: parsed.error,
        });
        return { data: cached?.data ?? null, isNotModified: !!cached?.data, etag: cached?.etag ?? null };
      }
      const dataObj = parsed.data as any;
      saveMasterDataCache(cacheKey, parsed.data, {
        etag,
        periodTag: dataObj?.period_tag ?? null,
        periodRevision: dataObj?.period_revision ?? null,
        tableVersion: dataObj?.table_version ?? null,
      });
      return { data: parsed.data, isNotModified: false, etag };
    } catch (err) {
      console.error(`[simulator] ${label} json parse failed`, {
        url,
        error: String(err),
      });
      return { data: cached?.data ?? null, isNotModified: !!cached?.data, etag: cached?.etag ?? null };
    }
  } catch (err) {
    console.error(`[simulator] ${label} fetch error`, {
      url,
      error: String(err),
    });
    return { data: cached?.data ?? null, isNotModified: !!cached?.data, etag: cached?.etag ?? null };
  }
}
export async function loadMasterData(renderAll: () => void) {
  _dataLoadResults = [
    { name: "mst_ship", status: "pending" },
    { name: "mst_slotitem", status: "pending" },
    { name: "ship-banner-map", status: "pending" },
    { name: "ship-card-map", status: "pending" },
    { name: "ship-icon-map", status: "pending" },
    { name: "equip-image-map", status: "pending" },
    { name: "weapon-icon-frames", status: "pending" },
    { name: "ship-type-icon-frames", status: "pending" },
    { name: "mst_slotitem_equiptype", status: "pending" },
    { name: "mst_stype", status: "pending" },
    { name: "mst_equip_exslot", status: "pending" },
    { name: "mst_equip_ship", status: "pending" },
    { name: "mst_equip_exslot_ship", status: "pending" },
    { name: "mst_equip_limit_exslot", status: "pending" },
    { name: "synergy-data", status: "pending" },
  ];

  // 1. Instant hydration from IndexedDB cache (Stale-While-Revalidate)
  const allCache = await loadAllCachedMasterData();
  const cachedShip = allCache.get("mst_ship") as MasterCacheEntry<z.infer<typeof MasterShipResponseSchema>> | undefined;
  const cachedEquip = allCache.get("mst_slotitem") as MasterCacheEntry<z.infer<typeof MasterSlotItemResponseSchema>> | undefined;

  const hasCoreCache = !!(cachedShip?.data?.records?.length && cachedEquip?.data?.records?.length);

  if (hasCoreCache) {
    console.info("[data-loader] Instant load from IndexedDB cache...");
    if (cachedShip?.data?.records) {
      beginBulkLoad();
      try {
        for (const s of cachedShip.data.records) {
          if (s && s.id != null && s.name) setMasterShip(normalizeMstShip(s));
        }
      } finally {
        endBulkLoad("fleet");
      }
      _masterDataPeriodTag = cachedShip.data.period_tag ?? null;
      _masterDataPeriodRevision = cachedShip.data.period_revision ?? null;
      _masterDataTableVersion = cachedShip.data.table_version ?? null;
    }
    if (cachedEquip?.data?.records) {
      beginBulkLoad();
      try {
        for (const e of cachedEquip.data.records) {
          if (e && e.id != null && e.name) setMasterSlotItem(normalizeMstSlotItem(e));
        }
      } finally {
        endBulkLoad("fleet");
      }
    }
    const cachedBanner = allCache.get("ship-banner-map")?.data as any;
    if (cachedBanner?.base_url) setAssetBaseUrl(cachedBanner.base_url);
    if (cachedBanner?.banners) setBannerMap(cachedBanner.banners);

    const cachedCard = allCache.get("ship-card-map")?.data as any;
    if (cachedCard?.cards) setCardMap(cachedCard.cards);

    const cachedIcon = allCache.get("ship-icon-map")?.data as any;
    if (cachedIcon?.icons) setShipIconMap(cachedIcon.icons);

    const cachedEquipImg = allCache.get("equip-image-map")?.data as any;
    if (cachedEquipImg?.card) setEquipCardMap(cachedEquipImg.card);
    if (cachedEquipImg?.item_on) setEquipItemOnMap(cachedEquipImg.item_on);
    if (cachedEquipImg?.item_up) setEquipItemUpMap(cachedEquipImg.item_up);

    const cachedWeaponFrames = allCache.get("weapon-icon-frames")?.data as any;
    if (cachedWeaponFrames?.frames) {
      resetWeaponIconFrames();
      for (const [name, entry] of Object.entries(cachedWeaponFrames.frames as Record<string, any>)) {
        const m = name.match(/_id_(\d+)$/);
        const idText = m?.[1];
        if (idText === undefined) continue;
        const { x, y, w, h } = entry.frame;
        setWeaponIconFrame(parseInt(idText, 10), [x, y, w, h]);
      }
      if (cachedWeaponFrames.meta?.size) {
        setSpriteSheetMeta(cachedWeaponFrames.meta.size.w ?? 0, cachedWeaponFrames.meta.size.h ?? 0);
      }
    }

    const cachedWeaponPng = allCache.get("weapon-icon-data-url")?.data as string | undefined;
    if (cachedWeaponPng) {
      _weaponIconDataUrl = cachedWeaponPng;
      setSpriteSheetUrl(cachedWeaponPng);
    }

    const cachedShipTypeFrames = allCache.get("ship-type-icon-frames")?.data as any;
    if (cachedShipTypeFrames?.frames) {
      resetShipTypeIconFrames();
      const portShipFrameByIndex = new Map<number, [number, number, number, number]>();
      for (const [name, entry] of Object.entries(cachedShipTypeFrames.frames as Record<string, any>)) {
        const portMatch = name.match(/^port_ships_(\d+)$/);
        const idx = portMatch?.[1] !== undefined ? Number.parseInt(portMatch[1], 10) : NaN;
        if (Number.isFinite(idx) && idx >= 0) {
          portShipFrameByIndex.set(idx, [entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h]);
        }
      }
      const stypeToPortShipsFrameIndex: Record<number, number> = {
        1: 14, 2: 0, 3: 11, 4: 16, 5: 15, 6: 17, 7: 20, 8: 18, 9: 18, 10: 19,
        11: 21, 12: 18, 13: 1, 14: 2, 15: 9, 16: 3, 17: 7, 18: 5, 19: 6, 20: 4, 21: 8, 22: 9,
      };
      if (portShipFrameByIndex.size > 0) {
        for (const [stypeRaw, frameIdx] of Object.entries(stypeToPortShipsFrameIndex)) {
          const stype = Number.parseInt(stypeRaw, 10);
          const frame = portShipFrameByIndex.get(frameIdx);
          if (frame && Number.isFinite(stype) && stype > 0) setShipTypeIconFrame(stype, frame);
        }
      }
      for (const [name, entry] of Object.entries(cachedShipTypeFrames.frames as Record<string, any>)) {
        if (/^port_ships_\d+$/.test(name)) continue;
        const genericMatch = name.match(/_([0-9]+)$/);
        const stype = genericMatch?.[1] !== undefined ? Number.parseInt(genericMatch[1], 10) : NaN;
        if (!Number.isFinite(stype) || stype <= 0) continue;
        if (portShipFrameByIndex.size > 0 && stypeToPortShipsFrameIndex[stype]) continue;
        setShipTypeIconFrame(stype, [entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h]);
      }
      if (cachedShipTypeFrames.meta?.size) {
        setShipTypeSpriteSheetMeta(cachedShipTypeFrames.meta.size.w ?? 0, cachedShipTypeFrames.meta.size.h ?? 0);
      }
    }

    const cachedShipTypePng = allCache.get("ship-type-icon-data-url")?.data as string | undefined;
    if (cachedShipTypePng) {
      _shipTypeIconDataUrl = cachedShipTypePng;
      setShipTypeSpriteSheetUrl(cachedShipTypePng);
    }

    const cachedEquipType = allCache.get("mst_slotitem_equiptype")?.data as any;
    if (cachedEquipType?.records) {
      for (const t of cachedEquipType.records) {
        if (t && t.id != null && t.name) setMasterEquipType(t);
      }
    }

    const cachedStype = allCache.get("mst_stype")?.data as any;
    if (cachedStype?.records) {
      for (const s of cachedStype.records) {
        if (s && s.id != null) setMasterStype(s);
      }
    }

    const cachedExslot = allCache.get("mst_equip_exslot")?.data as any;
    if (cachedExslot?.records) {
      for (const e of cachedExslot.records) {
        if (e && e.equip != null) addEquipExslotId(e.equip);
      }
    }

    const cachedEquipShip = allCache.get("mst_equip_ship")?.data as any;
    if (cachedEquipShip?.records) {
      for (const r of cachedEquipShip.records) {
        if (r && r.ship_id != null && r.equip_type) setMasterEquipShip(r);
      }
    }

    const cachedExslotShip = allCache.get("mst_equip_exslot_ship")?.data as any;
    if (cachedExslotShip?.records) {
      for (const r of cachedExslotShip.records) {
        if (r && r.slotitem_id != null) setMasterEquipExslotShip(r);
      }
    }

    const cachedLimitExslot = allCache.get("mst_equip_limit_exslot")?.data as any;
    if (cachedLimitExslot?.records) {
      for (const r of cachedLimitExslot.records) {
        if (r && r.ship_id != null && r.equip) setMasterEquipLimitExslot(r);
      }
    }

    const cachedSynergy = allCache.get("synergy-bundle")?.data as { data: SlotItemEffectsData; meta: SlotItemEffectsMeta | null } | undefined;
    if (cachedSynergy?.data) {
      setSlotItemEffects(cachedSynergy.data);
      if (cachedSynergy.meta) setSlotItemEffectsMeta(cachedSynergy.meta);
    }

    const cachedSpeedUpgrade = allCache.get("soku-speed-upgrade")?.data as any;
    if (cachedSpeedUpgrade?.ok && cachedSpeedUpgrade?.data) {
      setSokuSpeedData(cachedSpeedUpgrade.data);
    }

    for (const item of _dataLoadResults) {
      const c = allCache.get(item.name);
      if (c?.data) {
        item.status = "success";
        const records = (c.data as any)?.records;
        if (Array.isArray(records)) item.recordCount = records.length;
      }
    }

    updateDataStatus();
    renderAll();
  } else {
    updateDataStatus();
  }

  const updateLoadResult = (name: string, data: unknown) => {
    const result = _dataLoadResults.find((r) => r.name === name);
    if (result) {
      const records =
        data !== null && typeof data === "object" && "records" in data
          ? (data as any).records
          : undefined;
      if (Array.isArray(records)) {
        result.status = "success";
        result.recordCount = records.length;
      } else if (data) {
        result.status = "success";
      } else {
        result.status = "failed";
      }
      result.loadedAt = Date.now();
      updateDataStatus();
    }
  };

  // 2. Background Revalidation with ETag
  const shipTask = (async () => {
    const cached = allCache.get("mst_ship") as MasterCacheEntry<z.infer<typeof MasterShipResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_ship",
      "mst_ship",
      "mst_ship",
      MasterShipResponseSchema,
      cached,
    );
    const shipData = res.data;
    updateLoadResult("mst_ship", shipData);
    if (!res.isNotModified && shipData?.records) {
      beginBulkLoad();
      try {
        for (const s of shipData.records) {
          if (s && s.id != null && s.name) setMasterShip(normalizeMstShip(s));
        }
      } finally {
        endBulkLoad("fleet");
      }
      _masterDataPeriodTag = shipData.period_tag ?? null;
      _masterDataPeriodRevision = shipData.period_revision ?? null;
      _masterDataTableVersion = shipData.table_version ?? null;
      updateDataStatus();
      renderAll();
    }
    return shipData;
  })();

  const equipTask = (async () => {
    const cached = allCache.get("mst_slotitem") as MasterCacheEntry<z.infer<typeof MasterSlotItemResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_slotitem",
      "mst_slotitem",
      "mst_slotitem",
      MasterSlotItemResponseSchema,
      cached,
    );
    const equipData = res.data;
    updateLoadResult("mst_slotitem", equipData);
    if (!res.isNotModified && equipData?.records) {
      beginBulkLoad();
      try {
        for (const e of equipData.records) {
          if (e && e.id != null && e.name) setMasterSlotItem(normalizeMstSlotItem(e));
        }
      } finally {
        endBulkLoad("fleet");
      }
      updateDataStatus();
      renderAll();
    }
    return equipData;
  })();

  const bannerMapTask = (async () => {
    const cached = allCache.get("ship-banner-map") as MasterCacheEntry<z.infer<typeof AssetMapResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/asset-sync/ship-banner-map",
      "ship-banner-map",
      "ship-banner-map",
      AssetMapResponseSchema,
      cached,
    );
    const bannerMapData = res.data;
    updateLoadResult("ship-banner-map", bannerMapData);
    if (!res.isNotModified) {
      if (bannerMapData?.base_url) setAssetBaseUrl(bannerMapData.base_url);
      if (bannerMapData?.banners) setBannerMap(bannerMapData.banners);
      renderAll();
    }
  })();

  const cardMapTask = (async () => {
    const cached = allCache.get("ship-card-map") as MasterCacheEntry<z.infer<typeof CardMapResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/asset-sync/ship-card-map",
      "ship-card-map",
      "ship-card-map",
      CardMapResponseSchema,
      cached,
    );
    const cardMapData = res.data;
    updateLoadResult("ship-card-map", cardMapData);
    if (!res.isNotModified) {
      if (cardMapData?.base_url && !getAssetBaseUrl()) setAssetBaseUrl(cardMapData.base_url);
      if (cardMapData?.cards) setCardMap(cardMapData.cards);
      renderAll();
    }
  })();

  const shipIconMapTask = (async () => {
    const cached = allCache.get("ship-icon-map") as MasterCacheEntry<z.infer<typeof ShipIconMapResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/asset-sync/ship-icon-map",
      "ship-icon-map",
      "ship-icon-map",
      ShipIconMapResponseSchema,
      cached,
    );
    const shipIconMapData = res.data;
    updateLoadResult("ship-icon-map", shipIconMapData);
    if (!res.isNotModified) {
      if (shipIconMapData?.base_url && !getAssetBaseUrl()) setAssetBaseUrl(shipIconMapData.base_url);
      if (shipIconMapData?.icons) setShipIconMap(shipIconMapData.icons);
      renderAll();
    }
  })();

  const equipImageMapTask = (async () => {
    const cached = allCache.get("equip-image-map") as MasterCacheEntry<z.infer<typeof EquipImageMapResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/asset-sync/equip-image-map",
      "equip-image-map",
      "equip-image-map",
      EquipImageMapResponseSchema,
      cached,
    );
    const equipImageData = res.data;
    updateLoadResult("equip-image-map", equipImageData);
    if (!res.isNotModified) {
      if (equipImageData?.base_url && !getAssetBaseUrl()) setAssetBaseUrl(equipImageData.base_url);
      if (equipImageData?.card) setEquipCardMap(equipImageData.card);
      if (equipImageData?.item_on) setEquipItemOnMap(equipImageData.item_on);
      if (equipImageData?.item_up) setEquipItemUpMap(equipImageData.item_up);
      renderAll();
    }
  })();

  const weaponIconTask = (async () => {
    const cached = allCache.get("weapon-icon-frames") as MasterCacheEntry<z.infer<typeof IconFramesResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/asset-sync/weapon-icon-frames?v=2",
      "weapon-icon-frames",
      "weapon-icon-frames",
      IconFramesResponseSchema,
      cached,
    );
    const iconFrameData = res.data;
    updateLoadResult("weapon-icon-frames", iconFrameData);
    if (!res.isNotModified && iconFrameData?.frames) {
      resetWeaponIconFrames();
      for (const [name, entry] of Object.entries(iconFrameData.frames)) {
        const m = name.match(/_id_(\d+)$/);
        const idText = m?.[1];
        if (idText === undefined) continue;
        const { x, y, w, h } = entry.frame;
        setWeaponIconFrame(parseInt(idText, 10), [x, y, w, h]);
      }
      if (iconFrameData.meta?.size) {
        setSpriteSheetMeta(iconFrameData.meta.size.w ?? 0, iconFrameData.meta.size.h ?? 0);
      }
    }
    if (iconFrameData) {
      const pngKey = "assets/kcs2/img/common/common_icon_weapon.png";
      if (_weaponIconDataUrl) {
        setSpriteSheetUrl(_weaponIconDataUrl);
      } else {
        try {
          const pngRes = await fetch("/api/asset-sync/weapon-icons");
          if (pngRes.ok) {
            const pngBlob = await pngRes.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(pngBlob);
            });
            _weaponIconDataUrl = dataUrl;
            setSpriteSheetUrl(dataUrl);
            saveMasterDataCache("weapon-icon-data-url", dataUrl);
          } else {
            const assetBaseUrl = getAssetBaseUrl();
            setSpriteSheetUrl(assetBaseUrl ? assetBaseUrl + "/" + pngKey : "/api/asset-sync/weapon-icons");
          }
        } catch {
          const assetBaseUrl = getAssetBaseUrl();
          setSpriteSheetUrl(assetBaseUrl ? assetBaseUrl + "/" + pngKey : "/api/asset-sync/weapon-icons");
        }
      }
    }
    renderAll();
  })();

  const shipTypeIconTask = (async () => {
    const cached = allCache.get("ship-type-icon-frames") as MasterCacheEntry<z.infer<typeof IconFramesResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/asset-sync/ship-type-icon-frames?v=1",
      "ship-type-icon-frames",
      "ship-type-icon-frames",
      IconFramesResponseSchema,
      cached,
    );
    const shipTypeIconFrameData = res.data;
    updateLoadResult("ship-type-icon-frames", shipTypeIconFrameData);
    if (!res.isNotModified && shipTypeIconFrameData?.frames) {
      resetShipTypeIconFrames();
      const portShipFrameByIndex = new Map<number, [number, number, number, number]>();
      for (const [name, entry] of Object.entries(shipTypeIconFrameData.frames)) {
        const portMatch = name.match(/^port_ships_(\d+)$/);
        const idx = portMatch?.[1] !== undefined ? Number.parseInt(portMatch[1], 10) : NaN;
        if (Number.isFinite(idx) && idx >= 0) {
          portShipFrameByIndex.set(idx, [entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h]);
        }
      }
      const stypeToPortShipsFrameIndex: Record<number, number> = {
        1: 14, 2: 0, 3: 11, 4: 16, 5: 15, 6: 17, 7: 20, 8: 18, 9: 18, 10: 19,
        11: 21, 12: 18, 13: 1, 14: 2, 15: 9, 16: 3, 17: 7, 18: 5, 19: 6, 20: 4, 21: 8, 22: 9,
      };
      if (portShipFrameByIndex.size > 0) {
        for (const [stypeRaw, frameIdx] of Object.entries(stypeToPortShipsFrameIndex)) {
          const stype = Number.parseInt(stypeRaw, 10);
          const frame = portShipFrameByIndex.get(frameIdx);
          if (frame && Number.isFinite(stype) && stype > 0) setShipTypeIconFrame(stype, frame);
        }
      }
      for (const [name, entry] of Object.entries(shipTypeIconFrameData.frames)) {
        if (/^port_ships_\d+$/.test(name)) continue;
        const genericMatch = name.match(/_([0-9]+)$/);
        const stype = genericMatch?.[1] !== undefined ? Number.parseInt(genericMatch[1], 10) : NaN;
        if (!Number.isFinite(stype) || stype <= 0) continue;
        if (portShipFrameByIndex.size > 0 && stypeToPortShipsFrameIndex[stype]) continue;
        setShipTypeIconFrame(stype, [entry.frame.x, entry.frame.y, entry.frame.w, entry.frame.h]);
      }
      if (shipTypeIconFrameData.meta?.size) {
        setShipTypeSpriteSheetMeta(shipTypeIconFrameData.meta.size.w ?? 0, shipTypeIconFrameData.meta.size.h ?? 0);
      }
    }
    if (shipTypeIconFrameData) {
      const pngKey = "assets/kcs2/img/port/port_ships.png";
      if (_shipTypeIconDataUrl) {
        setShipTypeSpriteSheetUrl(_shipTypeIconDataUrl);
      } else {
        try {
          const pngRes = await fetch("/api/asset-sync/ship-type-icons");
          if (pngRes.ok) {
            const pngBlob = await pngRes.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(pngBlob);
            });
            _shipTypeIconDataUrl = dataUrl;
            setShipTypeSpriteSheetUrl(dataUrl);
            saveMasterDataCache("ship-type-icon-data-url", dataUrl);
          } else {
            const assetBaseUrl = getAssetBaseUrl();
            setShipTypeSpriteSheetUrl(assetBaseUrl ? assetBaseUrl + "/" + pngKey : "/api/asset-sync/ship-type-icons");
          }
        } catch {
          const assetBaseUrl = getAssetBaseUrl();
          setShipTypeSpriteSheetUrl(assetBaseUrl ? assetBaseUrl + "/" + pngKey : "/api/asset-sync/ship-type-icons");
        }
      }
    }
    renderAll();
  })();

  const equipTypeTask = (async () => {
    const cached = allCache.get("mst_slotitem_equiptype") as MasterCacheEntry<z.infer<typeof MasterSlotItemEquipTypeResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_slotitem_equiptype",
      "mst_slotitem_equiptype",
      "mst_slotitem_equiptype",
      MasterSlotItemEquipTypeResponseSchema,
      cached,
    );
    const equipTypeData = res.data;
    updateLoadResult("mst_slotitem_equiptype", equipTypeData);
    if (!res.isNotModified && equipTypeData?.records) {
      for (const t of equipTypeData.records) {
        if (t && t.id != null && t.name) setMasterEquipType(t);
      }
      renderAll();
    }
  })();

  const stypeTask = (async () => {
    const cached = allCache.get("mst_stype") as MasterCacheEntry<z.infer<typeof MasterStypeResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_stype",
      "mst_stype",
      "mst_stype",
      MasterStypeResponseSchema,
      cached,
    );
    const stypeData = res.data;
    updateLoadResult("mst_stype", stypeData);
    if (!res.isNotModified && stypeData?.records) {
      for (const s of stypeData.records) {
        if (s && s.id != null) setMasterStype(s);
      }
      renderAll();
    }
  })();

  const equipExslotTask = (async () => {
    const cached = allCache.get("mst_equip_exslot") as MasterCacheEntry<z.infer<typeof MasterEquipExslotResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_equip_exslot",
      "mst_equip_exslot",
      "mst_equip_exslot",
      MasterEquipExslotResponseSchema,
      cached,
    );
    const equipExslotData = res.data;
    updateLoadResult("mst_equip_exslot", equipExslotData);
    if (!res.isNotModified && equipExslotData?.records) {
      for (const e of equipExslotData.records) {
        if (e && e.equip != null) addEquipExslotId(e.equip);
      }
      renderAll();
    }
  })();

  const equipShipTask = (async () => {
    const cached = allCache.get("mst_equip_ship") as MasterCacheEntry<z.infer<typeof MasterEquipShipResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_equip_ship",
      "mst_equip_ship",
      "mst_equip_ship",
      MasterEquipShipResponseSchema,
      cached,
    );
    const equipShipData = res.data;
    updateLoadResult("mst_equip_ship", equipShipData);
    if (!res.isNotModified && equipShipData?.records) {
      for (const r of equipShipData.records) {
        if (r && r.ship_id != null && r.equip_type) setMasterEquipShip(r);
      }
      renderAll();
    }
  })();

  const equipExslotShipTask = (async () => {
    const cached = allCache.get("mst_equip_exslot_ship") as MasterCacheEntry<z.infer<typeof MasterEquipExslotShipResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_equip_exslot_ship",
      "mst_equip_exslot_ship",
      "mst_equip_exslot_ship",
      MasterEquipExslotShipResponseSchema,
      cached,
    );
    const equipExslotShipData = res.data;
    updateLoadResult("mst_equip_exslot_ship", equipExslotShipData);
    if (!res.isNotModified && equipExslotShipData?.records) {
      for (const r of equipExslotShipData.records) {
        if (r && r.slotitem_id != null) setMasterEquipExslotShip(r);
      }
      renderAll();
    }
  })();

  const equipLimitExslotTask = (async () => {
    const cached = allCache.get("mst_equip_limit_exslot") as MasterCacheEntry<z.infer<typeof MasterEquipLimitExslotResponseSchema>> | undefined;
    const res = await fetchJsonSafeWithEtag(
      "/api/master-data/json?table_name=mst_equip_limit_exslot",
      "mst_equip_limit_exslot",
      "mst_equip_limit_exslot",
      MasterEquipLimitExslotResponseSchema,
      cached,
    );
    const equipLimitExslotData = res.data;
    updateLoadResult("mst_equip_limit_exslot", equipLimitExslotData);
    if (!res.isNotModified && equipLimitExslotData?.records) {
      for (const r of equipLimitExslotData.records) {
        if (r && r.ship_id != null && r.equip) setMasterEquipLimitExslot(r);
      }
      renderAll();
    }
  })();

  const synergyTask = (async () => {
    const cached = allCache.get("synergy-bundle") as MasterCacheEntry<{ data: SlotItemEffectsData; meta: SlotItemEffectsMeta | null }> | undefined;
    const synergyBundle = await fetchSynergyDataWithMeta(cached);
    updateLoadResult("synergy-data", synergyBundle.data);
    if (!synergyBundle.fromCache || !cached?.data) {
      setSlotItemEffects(
        synergyBundle.data && (synergyBundle.data.effect_rules ?? synergyBundle.data.effects)
          ? synergyBundle.data
          : null,
      );
      setSlotItemEffectsMeta(synergyBundle.meta);
    }

    const shipData = await shipTask;
    const speedUpgradeUrl = new URL(
      "/api/soku-speed-observed/speed-upgrade",
      window.location.origin,
    );
    if (shipData?.period_tag && shipData?.table_version) {
      speedUpgradeUrl.searchParams.set("period_tag", shipData.period_tag);
      speedUpgradeUrl.searchParams.set("table_version", shipData.table_version);
    }
    const cachedSpeed = allCache.get("soku-speed-upgrade") as MasterCacheEntry<z.infer<typeof SokuSpeedResponseSchema>> | undefined;
    const speedRes = await fetchJsonSafeWithEtag(
      speedUpgradeUrl.toString(),
      "soku-speed-upgrade",
      "soku-speed-upgrade",
      SokuSpeedResponseSchema,
      cachedSpeed,
    );
    const speedUpgradeData = speedRes.data;
    if (!speedRes.isNotModified) {
      setSokuSpeedData(
        speedUpgradeData?.ok && speedUpgradeData.data
          ? speedUpgradeData.data
          : null,
      );
      updateDataStatus();
      renderAll();
    }
  })();

  // Wait for all progressive tasks to settle
  await Promise.allSettled([
    shipTask,
    equipTask,
    bannerMapTask,
    cardMapTask,
    shipIconMapTask,
    equipImageMapTask,
    weaponIconTask,
    shipTypeIconTask,
    equipTypeTask,
    stypeTask,
    equipExslotTask,
    equipShipTask,
    equipExslotShipTask,
    equipLimitExslotTask,
    synergyTask,
  ]);

  console.info("[simulator] master data load summary", getMasterDataCounts());
  renderAll();
  updateDataStatus();
}