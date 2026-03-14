// ── Data loader: master data import, normalization, asset loading ──

import { state } from "./state";
import type {
  MstShipData,
  MstSlotItemData,
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
  const statusEl = document.getElementById("data-status")!;
  const textEl = document.getElementById("data-status-text")!;
  const shipCount = Object.keys(state.mstShips).length;
  const equipCount = Object.keys(state.mstSlotItems).length;

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

export async function loadMasterData(renderAll: () => void) {
  try {
    const [
      shipRes,
      equipRes,
      bannerRes,
      cardRes,
      equipImgRes,
      iconFrameRes,
      synergyRes,
      stypeRes,
      equipExslotRes,
      equipShipRes,
      equipExslotShipRes,
      equipLimitExslotRes,
    ] = await Promise.all([
      fetch("/api/master-data/json?table_name=mst_ship"),
      fetch("/api/master-data/json?table_name=mst_slotitem"),
      fetch("/api/asset-sync/ship-banner-map"),
      fetch("/api/asset-sync/ship-card-map"),
      fetch("/api/asset-sync/equip-image-map"),
      fetch("/api/asset-sync/weapon-icon-frames"),
      fetch("/data/slot_item_effects.json"),
      // Equipment filtering tables
      fetch("/api/master-data/json?table_name=mst_stype"),
      fetch("/api/master-data/json?table_name=mst_equip_exslot"),
      fetch("/api/master-data/json?table_name=mst_equip_ship"),
      fetch("/api/master-data/json?table_name=mst_equip_exslot_ship"),
      fetch("/api/master-data/json?table_name=mst_equip_limit_exslot"),
    ]);

    if (shipRes.ok) {
      const shipData = (await shipRes.json()) as { records: MstShipData[] };
      if (shipData.records) {
        for (const s of shipData.records) {
          if (s && s.id != null && s.name) state.mstShips[s.id] = s;
        }
      }
    }

    if (equipRes.ok) {
      const equipData = (await equipRes.json()) as {
        records: MstSlotItemData[];
      };
      if (equipData.records) {
        for (const e of equipData.records) {
          if (e && e.id != null && e.name)
            state.mstSlotItems[e.id] = normalizeMstSlotItem(e);
        }
      }
    }

    if (bannerRes.ok) {
      const mapData = (await bannerRes.json()) as {
        base_url: string;
        banners: Record<string, string>;
      };
      if (mapData.base_url) state.assetBaseUrl = mapData.base_url;
      if (mapData.banners) state.bannerMap = mapData.banners;
    }

    if (cardRes.ok) {
      const mapData = (await cardRes.json()) as {
        base_url: string;
        cards: Record<string, string>;
      };
      if (mapData.base_url && !state.assetBaseUrl)
        state.assetBaseUrl = mapData.base_url;
      if (mapData.cards) state.cardMap = mapData.cards;
    }

    if (equipImgRes.ok) {
      const eMap = (await equipImgRes.json()) as {
        base_url: string;
        card: Record<string, string>;
        item_up: Record<string, string>;
      };
      if (eMap.base_url && !state.assetBaseUrl)
        state.assetBaseUrl = eMap.base_url;
      if (eMap.card) state.equipCardMap = eMap.card;
      if (eMap.item_up) state.equipItemUpMap = eMap.item_up;
    }

    if (iconFrameRes.ok) {
      const atlas = (await iconFrameRes.json()) as {
        frames: Record<
          string,
          { frame: { x: number; y: number; w: number; h: number } }
        >;
        meta?: { size?: { w: number; h: number } };
      };
      if (atlas.frames) {
        state.weaponIconFrames = {};
        for (const [name, entry] of Object.entries(atlas.frames)) {
          const m = name.match(/_id_(\d+)$/);
          if (!m) continue;
          const { x, y, w, h } = entry.frame;
          state.weaponIconFrames[parseInt(m[1], 10)] = [x, y, w, h];
        }
      }
      if (atlas.meta?.size) {
        state.spriteSheetW = atlas.meta.size.w ?? 0;
        state.spriteSheetH = atlas.meta.size.h ?? 0;
      }
      const pngKey = "assets/kcs2/img/common/common_icon_weapon.png";
      try {
        const pngRes = await fetch("/api/asset-sync/weapon-icons");
        if (pngRes.ok) {
          const pngBlob = await pngRes.blob();
          state.spriteSheetUrl = await new Promise<string>(
            (resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(pngBlob);
            },
          );
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

    if (synergyRes.ok) {
      const synData = (await synergyRes.json()) as SlotItemEffectsData;
      if (synData.effects && synData.cross_effects) {
        state.slotItemEffects = synData;
      }
    }

    // ── Equipment filtering tables ──
    if (stypeRes.ok) {
      const data = (await stypeRes.json()) as { records: MstStypeData[] };
      if (data.records) {
        for (const s of data.records) {
          if (s && s.id != null) state.mstStypes[s.id] = s;
        }
      }
    }

    if (equipExslotRes.ok) {
      const data = (await equipExslotRes.json()) as {
        records: MstEquipExslotData[];
      };
      if (data.records) {
        for (const e of data.records) {
          if (e && e.equip != null) state.equipExslotSet.add(e.equip);
        }
      }
    }

    // mst_equip_ship — records now include ship_id field
    if (equipShipRes.ok) {
      const data = (await equipShipRes.json()) as {
        records: MstEquipShipData[];
      };
      if (data.records) {
        for (const r of data.records) {
          if (r && r.ship_id != null && r.equip_type) {
            state.mstEquipShip[r.ship_id] = r;
          }
        }
      }
    }

    // mst_equip_exslot_ship — records now include slotitem_id field
    if (equipExslotShipRes.ok) {
      const data = (await equipExslotShipRes.json()) as {
        records: MstEquipExslotShipData[];
      };
      if (data.records) {
        for (const r of data.records) {
          if (r && r.slotitem_id != null) {
            state.mstEquipExslotShip[r.slotitem_id] = r;
          }
        }
      }
    }

    // mst_equip_limit_exslot — records now include ship_id field
    if (equipLimitExslotRes.ok) {
      const data = (await equipLimitExslotRes.json()) as {
        records: MstEquipLimitExslotData[];
      };
      if (data.records) {
        for (const r of data.records) {
          if (r && r.ship_id != null && r.equip) {
            state.mstEquipLimitExslot[r.ship_id] = r;
          }
        }
      }
    }
  } catch {
    // Server unavailable
  }

  updateDataStatus();
  renderAll();
}
