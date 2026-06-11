// ── Data loader: master data import, normalization, asset loading ──

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
import type {
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  SlotItemEffectsData,
  SlotItemEffectsMeta,
  MstStypeData,
  MstEquipExslotData,
  MstEquipShipData,
  MstEquipExslotShipData,
  MstEquipLimitExslotData,
} from "./types";

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
  const out = raw as MstShipData;
  if (out.leng == null) {
    return { ...out, leng: 0 };
  }
  return out;
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

async function fetchSynergyDataWithMeta(): Promise<{
  data: SlotItemEffectsData | null;
  meta: SlotItemEffectsMeta | null;
}> {
  try {
    const res = await fetch("/api/master-data/synergy-data", {
      cache: "no-store",
    });
    if (!res.ok) {
      console.warn("[simulator] slot_item_effects fetch failed", {
        url: "/api/master-data/synergy-data",
        status: res.status,
      });
      return { data: null, meta: null };
    }

    let parsed:
      | (SlotItemEffectsData & {
          _meta?: {
            generator_version?: string;
            table_version?: string;
          };
        })
      | null = null;
    try {
      parsed = (await res.json()) as SlotItemEffectsData;
      if (parsed) {
        parsed = await normalizeCompressedComboRules(parsed);
      }
    } catch (err) {
      console.error("[simulator] slot_item_effects json parse failed", {
        url: "/api/master-data/synergy-data",
        error: String(err),
      });
      return { data: null, meta: null };
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
              source,
              generator_version: parsed?._meta?.generator_version ?? null,
              table_version: parsed?._meta?.table_version ?? null,
            }
          : null;

    return { data: parsed, meta };
  } catch (err) {
    console.error("[simulator] slot_item_effects fetch error", {
      url: "/api/master-data/synergy-data",
      error: String(err),
    });
    return { data: null, meta: null };
  }
}

export function updateDataStatus() {
  const statusEl = document.getElementById("data-status");
  const textEl = document.getElementById("data-status-text");
  const masterMetaEl = document.getElementById("data-status-master-meta");
  const synergyMetaEl = document.getElementById("data-status-synergy-meta");
  const detailsEl = document.getElementById("data-status-details");
  const detailsToggleEl = document.getElementById("data-status-details-toggle");
  const counts = getMasterDataCounts();
  const shipCount = counts.ships;
  const equipCount = counts.equips;
  const synergyMetaText = getSlotItemEffectsMetaForStatus();
  const hasSynergyData = !!getSlotItemEffects();

  if (!statusEl || !textEl) {
    // Some render paths may load data before the status elements are mounted.
    setHasMasterData(shipCount > 0 || equipCount > 0);
    return;
  }

  // Swap the alert color modifier without touching other classes (mb-*, py-*, hidden, …).
  function setAlertType(type: "info" | "success" | "warning") {
    for (const cls of [
      "alert-info",
      "alert-success",
      "alert-warning",
      "alert-error",
    ] as const) {
      statusEl!.classList.remove(cls);
    }
    statusEl!.classList.add(`alert-${type}`);
  }

  // Show only the icon that matches the current state.
  function showIcon(active: "info" | "success" | "warning") {
    for (const t of ["info", "success", "warning"] as const) {
      document
        .getElementById(`data-status-icon-${t}`)
        ?.classList.toggle("hidden", t !== active);
    }
  }

  statusEl.classList.remove("hidden");

  if (masterMetaEl) {
    if (_masterDataPeriodTag && _masterDataPeriodRevision != null) {
      masterMetaEl.classList.remove("hidden");
      masterMetaEl.textContent = `マスターデータ: ${_masterDataPeriodTag} rev${_masterDataPeriodRevision}`;
    } else {
      masterMetaEl.classList.add("hidden");
      masterMetaEl.textContent = "";
    }
  }

  if (synergyMetaEl) {
    if (synergyMetaText) {
      synergyMetaEl.classList.remove("hidden");
      synergyMetaEl.textContent = `装備シナジーデータ: ${synergyMetaText}`;
    } else if (hasSynergyData) {
      synergyMetaEl.classList.remove("hidden");
      synergyMetaEl.textContent = "装備シナジーデータ読込済み";
    } else {
      synergyMetaEl.classList.add("hidden");
      synergyMetaEl.textContent = "";
    }
  }

  // Render detailed load results
  if (detailsEl) {
    const results = getDataLoadResults();
    if (results.length > 0) {
      // Preserve open/closed state across updates
      const wasOpen = !detailsEl.classList.contains("hidden");
      detailsEl.innerHTML = results
        .map((result) => {
          const icon =
            result.status === "success"
              ? '<span class="text-success">✓</span>'
              : result.status === "failed"
                ? '<span class="text-error">✗</span>'
                : '<span class="text-info">⋯</span>';
          // Only show record count when meaningful (> 0)
          const label =
            result.recordCount != null && result.recordCount > 0
              ? `${result.name} (${result.recordCount})`
              : result.name;
          return `<div class="flex items-center gap-1">${icon} <span class="truncate">${label}</span></div>`;
        })
        .join("");
      if (!wasOpen) {
        detailsEl.classList.add("hidden");
      }
    }
  }

  // Toggle button visibility
  if (detailsToggleEl) {
    const hasFailed =
      _dataLoadResults.some((r) => r.status === "failed") ||
      shipCount === 0;
    if (hasFailed) {
      detailsToggleEl.style.display = "inline-block";
    } else {
      detailsToggleEl.style.display = "none";
    }

    // Add toggle handler
    detailsToggleEl.onclick = () => {
      if (detailsEl) {
        detailsEl.classList.toggle("hidden");
      }
    };
  }

  if (shipCount > 0 && equipCount > 0) {
    setHasMasterData(true);
    setAlertType("success");
    showIcon("success");
    textEl.textContent = `マスターデータ読込済み — 艦 ${shipCount}件 / 装備 ${equipCount}件`;
  } else if (shipCount > 0 || equipCount > 0) {
    setHasMasterData(true);
    setAlertType("warning");
    showIcon("warning");
    textEl.textContent = `一部マスターデータ読込済み — 艦 ${shipCount}件 / 装備 ${equipCount}件`;
  } else {
    setHasMasterData(false);
    setAlertType("warning");
    showIcon("warning");
    textEl.textContent = "マスターデータが未読込です";
  }
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
  // mst_stypes
  if (obj.mst_stypes && typeof obj.mst_stypes === "object") {
    if (Array.isArray(obj.mst_stypes)) {
      for (const v of obj.mst_stypes) {
        if (v && typeof v === "object" && "id" in v) {
          setMasterStype(v as MstStypeData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_stypes as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "id" in v) {
          setMasterStype({ ...(v as MstStypeData), id: Number(k) });
        }
      }
    }
  }

  // mst_equip_exslots
  if (obj.mst_equip_exslots && typeof obj.mst_equip_exslots === "object") {
    if (Array.isArray(obj.mst_equip_exslots)) {
      for (const v of obj.mst_equip_exslots) {
        if (v && typeof v === "object" && "equip" in v) {
          addEquipExslotId((v as MstEquipExslotData).equip);
        }
      }
    } else {
      for (const v of Object.values(
        obj.mst_equip_exslots as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip" in v) {
          addEquipExslotId((v as MstEquipExslotData).equip);
        }
      }
    }
  }

  // mst_equip_ships — supports both keyed object and array (with ship_id field)
  if (obj.mst_equip_ships && typeof obj.mst_equip_ships === "object") {
    if (Array.isArray(obj.mst_equip_ships)) {
      for (const v of obj.mst_equip_ships) {
        if (v && typeof v === "object" && "ship_id" in v && "equip_type" in v) {
          setMasterEquipShip(v as MstEquipShipData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip_type" in v) {
          setMasterEquipShip({
            ...(v as MstEquipShipData),
            ship_id: Number(k),
          });
        }
      }
    }
  }

  // mst_equip_exslot_ships — supports both keyed object and array (with slotitem_id field)
  if (
    obj.mst_equip_exslot_ships &&
    typeof obj.mst_equip_exslot_ships === "object"
  ) {
    if (Array.isArray(obj.mst_equip_exslot_ships)) {
      for (const v of obj.mst_equip_exslot_ships) {
        if (v && typeof v === "object" && "slotitem_id" in v) {
          setMasterEquipExslotShip(v as MstEquipExslotShipData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_exslot_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "req_level" in v) {
          setMasterEquipExslotShip({
            ...(v as MstEquipExslotShipData),
            slotitem_id: Number(k),
          });
        }
      }
    }
  }

  // mst_equip_limit_exslots — supports both keyed object and array (with ship_id field)
  if (
    obj.mst_equip_limit_exslots &&
    typeof obj.mst_equip_limit_exslots === "object"
  ) {
    if (Array.isArray(obj.mst_equip_limit_exslots)) {
      for (const v of obj.mst_equip_limit_exslots) {
        if (v && typeof v === "object" && "ship_id" in v && "equip" in v) {
          setMasterEquipLimitExslot(v as MstEquipLimitExslotData);
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_limit_exslots as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip" in v) {
          setMasterEquipLimitExslot({
            ...(v as MstEquipLimitExslotData),
            ship_id: Number(k),
          });
        }
      }
    }
  }
}

export function loadMasterDataFromJson(json: unknown, renderAll: () => void) {
  if (typeof json !== "object" || json === null) return;
  const obj = json as Record<string, unknown>;

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
    if (obj.mst_ships && typeof obj.mst_ships === "object") {
      if (Array.isArray(obj.mst_ships)) {
        for (const v of obj.mst_ships) {
          if (v && typeof v === "object" && "id" in v && "name" in v) {
            setMasterShip(normalizeMstShip(v as MstShipData));
            shipCount++;
          }
        }
      } else {
        for (const [k, v] of Object.entries(
          obj.mst_ships as Record<string, unknown>,
        )) {
          if (v && typeof v === "object" && "id" in v && "name" in v) {
            setMasterShip(
              normalizeMstShip({ ...(v as MstShipData), id: Number(k) }),
            );
            shipCount++;
          }
        }
      }
    }
    const shipResult = _dataLoadResults.find((r) => r.name === "mst_ship");
    if (shipResult) {
      shipResult.status = shipCount > 0 ? "success" : "failed";
      shipResult.recordCount = shipCount;
      shipResult.loadedAt = Date.now();
    }

    let equipCount = 0;
    if (obj.mst_slot_items && typeof obj.mst_slot_items === "object") {
      if (Array.isArray(obj.mst_slot_items)) {
        for (const v of obj.mst_slot_items) {
          if (v && typeof v === "object" && "id" in v && "name" in v) {
            const item = normalizeMstSlotItem(v as MstSlotItemData);
            setMasterSlotItem(item);
            equipCount++;
          }
        }
      } else {
        for (const [k, v] of Object.entries(
          obj.mst_slot_items as Record<string, unknown>,
        )) {
          if (v && typeof v === "object" && "id" in v && "name" in v) {
            setMasterSlotItem({
              ...normalizeMstSlotItem(v as MstSlotItemData),
              id: Number(k),
            });
            equipCount++;
          }
        }
      }
    }
    const equipResult = _dataLoadResults.find((r) => r.name === "mst_slotitem");
    if (equipResult) {
      equipResult.status = equipCount > 0 ? "success" : "failed";
      equipResult.recordCount = equipCount;
      equipResult.loadedAt = Date.now();
    }

    // Optional: equipment type master for category display
    const equipTypeObj =
      (obj.mst_slotitem_equiptypes as unknown) ??
      (obj.mst_slotitem_equiptype as unknown);
    if (equipTypeObj && typeof equipTypeObj === "object") {
      if (Array.isArray(equipTypeObj)) {
        for (const v of equipTypeObj) {
          if (v && typeof v === "object" && "id" in v && "name" in v) {
            const rec = v as MstSlotItemEquipTypeData;
            setMasterEquipType(rec);
          }
        }
      } else {
        for (const [k, v] of Object.entries(
          equipTypeObj as Record<string, unknown>,
        )) {
          if (v && typeof v === "object" && "name" in v) {
            const rec = v as MstSlotItemEquipTypeData;
            setMasterEquipType({ ...rec, id: Number(k) });
          }
        }
      }
    }

    if (obj.ships && !obj.mst_ships) {
      loadMasterDataFromJson({ mst_ships: obj.ships }, renderAll);
    }
    if (obj.equipments && !obj.mst_slot_items) {
      loadMasterDataFromJson({ mst_slot_items: obj.equipments }, renderAll);
    }

    // ── Equipment filtering tables (JSON import preserves keys) ──
    loadEquipFilterFromJson(obj);

    updateDataStatus();
  } finally {
    endBulkLoad("all");
  }
  renderAll();
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

async function fetchJsonSafe<T>(url: string, label: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[simulator] ${label} fetch failed`, {
        url,
        status: res.status,
      });
      return null;
    }

    try {
      return (await res.json()) as T;
    } catch (err) {
      console.error(`[simulator] ${label} json parse failed`, {
        url,
        error: String(err),
      });
      return null;
    }
  } catch (err) {
    console.error(`[simulator] ${label} fetch error`, {
      url,
      error: String(err),
    });
    return null;
  }
}

export async function loadMasterData(renderAll: () => void) {
  // Initialize load result tracking
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

  beginBulkLoad();
  try {
    const [
      synergyBundle,
      shipData,
      equipData,
      bannerMapData,
      cardMapData,
      shipIconMapData,
      equipImageData,
      iconFrameData,
      shipTypeIconFrameData,
      equipTypeData,
      stypeData,
      equipExslotData,
      equipShipData,
      equipExslotShipData,
      equipLimitExslotData,
    ] = await Promise.all([
      fetchSynergyDataWithMeta(),
      fetchJsonSafe<{
        records: MstShipData[];
        period_tag?: string;
        period_revision?: number;
        table_version?: string;
      }>("/api/master-data/json?table_name=mst_ship", "mst_ship"),
      fetchJsonSafe<{ records: MstSlotItemData[] }>(
        "/api/master-data/json?table_name=mst_slotitem",
        "mst_slotitem",
      ),
      fetchJsonSafe<{
        base_url: string;
        banners: Record<string, string>;
      }>("/api/asset-sync/ship-banner-map", "ship-banner-map"),
      fetchJsonSafe<{
        base_url: string;
        cards: Record<string, string>;
      }>("/api/asset-sync/ship-card-map", "ship-card-map"),
      fetchJsonSafe<{
        base_url: string;
        icons: Record<string, string>;
      }>("/api/asset-sync/ship-icon-map", "ship-icon-map"),
      fetchJsonSafe<{
        base_url: string;
        card: Record<string, string>;
        item_on: Record<string, string>;
        item_up: Record<string, string>;
      }>("/api/asset-sync/equip-image-map", "equip-image-map"),
      fetchJsonSafe<{
        frames: Record<
          string,
          { frame: { x: number; y: number; w: number; h: number } }
        >;
        meta?: { size?: { w: number; h: number } };
      }>("/api/asset-sync/weapon-icon-frames?v=2", "weapon-icon-frames"),
      fetchJsonSafe<{
        frames: Record<
          string,
          { frame: { x: number; y: number; w: number; h: number } }
        >;
        meta?: { size?: { w: number; h: number } };
      }>("/api/asset-sync/ship-type-icon-frames?v=1", "ship-type-icon-frames"),
      fetchJsonSafe<{ records: MstSlotItemEquipTypeData[] }>(
        "/api/master-data/json?table_name=mst_slotitem_equiptype",
        "mst_slotitem_equiptype",
      ),
      fetchJsonSafe<{ records: MstStypeData[] }>(
        "/api/master-data/json?table_name=mst_stype",
        "mst_stype",
      ),
      fetchJsonSafe<{ records: MstEquipExslotData[] }>(
        "/api/master-data/json?table_name=mst_equip_exslot",
        "mst_equip_exslot",
      ),
      fetchJsonSafe<{ records: MstEquipShipData[] }>(
        "/api/master-data/json?table_name=mst_equip_ship",
        "mst_equip_ship",
      ),
      fetchJsonSafe<{ records: MstEquipExslotShipData[] }>(
        "/api/master-data/json?table_name=mst_equip_exslot_ship",
        "mst_equip_exslot_ship",
      ),
      fetchJsonSafe<{ records: MstEquipLimitExslotData[] }>(
        "/api/master-data/json?table_name=mst_equip_limit_exslot",
        "mst_equip_limit_exslot",
      ),
    ]);

    // Record load results for each table
    const updateLoadResult = (name: string, data: any) => {
      const result = _dataLoadResults.find((r) => r.name === name);
      if (result) {
        if (data && data.records && Array.isArray(data.records)) {
          result.status = "success";
          result.recordCount = data.records.length;
        } else if (data) {
          result.status = "success";
          // Non-records data (assets, synergy): omit recordCount so display shows name only
        } else {
          result.status = "failed";
        }
        result.loadedAt = Date.now();
      }
    };

    updateLoadResult("mst_ship", shipData);
    updateLoadResult("mst_slotitem", equipData);
    updateLoadResult("ship-banner-map", bannerMapData);
    updateLoadResult("ship-card-map", cardMapData);
    updateLoadResult("ship-icon-map", shipIconMapData);
    updateLoadResult("equip-image-map", equipImageData);
    updateLoadResult("weapon-icon-frames", iconFrameData);
    updateLoadResult("ship-type-icon-frames", shipTypeIconFrameData);
    updateLoadResult("mst_slotitem_equiptype", equipTypeData);
    updateLoadResult("mst_stype", stypeData);
    updateLoadResult("mst_equip_exslot", equipExslotData);
    updateLoadResult("mst_equip_ship", equipShipData);
    updateLoadResult("mst_equip_exslot_ship", equipExslotShipData);
    updateLoadResult("mst_equip_limit_exslot", equipLimitExslotData);
    updateLoadResult("synergy-data", synergyBundle.data);

    if (shipData?.records) {
      for (const s of shipData.records) {
        if (s && s.id != null && s.name) setMasterShip(normalizeMstShip(s));
      }
    }
    _masterDataPeriodTag = shipData?.period_tag ?? null;
    _masterDataPeriodRevision = shipData?.period_revision ?? null;
    _masterDataTableVersion = shipData?.table_version ?? null;

    if (equipData?.records) {
      for (const e of equipData.records) {
        if (e && e.id != null && e.name)
          setMasterSlotItem(normalizeMstSlotItem(e));
      }
    }

    if (bannerMapData?.base_url) setAssetBaseUrl(bannerMapData.base_url);
    if (bannerMapData?.banners) setBannerMap(bannerMapData.banners);

    if (cardMapData?.base_url && !getAssetBaseUrl())
      setAssetBaseUrl(cardMapData.base_url);
    if (cardMapData?.cards) setCardMap(cardMapData.cards);

    if (shipIconMapData?.base_url && !getAssetBaseUrl())
      setAssetBaseUrl(shipIconMapData.base_url);
    if (shipIconMapData?.icons) setShipIconMap(shipIconMapData.icons);

    if (equipImageData?.base_url && !getAssetBaseUrl())
      setAssetBaseUrl(equipImageData.base_url);
    if (equipImageData?.card) setEquipCardMap(equipImageData.card);
    if (equipImageData?.item_on) setEquipItemOnMap(equipImageData.item_on);
    if (equipImageData?.item_up) setEquipItemUpMap(equipImageData.item_up);

    if (iconFrameData?.frames) {
      resetWeaponIconFrames();
      for (const [name, entry] of Object.entries(iconFrameData.frames)) {
        const m = name.match(/_id_(\d+)$/);
        if (!m) continue;
        const { x, y, w, h } = entry.frame;
        setWeaponIconFrame(parseInt(m[1], 10), [x, y, w, h]);
      }
    }

    if (iconFrameData?.meta?.size) {
      setSpriteSheetMeta(
        iconFrameData.meta.size.w ?? 0,
        iconFrameData.meta.size.h ?? 0,
      );
    }

    if (shipTypeIconFrameData?.frames) {
      resetShipTypeIconFrames();
      for (const [name, entry] of Object.entries(
        shipTypeIconFrameData.frames,
      )) {
        const m = name.match(/_([0-9]+)$/);
        if (!m) continue;
        const { x, y, w, h } = entry.frame;
        setShipTypeIconFrame(parseInt(m[1], 10), [x, y, w, h]);
      }
    }

    if (shipTypeIconFrameData?.meta?.size) {
      setShipTypeSpriteSheetMeta(
        shipTypeIconFrameData.meta.size.w ?? 0,
        shipTypeIconFrameData.meta.size.h ?? 0,
      );
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
          } else {
            const assetBaseUrl = getAssetBaseUrl();
            setSpriteSheetUrl(
              assetBaseUrl
                ? `${assetBaseUrl}/${pngKey}`
                : "/api/asset-sync/weapon-icons",
            );
          }
        } catch {
          const assetBaseUrl = getAssetBaseUrl();
          setSpriteSheetUrl(
            assetBaseUrl
              ? `${assetBaseUrl}/${pngKey}`
              : "/api/asset-sync/weapon-icons",
          );
        }
      }
    }

    if (shipTypeIconFrameData) {
      const pngKey = "assets/kcs2/img/organize/organize_ship.png";
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
          } else {
            const assetBaseUrl = getAssetBaseUrl();
            setShipTypeSpriteSheetUrl(
              assetBaseUrl
                ? `${assetBaseUrl}/${pngKey}`
                : "/api/asset-sync/ship-type-icons",
            );
          }
        } catch {
          const assetBaseUrl = getAssetBaseUrl();
          setShipTypeSpriteSheetUrl(
            assetBaseUrl
              ? `${assetBaseUrl}/${pngKey}`
              : "/api/asset-sync/ship-type-icons",
          );
        }
      }
    }

    setSlotItemEffects(
      synergyBundle.data &&
        (synergyBundle.data.effect_rules ?? synergyBundle.data.effects)
        ? synergyBundle.data
        : null,
    );
    setSlotItemEffectsMeta(synergyBundle.meta);

    const speedUpgradeUrl = new URL(
      "/api/soku-speed-observed/speed-upgrade",
      window.location.origin,
    );
    if (shipData?.period_tag && shipData?.table_version) {
      speedUpgradeUrl.searchParams.set("period_tag", shipData.period_tag);
      speedUpgradeUrl.searchParams.set("table_version", shipData.table_version);
    }
    const speedUpgradeData = await fetchJsonSafe<{
      ok: boolean;
      data: import("./types").SokuSpeedData;
    }>(speedUpgradeUrl.toString(), "soku-speed-upgrade");
    setSokuSpeedData(
      speedUpgradeData?.ok && speedUpgradeData.data
        ? speedUpgradeData.data
        : null,
    );

    if (equipTypeData?.records) {
      for (const t of equipTypeData.records) {
        if (t && t.id != null && t.name) {
          setMasterEquipType(t);
        }
      }
    }

    // ── Equipment filtering tables ──
    if (stypeData?.records) {
      for (const s of stypeData.records) {
        if (s && s.id != null) setMasterStype(s);
      }
    }

    if (equipExslotData?.records) {
      for (const e of equipExslotData.records) {
        if (e && e.equip != null) addEquipExslotId(e.equip);
      }
    }

    if (equipShipData?.records) {
      for (const r of equipShipData.records) {
        if (r && r.ship_id != null && r.equip_type) {
          setMasterEquipShip(r);
        }
      }
    }

    if (equipExslotShipData?.records) {
      for (const r of equipExslotShipData.records) {
        if (r && r.slotitem_id != null) {
          setMasterEquipExslotShip(r);
        }
      }
    }

    if (equipLimitExslotData?.records) {
      for (const r of equipLimitExslotData.records) {
        if (r && r.ship_id != null && r.equip) {
          setMasterEquipLimitExslot(r);
        }
      }
    }

    console.info("[simulator] master data load summary", getMasterDataCounts());

    updateDataStatus();
  } finally {
    endBulkLoad("all");
  }
  renderAll();
}
