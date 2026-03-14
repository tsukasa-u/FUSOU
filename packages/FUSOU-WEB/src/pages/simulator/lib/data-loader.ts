// ── Data loader: master data import, normalization, asset loading ──

import { state } from "./state";
import type {
  MstShipData,
  MstSlotItemData,
  MstSlotItemEquipTypeData,
  SlotItemEffectsData,
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

export function updateDataStatus() {
  const statusEl = document.getElementById("data-status");
  const textEl = document.getElementById("data-status-text");
  const shipCount = Object.keys(state.mstShips).length;
  const equipCount = Object.keys(state.mstSlotItems).length;

  if (!statusEl || !textEl) {
    // Some render paths may load data before the status elements are mounted.
    state.hasMasterData = shipCount > 0 || equipCount > 0;
    return;
  }

  if (shipCount > 0 && equipCount > 0) {
    state.hasMasterData = true;
    statusEl.className = "alert alert-success mb-5 py-2";
    textEl.textContent = `マスターデータ読込済み — 艦娘 ${shipCount}件 / 装備 ${equipCount}件`;
  } else if (shipCount > 0 || equipCount > 0) {
    state.hasMasterData = true;
    statusEl.className = "alert alert-warning mb-5 py-2";
    textEl.textContent = `一部マスターデータ読込済み — 艦娘 ${shipCount}件 / 装備 ${equipCount}件`;
  } else {
    state.hasMasterData = false;
    statusEl.className = "alert alert-warning mb-5 py-2";
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
          state.mstStypes[(v as MstStypeData).id] = v as MstStypeData;
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_stypes as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "id" in v) {
          state.mstStypes[Number(k)] = v as MstStypeData;
        }
      }
    }
  }

  // mst_equip_exslots
  if (obj.mst_equip_exslots && typeof obj.mst_equip_exslots === "object") {
    if (Array.isArray(obj.mst_equip_exslots)) {
      for (const v of obj.mst_equip_exslots) {
        if (v && typeof v === "object" && "equip" in v) {
          state.equipExslotSet.add((v as MstEquipExslotData).equip);
        }
      }
    } else {
      for (const v of Object.values(
        obj.mst_equip_exslots as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip" in v) {
          state.equipExslotSet.add((v as MstEquipExslotData).equip);
        }
      }
    }
  }

  // mst_equip_ships — supports both keyed object and array (with ship_id field)
  if (obj.mst_equip_ships && typeof obj.mst_equip_ships === "object") {
    if (Array.isArray(obj.mst_equip_ships)) {
      for (const v of obj.mst_equip_ships) {
        if (v && typeof v === "object" && "ship_id" in v && "equip_type" in v) {
          state.mstEquipShip[(v as MstEquipShipData).ship_id] =
            v as MstEquipShipData;
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip_type" in v) {
          state.mstEquipShip[Number(k)] = v as MstEquipShipData;
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
          state.mstEquipExslotShip[(v as MstEquipExslotShipData).slotitem_id] =
            v as MstEquipExslotShipData;
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_exslot_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "req_level" in v) {
          state.mstEquipExslotShip[Number(k)] = v as MstEquipExslotShipData;
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
          state.mstEquipLimitExslot[(v as MstEquipLimitExslotData).ship_id] =
            v as MstEquipLimitExslotData;
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_equip_limit_exslots as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "equip" in v) {
          state.mstEquipLimitExslot[Number(k)] = v as MstEquipLimitExslotData;
        }
      }
    }
  }
}

export function loadMasterDataFromJson(json: unknown, renderAll: () => void) {
  if (typeof json !== "object" || json === null) return;
  const obj = json as Record<string, unknown>;

  if (obj.mst_ships && typeof obj.mst_ships === "object") {
    if (Array.isArray(obj.mst_ships)) {
      for (const v of obj.mst_ships) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          state.mstShips[(v as MstShipData).id] = v as MstShipData;
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_ships as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          state.mstShips[Number(k)] = v as MstShipData;
        }
      }
    }
  }

  if (obj.mst_slot_items && typeof obj.mst_slot_items === "object") {
    if (Array.isArray(obj.mst_slot_items)) {
      for (const v of obj.mst_slot_items) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          const item = normalizeMstSlotItem(v as MstSlotItemData);
          state.mstSlotItems[item.id] = item;
        }
      }
    } else {
      for (const [k, v] of Object.entries(
        obj.mst_slot_items as Record<string, unknown>,
      )) {
        if (v && typeof v === "object" && "id" in v && "name" in v) {
          state.mstSlotItems[Number(k)] = normalizeMstSlotItem(
            v as MstSlotItemData,
          );
        }
      }
    }
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
          state.mstSlotItemEquipTypes[rec.id] = rec;
        }
      }
    } else {
      for (const [k, v] of Object.entries(equipTypeObj as Record<string, unknown>)) {
        if (v && typeof v === "object" && "name" in v) {
          const rec = v as MstSlotItemEquipTypeData;
          state.mstSlotItemEquipTypes[Number(k)] = { ...rec, id: Number(k) };
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
  renderAll();
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
  const [
    shipData,
    equipData,
    bannerMapData,
    cardMapData,
    equipImageData,
    iconFrameData,
    synergyData,
    equipTypeData,
    stypeData,
    equipExslotData,
    equipShipData,
    equipExslotShipData,
    equipLimitExslotData,
  ] = await Promise.all([
    fetchJsonSafe<{ records: MstShipData[] }>(
      "/api/master-data/json?table_name=mst_ship",
      "mst_ship",
    ),
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
      card: Record<string, string>;
      item_up: Record<string, string>;
    }>("/api/asset-sync/equip-image-map", "equip-image-map"),
    fetchJsonSafe<{
      frames: Record<
        string,
        { frame: { x: number; y: number; w: number; h: number } }
      >;
      meta?: { size?: { w: number; h: number } };
    }>("/api/asset-sync/weapon-icon-frames", "weapon-icon-frames"),
    fetchJsonSafe<SlotItemEffectsData>(
      "/data/slot_item_effects.json",
      "slot_item_effects",
    ),
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

  if (shipData?.records) {
    for (const s of shipData.records) {
      if (s && s.id != null && s.name) state.mstShips[s.id] = s;
    }
  }

  if (equipData?.records) {
    for (const e of equipData.records) {
      if (e && e.id != null && e.name)
        state.mstSlotItems[e.id] = normalizeMstSlotItem(e);
    }
  }

  if (bannerMapData?.base_url) state.assetBaseUrl = bannerMapData.base_url;
  if (bannerMapData?.banners) state.bannerMap = bannerMapData.banners;

  if (cardMapData?.base_url && !state.assetBaseUrl)
    state.assetBaseUrl = cardMapData.base_url;
  if (cardMapData?.cards) state.cardMap = cardMapData.cards;

  if (equipImageData?.base_url && !state.assetBaseUrl)
    state.assetBaseUrl = equipImageData.base_url;
  if (equipImageData?.card) state.equipCardMap = equipImageData.card;
  if (equipImageData?.item_up) state.equipItemUpMap = equipImageData.item_up;

  if (iconFrameData?.frames) {
    state.weaponIconFrames = {};
    for (const [name, entry] of Object.entries(iconFrameData.frames)) {
      const m = name.match(/_id_(\d+)$/);
      if (!m) continue;
      const { x, y, w, h } = entry.frame;
      state.weaponIconFrames[parseInt(m[1], 10)] = [x, y, w, h];
    }
  }

  if (iconFrameData?.meta?.size) {
    state.spriteSheetW = iconFrameData.meta.size.w ?? 0;
    state.spriteSheetH = iconFrameData.meta.size.h ?? 0;
  }

  if (iconFrameData) {
    const pngKey = "assets/kcs2/img/common/common_icon_weapon.png";
    try {
      const pngRes = await fetch("/api/asset-sync/weapon-icons");
      if (pngRes.ok) {
        const pngBlob = await pngRes.blob();
        state.spriteSheetUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(pngBlob);
        });
      } else {
        state.spriteSheetUrl = state.assetBaseUrl
          ? `${state.assetBaseUrl}/${pngKey}`
          : "/api/asset-sync/weapon-icons";
      }
    } catch {
      state.spriteSheetUrl = state.assetBaseUrl
        ? `${state.assetBaseUrl}/${pngKey}`
        : "/api/asset-sync/weapon-icons";
    }
  }

  if (synergyData?.effects && synergyData.cross_effects) {
    state.slotItemEffects = synergyData;
  }

  if (equipTypeData?.records) {
    for (const t of equipTypeData.records) {
      if (t && t.id != null && t.name) {
        state.mstSlotItemEquipTypes[t.id] = t;
      }
    }
  }

  // ── Equipment filtering tables ──
  if (stypeData?.records) {
    for (const s of stypeData.records) {
      if (s && s.id != null) state.mstStypes[s.id] = s;
    }
  }

  if (equipExslotData?.records) {
    for (const e of equipExslotData.records) {
      if (e && e.equip != null) state.equipExslotSet.add(e.equip);
    }
  }

  if (equipShipData?.records) {
    for (const r of equipShipData.records) {
      if (r && r.ship_id != null && r.equip_type) {
        state.mstEquipShip[r.ship_id] = r;
      }
    }
  }

  if (equipExslotShipData?.records) {
    for (const r of equipExslotShipData.records) {
      if (r && r.slotitem_id != null) {
        state.mstEquipExslotShip[r.slotitem_id] = r;
      }
    }
  }

  if (equipLimitExslotData?.records) {
    for (const r of equipLimitExslotData.records) {
      if (r && r.ship_id != null && r.equip) {
        state.mstEquipLimitExslot[r.ship_id] = r;
      }
    }
  }

  console.info("[simulator] master data load summary", {
    ships: Object.keys(state.mstShips).length,
    equips: Object.keys(state.mstSlotItems).length,
    equipTypes: Object.keys(state.mstSlotItemEquipTypes).length,
    stypes: Object.keys(state.mstStypes).length,
    equipShip: Object.keys(state.mstEquipShip).length,
  });

  updateDataStatus();
  renderAll();
}
